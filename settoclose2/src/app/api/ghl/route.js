const LOCATION_ID = 'EiZQnibRq2k2C21iyxmd'

// Two shared calendars (English + Spanish).
// Once per-client calendars are created, add them here per office.
const CALENDAR_IDS = [
  'CsOaL7Tro3wqQsnqLjqP', // English
  'fGkik0B8jmdRT2nMWYDt', // Spanish
]

// Each office is identified in GHL by a contact tag.
// Secondary tags (Scheduled, venta, english, spanish) are checked locally.
const OFFICE_TAGS = {
  VA: 'va leads - jorge',
  MD: 'md leads - fernando',
  NC: 'nc leads - danelly',
  SC: 'sc leads - a&y',
}

const hasTag = (contact, tag) =>
  (contact.tags || []).some(t => t.toLowerCase() === tag.toLowerCase())

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const officeId = searchParams.get('officeId')
  const dateFrom = searchParams.get('dateFrom')
  const dateTo   = searchParams.get('dateTo')

  const officeTag = OFFICE_TAGS[officeId]
  if (!officeTag) return Response.json({ error: 'Invalid officeId' }, { status: 400 })

  const token = process.env.GHL_TOKEN
  if (!token) return Response.json({ error: 'GHL_TOKEN not configured' }, { status: 500 })

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Version': '2021-07-28',
    'Content-Type': 'application/json',
  }

  const fromDate = new Date(dateFrom + 'T00:00:00.000Z')
  const toDate   = new Date(dateTo   + 'T23:59:59.999Z')

  try {
    // ── 1. CALENDAR APPOINTMENTS (shared — same data for all offices for now) ──
    const allEvents = []
    await Promise.all(CALENDAR_IDS.map(async (calId) => {
      try {
        const startTime = fromDate.getTime()
        const endTime   = toDate.getTime()
        const p = new URLSearchParams({ locationId: LOCATION_ID, calendarId: calId, startTime, endTime })
        const r = await fetch(`https://services.leadconnectorhq.com/calendars/events?${p}`, { headers })
        const j = await r.json()
        if (j.events) allEvents.push(...j.events)
      } catch (e) { console.warn(`Calendar ${calId} error:`, e.message) }
    }))

    const bookedByDate  = {}
    const showedByDate  = {}
    allEvents.forEach(ev => {
      const raw = ev.startTime || ev.dateAdded
      if (!raw) return
      const date = new Date(raw).toISOString().split('T')[0]
      bookedByDate[date] = (bookedByDate[date] || 0) + 1
      if (ev.appointmentStatus === 'showed' || ev.appointmentStatus === 'completed') {
        showedByDate[date] = (showedByDate[date] || 0) + 1
      }
    })

    // ── 2. CONTACTS WITH OFFICE TAG (paginated) ──────────────────────────────
    let allContacts  = []
    let startAfter   = null
    let startAfterId = null
    let keepGoing    = true

    while (keepGoing) {
      const p = new URLSearchParams({ locationId: LOCATION_ID, tags: officeTag, limit: 100 })
      if (startAfter)   p.set('startAfter', startAfter)
      if (startAfterId) p.set('startAfterId', startAfterId)

      const r = await fetch(`https://services.leadconnectorhq.com/contacts/?${p}`, { headers })
      const j = await r.json()
      const contacts = j.contacts || []
      allContacts = [...allContacts, ...contacts]

      if (contacts.length < 100 || !j.meta?.startAfter) {
        keepGoing = false
      } else {
        startAfter   = j.meta.startAfter
        startAfterId = j.meta.startAfterId || null
      }
      if (allContacts.length > 5000) break
    }

    // Filter to contacts added in the requested date range
    const inRange = allContacts.filter(c => {
      if (!c.dateAdded) return false
      const d = new Date(c.dateAdded)
      return d >= fromDate && d <= toDate
    })

    // ── 3. BUILD DAILY BUCKETS FROM CONTACTS ─────────────────────────────────
    const leadsByDate  = {}
    const salesByDate  = {}

    inRange.forEach(c => {
      const date = new Date(c.dateAdded).toISOString().split('T')[0]
      leadsByDate[date] = (leadsByDate[date] || 0) + 1
      if (hasTag(c, 'venta')) salesByDate[date] = (salesByDate[date] || 0) + 1
    })

    // ── 4. VENTAS LIST ────────────────────────────────────────────────────────
    const ventasList = inRange
      .filter(c => hasTag(c, 'venta'))
      .map(c => ({
        id:       c.id,
        name:     `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Sin nombre',
        phone:    c.phone || '',
        email:    c.email || '',
        date:     new Date(c.dateAdded).toISOString().split('T')[0],
        status:   hasTag(c, 'pagada') ? 'pagada' : 'venta',
        language: hasTag(c, 'english') ? 'english' : hasTag(c, 'spanish') ? 'spanish' : '',
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date))

    // ── 5. AGGREGATE TOTALS (for CRM summary cards) ───────────────────────────
    const totals = {
      leads:     inRange.length,
      scheduled: inRange.filter(c => hasTag(c, 'Scheduled')).length,
      ventas:    inRange.filter(c => hasTag(c, 'venta')).length,
      english:   inRange.filter(c => hasTag(c, 'english')).length,
      spanish:   inRange.filter(c => hasTag(c, 'spanish')).length,
    }

    // ── 6. DAILY ARRAY ────────────────────────────────────────────────────────
    const days = []
    const cursor = new Date(dateFrom + 'T00:00:00.000Z')
    const end    = new Date(dateTo   + 'T00:00:00.000Z')

    while (cursor <= end) {
      const date       = cursor.toISOString().split('T')[0]
      const appsBooked = bookedByDate[date] || 0
      const appsShowed = showedByDate[date] || 0
      const sales      = salesByDate[date]  || 0
      const leads      = leadsByDate[date]  || 0
      days.push({
        date,
        leads,
        appsBooked,
        appsShowed,
        showRate: appsBooked > 0 ? +((appsShowed / appsBooked) * 100).toFixed(1) : 0,
        sales,
      })
      cursor.setDate(cursor.getDate() + 1)
    }

    return Response.json({ days, ventas: ventasList, totals })

  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
