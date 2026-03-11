// src/app/api/logs/route.js
// Saves and retrieves action logs from Upstash Redis

const REDIS_URL   = process.env.KV_REST_API_URL
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN

async function redis(method, ...args) {
  const res = await fetch(`${REDIS_URL}/${method}/${args.map(a => encodeURIComponent(typeof a === 'object' ? JSON.stringify(a) : a)).join('/')}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  })
  const data = await res.json()
  return data.result
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const officeId = searchParams.get('officeId')
  if (!officeId) return Response.json({ error: 'officeId required' }, { status: 400 })
  if (!REDIS_URL) return Response.json({ logs: [] })

  try {
    const raw = await redis('get', `logs:${officeId}`)
    const logs = raw ? JSON.parse(raw) : []
    return Response.json({ logs })
  } catch (e) {
    return Response.json({ logs: [] })
  }
}

export async function POST(request) {
  const { officeId, logs } = await request.json()
  if (!officeId) return Response.json({ error: 'officeId required' }, { status: 400 })
  if (!REDIS_URL) return Response.json({ ok: false, error: 'KV not configured' })

  try {
    await redis('set', `logs:${officeId}`, JSON.stringify(logs))
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ ok: false, error: e.message })
  }
}
