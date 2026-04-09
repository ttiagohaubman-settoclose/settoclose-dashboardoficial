// src/app/api/users/route.js
// Manages client user credentials stored in Upstash Redis

const REDIS_URL   = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;

async function redis(method, ...args) {
  const res = await fetch(
    `${REDIS_URL}/${method}/${args.map(a => encodeURIComponent(typeof a === 'object' ? JSON.stringify(a) : a)).join('/')}`,
    { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } }
  );
  const data = await res.json();
  return data.result;
}

export async function GET() {
  if (!REDIS_URL) return Response.json({ users: [] });
  try {
    const raw = await redis('get', 'client:users');
    const users = raw ? JSON.parse(raw) : [];
    return Response.json({ users });
  } catch (e) {
    return Response.json({ users: [] });
  }
}

export async function POST(request) {
  const body = await request.json();
  if (!REDIS_URL) return Response.json({ ok: false, error: 'KV not configured' });

  // Validate credentials (login check)
  if (body.action === 'login') {
    try {
      const raw = await redis('get', 'client:users');
      const users = raw ? JSON.parse(raw) : [];
      const match = users.find(u => u.username === body.username && u.password === body.password);
      if (match) return Response.json({ ok: true, officeId: match.officeId, officeName: match.officeName });
      return Response.json({ ok: false });
    } catch (e) {
      return Response.json({ ok: false, error: e.message });
    }
  }

  // Save users list
  if (body.action === 'save') {
    try {
      await redis('set', 'client:users', JSON.stringify(body.users));
      return Response.json({ ok: true });
    } catch (e) {
      return Response.json({ ok: false, error: e.message });
    }
  }

  return Response.json({ ok: false, error: 'Unknown action' });
}
