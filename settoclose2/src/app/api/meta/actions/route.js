// Discovery endpoint: returns ALL action types that fired in the account
// over a recent date range. Used to populate the dynamic metric picker.
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const adAccountId = searchParams.get('adAccountId')
  const dateFrom    = searchParams.get('dateFrom')   // optional, defaults to last 30 days
  const dateTo      = searchParams.get('dateTo')
  const TOKEN       = process.env.META_ACCESS_TOKEN

  if (!TOKEN)        return Response.json({ error: 'META_ACCESS_TOKEN not configured' }, { status: 500 })
  if (!adAccountId) return Response.json({ error: 'adAccountId required' }, { status: 400 })

  // Default: last 30 days if no range provided
  const now  = new Date()
  const from = dateFrom || new Date(now - 30 * 864e5).toISOString().slice(0, 10)
  const to   = dateTo   || now.toISOString().slice(0, 10)

  try {
    const params = new URLSearchParams({
      fields: 'actions,cost_per_action_type',
      time_range: JSON.stringify({ since: from, until: to }),
      time_increment: 'all',   // aggregate — one row for the whole range
      level: 'account',
      limit: 1,
      access_token: TOKEN,
    })

    const url  = `https://graph.facebook.com/v19.0/act_${adAccountId}/insights?${params}`
    const res  = await fetch(url)
    const data = await res.json()

    if (data.error) return Response.json({ error: data.error.message }, { status: 400 })

    const row            = (data.data || [])[0] || {}
    const actions        = row.actions || []
    const costPerAction  = row.cost_per_action_type || []

    // Build a set of all action_types with their values
    const actionMap = {}
    actions.forEach(a => {
      if (!actionMap[a.action_type]) actionMap[a.action_type] = { count: 0, hasCost: false }
      actionMap[a.action_type].count += parseFloat(a.value) || 0
    })
    costPerAction.forEach(a => {
      if (!actionMap[a.action_type]) actionMap[a.action_type] = { count: 0, hasCost: false }
      actionMap[a.action_type].hasCost = true
      actionMap[a.action_type].costSample = parseFloat(a.value) || 0
    })

    // Human-readable labels for common action types
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

    const result = Object.entries(actionMap)
      .sort((a, b) => b[1].count - a[1].count) // sort by volume desc
      .map(([actionType, info]) => ({
        actionType,
        label:       LABELS[actionType] || actionType,
        count:       Math.round(info.count),
        hasCost:     info.hasCost,
        costSample:  info.costSample || 0,
        isCustom:    actionType.startsWith('offsite_conversion.custom.'),
      }))

    return Response.json({ actions: result, dateRange: { from, to } })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
