# Metis — Design System

Full reference for Part 5 of METIS-BIBLE. All UI work must follow these rules.

---

## Typography

### Fonts

```css
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600&family=DM+Sans:wght@400;500&display=swap');
```

| Token | Typeface | Weights | Usage |
|-------|----------|---------|-------|
| `--font-display` | Barlow Condensed | 400, 500, 600 | App name "METIS", page headings, stat numbers |
| `--font-ui` | DM Sans | 400, 500 | All body copy, labels, inputs, navigation |

### Scale

| Size | Usage |
|------|-------|
| 10px | Nav labels (mobile), micro badges |
| 12px | Captions, metadata, edge badge labels |
| 13px | Secondary labels, form helper text |
| 14px | Body text, table cells, nav desktop |
| 15px | Button labels, card summaries |
| 16px | **Minimum for all inputs** (MT11) |
| 18px | Sub-headings |
| 20–24px | Page headings (`--font-display`) |
| 28–36px | Stat numbers (`--font-display`) |

---

## Color Tokens

All tokens defined in `src/index.css` `:root`. Use only CSS variables — never hardcode hex values in components.

### Backgrounds
```css
--color-bg:          #0a0a0a    /* page background */
--color-bg-secondary:#141414    /* nav bars */
--color-bg-card:     #1a1a1a    /* cards, form containers */
--color-bg-elevated: #222222    /* dropdowns, tooltips */
--color-bg-overlay:  rgba(0,0,0,0.7)  /* modal backdrops */
```

### Borders
```css
--color-border:        rgba(255,255,255,0.08)   /* default */
--color-border-hover:  rgba(255,255,255,0.15)   /* hover */
--color-border-strong: rgba(255,255,255,0.25)   /* focus */
```

### Text
```css
--color-text-primary:   #f0f0f0   /* body */
--color-text-secondary: #888888   /* labels, captions */
--color-text-muted:     #555555   /* placeholder, disabled */
--color-text-inverse:   #0a0a0a   /* text on accent bg */
```

### Brand Accent (Mint Green)
```css
--color-accent:       #00e5a0
--color-accent-dim:   rgba(0,229,160,0.12)
--color-accent-hover: #00c98a
```

### Semantic
```css
--color-success:     #00e5a0
--color-success-dim: rgba(0,229,160,0.12)
--color-danger:      #ff4d4d
--color-danger-dim:  rgba(255,77,77,0.12)
--color-warning:     #ffb547
--color-warning-dim: rgba(255,181,71,0.12)
--color-info:        #4db8ff
--color-info-dim:    rgba(77,184,255,0.12)
```

### Edge Traffic Lights
```css
--color-edge-green: #00e5a0   /* edge ≥ 5% — recommend */
--color-edge-amber: #ffb547   /* edge 0–4.9% — marginal */
--color-edge-red:   #ff4d4d   /* edge < 0% — skip */
```

---

## Spacing & Shape

```css
--radius-sm:   6px
--radius-md:   10px
--radius-lg:   16px
--radius-full: 9999px   /* pills */

--touch-target:       44px    /* minimum height for any tappable */
--nav-height-top:     56px    /* desktop top nav */
--nav-height-bottom:  64px    /* mobile bottom nav */
```

---

## Layout

### Breakpoint
- **Mobile**: `< 768px` — bottom nav, full-width cards
- **Desktop**: `≥ 768px` — top nav, centered content

### Content Container
```css
max-width: 720px;
margin: 0 auto;
padding: 0 24px;          /* desktop */
padding: 0 16px;          /* mobile */
```

### App Content Padding (avoids nav overlap)
```css
.app-content {
  padding-bottom: 80px;   /* mobile: clears bottom nav */
}
@media (min-width: 768px) {
  .app-content {
    padding-bottom: 0;
    padding-top: 56px;    /* desktop: clears top nav */
  }
}
```

### Section Rhythm
- Gap between cards: `12px`
- Gap between sections: `24px`
- Page top padding: `24px`

---

## Component Patterns

### Card
```jsx
<div style={{
  background: 'var(--color-bg-card)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '20px 16px',
}}>
```

### Input
```jsx
<input style={{
  width: '100%',
  padding: '11px 12px',
  background: 'var(--color-bg-secondary)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-ui)',
  fontSize: 16,               /* MT11 */
  outline: 'none',
  boxSizing: 'border-box',
}} />
```

On focus: border changes to `var(--color-border-strong)`.

### Button (Primary)
```jsx
<button style={{
  width: '100%',
  minHeight: 'var(--touch-target)',   /* MT12 */
  background: 'var(--color-accent)',
  color: 'var(--color-text-inverse)',
  fontWeight: 600,
  fontSize: 15,
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontFamily: 'var(--font-ui)',
}} />
```

Disabled state: `background: var(--color-accent-dim)`, `color: var(--color-accent)`, `opacity: 0.7`, `cursor: not-allowed`.

### Button (Ghost)
```jsx
<button style={{
  background: 'none',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-secondary)',
  padding: '5px 12px',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontFamily: 'var(--font-ui)',
  fontSize: 13,
  minHeight: 'var(--touch-target)',
}} />
```

### Edge Badge
```jsx
<span style={{
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 'var(--radius-full)',
  fontSize: 12,
  fontWeight: 600,
  background: edge >= 0.05
    ? 'var(--color-success-dim)'
    : edge >= 0
    ? 'var(--color-warning-dim)'
    : 'var(--color-danger-dim)',
  color: edge >= 0.05
    ? 'var(--color-edge-green)'
    : edge >= 0
    ? 'var(--color-edge-amber)'
    : 'var(--color-edge-red)',
}}>
  {edge >= 0 ? '+' : ''}{(edge * 100).toFixed(1)}%
</span>
```

### Stat Card
```jsx
<div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '20px 16px' }}>
  <p style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
    {label}
  </p>
  <p style={{ fontSize: 32, fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
    {value}
  </p>
</div>
```

### Error State
```jsx
<div style={{
  background: 'var(--color-danger-dim)',
  border: '1px solid var(--color-danger)',
  borderRadius: 'var(--radius-sm)',
  padding: '10px 12px',
}}>
  <p style={{ color: 'var(--color-danger)', fontSize: 13, margin: 0 }}>
    {errorMessage}
  </p>
</div>
```

### Loading Spinner
```jsx
<span style={{
  width: 16, height: 16,
  border: '2px solid currentColor',
  borderTopColor: 'transparent',
  borderRadius: '50%',
  display: 'inline-block',
  animation: 'spin 0.7s linear infinite',
}} />
/* Add to a <style> block: @keyframes spin { to { transform: rotate(360deg); } } */
```

---

## NavBar

### Mobile (bottom, < 768px)
- Fixed bottom, full width
- Background: `--color-bg-secondary`
- Border top: `1px solid var(--color-border)`
- `paddingBottom: 'env(safe-area-inset-bottom)'`
- 4 items: Dashboard ⚽ Matches 🎯 My Bets ⚙️ Settings
- Each item: icon (20px) + label (10px, `--font-ui`)
- Active: `--color-accent` + `fontWeight: 600`
- Inactive: `--color-text-secondary`

### Desktop (top, ≥ 768px)
- Fixed top, full width, height: `--nav-height-top` (56px)
- Background: `--color-bg-secondary`
- Border bottom: `1px solid var(--color-border)`
- Left: "METIS" in `--font-display`, 18px, `--color-accent`
- Centre: nav links (Dashboard, Matches, My Bets)
- Right: ⚙️ icon + user email (muted, truncated) + Logout ghost button

Active nav link: `--color-accent` text + `--color-accent-dim` background pill.

---

## Do Not
- Do not use hex colors directly in component `style` props
- Do not use CSS class names for one-off styling (use inline style or add to index.css)
- Do not add new Google Fonts without updating `--font-display` or `--font-ui`
- Do not use `!important` outside of `index.css` responsive rules
- Do not use `px` for font sizes below 16 on any interactive input
