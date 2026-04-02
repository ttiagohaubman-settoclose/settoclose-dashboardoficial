export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const adAccountId      = searchParams.get('adAccountId')
  const dateFrom         = searchParams.get('dateFrom')
  const dateTo           = searchParams.get('dateTo')
  const customConversions = JSON.parse(searchParams.get('customConversions') || '[]')
  const TOKEN            = process.env.META_ACCESS_TOKEN

  if (!TOKEN)        return Response.json({ error: 'META_ACCESS_TOKEN not configured' }, { status: 500 })
  if (!adAccountId) return Response.json({ error: 'adAccountId required' }, { status: 400 })

  const fields = [
    'date_start',
    'spend',
    'impressions',
    'reach',
    'frequency',
    'cpm',
    'clicks',
    'unique_clicks',
    'inline_link_clicks',
    'inline_link_click_ctr',
    'cost_per_inline_link_click',
    'unique_inline_link_clicks',
    'outbound_clicks',
    'unique_outbound_clicks',
    'video_p25_watched_actions',
    'video_p50_watched_actions',
    'video_p75_watched_actions',
    'video_p100_watched_actions',
    'video_thruplay_watched_actions',
    'actions',
    'cost_per_action_type',
  ].join(',')

  const fetchPage = async (url) => {
    const res = await fetch(url)
    const data = await res.json()
    if (data.error) throw new Error(data.error.message)
    return data
  }

  // Helper: extract numeric value from action array by action_type (tries multiple types)
  const fromActions = (actions, ...types) => {
    for (const t of types) {
      const hit = actions.find(a => a.action_type === t)
      if (hit) return parseFloat(hit.value) || 0
    }
    return 0
  }

  // Helper: sum all values from a video-watched array field
  const fromVideoField = (arr) => {
    if (!Array.isArray(arr)) return 0
    return arr.reduce((s, a) => s + (parseFloat(a.value) || 0), 0)
  }

  try {
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
      const actions       = d.actions || []
      const costPerAction = d.cost_per_action_type || []
      const spent         = parseFloat(d.spend || 0)

      // ── Leads ──────────────────────────────────────────────────────
      const leads = fromActions(actions,
        'lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped',
        'offsite_conversion.fb_pixel_lead',
      )
      const cplAction = costPerAction.find(a =>
        ['lead','onsite_conversion.lead_grouped','leadgen_grouped','offsite_conversion.fb_pixel_lead'].includes(a.action_type)
      )
      const cpl = cplAction ? parseFloat(cplAction.value) : (leads > 0 ? +(spent / leads).toFixed(2) : 0)

      // ── Conversiones estándar ──────────────────────────────────────
      const purchases       = fromActions(actions, 'purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase')
      const purchaseValue   = fromActions(actions, 'offsite_conversion.fb_pixel_custom', 'purchase_value') ||
                              fromActions(costPerAction, 'purchase', 'offsite_conversion.fb_pixel_purchase') * purchases
      const addToCart       = fromActions(actions, 'add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart', 'omni_add_to_cart')
      const initiateCheckout= fromActions(actions, 'initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout', 'omni_initiated_checkout')
      const viewContent     = fromActions(actions, 'view_content', 'offsite_conversion.fb_pixel_view_content', 'omni_view_content')
      const registrations   = fromActions(actions, 'complete_registration', 'offsite_conversion.fb_pixel_complete_registration')
      const leadFormOpens   = fromActions(actions, 'onsite_conversion.lead_grouped', 'lead_grouped')
      const leadFormCompletions = leads // best approximation without a separate field

      // ── Video ──────────────────────────────────────────────────────
      const videoViews3s  = fromActions(actions, 'video_view')
      const videoThruplay = fromVideoField(d.video_thruplay_watched_actions)
      const videoP25      = fromVideoField(d.video_p25_watched_actions)
      const videoP50      = fromVideoField(d.video_p50_watched_actions)
      const videoP75      = fromVideoField(d.video_p75_watched_actions)
      const videoP100     = fromVideoField(d.video_p100_watched_actions)

      // ── Engagement ─────────────────────────────────────────────────
      const postEngagement = fromActions(actions, 'post_engagement', 'page_engagement')
      const reactions      = fromActions(actions, 'post_reaction', 'like')
      const comments       = fromActions(actions, 'comment')
      const shares         = fromActions(actions, 'post', 'share')
      const pageLikes      = fromActions(actions, 'like', 'page_like')
      const postClicks     = fromActions(actions, 'post_click', 'link_click')

      // ── Mensajería ─────────────────────────────────────────────────
      const messagingConversations = fromActions(actions,
        'onsite_conversion.messaging_conversation_started_7d',
        'onsite_conversion.messaging_first_reply',
      )
      const messagingReplies = fromActions(actions, 'onsite_conversion.messaging_reply')

      // ── Conversiones personalizadas ─────────────────────────────────
      const customConvValues = {}
      for (const cv of customConversions) {
        customConvValues[`conv_${cv.id}`] = fromActions(actions,
          `offsite_conversion.custom.${cv.id}`,
          cv.id,
        )
      }

      // ── Clics ──────────────────────────────────────────────────────
      const linkClicks     = parseInt(d.inline_link_clicks || 0)
      const clicks         = parseInt(d.clicks || 0) || linkClicks
      const uniqueClicks   = parseInt(d.unique_clicks || 0) || parseInt(d.unique_inline_link_clicks || 0)
      const outboundClicks = fromVideoField(d.outbound_clicks) || linkClicks

      return {
        date: d.date_start,
        spent,
        impressions:           parseInt(d.impressions || 0),
        reach:                 parseInt(d.reach || 0),
        frequency:             parseFloat(d.frequency || 0),
        cpm:                   parseFloat(d.cpm || 0),
        clicks,
        uniqueClicks,
        linkClicks,
        ctrLink:               parseFloat(d.inline_link_click_ctr || 0),
        cpcLink:               parseFloat(d.cost_per_inline_link_click || 0),
        outboundClicks,
        leads,
        cpl,
        purchases,
        purchaseValue,
        addToCart,
        initiateCheckout,
        viewContent,
        registrations,
        leadFormOpens,
        leadFormCompletions,
        videoViews3s,
        videoThruplay,
        videoP25,
        videoP50,
        videoP75,
        videoP100,
        postEngagement,
        reactions,
        comments,
        shares,
        pageLikes,
        postClicks,
        messagingConversations,
        messagingReplies,
        ...customConvValues,
        // GHL fields (filled downstream)
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
