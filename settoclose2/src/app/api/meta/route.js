export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const adAccountId = searchParams.get('adAccountId')
  const dateFrom    = searchParams.get('dateFrom')
  const dateTo      = searchParams.get('dateTo')
  const TOKEN       = process.env.META_ACCESS_TOKEN

  if (!TOKEN)        return Response.json({ error: 'META_ACCESS_TOKEN not configured' }, { status: 500 })
  if (!adAccountId) return Response.json({ error: 'adAccountId required' }, { status: 400 })

  const fields = [
    'date_start','spend','impressions','reach','frequency',
    'inline_link_clicks','inline_link_click_ctr','cost_per_inline_link_click',
    'actions','cost_per_action_type'
  ].join(',')

  // Fetch all pages from Meta
  const fetchPage = async (url) => {
    const res = await fetch(url)
    const data = await res.json()
    if (data.error) throw new Error(data.error.message)
    return data
  }

  try {
    const baseParams = new URLSearchParams({
      fields,
      time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
      time_increment: '1',
      level: 'account',
      limit: 100,  // max per page
      access_token: TOKEN,
    })

    let url = `https://graph.facebook.com/v19.0/act_${adAccountId}/insights?${baseParams}`
    let allRows = []

    // Paginate through all results
    while (url) {
      const data = await fetchPage(url)
      allRows = [...allRows, ...(data.data || [])]
      url = data.paging?.next || null
    }

    const days = allRows.map(d => {
      const actions = d.actions || []
      const costPerAction = d.cost_per_action_type || []

      // Get leads - try multiple action types
      const leadsAction = actions.find(a =>
        a.action_type === 'lead' ||
        a.action_type === 'onsite_conversion.lead_grouped' ||
        a.action_type === 'leadgen_grouped'
      )
      const leads = leadsAction ? parseInt(leadsAction.value) : 0
      const spent = parseFloat(d.spend || 0)

      // Get CPL from cost_per_action_type
      const cplAction = costPerAction.find(a =>
        a.action_type === 'lead' ||
        a.action_type === 'onsite_conversion.lead_grouped' ||
        a.action_type === 'leadgen_grouped'
      )
      const cpl = cplAction ? parseFloat(cplAction.value) : (leads > 0 ? +(spent / leads).toFixed(2) : 0)

      return {
        date:        d.date_start,
        spent,
        impressions: parseInt(d.impressions || 0),
        reach:       parseInt(d.reach || 0),
        frequency:   parseFloat(d.frequency || 0),
        linkClicks:  parseInt(d.inline_link_clicks || 0),
        ctrLink:     parseFloat(d.inline_link_click_ctr || 0),
        cpcLink:     parseFloat(d.cost_per_inline_link_click || 0),
        leads,
        cpl,
        appsBooked: 0, appsShowed: 0, showRate: 0,
        sales: 0, revCompany: 0, revOffice: 0, cashTiago: 0, cashOffice: 0, roasCash: 0,
      }
    })

    // Sort by date asc
    days.sort((a, b) => new Date(a.date) - new Date(b.date))

    return Response.json({ days })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
