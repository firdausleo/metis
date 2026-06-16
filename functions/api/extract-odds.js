export async function onRequest(context) {
  const { request, env } = context

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const { image, mediaType, homeTeam, awayTeam } = await request.json()

    if (!image || !mediaType) {
      return new Response(
        JSON.stringify({ error: 'Missing image data' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: image,
              }
            },
            {
              type: 'text',
              text: `This is a screenshot of a Chinese sports lottery (彩票) app showing betting odds for a football match${homeTeam ? ` between ${homeTeam} and ${awayTeam}` : ''}.

Extract ALL visible odds and return as JSON only, no other text, no markdown:
{
  "spf": {
    "home": null,
    "draw": null,
    "away": null
  },
  "rspf": {
    "line": -1,
    "home": null,
    "draw": null,
    "away": null
  },
  "scores": {
    "1:0": null, "2:0": null, "2:1": null,
    "3:0": null, "3:1": null, "3:2": null,
    "4:0": null, "4:1": null, "4:2": null,
    "5:0": null, "5:1": null, "5:2": null,
    "homeOther": null,
    "0:0": null, "1:1": null, "2:2": null,
    "3:3": null, "drawOther": null,
    "0:1": null, "0:2": null, "1:2": null,
    "0:3": null, "1:3": null, "2:3": null,
    "0:4": null, "1:4": null, "2:4": null,
    "0:5": null, "1:5": null, "2:5": null,
    "awayOther": null
  }
}

Rules:
- Numbers only for odds values (e.g. 6.25 not "6.25x")
- null for any score not visible in the screenshot
- The rspf line number is the handicap shown (e.g. -1)
- Return pure JSON, nothing else`
            }
          ]
        }]
      })
    })

    const data = await response.json()
    const text = data.content?.[0]?.text || ''

    try {
      const clean = text.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean)
      return new Response(JSON.stringify(parsed), {
        headers: { 'Content-Type': 'application/json' }
      })
    } catch {
      return new Response(
        JSON.stringify({ error: 'Could not parse odds from image', raw: text }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      )
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
