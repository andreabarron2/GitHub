const { query } = require('./db');

async function run() {
  try {
    const res = await query(
      'UPDATE comentarios SET respuesta_admin = $2, respondido = $3, leido = TRUE WHERE id = $1 RETURNING *',
      [4, 'respuesta test', true]
    );
    console.log(res.rows);
  } catch (err) {
    console.error('update failed', err);
  } finally {
    process.exit(0);
  }
}

run();
