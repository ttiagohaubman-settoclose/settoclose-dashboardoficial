export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const officeId = searchParams.get('officeId')
  const dateFrom = searchParams.get('dateFrom')
  const dateTo   = searchParams.get('dateTo')

  const CONFIG = {
    SC: { locationId: 'cCytukkNAHUpNbtKDk2e', token: process.env.GHL_TOKEN_SC, calendarIds: ['Y7Syrvxv1KnzBfOmv4Vu','iWHyrsAK8e5D1GGDo3jO'] },
    VA: { locationId: 'WqKinxJ77nKg9ppEQifq', token: process.env.GHL_TOKEN_VA, calendarIds: ['F6oJTEf1CoIgYeSnsTPZ','akCXPNaK4nkh4c11IBYo'] },
    MD: { locationId: 'PBIUP5IiLK1GJTISSwOi', token: process.env.GHL_TOKEN_MD, calendarIds: ['sMPqiIGbiOH5hEV22zWA','M4hGQ2JFwGsdai8Zz5sy'] },
    NC: { locationId: 'ZzYnwk1G9JMLRWYvoJJT', token: process.env.GHL_TOKEN_NC, calendarIds: ['iZLArVoRxshTpY9B36H9'] },
  }

  const cfg = CONFIG[officeId]
  if (!cfg)       return Response.json({ error: 'Invalid officeId' }, { status: 400 })
  if (!cfg.token) return Response.json({ error: `GHL_TOKEN_${officeId} not configured` }, { status: 500 })

  const headers = {
    'Authorization': `Bearer ${cfg.token}`,
    'Version': '2021-07-28',
    'Content-Type': 'application/json',
  }

  try {
    // Date range — use full day boundaries in UTC
    const startTime = new Date(dateFrom + 'T00:00:00.000Z').getTime()
    const endTime   = new Date(dateTo   + 'T23:59:59.999Z').getTime()
    const fromDate  = new Date(dateFrom + 'T00:00:00.000Z')
    const toDate    = new Date(dateTo   + 'T23:59:59.999Z')

    // ── 1. APPOINTMENTS ──────────────────────────────────────────────
    const allEvents = []
    await Promise.all(cfg.calendarIds.map(async (calId) => {
      try {
        const p = new URLSearchParams({ locationId: cfg.locationId, calendarId: calId, startTime, endTime })
        const r = await fetch(`https://services.leadconnectorhq.com/calendars/events?${p}`, { headers })
        const j = await r.json()
        if (j.events) allEvents.push(...j.events)
      } catch(e) { console.warn(`Calendar ${calId} error:`, e.message) }
    }))

    const bookedByDate = {}
    const showedByDate = {}
    allEvents.forEach(ev => {
      // Use startTime of appointment for the date
      const raw = ev.startTime || ev.dateAdded
      if (!raw) return
      const date = new Date(raw).toISOString().split('T')[0]
      bookedByDate[date] = (bookedByDate[date] || 0) + 1
      if (ev.appointmentStatus === 'showed' || ev.appointmentStatus === 'completed') {
        showedByDate[date] = (showedByDate[date] || 0) + 1
      }
    })

    // ── 2. CONTACTS WITH TAG "venta" — full pagination ───────────────
    let allContacts = []
    // Use startAfterDate cursor-based pagination (more reliable than page)
    let startAfter = null
    let startAfterId = null
    let keepGoing = true

    while (keepGoing) {
      const p = new URLSearchParams({
        locationId: cfg.locationId,
        tags: 'venta',    // some GHL versions use 'tags' plural
        limit: 100,
      })
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
      if (allContacts.length > 2000) break // safety cap
    }

    // Also try with tag singular param in case of GHL version difference
    if (allContacts.length === 0) {
      const p2 = new URLSearchParams({ locationId: cfg.locationId, tag: 'venta', limit: 100 })
      const r2 = await fetch(`https://services.leadconnectorhq.com/contacts/?${p2}`, { headers })
      const j2 = await r2.json()
      allContacts = j2.contacts || []
    }

    // Filter contacts by date range
    // Use dateAdded as the "sale date" — more stable than dateUpdated
    const ventasInRange = allContacts.filter(c => {
      // Prefer custom field "closeDate" if exists, fallback to dateAdded
      const rawDate = c.dateAdded
      if (!rawDate) return false
      const d = new Date(rawDate)
      return d >= fromDate && d <= toDate
    })

    const closedByDate = {}
    const ventasList = []

    ventasInRange.forEach(c => {
      const date = new Date(c.dateAdded).toISOString().split('T')[0]
      closedByDate[date] = (closedByDate[date] || 0) + 1
      const tags = c.tags || []
      ventasList.push({
        id:      c.id,
        name:    `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Sin nombre',
        phone:   c.phone || '',
        email:   c.email || '',
        address: [c.address1, c.city, c.state].filter(Boolean).join(', '),
        date,
        status:  tags.includes('pagada') ? 'pagada' : 'venta',
      })
    })

    ventasList.sort((a, b) => new Date(b.date) - new Date(a.date))

    // ── 3. DAILY ARRAY ───────────────────────────────────────────────
    const days = []
    const cursor = new Date(dateFrom + 'T00:00:00.000Z')
    const end    = new Date(dateTo   + 'T00:00:00.000Z')
    while (cursor <= end) {
      const date       = cursor.toISOString().split('T')[0]
      const appsBooked = bookedByDate[date] || 0
      const appsShowed = showedByDate[date] || 0
      const sales      = closedByDate[date] || 0
      days.push({
        date, appsBooked, appsShowed,
        showRate: appsBooked > 0 ? +((appsShowed / appsBooked) * 100).toFixed(1) : 0,
        sales,
      })
      cursor.setDate(cursor.getDate() + 1)
    }

    // ── 4. APPOINTMENTS LIST ─────────────────────────────────────────
    const appointmentsList = allEvents
      .filter(ev => ev.startTime || ev.dateAdded)
      .map(ev => {
        const ct = ev.contact || {}
        const name = [ct.firstName, ct.lastName].filter(Boolean).join(' ') || ev.title || 'Sin nombre'
        return {
          id:      ev.id,
          name,
          phone:   ct.phone   || '',
          email:   ct.email   || '',
          address: [ct.address1, ct.city, ct.state].filter(Boolean).join(', '),
          date:    ev.startTime || ev.dateAdded,
          status:  ev.appointmentStatus || 'booked',
        }
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date))

    return Response.json({ days, ventas: ventasList, appointments: appointmentsList })

  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
