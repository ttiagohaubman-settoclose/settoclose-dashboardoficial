export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const adAccountId = searchParams.get('adAccountId')
  const dateFrom    = searchParams.get('dateFrom')
  const dateTo      = searchParams.get('dateTo')
  const type        = searchParams.get('type') || 'days'  // 'days' | 'campaigns'
  const TOKEN       = process.env.META_ACCESS_TOKEN

  if (!TOKEN)        return Response.json({ error: 'META_ACCESS_TOKEN not configured' }, { status: 500 })
  if (!adAccountId) return Response.json({ error: 'adAccountId required' }, { status: 400 })

  const fetchPage = async (url) => {
    const res = await fetch(url)
    const data = await res.json()
    if (data.error) throw new Error(data.error.message)
    return data
  }

  const extractLeads = (actions, costPerAction, spent) => {
    const leadsAction = (actions||[]).find(a =>
      a.action_type === 'lead' ||
      a.action_type === 'onsite_conversion.lead_grouped' ||
      a.action_type === 'leadgen_grouped'
    )
    const leads = leadsAction ? parseInt(leadsAction.value) : 0
    const cplAction = (costPerAction||[]).find(a =>
      a.action_type === 'lead' ||
      a.action_type === 'onsite_conversion.lead_grouped' ||
      a.action_type === 'leadgen_grouped'
    )
    const cpl = cplAction ? parseFloat(cplAction.value) : (leads > 0 ? +(spent / leads).toFixed(2) : 0)
    return { leads, cpl }
  }

  try {
    if (type === 'campaigns') {
      // ── Campaign-level insights ──────────────────────────────────
      const fields = [
        'campaign_id','campaign_name','spend','impressions','reach',
        'inline_link_clicks','actions','cost_per_action_type'
      ].join(',')

      const baseParams = new URLSearchParams({
        fields,
        time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
        level: 'campaign',
        limit: 50,
        access_token: TOKEN,
      })

      let url = `https://graph.facebook.com/v19.0/act_${adAccountId}/insights?${baseParams}`
      let allRows = []
      while (url) {
        const data = await fetchPage(url)
        allRows = [...allRows, ...(data.data || [])]
        url = data.paging?.next || null
      }

      const campaigns = allRows.map(d => {
        const spent = parseFloat(d.spend || 0)
        const { leads, cpl } = extractLeads(d.actions, d.cost_per_action_type, spent)
        return {
          id:          d.campaign_id,
          name:        d.campaign_name || 'Sin nombre',
          spent,
          impressions: parseInt(d.impressions || 0),
          reach:       parseInt(d.reach || 0),
          linkClicks:  parseInt(d.inline_link_clicks || 0),
          leads,
          cpl,
          ctr:         d.impressions > 0 ? +((d.inline_link_clicks / d.impressions) * 100).toFixed(2) : 0,
        }
      }).sort((a, b) => b.leads - a.leads)

      return Response.json({ campaigns })
    }

    // ── Day-level insights (original) ───────────────────────────────
    const fields = [
      'date_start','spend','impressions','reach','frequency',
      'inline_link_clicks','inline_link_click_ctr','cost_per_inline_link_click',
      'actions','cost_per_action_type'
    ].join(',')

    const baseParams = new URLSearchParams({
      fields,
      time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
      time_increment: '1',
      level: 'account',
      limit: 100,
      access_token: TOKEN,
    })

    let url = `https://graph.facebook.com/v19.0/act_${adAccountId}/insights?${baseParams}`
    let allRows = []
    while (url) {
      const data = await fetchPage(url)
      allRows = [...allRows, ...(data.data || [])]
      url = data.paging?.next || null
    }

    const days = allRows.map(d => {
      const spent = parseFloat(d.spend || 0)
      const { leads, cpl } = extractLeads(d.actions, d.cost_per_action_type, spent)
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

    days.sort((a, b) => new Date(a.date) - new Date(b.date))
    return Response.json({ days })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
