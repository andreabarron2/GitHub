const fetch = global.fetch;

async function run() {
  const base = 'http://localhost:3000';
  const loginRes = await fetch(base + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'LittleNails@gmail.com', password: 'littlenails1' }),
    redirect: 'manual'
  });
  const cookies = loginRes.headers.get('set-cookie');
  console.log('login status', loginRes.status, 'cookies', cookies);
  const replyRes = await fetch(base + '/admin/comentarios/4/respuesta', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookies || ''
    },
    body: JSON.stringify({ respuesta: 'desde script' })
  });
  const replyText = await replyRes.text();
  console.log('reply status', replyRes.status, 'body', replyText);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
