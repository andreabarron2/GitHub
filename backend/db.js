// PostgreSQL connection via pg Pool (compatible with Render Postgres)
const { Pool } = require('pg');

// Prefer environment variable; fall back to provided external URL
const CONNECTION_STRING = process.env.DATABASE_URL ||
  'postgresql://little_nails_luxury_ek5x_user:WAA2aLyA77MLwii5sjQviq3Q29BILloe@dpg-d4a274adbo4c73c3f910-a.frankfurt-postgres.render.com/little_nails_luxury_ek5x';

const pool = new Pool({
  connectionString: CONNECTION_STRING,
  ssl: {
    rejectUnauthorized: false // Render requires SSL; allow provided cert
  }
});

async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production') {
    console.log('executed query', { text, duration, rows: res.rowCount });
  }
  return res;
}

// Initialize database schema (idempotent)
async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'customer',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS datos_usuario (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      apellido_paterno TEXT NOT NULL,
      apellido_materno TEXT NOT NULL,
      email TEXT NOT NULL,
      telefono TEXT,
      estado TEXT,
      codigo_postal TEXT,
      resumen_pedido TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS comentarios (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      email TEXT NOT NULL,
      mensaje TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      leido BOOLEAN DEFAULT FALSE,
      respuesta_admin TEXT,
      respondido BOOLEAN DEFAULT FALSE
    );
  `);

  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS apellido_paterno TEXT,
    ADD COLUMN IF NOT EXISTS apellido_materno TEXT,
    ADD COLUMN IF NOT EXISTS telefono TEXT,
    ADD COLUMN IF NOT EXISTS ciudad TEXT,
    ADD COLUMN IF NOT EXISTS codigo_postal TEXT;
  `);

  await query(`
    ALTER TABLE users
    ALTER COLUMN role SET DEFAULT 'customer';
  `);

  // Backfill columns that may be missing from earlier versions
  await query(`
    ALTER TABLE comentarios
      ADD COLUMN IF NOT EXISTS nombre TEXT,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS mensaje TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS leido BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS respuesta_admin TEXT,
      ADD COLUMN IF NOT EXISTS respondido BOOLEAN DEFAULT FALSE;
  `);

  await query(`
    ALTER TABLE datos_usuario
    ADD COLUMN IF NOT EXISTS estado_pedido TEXT DEFAULT 'Pendiente por realizar',
    ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES users(id);
  `);

  await query(`
    UPDATE datos_usuario
    SET estado_pedido = 'Pendiente por realizar'
    WHERE estado_pedido IS NULL;
  `);

  // Relax legacy NOT NULL constraints so new flow can insert without FK
  await query(`
    DO $$ BEGIN
      BEGIN ALTER TABLE comentarios ALTER COLUMN usuario_id DROP NOT NULL; EXCEPTION WHEN undefined_column THEN END;
      BEGIN ALTER TABLE comentarios ALTER COLUMN diseno_id DROP NOT NULL; EXCEPTION WHEN undefined_column THEN END;
      BEGIN ALTER TABLE comentarios ALTER COLUMN rating DROP NOT NULL; EXCEPTION WHEN undefined_column THEN END;
      BEGIN ALTER TABLE comentarios ALTER COLUMN comentario DROP NOT NULL; EXCEPTION WHEN undefined_column THEN END;
      BEGIN ALTER TABLE comentarios ALTER COLUMN creado_en DROP NOT NULL; EXCEPTION WHEN undefined_column THEN END;
    END $$;
  `);
}

module.exports = { pool, query, initDb };
