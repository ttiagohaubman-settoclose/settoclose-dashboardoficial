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
    const startTime = new Date(dateFrom).getTime()
    const endTime   = new Date(dateTo + 'T23:59:59').getTime()
    const from      = new Date(dateFrom)
    const to        = new Date(dateTo + 'T23:59:59')

    // ── 1. APPOINTMENTS ──────────────────────────────────────────────
    const allEvents = []
    await Promise.all(cfg.calendarIds.map(async (calId) => {
      const p = new URLSearchParams({ locationId: cfg.locationId, calendarId: calId, startTime, endTime })
      const r = await fetch(`https://services.leadconnectorhq.com/calendars/events?${p}`, { headers })
      const j = await r.json()
      if (j.events) allEvents.push(...j.events)
    }))

    const bookedByDate = {}
    const showedByDate = {}
    allEvents.forEach(ev => {
      const date = ev.startTime?.split('T')[0]
      if (!date) return
      bookedByDate[date] = (bookedByDate[date] || 0) + 1
      if (ev.appointmentStatus === 'showed' || ev.appointmentStatus === 'completed') {
        showedByDate[date] = (showedByDate[date] || 0) + 1
      }
    })

    // ── 2. CONTACTS WITH TAG "venta" ─────────────────────────────────
    let page = 1, allContacts = [], hasMore = true
    while (hasMore) {
      const p = new URLSearchParams({ locationId: cfg.locationId, tag: 'venta', limit: 100, page })
      const r = await fetch(`https://services.leadconnectorhq.com/contacts/?${p}`, { headers })
      const j = await r.json()
      const contacts = j.contacts || []
      allContacts = [...allContacts, ...contacts]
      hasMore = contacts.length === 100
      page++
      if (page > 20) break
    }

    // Filter by date range
    const ventasInRange = allContacts.filter(c => {
      const d = new Date(c.dateUpdated || c.dateAdded)
      return d >= from && d <= to
    })

    const closedByDate = {}
    const ventasList = []

    ventasInRange.forEach(c => {
      const date = new Date(c.dateUpdated || c.dateAdded).toISOString().split('T')[0]
      closedByDate[date] = (closedByDate[date] || 0) + 1
      const tags = c.tags || []
      ventasList.push({
        id:     c.id,
        name:   `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Sin nombre',
        phone:  c.phone || '',
        email:  c.email || '',
        date,
        status: tags.includes('pagada') ? 'pagada' : 'venta',
      })
    })

    // Sort by date desc
    ventasList.sort((a, b) => new Date(b.date) - new Date(a.date))

    // ── 3. DAILY ARRAY ───────────────────────────────────────────────
    const days = []
    for (let d = new Date(dateFrom); d <= new Date(dateTo); d.setDate(d.getDate() + 1)) {
      const date = d.toISOString().split('T')[0]
      const appsBooked = bookedByDate[date] || 0
      const appsShowed = showedByDate[date] || 0
      const sales      = closedByDate[date] || 0
      days.push({ date, appsBooked, appsShowed, showRate: appsBooked > 0 ? +((appsShowed/appsBooked)*100).toFixed(1) : 0, sales })
    }

    return Response.json({ days, ventas: ventasList })

  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
