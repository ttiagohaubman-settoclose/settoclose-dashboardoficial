export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const dateFrom = searchParams.get('dateFrom')
  const dateTo   = searchParams.get('dateTo')

  const LOCATION_ID = 'EiZQnibRq2k2C21iyxmd'
  const TOKEN = process.env.GHL_TOKEN

  // Mapeo de clientes a sus etiquetas
  const CLIENT_CONFIG = {
    jorge:   { label: 'va leads - jorge',  office: 'Virginia' },
    fernando:{ label: 'md leads - fernando', office: 'Maryland' },
    danelly: { label: 'nc leads - danelly', office: 'North Carolina' },
    ay:      { label: 'sc leads - a&y',     office: 'South Carolina' },
  }

  if (clientId && !CLIENT_CONFIG[clientId]) {
    return Response.json({ error: 'Invalid clientId' }, { status: 400 })
  }

  if (!TOKEN) {
    return Response.json({ error: 'GHL_TOKEN not configured' }, { status: 500 })
  }

  const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'Version': '2021-07-28',
    'Content-Type': 'application/json',
  }

  try {
    const fromDate = new Date(dateFrom + 'T00:00:00.000Z')
    const toDate   = new Date(dateTo   + 'T23:59:59.999Z')

    // ── CONTACTS con tag "venta" ─────────────────────────────────────
    // Si viene clientId, filtramos por su tag específica también
    let allContacts = []
    let startAfter = null
    let startAfterId = null
    let keepGoing = true

    while (keepGoing) {
      const p = new URLSearchParams({
        locationId: LOCATION_ID,
        tags: 'venta',
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
      if (allContacts.length > 5000) break
    }

    // Filtrar por cliente si viene clientId
    if (clientId) {
      const clientTag = CLIENT_CONFIG[clientId].label
      allContacts = allContacts.filter(c =>
        (c.tags || []).some(t => t.toLowerCase() === clientTag.toLowerCase())
      )
    }

    // Filtrar por rango de fechas
    const ventasInRange = allContacts.filter(c => {
      if (!c.dateAdded) return false
      const d = new Date(c.dateAdded)
      return d >= fromDate && d <= toDate
    })

    const closedByDate = {}
    const ventasList = []

    ventasInRange.forEach(c => {
      const tags = c.tags || []
      const date = new Date(c.dateAdded).toISOString().split('T')[0]
      closedByDate[date] = (closedByDate[date] || 0) + 1

      // Detectar a qué cliente pertenece
      let clientName = 'General'
      let officeName = 'General'
      for (const [key, cfg] of Object.entries(CLIENT_CONFIG)) {
        if (tags.some(t => t.toLowerCase() === cfg.label.toLowerCase())) {
          clientName = key
          officeName = cfg.office
          break
        }
      }

      ventasList.push({
        id:       c.id,
        name:     `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Sin nombre',
        phone:    c.phone || '',
        email:    c.email || '',
        date,
        client:   clientName,
        office:   officeName,
        language: tags.includes('english') ? 'English' : tags.includes('spanish') ? 'Spanish' : 'N/A',
        status:   tags.includes('pagada') ? 'pagada' : 'venta',
        scheduled: tags.includes('scheduled'),
      })
    })

    ventasList.sort((a, b) => new Date(b.date) - new Date(a.date))

    // ── DAILY ARRAY ──────────────────────────────────────────────────
    const days = []
    const cursor = new Date(dateFrom + 'T00:00:00.000Z')
    const end    = new Date(dateTo   + 'T00:00:00.000Z')
    while (cursor <= end) {
      const date  = cursor.toISOString().split('T')[0]
      const sales = closedByDate[date] || 0
      days.push({ date, sales })
      cursor.setDate(cursor.getDate() + 1)
    }

    return Response.json({ days, ventas: ventasList })

  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
