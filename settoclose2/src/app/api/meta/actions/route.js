// Discovery endpoint: returns ALL available metrics for an ad account.
// Combines:
//   1. Custom conversions from the account (always, even with 0 events)
//   2. All action_types that fired in the given date range (from insights)
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const adAccountId = searchParams.get('adAccountId')
  const dateFrom    = searchParams.get('dateFrom')
  const dateTo      = searchParams.get('dateTo')
  const TOKEN       = process.env.META_ACCESS_TOKEN

  if (!TOKEN)        return Response.json({ error: 'META_ACCESS_TOKEN not configured' }, { status: 500 })
  if (!adAccountId) return Response.json({ error: 'adAccountId required' }, { status: 400 })

  const now  = new Date()
  const from = dateFrom || new Date(now - 30 * 864e5).toISOString().slice(0, 10)
  const to   = dateTo   || now.toISOString().slice(0, 10)

  const LABELS = {
    'landing_page_view':                                          'Landing Page Views',
    'link_click':                                                 'Link Clicks',
    'post_engagement':                                            'Post Engagement',
    'page_engagement':                                            'Page Engagement',
    'post_reaction':                                              'Reactions',
    'comment':                                                    'Comments',
    'post':                                                       'Shares',
    'like':                                                       'Page Likes',
    'video_view':                                                 'Video Views (3s)',
    'lead':                                                       'Leads',
    'onsite_conversion.lead_grouped':                             'Onsite Leads',
    'leadgen_grouped':                                            'Lead Form Leads',
    'offsite_conversion.fb_pixel_lead':                           'Pixel Leads',
    'purchase':                                                   'Purchases',
    'offsite_conversion.fb_pixel_purchase':                       'Pixel Purchases',
    'omni_purchase':                                              'Omni Purchases',
    'add_to_cart':                                                'Add to Cart',
    'offsite_conversion.fb_pixel_add_to_cart':                    'Pixel Add to Cart',
    'initiate_checkout':                                          'Initiate Checkout',
    'offsite_conversion.fb_pixel_initiate_checkout':              'Pixel Initiate Checkout',
    'view_content':                                               'View Content',
    'offsite_conversion.fb_pixel_view_content':                   'Pixel View Content',
    'complete_registration':                                      'Complete Registration',
    'offsite_conversion.fb_pixel_complete_registration':          'Pixel Registration',
    'search':                                                     'Search',
    'subscribe':                                                  'Subscribe',
    'contact':                                                    'Contact',
    'find_location':                                              'Find Location',
    'schedule':                                                   'Schedule',
    'start_trial':                                                'Start Trial',
    'submit_application':                                         'Submit Application',
    'onsite_conversion.messaging_conversation_started_7d':        'Messaging Started',
    'onsite_conversion.messaging_first_reply':                    'Messaging First Reply',
    'onsite_conversion.messaging_reply':                          'Messaging Replies',
    'onsite_conversion.post_save':                                'Post Saves',
    'click_to_call_call_confirm':                                 'Click to Call',
  }

  try {
    // ── 1. Fetch ALL custom conversions for the account ───────────────
    // These are returned regardless of whether they fired in the date range
    const [customConvRes, insightsRes] = await Promise.all([
      fetch(
        `https://graph.facebook.com/v19.0/act_${adAccountId}/customconversions` +
        `?fields=id,name,description,custom_event_type&limit=200&access_token=${TOKEN}`
      ),
      fetch(
        `https://graph.facebook.com/v19.0/act_${adAccountId}/insights?` +
        new URLSearchParams({
          fields: 'actions,cost_per_action_type',
          time_range: JSON.stringify({ since: from, until: to }),
          time_increment: 'all_days',
          level: 'account',
          limit: 1,
          access_token: TOKEN,
        })
      ),
    ])

    const [customConvData, insightsData] = await Promise.all([
      customConvRes.json(),
      insightsRes.json(),
    ])

    if (insightsData.error) return Response.json({ error: insightsData.error.message }, { status: 400 })

    // ── 2. Build action map from insights ────────────────────────────
    const row           = (insightsData.data || [])[0] || {}
    const actions       = row.actions || []
    const costPerAction = row.cost_per_action_type || []
    const actionMap     = {}

    actions.forEach(a => {
      if (!actionMap[a.action_type]) actionMap[a.action_type] = { count: 0, hasCost: false }
      actionMap[a.action_type].count += parseFloat(a.value) || 0
    })
    costPerAction.forEach(a => {
      if (!actionMap[a.action_type]) actionMap[a.action_type] = { count: 0, hasCost: false }
      actionMap[a.action_type].hasCost = true
      actionMap[a.action_type].costSample = parseFloat(a.value) || 0
    })

    // ── 3. Inject custom conversions — always present, even with 0 events
    const customConversions = customConvData.data || []
    customConversions.forEach(cv => {
      // Meta reports custom conversions in actions as offsite_conversion.custom.{id}
      const actionType = `offsite_conversion.custom.${cv.id}`
      if (!actionMap[actionType]) {
        actionMap[actionType] = { count: 0, hasCost: false }
      }
      // Store the human name so we can label it properly
      actionMap[actionType].customName = cv.name
      actionMap[actionType].customId   = cv.id
      actionMap[actionType].hasCost    = true // custom conversions always support cost
    })

    // ── 4. Build final result list ───────────────────────────────────
    const result = Object.entries(actionMap)
      .sort((a, b) => {
        // Custom conversions first, then sort by volume desc
        const aIsCustom = a[0].startsWith('offsite_conversion.custom.')
        const bIsCustom = b[0].startsWith('offsite_conversion.custom.')
        if (aIsCustom && !bIsCustom) return -1
        if (!aIsCustom && bIsCustom) return 1
        return b[1].count - a[1].count
      })
      .map(([actionType, info]) => ({
        actionType,
        label:      info.customName || LABELS[actionType] || actionType,
        count:      Math.round(info.count),
        hasCost:    info.hasCost,
        costSample: info.costSample || 0,
        isCustom:   !!info.customName,
        customId:   info.customId || null,
      }))

    return Response.json({ actions: result, dateRange: { from, to } })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
