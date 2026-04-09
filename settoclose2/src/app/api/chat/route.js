// src/app/api/chat/route.js
// Ads chat messages stored in Upstash Redis per officeId

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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const officeId = searchParams.get('officeId');
  if (!officeId) return Response.json({ messages: [] });
  if (!REDIS_URL) return Response.json({ messages: [] });
  try {
    const raw = await redis('get', `chat:${officeId}`);
    const messages = raw ? JSON.parse(raw) : [];
    return Response.json({ messages });
  } catch(e) {
    return Response.json({ messages: [] });
  }
}

export async function POST(request) {
  const body = await request.json();
  const { officeId, author, text, role } = body;
  if (!officeId || !text?.trim()) return Response.json({ ok: false });
  if (!REDIS_URL) return Response.json({ ok: false, error: 'KV not configured' });

  if (body.action === 'clear') {
    try {
      await redis('set', `chat:${officeId}`, JSON.stringify([]));
      return Response.json({ ok: true });
    } catch(e) { return Response.json({ ok: false }); }
  }

  try {
    const raw = await redis('get', `chat:${officeId}`);
    const messages = raw ? JSON.parse(raw) : [];
    const newMsg = {
      id:        Date.now() + Math.floor(Math.random() * 10000),
      officeId,
      author:    author || 'Anónimo',
      role:      role || 'admin',    // 'admin' | 'client'
      text:      text.trim(),
      timestamp: new Date().toISOString(),
    };
    messages.push(newMsg);
    // Keep last 200 messages max
    if (messages.length > 200) messages.splice(0, messages.length - 200);
    await redis('set', `chat:${officeId}`, JSON.stringify(messages));
    return Response.json({ ok: true, message: newMsg });
  } catch(e) {
    return Response.json({ ok: false, error: e.message });
  }
}
