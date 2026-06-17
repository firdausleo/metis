import { useEffect } from 'react'

export function useBrainCanvas(canvasRef, active = true) {
  useEffect(() => {
    if (!active || !canvasRef.current) return
    const canvas = canvasRef.current

    let cleanup = () => {}
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      observer.disconnect()
      const W = entry.contentRect.width
      const H = entry.contentRect.height
      if (W < 100 || H < 100) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = W * dpr
      canvas.height = H * dpr
      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)

      // Oval boundary constants — all node geometry derives from these
      const cx = W * 0.50
      const cy = H * 0.44
      const rx = W * 0.30
      const ry = H * 0.32

      const nodes = []
      const edges = []
      const pulses = []
      let frame = 0
      let surgeRadius = 0
      let surgeActive = false
      let animId

      function rand(a, b) { return a + Math.random() * (b - a) }

      function randomInOval(ocx, ocy, orx, ory) {
        const angle = rand(0, Math.PI * 2)
        const r = Math.sqrt(Math.random())
        return {
          x: ocx + Math.cos(angle) * r * orx,
          y: ocy + Math.sin(angle) * r * ory,
        }
      }

      // Left lobe cluster — 35 nodes, denser left-centre
      for (let i = 0; i < 35; i++) {
        const pos = randomInOval(cx - rx * 0.35, cy, rx * 0.55, ry * 0.75)
        nodes.push({
          x: pos.x, y: pos.y,
          vx: rand(-0.15, 0.15), vy: rand(-0.10, 0.10),
          r: rand(1.5, 4.0), phase: rand(0, Math.PI * 2), type: 'lobe',
        })
      }

      // Right lobe cluster — 35 nodes, mirror
      for (let i = 0; i < 35; i++) {
        const pos = randomInOval(cx + rx * 0.35, cy, rx * 0.55, ry * 0.75)
        nodes.push({
          x: pos.x, y: pos.y,
          vx: rand(-0.15, 0.15), vy: rand(-0.10, 0.10),
          r: rand(1.5, 4.0), phase: rand(0, Math.PI * 2), type: 'lobe',
        })
      }

      // Bridge — tight centre band only
      for (let i = 0; i < 14; i++) {
        const pos = randomInOval(cx, cy, rx * 0.22, ry * 0.45)
        nodes.push({
          x: pos.x, y: pos.y,
          vx: rand(-0.08, 0.08), vy: rand(-0.06, 0.06),
          r: rand(1.0, 2.5), phase: rand(0, Math.PI * 2), type: 'bridge',
        })
      }

      // Core nodes — fixed centre positions
      ;[
        { x: cx,              y: cy,              r: 9 },
        { x: cx - rx * 0.30,  y: cy - ry * 0.10,  r: 7 },
        { x: cx + rx * 0.30,  y: cy - ry * 0.10,  r: 7 },
        { x: cx - rx * 0.18,  y: cy + ry * 0.18,  r: 6 },
        { x: cx + rx * 0.18,  y: cy + ry * 0.18,  r: 6 },
      ].forEach(c => nodes.push({
        ...c, vx: rand(-0.04, 0.04), vy: rand(-0.03, 0.03),
        phase: rand(0, Math.PI * 2), type: 'core',
      }))

      // Build edges
      const MAX_DIST = 120
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
        if (pulses.length > 35) pulses.shift()
      }, 120)

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
          const baseAlpha = (1 - e.d / MAX_DIST) * 0.30
          const alpha = e.isBridge ? baseAlpha * 2.5 : baseAlpha
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
          const pulse = 0.5 + 0.5 * Math.sin(frame * 0.028 + n.phase)
          const isCore = n.type === 'core'

          // Core: outer glow rings
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

          // Core: radiating beams (before node body)
          if (isCore) {
            const beamCount = 8
            const beamLen = n.r * 5 + pulse * n.r * 3
            const rot = frame * 0.006
            for (let b = 0; b < beamCount * 2; b++) {
              const isPrimary = b % 2 === 0
              const angle = rot + (b / (beamCount * 2)) * Math.PI * 2
              const x1 = n.x + Math.cos(angle) * (n.r + 1)
              const y1 = n.y + Math.sin(angle) * (n.r + 1)
              const len = isPrimary ? beamLen : beamLen * 0.5
              const x2 = n.x + Math.cos(angle) * len
              const y2 = n.y + Math.sin(angle) * len
              const bg = ctx.createLinearGradient(x1, y1, x2, y2)
              bg.addColorStop(0, `rgba(201,168,76,${isPrimary ? 0.4 * pulse : 0.2 * pulse})`)
              bg.addColorStop(1, 'rgba(201,168,76,0)')
              ctx.beginPath()
              ctx.moveTo(x1, y1)
              ctx.lineTo(x2, y2)
              ctx.strokeStyle = bg
              ctx.lineWidth = isPrimary ? 0.8 + pulse * 0.4 : 0.4
              ctx.stroke()
            }
          }

          // Lobe/bridge: soft ambient glow
          if (n.type === 'lobe' || n.type === 'bridge') {
            const glowR = n.r * 3.5
            const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glowR)
            g.addColorStop(0, `rgba(100,160,255,${0.18 + pulse * 0.12})`)
            g.addColorStop(1, 'rgba(100,160,255,0)')
            ctx.beginPath()
            ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2)
            ctx.fillStyle = g
            ctx.fill()
          }

          const fillColor = isCore
            ? `rgba(201,168,76,${0.6 + pulse * 0.4})`
            : n.type === 'bridge'
              ? `rgba(180,220,255,${0.70 + pulse * 0.25})`
              : `rgba(110,170,255,${0.60 + pulse * 0.30})`

          ctx.beginPath()
          ctx.arc(n.x, n.y, n.r + (isCore ? pulse * 3 : pulse * 0.8), 0, Math.PI * 2)
          ctx.fillStyle = fillColor
          ctx.fill()

          if (isCore) {
            ctx.beginPath()
            ctx.arc(n.x, n.y, n.r + pulse * 3 + 5, 0, Math.PI * 2)
            ctx.strokeStyle = `rgba(201,168,76,${0.18 * (1 - pulse * 0.5)})`
            ctx.lineWidth = 1
            ctx.stroke()
          }

          // Move node
          n.x += n.vx; n.y += n.vy

          // Oval boundary enforcement — replace rectangular bounce
          const maxRx = n.type === 'core' ? rx * 0.25
            : n.type === 'bridge' ? rx * 0.22
            : rx * 0.58
          const maxRy = n.type === 'core' ? ry * 0.25
            : n.type === 'bridge' ? ry * 0.45
            : ry * 0.78
          const ddx = n.x - cx
          const ddy = n.y - cy
          const dist = (ddx * ddx) / (maxRx * maxRx) + (ddy * ddy) / (maxRy * maxRy)
          if (dist > 1) {
            n.vx *= -0.8
            n.vy *= -0.8
            const scale = 1 / Math.sqrt(dist)
            n.x = cx + ddx * scale * 0.95
            n.y = cy + ddy * scale * 0.95
          }
        }

        // Surge ring
        if (surgeActive) {
          surgeRadius += 3.5
          ctx.beginPath()
          ctx.arc(cx, cy, surgeRadius, 0, Math.PI * 2)
          const alpha = Math.max(0, 0.18 - surgeRadius / rx * 0.18)
          ctx.strokeStyle = `rgba(201,168,76,${alpha})`
          ctx.lineWidth = 1.2
          ctx.stroke()
          if (surgeRadius > rx) surgeActive = false
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

        frame++
        animId = requestAnimationFrame(draw)
      }

      animId = requestAnimationFrame(draw)

      cleanup = () => {
        cancelAnimationFrame(animId)
        clearInterval(pulseTimer)
        clearInterval(surgeTimer)
      }
    })
    observer.observe(canvas)

    return () => {
      observer.disconnect()
      cleanup()
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
