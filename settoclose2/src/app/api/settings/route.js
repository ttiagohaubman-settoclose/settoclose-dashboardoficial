// src/app/api/settings/route.js
// Saves and retrieves global dashboard settings (bgThemes, offices) from Upstash Redis

const REDIS_URL   = process.env.KV_REST_API_URL
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN

async function redis(method, ...args) {
  const res = await fetch(
    `${REDIS_URL}/${method}/${args.map(a => encodeURIComponent(typeof a === 'object' ? JSON.stringify(a) : a)).join('/')}`,
    { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } }
  )
  const data = await res.json()
  return data.result
}

export async function GET() {
  if (!REDIS_URL) return Response.json({ settings: null })
  try {
    const raw = await redis('get', 'settings:global')
    const settings = raw ? JSON.parse(raw) : null
    return Response.json({ settings })
  } catch (e) {
    return Response.json({ settings: null })
  }
}

export async function POST(request) {
  const { settings } = await request.json()
  if (!REDIS_URL) return Response.json({ ok: false, error: 'KV not configured' })
  try {
    await redis('set', 'settings:global', JSON.stringify(settings))
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ ok: false, error: e.message })
  }
}
