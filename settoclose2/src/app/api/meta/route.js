export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const adAccountId = searchParams.get('adAccountId')
  const dateFrom    = searchParams.get('dateFrom')
  const dateTo      = searchParams.get('dateTo')
  const TOKEN       = process.env.META_ACCESS_TOKEN

  if (!TOKEN)        return Response.json({ error: 'META_ACCESS_TOKEN not configured' }, { status: 500 })
  if (!adAccountId) return Response.json({ error: 'adAccountId required' }, { status: 400 })

  const fields = [
    'date_start',
    'spend',
    'impressions',
    'reach',
    'frequency',
    'inline_link_clicks',       // ✅ Link clicks (not all clicks)
    'inline_link_click_ctr',    // ✅ CTR link (not all clicks CTR)
    'cost_per_inline_link_click', // ✅ CPC link (not all clicks CPC)
    'actions',                  // leads + other conversions
    'cost_per_action_type',     // CPL
  ].join(',')

  const params = new URLSearchParams({
    fields,
    time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
    time_increment: '1',
    level: 'account',
    access_token: TOKEN,
  })

  try {
    const res  = await fetch(`https://graph.facebook.com/v19.0/act_${adAccountId}/insights?${params}`)
    const data = await res.json()
    if (data.error) return Response.json({ error: data.error.message }, { status: 400 })

    const days = (data.data || []).map(d => {
      // Leads
      const leadsAction = (d.actions || []).find(
        a => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped'
      )
      const leads = leadsAction ? parseInt(leadsAction.value) : 0

      // Spend
      const spent = parseFloat(d.spend || 0)

      // ✅ Link clicks (correct)
      const linkClicks = parseInt(d.inline_link_clicks || 0)

      // ✅ CTR link (correct)
      const ctrLink = parseFloat(d.inline_link_click_ctr || 0)

      // ✅ CPC link (correct)
      const cpcLink = parseFloat(d.cost_per_inline_link_click || 0)

      // CPL
      const cpl = leads > 0 ? +(spent / leads).toFixed(2) : 0

      return {
        date:        d.date_start,
        spent,
        impressions: parseInt(d.impressions || 0),
        reach:       parseInt(d.reach || 0),
        frequency:   parseFloat(d.frequency || 0),
        linkClicks,
        ctrLink,
        cpcLink,
        leads,
        cpl,
        // Sales/appointments — manual entry in UI
        appsBooked: 0, appsShowed: 0, showRate: 0,
        sales: 0, revCompany: 0, revOffice: 0, cashTiago: 0, cashOffice: 0, roasCash: 0,
      }
    })

    return Response.json({ days })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
