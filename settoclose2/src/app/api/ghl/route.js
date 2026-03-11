export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const officeId  = searchParams.get('officeId')
  const dateFrom  = searchParams.get('dateFrom')
  const dateTo    = searchParams.get('dateTo')

  const CONFIG = {
    SC: { locationId: 'cCytukkNAHUpNbtKDk2e', pipelineId: '66Nwo6mQHylEGha2G3Eq', token: process.env.GHL_TOKEN_SC },
    VA: { locationId: 'WqKinxJ77nKg9ppEQifq', pipelineId: '8YUi2O3NzfzVcBhvPtu5', token: process.env.GHL_TOKEN_VA },
    MD: { locationId: 'PBIUP5IiLK1GJTISSwOi', pipelineId: 'omwLqbX0Ee6RBD0CmjC0', token: process.env.GHL_TOKEN_MD },
    NC: { locationId: 'ZzYnwk1G9JMLRWYvoJJT', pipelineId: 'MtH03gvrKxxbjoaFAIqd', token: process.env.GHL_TOKEN_NC },
  }

  const cfg = CONFIG[officeId]
  if (!cfg)        return Response.json({ error: 'Invalid officeId' }, { status: 400 })
  if (!cfg.token)  return Response.json({ error: `GHL_TOKEN_${officeId} not configured` }, { status: 500 })

  const headers = {
    'Authorization': `Bearer ${cfg.token}`,
    'Version': '2021-07-28',
    'Content-Type': 'application/json',
  }

  try {
    // ── 1. APPOINTMENTS ──────────────────────────────────────────────
    // Fetch calendar events (appointments) in date range
    const calParams = new URLSearchParams({
      locationId: cfg.locationId,
      startTime: new Date(dateFrom).getTime(),
      endTime:   new Date(dateTo + 'T23:59:59').getTime(),
    })
    const calRes  = await fetch(`https://services.leadconnectorhq.com/calendars/events?${calParams}`, { headers })
    const calData = await calRes.json()
    const events  = calData.events || []

    // Group by date
    const bookedByDate  = {}
    const showedByDate  = {}

    events.forEach(ev => {
      const date = ev.startTime?.split('T')[0]
      if (!date) return
      if (!bookedByDate[date])  bookedByDate[date]  = 0
      if (!showedByDate[date])  showedByDate[date]  = 0
      bookedByDate[date]++
      // "showed" = status is 'showed' or 'completed'
      if (ev.appointmentStatus === 'showed' || ev.appointmentStatus === 'completed') {
        showedByDate[date]++
      }
    })

    // ── 2. DEALS CLOSED ──────────────────────────────────────────────
    // Fetch opportunities in "Closed Won" stage
    let page = 1
    let allOpps = []
    let hasMore = true

    while (hasMore) {
      const oppParams = new URLSearchParams({
        pipelineId: cfg.pipelineId,
        locationId: cfg.locationId,
        status: 'won',
        limit: 100,
        page,
      })
      const oppRes  = await fetch(`https://services.leadconnectorhq.com/opportunities/search?${oppParams}`, { headers })
      const oppData = await oppRes.json()
      const opps    = oppData.opportunities || []
      allOpps = [...allOpps, ...opps]
      hasMore = opps.length === 100
      page++
      if (page > 20) break // safety
    }

    // Filter by date range and group by date
    const closedByDate = {}
    const from = new Date(dateFrom)
    const to   = new Date(dateTo + 'T23:59:59')

    allOpps.forEach(opp => {
      const date = opp.lastStageChangeAt?.split('T')[0] || opp.updatedAt?.split('T')[0]
      if (!date) return
      const d = new Date(date)
      if (d < from || d > to) return
      if (!closedByDate[date]) closedByDate[date] = 0
      closedByDate[date]++
    })

    // ── 3. BUILD DAILY ARRAY ─────────────────────────────────────────
    const days = []
    const start = new Date(dateFrom)
    const end   = new Date(dateTo)

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const date = d.toISOString().split('T')[0]
      const appsBooked  = bookedByDate[date]  || 0
      const appsShowed  = showedByDate[date]  || 0
      const sales       = closedByDate[date]  || 0
      days.push({
        date,
        appsBooked,
        appsShowed,
        showRate: appsBooked > 0 ? +((appsShowed / appsBooked) * 100).toFixed(1) : 0,
        sales,
      })
    }

    return Response.json({ days })

  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
