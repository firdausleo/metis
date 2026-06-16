import { useEffect } from 'react'

export function useBrainCanvas(canvasRef, active = true) {
  useEffect(() => {
    if (!active || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const W = canvas.offsetWidth
    const H = canvas.offsetHeight
    canvas.width = W * window.devicePixelRatio
    canvas.height = H * window.devicePixelRatio
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

    const nodes = []
    const edges = []
    const pulses = []
    let frame = 0
    let surgeRadius = 0
    let surgeActive = false
    let animId

    function rand(a, b) { return a + Math.random() * (b - a) }
    function gauss() {
      return (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2
    }

    // Left lobe — 32 nodes
    for (let i = 0; i < 32; i++) {
      const a = rand(0, Math.PI * 2)
      const r = rand(0, W * 0.14)
      nodes.push({
        x: W * 0.27 + Math.cos(a) * r + gauss() * 12,
        y: H * 0.44 + Math.sin(a) * r * 0.78 + gauss() * 8,
        vx: rand(-0.15, 0.15), vy: rand(-0.10, 0.10),
        r: rand(1.5, 4.5), phase: rand(0, Math.PI * 2), type: 'lobe',
      })
    }

    // Right lobe — 32 nodes
    for (let i = 0; i < 32; i++) {
      const a = rand(0, Math.PI * 2)
      const r = rand(0, W * 0.14)
      nodes.push({
        x: W * 0.73 + Math.cos(a) * r + gauss() * 12,
        y: H * 0.44 + Math.sin(a) * r * 0.78 + gauss() * 8,
        vx: rand(-0.15, 0.15), vy: rand(-0.10, 0.10),
        r: rand(1.5, 4.5), phase: rand(0, Math.PI * 2), type: 'lobe',
      })
    }

    // Corpus callosum bridge — 14 nodes
    for (let i = 0; i < 14; i++) {
      nodes.push({
        x: rand(W * 0.37, W * 0.63),
        y: rand(H * 0.36, H * 0.56),
        vx: rand(-0.08, 0.08), vy: rand(-0.06, 0.06),
        r: rand(1.2, 2.8), phase: rand(0, Math.PI * 2), type: 'bridge',
      })
    }

    // Periphery — 10 nodes
    for (let i = 0; i < 10; i++) {
      nodes.push({
        x: rand(W * 0.06, W * 0.94),
        y: rand(H * 0.08, H * 0.82),
        vx: rand(-0.12, 0.12), vy: rand(-0.08, 0.08),
        r: rand(1.0, 2.2), phase: rand(0, Math.PI * 2), type: 'periph',
      })
    }

    // Core nodes
    ;[
      { x: W * 0.50, y: H * 0.44, r: 9 },
      { x: W * 0.41, y: H * 0.39, r: 7 },
      { x: W * 0.59, y: H * 0.39, r: 7 },
      { x: W * 0.45, y: H * 0.51, r: 6 },
      { x: W * 0.55, y: H * 0.51, r: 6 },
    ].forEach(c => nodes.push({
      ...c, vx: rand(-0.04, 0.04), vy: rand(-0.03, 0.03),
      phase: rand(0, Math.PI * 2), type: 'core',
    }))

    // Build edges
    const MAX_DIST = 145
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x
        const dy = nodes[i].y - nodes[j].y
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < MAX_DIST && edges.length < 200) {
          const isBridge = nodes[i].type === 'bridge' || nodes[j].type === 'bridge'
          edges.push({ a: i, b: j, d, isBridge })
        }
      }
    }

    // Pulse spawner
    const pulseTimer = setInterval(() => {
      const pool = []
      edges.forEach((e, idx) => {
        pool.push(idx)
        if (e.isBridge) pool.push(idx, idx)
      })
      if (!pool.length) return
      const e = edges[pool[Math.floor(Math.random() * pool.length)]]
      pulses.push({
        edge: e, t: 0,
        speed: rand(0.005, 0.016) * (e.isBridge ? 1.7 : 1),
        rev: Math.random() > 0.5,
        alpha: rand(0.55, 1.0),
        trail: [],
      })
      if (pulses.length > 28) pulses.shift()
    }, 150)

    // Surge timer
    const surgeTimer = setInterval(() => {
      surgeActive = true
      surgeRadius = 0
    }, 5000)

    function draw() {
      ctx.clearRect(0, 0, W, H)

      // Edges
      for (const e of edges) {
        const na = nodes[e.a], nb = nodes[e.b]
        const baseAlpha = (1 - e.d / MAX_DIST) * 0.22
        const alpha = e.isBridge ? baseAlpha * 1.9 : baseAlpha
        ctx.beginPath()
        ctx.moveTo(na.x, na.y)
        ctx.lineTo(nb.x, nb.y)
        ctx.strokeStyle = e.isBridge
          ? `rgba(201,168,76,${alpha})`
          : `rgba(100,140,220,${alpha})`
        ctx.lineWidth = e.isBridge ? 0.9 : 0.6
        ctx.stroke()
      }

      // Pulses
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i]
        p.t += p.speed
        if (p.t > 1) { pulses.splice(i, 1); continue }
        const na = nodes[p.edge.a], nb = nodes[p.edge.b]
        const t = p.rev ? 1 - p.t : p.t
        const px = na.x + (nb.x - na.x) * t
        const py = na.y + (nb.y - na.y) * t

        p.trail.push({ x: px, y: py })
        if (p.trail.length > 6) p.trail.shift()
        p.trail.forEach((pt, ti) => {
          const ta = p.alpha * (ti / p.trail.length) * 0.35
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(201,168,76,${ta})`
          ctx.fill()
        })

        const g = ctx.createRadialGradient(px, py, 0, px, py, 7)
        g.addColorStop(0, `rgba(201,168,76,${p.alpha})`)
        g.addColorStop(1, 'rgba(201,168,76,0)')
        ctx.beginPath()
        ctx.arc(px, py, 7, 0, Math.PI * 2)
        ctx.fillStyle = g
        ctx.fill()
      }

      // Nodes
      for (const n of nodes) {
        const pulse = 0.5 + 0.5 * Math.sin(frame * 0.018 + n.phase)
        const isCore = n.type === 'core'

        if (isCore) {
          ;[{ r: n.r + 18, a: 0.06 }, { r: n.r + 10, a: 0.14 }, { r: n.r + 5, a: 0.25 }]
            .forEach(gl => {
              const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, gl.r + pulse * 2)
              g.addColorStop(0, `rgba(201,168,76,${gl.a})`)
              g.addColorStop(1, 'rgba(201,168,76,0)')
              ctx.beginPath()
              ctx.arc(n.x, n.y, gl.r + pulse * 2, 0, Math.PI * 2)
              ctx.fillStyle = g
              ctx.fill()
            })
        }

        const fillColor = isCore
          ? `rgba(201,168,76,${0.6 + pulse * 0.4})`
          : n.type === 'bridge'
            ? `rgba(160,200,255,${0.35 + pulse * 0.2})`
            : `rgba(90,130,200,${0.25 + pulse * 0.15})`

        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r + (isCore ? pulse * 2.5 : 0), 0, Math.PI * 2)
        ctx.fillStyle = fillColor
        ctx.fill()

        if (isCore) {
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.r + pulse * 3 + 5, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(201,168,76,${0.18 * (1 - pulse * 0.5)})`
          ctx.lineWidth = 1
          ctx.stroke()
        }

        n.x += n.vx; n.y += n.vy
        const pad = 20
        if (n.x < pad || n.x > W - pad) n.vx *= -1
        if (n.y < pad || n.y > H - pad) n.vy *= -1
      }

      // Surge ring
      if (surgeActive) {
        surgeRadius += 3.5
        ctx.beginPath()
        ctx.arc(W * 0.5, H * 0.44, surgeRadius, 0, Math.PI * 2)
        const alpha = Math.max(0, 0.18 - surgeRadius / (W * 0.6) * 0.18)
        ctx.strokeStyle = `rgba(201,168,76,${alpha})`
        ctx.lineWidth = 1.2
        ctx.stroke()
        if (surgeRadius > W * 0.6) surgeActive = false
      }

      // Region labels
      ctx.font = '500 8px "IBM Plex Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillStyle = 'rgba(201,168,76,0.13)'
      ;[
        ['STATS', W * 0.16, H * 0.22],
        ['PREDICT', W * 0.78, H * 0.22],
        ['EDGE', W * 0.16, H * 0.72],
        ['LEARN', W * 0.78, H * 0.72],
      ].forEach(([label, lx, ly]) => ctx.fillText(label, lx, ly))

      // METIS wordmark
      ctx.font = '600 20px "IBM Plex Mono", monospace'
      ctx.fillStyle = 'rgba(201,168,76,0.82)'
      ctx.textAlign = 'center'
      ctx.letterSpacing = '0.3em'
      ctx.fillText('METIS', W * 0.5, H * 0.88)
      ctx.letterSpacing = '0'

      ctx.font = '400 9px "Space Grotesk", sans-serif'
      ctx.fillStyle = 'rgba(201,168,76,0.38)'
      ctx.fillText('WC2026 INTELLIGENCE', W * 0.5, H * 0.93)

      frame++
      animId = requestAnimationFrame(draw)
    }

    animId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animId)
      clearInterval(pulseTimer)
      clearInterval(surgeTimer)
    }
  }, [active])
}

export function useMiniCanvas(canvasRef, active = true) {
  useEffect(() => {
    if (!active || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const S = 36
    canvas.width = S * window.devicePixelRatio
    canvas.height = S * window.devicePixelRatio
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

    const nodes = Array.from({ length: 9 }, () => ({
      x: 6 + Math.random() * 24,
      y: 6 + Math.random() * 24,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: 1.2 + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2,
    }))

    const edges = []
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x
        const dy = nodes[i].y - nodes[j].y
        if (Math.sqrt(dx * dx + dy * dy) < 18) edges.push([i, j])
      }

    let frame = 0, animId

    function draw() {
      ctx.clearRect(0, 0, S, S)
      ctx.fillStyle = '#080c14'
      ctx.fillRect(0, 0, S, S)

      edges.forEach(([a, b]) => {
        ctx.beginPath()
        ctx.moveTo(nodes[a].x, nodes[a].y)
        ctx.lineTo(nodes[b].x, nodes[b].y)
        ctx.strokeStyle = 'rgba(201,168,76,0.25)'
        ctx.lineWidth = 0.6
        ctx.stroke()
      })

      nodes.forEach(n => {
        const p = 0.5 + 0.5 * Math.sin(frame * 0.04 + n.phase)
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r + p * 0.8, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(201,168,76,${0.5 + p * 0.4})`
        ctx.fill()
        n.x += n.vx; n.y += n.vy
        if (n.x < 3 || n.x > S - 3) n.vx *= -1
        if (n.y < 3 || n.y > S - 3) n.vy *= -1
      })

      frame++
      animId = requestAnimationFrame(draw)
    }

    animId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animId)
  }, [active])
}
