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

    const matchStr = homeTeam && awayTeam ? `${homeTeam} vs ${awayTeam}` : 'a football match'

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
              text: `This screenshot shows a Chinese sports lottery (彩票) app for ${matchStr}.

Extract ALL visible odds carefully.

IMPORTANT — 让球胜平负 (handicap):
  The handicap line is shown as a number in a gray/dark box on the LEFT of the row. It is usually -1, -2, +1 etc.
  主胜 = home team wins AFTER applying handicap
  平   = draw AFTER applying handicap
  主负 = away team wins AFTER applying handicap

  Example: if line = -1 and ${homeTeam || 'Home'} vs ${awayTeam || 'Away'}:
    主胜 means ${homeTeam || 'Home'} wins by 2+ goals (covers -1)
    平   means ${homeTeam || 'Home'} wins by exactly 1 goal (push)
    主负 means ${homeTeam || 'Home'} draws or loses (${awayTeam || 'Away'} covers)

Return JSON only, no other text, no markdown fences:
{
  "spf": {
    "home": null,
    "draw": null,
    "away": null
  },
  "rspf": {
    "line": null,
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
  },
  "totalGoals": {
    "0": null, "1": null, "2": null, "3": null,
    "4": null, "5": null, "6": null, "7plus": null
  },
  "halfFullTime": {
    "homeHome": null, "homeDraw": null, "homeAway": null,
    "drawHome": null, "drawDraw": null, "drawAway": null,
    "awayHome": null, "awayDraw": null, "awayAway": null
  }
}

Rules:
- rspf.line = the integer in the gray box (e.g. -1, -2, +1) — NOT null if visible
- rspf.home = 主胜 odds
- rspf.draw = 平 odds (the middle value)
- rspf.away = 主负 odds
- All odds are numbers only (e.g. 2.12 not "2.12x")
- null for anything not visible in the screenshot`
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
