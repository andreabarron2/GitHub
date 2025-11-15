const path = require('path');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { pool, query, initDb } = require('./db');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'LittleNails@gmail.com';

const app = express();
const isSecure = process.env.USE_SECURE_COOKIES === '1';
app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Sessions with expiration (stored in Postgres)
app.use(
  session({
    store: new pgSession({
      pool,
      tableName: 'session',
      createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || 'little-nails-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? 'none' : 'lax',
      maxAge: 1000 * 60 * 60 * 2 // 2h
    }
  })
);

// Ensure DB schema exists and seed admin
(async () => {
  try {
    await initDb();
    // Seed admin if none exists (matches previous hardcoded credentials)
    const adminEmail = ADMIN_EMAIL;
    const adminPass = 'littlenails1';
    const { rowCount } = await query('SELECT 1 FROM users LIMIT 1');
    if (rowCount === 0) {
      const hash = await bcrypt.hash(adminPass, 10);
      await query(
        'INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)',
        [adminEmail, 'Admin', hash, 'admin']
      );
      console.log('Admin seed created:', adminEmail);
    }

    await query(
      `UPDATE users
         SET role = 'customer'
       WHERE email <> $1
         AND (role IS NULL OR role = '' OR role = 'admin')`,
      [adminEmail]
    );
  } catch (e) {
    console.error('DB init/seed error:', e);
  }
})();


// Logging middleware: muestra en consola cada petición entrante
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Health endpoint para comprobaciones rápidas
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Auth helpers
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'No autenticado' });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Acceso restringido' });
}

async function getComentarioTotals() {
  const { rows } = await query(`
    SELECT
      COUNT(*) FILTER (WHERE leido IS TRUE) AS leidos,
      COUNT(*) FILTER (WHERE leido IS NOT TRUE) AS no_leidos
    FROM comentarios
  `);
  const stats = rows[0] || {};
  return {
    leidos: Number(stats.leidos || 0),
    noLeidos: Number(stats.no_leidos || 0)
  };
}

async function deleteComentarioById(id) {
  return query('DELETE FROM comentarios WHERE id = $1 RETURNING id', [id]);
}

async function updateComentarioRespuesta(id, respuesta) {
  return query(
    `UPDATE comentarios
        SET respuesta_admin = $2,
            respondido = $3,
            leido = TRUE
      WHERE id = $1
      RETURNING *`,
    [id, respuesta, Boolean(respuesta && respuesta.trim())]
  );
}

// Registro (opcional para pruebas)
app.post('/register', async (req, res) => {
  const {
    email,
    password,
    name,
    apellidoPaterno,
    apellidoMaterno,
    telefono,
    ciudad,
    codigoPostal
  } = req.body;

  const errors = [];
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const onlyDigits = (s) => /^\d+$/.test(s || '');
  const emailTrim = (email || '').trim().toLowerCase();
  const passwordVal = (password || '').toString();
  if (!emailTrim || !emailRegex.test(emailTrim)) errors.push('Correo inválido');
  if (!passwordVal) errors.push('Contraseña requerida');
  if (passwordVal && passwordVal.length < 6) errors.push('La contraseña debe tener al menos 6 caracteres');
  if (!apellidoPaterno || !apellidoPaterno.trim()) errors.push('Apellido paterno requerido');
  if (!apellidoMaterno || !apellidoMaterno.trim()) errors.push('Apellido materno requerido');
  if (!telefono || !onlyDigits(telefono) || telefono.length !== 10) errors.push('Teléfono debe ser de 10 dígitos');
  if (!ciudad || !ciudad.trim()) errors.push('Ciudad requerida');
  if (!codigoPostal || !onlyDigits(codigoPostal) || codigoPostal.length !== 5) errors.push('Código postal debe ser de 5 dígitos');
  if (errors.length) return res.status(400).json({ errors });

  try {
    const hash = await bcrypt.hash(passwordVal, 10);
    await query(
      `INSERT INTO users (email, name, password_hash, apellido_paterno, apellido_materno, telefono, ciudad, codigo_postal, role)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        emailTrim,
        name ? name.trim() : null,
        hash,
        apellidoPaterno.trim(),
        apellidoMaterno.trim(),
        telefono.trim(),
        ciudad.trim(),
        codigoPostal.trim(),
        'customer'
      ]
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error('register error', e);
    if (e.code === '23505') {
      return res.status(409).json({ error: 'El correo ya está registrado' });
    }
    res.status(500).json({ error: 'No se pudo registrar' });
  }
});

// Login crea sesión con expiración
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await query('SELECT * FROM users WHERE email=$1', [email]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    const role = user.role || 'customer';
    req.session.user = { id: user.id, email: user.email, role };
    res.json({ ok: true, role });
  } catch (e) {
    console.error('login error', e);
    res.status(500).json({ error: 'No se pudo iniciar sesión' });
  }
});

app.get('/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

app.get('/mis-pedidos', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const userEmail = req.session.user.email;
    const { rows } = await query(
      `SELECT id, nombre, apellido_paterno, apellido_materno, estado, codigo_postal, resumen_pedido, estado_pedido, created_at
       FROM datos_usuario
       WHERE usuario_id = $1 OR email = $2
       ORDER BY created_at DESC`,
      [userId, userEmail]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error al obtener pedidos del usuario:', err);
    res.status(500).json({ error: 'No se pudieron obtener los pedidos' });
  }
});

app.get('/profile', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, email, name, apellido_paterno, apellido_materno, telefono, ciudad, codigo_postal
       FROM users WHERE id = $1`,
      [req.session.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (e) {
    console.error('profile error', e);
    res.status(500).json({ error: 'No se pudo obtener el perfil' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Guardar usuario
app.post('/guardar-usuario', async (req, res) => {
  console.log('Datos recibidos:', req.body); // Para depurar

  const sessionUserId = req.session?.user?.id || null;
  let profile = null;
  if (sessionUserId) {
    try {
      const profileRes = await query(
        `SELECT name, apellido_paterno, apellido_materno, email, telefono, ciudad, codigo_postal
         FROM users WHERE id=$1`,
        [sessionUserId]
      );
      profile = profileRes.rows[0] || null;
    } catch (err) {
      console.error('Error obteniendo perfil para pedido', err);
    }
  }

  const payload = {
    nombre: (req.body.nombre || (profile?.name ?? '')).trim(),
    apellidoPaterno: (req.body.apellidoPaterno || profile?.apellido_paterno || '').trim(),
    apellidoMaterno: (req.body.apellidoMaterno || profile?.apellido_materno || '').trim(),
    email: (req.body.email || profile?.email || '').trim(),
    telefono: (req.body.telefono || profile?.telefono || '').trim(),
    estado: (req.body.estado || profile?.ciudad || '').trim(),
    codigoPostal: (req.body.codigoPostal || profile?.codigo_postal || '').trim(),
    resumenPedido: (req.body.resumenPedido || '').trim(),
    estadoPedido: 'Pendiente por realizar'
  };

  const errors = [];
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const onlyDigits = (s) => /^\d+$/.test(s || '');
  if (!payload.nombre) errors.push('Nombre requerido');
  if (!payload.apellidoPaterno) errors.push('Apellido paterno requerido');
  if (!payload.apellidoMaterno) errors.push('Apellido materno requerido');
  if (!payload.email || !emailRegex.test(payload.email)) errors.push('Correo inválido');
  if (!payload.telefono || !onlyDigits(payload.telefono) || payload.telefono.length !== 10) errors.push('Teléfono inválido');
  if (!payload.estado) errors.push('Ciudad requerida');
  if (!payload.codigoPostal || !onlyDigits(payload.codigoPostal) || payload.codigoPostal.length !== 5) errors.push('Código postal inválido');
  if (errors.length) return res.status(400).json({ errors });

  try {
    const insertRes = await query(
      `INSERT INTO datos_usuario 
        (nombre, apellido_paterno, apellido_materno, email, telefono, estado, codigo_postal, resumen_pedido, estado_pedido, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, created_at`,
      [
        payload.nombre,
        payload.apellidoPaterno,
        payload.apellidoMaterno,
        payload.email,
        payload.telefono,
        payload.estado,
        payload.codigoPostal,
        payload.resumenPedido,
        payload.estadoPedido,
        sessionUserId
      ]
    );

    const newOrder = {
      id: insertRes.rows?.[0]?.id || null,
      createdAt: insertRes.rows?.[0]?.created_at || null,
      usuarioId: sessionUserId,
      ...payload
    };
    console.log('Pedido registrado (pedido ID):', newOrder.id);

    res.status(200).send('Datos guardados correctamente');
  } catch (err) {
    console.error('Error al guardar:', err);
    res.status(500).send('Error al guardar los datos');
  }
});

// Obtener usuarios
app.get('/usuarios', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM datos_usuario ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error('Error al obtener usuarios:', err);
    res.status(500).send('Error al obtener usuarios');
  }
});

// Actualizar un usuario/pedido (admin)
app.put('/usuarios/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = req.params.id;
  // Validaciones básicas
  const errors = [];
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const onlyDigits = (s) => /^\d+$/.test(s);
  if (Object.prototype.hasOwnProperty.call(req.body, 'nombre')) {
    const v = (req.body.nombre || '').toString().trim();
    if (v.length === 0) errors.push('El nombre es obligatorio');
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'email')) {
    const v = (req.body.email || '').toString().trim();
    if (!emailRegex.test(v)) errors.push('Correo electrónico inválido');
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'telefono')) {
    const v = (req.body.telefono || '').toString().trim();
    if (v && (!onlyDigits(v) || v.length !== 10)) errors.push('El teléfono debe tener 10 dígitos');
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'codigo_postal')) {
    const v = (req.body.codigo_postal || '').toString().trim();
    if (v && (!onlyDigits(v) || v.length !== 5)) errors.push('El código postal debe tener 5 dígitos');
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'estado_pedido')) {
    const estadoPedido = (req.body.estado_pedido || '').toString().trim();
    const allowedEstados = ['Pendiente por realizar', 'Realizado'];
    if (estadoPedido && !allowedEstados.includes(estadoPedido)) {
      errors.push('Estado de pedido inválido');
    }
  }
  if (errors.length) return res.status(400).json({ errors });
  // Acepta actualización parcial de estos campos
  const allowed = {
    nombre: req.body.nombre,
    apellido_paterno: req.body.apellido_paterno,
    apellido_materno: req.body.apellido_materno,
    email: req.body.email,
    telefono: req.body.telefono,
    estado: req.body.estado,
    codigo_postal: req.body.codigo_postal,
    resumen_pedido: req.body.resumen_pedido,
    estado_pedido: req.body.estado_pedido ? req.body.estado_pedido.toString().trim() : undefined
  };
  const keys = Object.keys(allowed).filter(k => allowed[k] !== undefined);
  if (keys.length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });
  const setSql = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const params = keys.map(k => allowed[k]);
  params.push(id);
  try {
    const { rows } = await query(`UPDATE datos_usuario SET ${setSql} WHERE id = $${keys.length + 1} RETURNING *`, params);
    if (rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (e) {
    console.error('Error al actualizar usuario', e);
    res.status(500).json({ error: 'No se pudo actualizar' });
  }
});

// Eliminar un usuario/pedido (admin)
app.delete('/usuarios/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    const { rowCount } = await query('DELETE FROM datos_usuario WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'No encontrado' });
    res.status(204).send();
  } catch (e) {
    console.error('Error al eliminar usuario', e);
    res.status(500).json({ error: 'No se pudo eliminar' });
  }
});

// Guardar comentario
app.post('/comentarios', async (req, res) => {
  const { nombre, email, mensaje } = req.body;
  if (!nombre || !email || !mensaje) return res.status(400).json({ error: 'Faltan campos' });
  try {
    await query('INSERT INTO comentarios (nombre, email, mensaje) VALUES ($1,$2,$3)', [nombre, email, mensaje]);
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error('Error guardando comentario', e);
    res.status(500).json({ error: 'No se pudo guardar el comentario' });
  }
});

// Listar comentarios (admin)
app.get('/admin/comentarios', requireAuth, requireAdmin, async (req, res) => {
  try {
    const search = (req.query.search || '').toString().trim();
    let rows;
    if (search) {
      const like = `%${search.toLowerCase()}%`;
      const result = await query(
        `SELECT *
           FROM comentarios
          WHERE LOWER(nombre) LIKE $1
             OR LOWER(email) LIKE $1
             OR LOWER(mensaje) LIKE $1
             OR LOWER(COALESCE(respuesta_admin, '')) LIKE $1
          ORDER BY leido ASC, created_at DESC`,
        [like]
      );
      rows = result.rows;
    } else {
      const result = await query('SELECT * FROM comentarios ORDER BY leido ASC, created_at DESC');
      rows = result.rows;
    }
    const totals = await getComentarioTotals();
    res.json({ items: rows, totals });
  } catch (e) {
    console.error('Error listando comentarios', e);
    res.status(500).json({ error: 'No se pudo obtener comentarios' });
  }
});

// Marcar comentario como leído (admin)
app.patch('/admin/comentarios/:id/marcar', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await query('UPDATE comentarios SET leido = TRUE WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Comentario no encontrado' });
    }
    const totals = await getComentarioTotals();
    res.json({ ok: true, totals });
  } catch (e) {
    console.error('Error marcando comentario', e);
    res.status(500).json({ error: 'No se pudo marcar el comentario' });
  }
});

// Eliminar comentario (admin)
app.delete('/admin/comentarios/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await deleteComentarioById(req.params.id);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Comentario no encontrado' });
    }
    const totals = await getComentarioTotals();
    res.json({ ok: true, totals });
  } catch (e) {
    console.error('Error eliminando comentario', e);
    res.status(500).json({ error: 'No se pudo eliminar el comentario' });
  }
});

// Responder comentario (admin)
app.put('/admin/comentarios/:id/respuesta', requireAuth, requireAdmin, async (req, res) => {
  try {
    const respuesta = (req.body.respuesta || '').toString().trim();
    const result = await updateComentarioRespuesta(req.params.id, respuesta);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Comentario no encontrado' });
    }
    const totals = await getComentarioTotals();
    res.json({ ok: true, comentario: result.rows[0], totals });
  } catch (e) {
    console.error('Error guardando respuesta', e);
    res.status(500).json({ error: 'No se pudo guardar la respuesta' });
  }
});

// Servir archivos estáticos del frontend (opcional al usar live-server)
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));
app.get('/', (req, res) => res.sendFile(path.join(frontendPath, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

