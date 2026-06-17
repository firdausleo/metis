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

      const cx = W * 0.50
      const cy = H * 0.48
      const baseR = Math.min(W, H) * 0.36
      const rx = baseR * 1.15
      const ry = baseR * 0.92

      function lerp(a, b, t) { return a + (b - a) * t }

      function fiberColor(distRatio, alpha) {
        if (distRatio < 0.25) {
          // orange core
          return `rgba(220,90,30,${alpha})`
        } else if (distRatio < 0.55) {
          // orange → teal transition
          const tl = (distRatio - 0.25) / 0.30
          const r = Math.round(lerp(220, 40, tl))
          const g = Math.round(lerp(90, 190, tl))
          const b = Math.round(lerp(30, 180, tl))
          return `rgba(${r},${g},${b},${alpha})`
        } else {
          // teal → blue transition
          const tl = Math.min((distRatio - 0.55) / 0.45, 1)
          const r = Math.round(lerp(40, 20, tl))
          const g = Math.round(lerp(190, 120, tl))
          const b = Math.round(lerp(180, 255, tl))
          return `rgba(${r},${g},${b},${alpha})`
        }
      }

      // Background stars
      const STARS = Array.from({ length: 55 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 0.3 + Math.random() * 0.8,
        a: 0.1 + Math.random() * 0.25,
        phase: Math.random() * Math.PI * 2,
      }))

      class FiberTract {
        constructor() { this.init() }

        init() {
          // Start near centre with slight random offset
          const startSpread = baseR * 0.12
          this.startX = cx + (Math.random() - 0.5) * startSpread * 2
          this.startY = cy + (Math.random() - 0.5) * startSpread * 2

          // Random outward angle
          this.angle = Math.random() * Math.PI * 2

          // Thin/deep variant for 30%
          this.thin = Math.random() < 0.30
          const maxLen = this.thin ? baseR * lerp(0.45, 0.75, Math.random()) : baseR * lerp(0.7, 1.05, Math.random())

          this.length = maxLen
          this.speed = lerp(0.006, 0.014, Math.random()) * (this.thin ? 1.3 : 1.0)
          this.curvature = (Math.random() - 0.5) * 1.8  // bend direction
          this.noiseAmt = lerp(0.3, 0.9, Math.random())
          this.noiseSeed = Math.random() * 100

          this.t = 0
          this.done = false
          this.fadeIn = true
          this.alpha = 0
          this.lineWidth = this.thin ? lerp(0.4, 0.8, Math.random()) : lerp(0.8, 1.6, Math.random())

          // Pulse dot
          this.hasPulse = !this.thin && Math.random() < 0.4
          this.pulseT = Math.random()  // position along tract [0,1]
          this.pulseSpeed = lerp(0.008, 0.018, Math.random())
        }

        _pos(tNorm) {
          // Generate point at normalised position tNorm along tract
          const len = tNorm * this.length
          // Base straight direction
          const bx = this.startX + Math.cos(this.angle) * len
          const by = this.startY + Math.sin(this.angle) * len
          // Curvature offset (perpendicular)
          const perpX = -Math.sin(this.angle)
          const perpY = Math.cos(this.angle)
          const curve = this.curvature * len * len / (this.length + 1) * 0.012
          // Noise layer
          const noiseX = Math.sin(tNorm * 4.2 + this.noiseSeed) * this.noiseAmt * baseR * 0.04
          const noiseY = Math.cos(tNorm * 3.7 + this.noiseSeed + 1.1) * this.noiseAmt * baseR * 0.04
          return {
            x: bx + perpX * curve + noiseX,
            y: by + perpY * curve + noiseY,
          }
        }

        _distRatio(p) {
          const dx = (p.x - cx) / rx
          const dy = (p.y - cy) / ry
          return Math.sqrt(dx * dx + dy * dy)
        }

        update() {
          if (this.done) return
          this.t += this.speed
          if (this.t >= 1) { this.t = 1; this.done = true }
          // Fade in first 15%, fade out last 20%
          if (this.t < 0.15) this.alpha = this.t / 0.15
          else if (this.t > 0.80) this.alpha = (1 - this.t) / 0.20
          else this.alpha = 1.0
          // Pulse dot advance
          if (this.hasPulse) {
            this.pulseT += this.pulseSpeed
            if (this.pulseT > 1) this.pulseT -= 1
          }
        }

        draw() {
          if (this.t <= 0) return
          const STEPS = 22
          const drawnT = this.t  // only draw up to current head
          ctx.beginPath()
          for (let i = 0; i <= STEPS; i++) {
            const tNorm = (i / STEPS) * drawnT
            const p = this._pos(tNorm)
            if (i === 0) ctx.moveTo(p.x, p.y)
            else ctx.lineTo(p.x, p.y)
          }
          // Color by midpoint distRatio
          const mid = this._pos(drawnT * 0.5)
          const distRatio = this._distRatio(mid)
          const baseAlpha = this.alpha * (this.thin ? 0.28 : 0.52)
          ctx.strokeStyle = fiberColor(distRatio, baseAlpha)
          ctx.lineWidth = this.lineWidth
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.stroke()

          // Pulse dot
          if (this.hasPulse && this.pulseT < drawnT) {
            const pp = this._pos(this.pulseT)
            const pd = this._distRatio(pp)
            const g = ctx.createRadialGradient(pp.x, pp.y, 0, pp.x, pp.y, 4)
            g.addColorStop(0, fiberColor(pd, this.alpha * 0.9))
            g.addColorStop(1, fiberColor(pd, 0))
            ctx.beginPath()
            ctx.arc(pp.x, pp.y, 4, 0, Math.PI * 2)
            ctx.fillStyle = g
            ctx.fill()
          }
        }
      }

      const TRACT_COUNT = Math.floor(Math.min(W, H) * 0.35 + 80)
      const tracts = Array.from({ length: TRACT_COUNT }, () => new FiberTract())
      // Stagger initial progress so not all start at zero
      tracts.forEach(t => { t.t = Math.random() * 0.8; t.alpha = Math.min(t.t / 0.15, 1) })

      // Surge
      let surgeActive = false
      let surgeRadius = 0
      const surgeTimer = setInterval(() => { surgeActive = true; surgeRadius = 0 }, 6000)

      let frame = 0
      let animId

      function draw() {
        ctx.clearRect(0, 0, W, H)

        // ── Background star field ──
        const starPulse = 0.5 + 0.5 * Math.sin(frame * 0.008)
        for (const s of STARS) {
          const flicker = 0.5 + 0.5 * Math.sin(frame * 0.02 + s.phase)
          ctx.beginPath()
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(180,220,255,${s.a * flicker * 0.6})`
          ctx.fill()
        }

        // ── Outer blue aura (3 layers) ──
        const auraPulse = 0.5 + 0.5 * Math.sin(frame * 0.018)
        ;[
          { r: rx * 1.30, a: 0.04 + auraPulse * 0.02 },
          { r: rx * 1.12, a: 0.08 + auraPulse * 0.03 },
          { r: rx * 0.96, a: 0.13 + auraPulse * 0.04 },
        ].forEach(layer => {
          const g = ctx.createRadialGradient(cx, cy, rx * 0.2, cx, cy, layer.r)
          g.addColorStop(0, 'rgba(20,100,255,0)')
          g.addColorStop(0.55, `rgba(40,130,255,${layer.a * 0.25})`)
          g.addColorStop(1, `rgba(20,80,200,${layer.a})`)
          ctx.beginPath()
          ctx.ellipse(cx, cy, layer.r, layer.r * (ry / rx), 0, 0, Math.PI * 2)
          ctx.fillStyle = g
          ctx.fill()
        })

        // ── Hot core — orange/amber glow ──
        const coreR = baseR * 0.18
        const corePulse = 0.5 + 0.5 * Math.sin(frame * 0.028)
        const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR + corePulse * 8)
        cg.addColorStop(0, `rgba(255,130,40,${0.35 + corePulse * 0.15})`)
        cg.addColorStop(0.4, `rgba(220,80,20,${0.18 + corePulse * 0.08})`)
        cg.addColorStop(1, 'rgba(180,60,10,0)')
        ctx.beginPath()
        ctx.arc(cx, cy, coreR + corePulse * 8, 0, Math.PI * 2)
        ctx.fillStyle = cg
        ctx.fill()

        // ── Hemisphere divide ──
        ctx.beginPath()
        ctx.moveTo(cx, cy - ry * 0.88)
        ctx.lineTo(cx, cy + ry * 0.88)
        ctx.strokeStyle = 'rgba(100,160,255,0.07)'
        ctx.lineWidth = 0.6
        ctx.stroke()

        // ── Fiber tracts ──
        for (const t of tracts) {
          t.update()
          t.draw()
          if (t.done && Math.random() < 0.004) t.init()
        }

        // ── Surge ring ──
        if (surgeActive) {
          surgeRadius += 2.5
          const sa = Math.max(0, 0.18 - surgeRadius / (rx * 2.2) * 0.18)
          ctx.beginPath()
          ctx.ellipse(cx, cy, surgeRadius, surgeRadius * (ry / rx), 0, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(80,200,255,${sa})`
          ctx.lineWidth = 1.2
          ctx.stroke()
          if (surgeRadius > rx * 1.4) surgeActive = false
        }

        // ── Region labels ──
        ctx.font = '400 8px "IBM Plex Mono", monospace'
        ctx.textAlign = 'center'
        ctx.fillStyle = 'rgba(120,190,255,0.12)'
        ;[
          ['FRONTAL',    cx,              cy - ry * 0.82],
          ['L TEMPORAL', cx - rx * 0.82,  cy + ry * 0.08],
          ['R TEMPORAL', cx + rx * 0.82,  cy + ry * 0.08],
          ['OCCIPITAL',  cx,              cy + ry * 0.82],
        ].forEach(([l, lx, ly]) => ctx.fillText(l, lx, ly))

        frame++
        animId = requestAnimationFrame(draw)
      }

      animId = requestAnimationFrame(draw)
      cleanup = () => {
        cancelAnimationFrame(animId)
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
    const S = 36
    canvas.width = S * window.devicePixelRatio
    canvas.height = S * window.devicePixelRatio
    const ctx = canvas.getContext('2d')
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

    const mc = S * 0.5

    function lerp(a, b, t) { return a + (b - a) * t }
    function miniColor(distRatio, alpha) {
      if (distRatio < 0.28) return `rgba(220,90,30,${alpha})`
      if (distRatio < 0.58) {
        const tl = (distRatio - 0.28) / 0.30
        return `rgba(${Math.round(lerp(220,40,tl))},${Math.round(lerp(90,190,tl))},${Math.round(lerp(30,180,tl))},${alpha})`
      }
      const tl = Math.min((distRatio - 0.58) / 0.42, 1)
      return `rgba(${Math.round(lerp(40,20,tl))},${Math.round(lerp(190,120,tl))},${Math.round(lerp(180,255,tl))},${alpha})`
    }

    class MiniTract {
      constructor() { this.init() }
      init() {
        this.startX = mc + (Math.random() - 0.5) * 3
        this.startY = mc + (Math.random() - 0.5) * 3
        this.angle = Math.random() * Math.PI * 2
        this.length = lerp(8, 15, Math.random())
        this.curvature = (Math.random() - 0.5) * 1.5
        this.noiseSeed = Math.random() * 100
        this.t = Math.random() * 0.7
        this.speed = lerp(0.012, 0.022, Math.random())
        this.alpha = Math.min(this.t / 0.15, 1)
        this.lineWidth = lerp(0.5, 1.2, Math.random())
        this.done = false
      }
      _pos(tNorm) {
        const len = tNorm * this.length
        const bx = this.startX + Math.cos(this.angle) * len
        const by = this.startY + Math.sin(this.angle) * len
        const perpX = -Math.sin(this.angle)
        const perpY = Math.cos(this.angle)
        const curve = this.curvature * len * len / (this.length + 1) * 0.015
        const nx = Math.sin(tNorm * 4 + this.noiseSeed) * 0.4
        const ny = Math.cos(tNorm * 3.5 + this.noiseSeed) * 0.4
        return { x: bx + perpX * curve + nx, y: by + perpY * curve + ny }
      }
      update() {
        if (this.done) return
        this.t += this.speed
        if (this.t >= 1) { this.t = 1; this.done = true }
        if (this.t < 0.15) this.alpha = this.t / 0.15
        else if (this.t > 0.80) this.alpha = (1 - this.t) / 0.20
        else this.alpha = 1.0
      }
      draw() {
        if (this.t <= 0) return
        const STEPS = 10
        ctx.beginPath()
        for (let i = 0; i <= STEPS; i++) {
          const p = this._pos((i / STEPS) * this.t)
          if (i === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        }
        const mid = this._pos(this.t * 0.5)
        const dr = Math.sqrt(((mid.x - mc) / 14) ** 2 + ((mid.y - mc) / 14) ** 2)
        ctx.strokeStyle = miniColor(dr, this.alpha * 0.55)
        ctx.lineWidth = this.lineWidth
        ctx.lineCap = 'round'
        ctx.stroke()
      }
    }

    const MINI_TRACTS = 18
    const tracts = Array.from({ length: MINI_TRACTS }, () => new MiniTract())

    let frame = 0, animId

    function draw() {
      ctx.clearRect(0, 0, S, S)
      ctx.fillStyle = '#070b12'
      ctx.fillRect(0, 0, S, S)

      // Core glow
      const cp = 0.5 + 0.5 * Math.sin(frame * 0.04)
      const cg = ctx.createRadialGradient(mc, mc, 0, mc, mc, 7 + cp * 2)
      cg.addColorStop(0, `rgba(230,100,30,${0.45 + cp * 0.15})`)
      cg.addColorStop(1, 'rgba(180,60,10,0)')
      ctx.beginPath()
      ctx.arc(mc, mc, 7 + cp * 2, 0, Math.PI * 2)
      ctx.fillStyle = cg
      ctx.fill()

      for (const t of tracts) {
        t.update()
        t.draw()
        if (t.done && Math.random() < 0.012) t.init()
      }

      frame++
      animId = requestAnimationFrame(draw)
    }

    animId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animId)
  }, [active])
}
