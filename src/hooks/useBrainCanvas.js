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

      // Brain oval parameters
      const cx = W * 0.50
      const cy = H * 0.47
      const rx = W * 0.28
      const ry = H * 0.38

      function rand(a, b) { return a + Math.random() * (b - a) }

      // ── NODE GENERATION — structured grid on oval ──────────────────
      const nodes = []
      const COLS = 14
      const ROWS = 10

      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const u = (col / (COLS - 1)) * 2 - 1  // -1 to 1
          const v = (row / (ROWS - 1)) * 2 - 1  // -1 to 1

          // Slight pear shape — wider top, narrower bottom
          const vAdj = v * (1 + v * 0.15)
          const dist = (u * u) + (vAdj * vAdj)
          if (dist > 0.88) continue

          const jitterX = (Math.random() - 0.5) * rx * 0.08
          const jitterY = (Math.random() - 0.5) * ry * 0.08
          const x = cx + u * rx + jitterX
          const y = cy + vAdj * ry + jitterY

          const type = Math.random() < 0.75 ? 'white' : 'gold'
          const centreDist = Math.sqrt(u * u + v * v)
          const r = rand(1.2, 3.5) * (1 - centreDist * 0.2)

          nodes.push({
            x, y, baseX: x, baseY: y,
            vx: rand(-0.08, 0.08), vy: rand(-0.06, 0.06),
            r: Math.max(r, 0.8),
            phase: rand(0, Math.PI * 2),
            type, u, v,
          })
        }
      }

      // Extra nodes along centre divide (corpus callosum)
      for (let i = 0; i < 12; i++) {
        const v = rand(-0.85, 0.85)
        const vAdj = v * (1 + v * 0.15)
        if (Math.abs(vAdj) > 0.88) continue
        const x = cx + rand(-rx * 0.04, rx * 0.04)
        const y = cy + vAdj * ry
        nodes.push({
          x, y, baseX: cx, baseY: y,
          vx: rand(-0.04, 0.04), vy: rand(-0.06, 0.06),
          r: rand(0.8, 1.8),
          phase: rand(0, Math.PI * 2),
          type: 'white', u: 0, v,
        })
      }

      // ── EDGES ─────────────────────────────────────────────────────
      const edges = []
      const MAX_DIST = rx * 0.28

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].baseX - nodes[j].baseX
          const dy = nodes[i].baseY - nodes[j].baseY
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < MAX_DIST) {
            const crossesCenter = nodes[i].u * nodes[j].u < -0.1
            if (crossesCenter && d > MAX_DIST * 0.5) continue
            edges.push({
              a: i, b: j, d,
              isCentre: Math.abs(nodes[i].u) < 0.15 && Math.abs(nodes[j].u) < 0.15,
            })
          }
        }
      }

      // ── PULSES ────────────────────────────────────────────────────
      const pulses = []
      const pulseTimer = setInterval(() => {
        if (!edges.length) return
        const e = edges[Math.floor(Math.random() * edges.length)]
        pulses.push({
          edge: e, t: 0,
          speed: rand(0.008, 0.020),
          rev: Math.random() > 0.5,
          alpha: rand(0.5, 0.9),
          trail: [],
        })
        if (pulses.length > 30) pulses.shift()
      }, 160)

      // ── SURGE ─────────────────────────────────────────────────────
      let surgeActive = false
      let surgeRadius = 0
      const surgeTimer = setInterval(() => {
        surgeActive = true
        surgeRadius = 0
      }, 6000)

      let frame = 0
      let animId

      function draw() {
        ctx.clearRect(0, 0, W, H)

        // Outer brain aura — pulsing blue glow
        const framePulse = 0.5 + 0.5 * Math.sin(frame * 0.015)
        ;[
          { r: rx * 1.25, a: 0.04 + framePulse * 0.02 },
          { r: rx * 1.10, a: 0.08 + framePulse * 0.03 },
          { r: rx * 0.98, a: 0.12 + framePulse * 0.04 },
        ].forEach(layer => {
          const g = ctx.createRadialGradient(cx, cy, rx * 0.3, cx, cy, layer.r)
          g.addColorStop(0, 'rgba(80,160,255,0)')
          g.addColorStop(0.6, `rgba(80,160,255,${layer.a * 0.3})`)
          g.addColorStop(1, `rgba(80,160,255,${layer.a})`)
          ctx.beginPath()
          ctx.ellipse(cx, cy, layer.r, layer.r * (ry / rx), 0, 0, Math.PI * 2)
          ctx.fillStyle = g
          ctx.fill()
        })

        // Hemisphere divide line (corpus callosum — subtle)
        ctx.beginPath()
        ctx.moveTo(cx, cy - ry * 0.85)
        ctx.lineTo(cx, cy + ry * 0.85)
        ctx.strokeStyle = 'rgba(150,200,255,0.12)'
        ctx.lineWidth = 0.8
        ctx.stroke()

        // Edges — thin white mesh lines
        for (const e of edges) {
          const na = nodes[e.a], nb = nodes[e.b]
          const baseAlpha = (1 - e.d / MAX_DIST) * 0.18
          ctx.beginPath()
          ctx.moveTo(na.x, na.y)
          ctx.lineTo(nb.x, nb.y)
          ctx.strokeStyle = e.isCentre
            ? `rgba(180,220,255,${baseAlpha * 1.8})`
            : `rgba(180,220,255,${baseAlpha})`
          ctx.lineWidth = 0.5
          ctx.stroke()
        }

        // Pulses — gold travelling dots
        for (let i = pulses.length - 1; i >= 0; i--) {
          const p = pulses[i]
          p.t += p.speed
          if (p.t > 1) { pulses.splice(i, 1); continue }
          const na = nodes[p.edge.a], nb = nodes[p.edge.b]
          const t = p.rev ? 1 - p.t : p.t
          const px = na.x + (nb.x - na.x) * t
          const py = na.y + (nb.y - na.y) * t
          p.trail.push({ x: px, y: py })
          if (p.trail.length > 5) p.trail.shift()
          p.trail.forEach((pt, ti) => {
            const ta = p.alpha * (ti / p.trail.length) * 0.3
            ctx.beginPath()
            ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2)
            ctx.fillStyle = `rgba(201,168,76,${ta})`
            ctx.fill()
          })
          const g = ctx.createRadialGradient(px, py, 0, px, py, 5)
          g.addColorStop(0, `rgba(201,168,76,${p.alpha})`)
          g.addColorStop(1, 'rgba(201,168,76,0)')
          ctx.beginPath()
          ctx.arc(px, py, 5, 0, Math.PI * 2)
          ctx.fillStyle = g
          ctx.fill()
        }

        // Nodes
        for (const n of nodes) {
          const pulse = 0.5 + 0.5 * Math.sin(frame * 0.020 + n.phase)
          const isGold = n.type === 'gold'

          // Node glow
          const glowR = n.r * 3.5
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glowR + pulse * 1.5)
          if (isGold) {
            g.addColorStop(0, `rgba(201,168,76,${0.25 + pulse * 0.15})`)
            g.addColorStop(1, 'rgba(201,168,76,0)')
          } else {
            g.addColorStop(0, `rgba(200,230,255,${0.22 + pulse * 0.13})`)
            g.addColorStop(1, 'rgba(180,220,255,0)')
          }
          ctx.beginPath()
          ctx.arc(n.x, n.y, glowR + pulse * 1.5, 0, Math.PI * 2)
          ctx.fillStyle = g
          ctx.fill()

          // Node body
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.r + pulse * 0.6, 0, Math.PI * 2)
          ctx.fillStyle = isGold
            ? `rgba(201,168,76,${0.80 + pulse * 0.18})`
            : `rgba(220,240,255,${0.82 + pulse * 0.16})`
          ctx.fill()

          // Drift + soft return to base
          n.x += n.vx
          n.y += n.vy
          n.vx += (n.baseX - n.x) * 0.0008
          n.vy += (n.baseY - n.y) * 0.0008
          n.vx *= 0.98
          n.vy *= 0.98
        }

        // Surge ring
        if (surgeActive) {
          surgeRadius += 3
          const a = Math.max(0, 0.15 - surgeRadius / (rx * 2) * 0.15)
          ctx.beginPath()
          ctx.ellipse(cx, cy, surgeRadius, surgeRadius * (ry / rx), 0, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(180,220,255,${a})`
          ctx.lineWidth = 1
          ctx.stroke()
          if (surgeRadius > rx * 1.3) surgeActive = false
        }

        // Region labels — very subtle
        ctx.font = '400 8px "IBM Plex Mono", monospace'
        ctx.textAlign = 'center'
        ctx.fillStyle = 'rgba(150,200,255,0.15)'
        ;[
          ['FRONTAL',    cx,          cy - ry * 0.78],
          ['L TEMPORAL', cx - rx * 0.78, cy + ry * 0.10],
          ['R TEMPORAL', cx + rx * 0.78, cy + ry * 0.10],
          ['OCCIPITAL',  cx,          cy + ry * 0.78],
        ].forEach(([l, lx, ly]) => ctx.fillText(l, lx, ly))

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
        ctx.strokeStyle = 'rgba(180,220,255,0.25)'
        ctx.lineWidth = 0.6
        ctx.stroke()
      })

      nodes.forEach(n => {
        const p = 0.5 + 0.5 * Math.sin(frame * 0.04 + n.phase)
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r + p * 0.8, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(220,240,255,${0.5 + p * 0.4})`
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
