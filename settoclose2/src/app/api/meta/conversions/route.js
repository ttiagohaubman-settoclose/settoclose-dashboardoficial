// Returns available custom conversions for a given Meta ad account.
// Used by the dashboard to populate the custom conversion selector per office.
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const adAccountId = searchParams.get('adAccountId')
  const TOKEN       = process.env.META_ACCESS_TOKEN

  if (!TOKEN)        return Response.json({ error: 'META_ACCESS_TOKEN not configured' }, { status: 500 })
  if (!adAccountId) return Response.json({ error: 'adAccountId required' }, { status: 400 })

  try {
    const url = `https://graph.facebook.com/v19.0/act_${adAccountId}/customconversions` +
      `?fields=id,name,description,custom_event_type,rule&limit=100&access_token=${TOKEN}`

    const res  = await fetch(url)
    const data = await res.json()

    if (data.error) return Response.json({ error: data.error.message }, { status: 400 })

    const conversions = (data.data || []).map(c => ({
      id:          c.id,
      name:        c.name,
      description: c.description || '',
      eventType:   c.custom_event_type || 'CUSTOM',
    }))

    // Also include common standard events as selectable options
    const standardEvents = [
      { id: 'purchase',                                      name: 'Purchase (standard)',                   eventType: 'PURCHASE' },
      { id: 'offsite_conversion.fb_pixel_purchase',          name: 'Pixel Purchase',                        eventType: 'PURCHASE' },
      { id: 'add_to_cart',                                   name: 'Add to Cart (standard)',                eventType: 'ADD_TO_CART' },
      { id: 'initiate_checkout',                             name: 'Initiate Checkout (standard)',          eventType: 'INITIATE_CHECKOUT' },
      { id: 'complete_registration',                         name: 'Complete Registration (standard)',      eventType: 'COMPLETE_REGISTRATION' },
      { id: 'view_content',                                  name: 'View Content (standard)',               eventType: 'VIEW_CONTENT' },
      { id: 'search',                                        name: 'Search (standard)',                     eventType: 'SEARCH' },
      { id: 'subscribe',                                     name: 'Subscribe (standard)',                  eventType: 'SUBSCRIBE' },
      { id: 'contact',                                       name: 'Contact (standard)',                    eventType: 'CONTACT' },
      { id: 'find_location',                                 name: 'Find Location (standard)',              eventType: 'FIND_LOCATION' },
      { id: 'schedule',                                      name: 'Schedule (standard)',                   eventType: 'SCHEDULE' },
      { id: 'start_trial',                                   name: 'Start Trial (standard)',                eventType: 'START_TRIAL' },
      { id: 'submit_application',                            name: 'Submit Application (standard)',         eventType: 'SUBMIT_APPLICATION' },
      { id: 'onsite_conversion.messaging_conversation_started_7d', name: 'Messaging Conversation Started', eventType: 'MESSAGING' },
    ]

    return Response.json({ conversions, standardEvents })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
