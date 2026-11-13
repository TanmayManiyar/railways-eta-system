import React from 'react'

/* Panels are ruled boxes, not floating cards: one hairline border, square corners,
   a tinted header strip. Nothing has a shadow — this is a printed operating sheet. */
export function Panel({ title, sub, right, children, className = '', pad = true }) {
  return (
    <section className={`bg-surface border border-rule ${className}`}>
      {(title || right) && (
        <header className="flex items-start justify-between gap-4 px-3.5 py-2 bg-surface2 border-b border-rule">
          <div className="min-w-0">
            {title && <h2 className="lbl text-[11.5px] text-primary">{title}</h2>}
            {sub && <p className="text-[11.5px] text-inkfaint mt-1 leading-snug max-w-[95ch]">{sub}</p>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div className={pad ? 'p-3.5' : ''}>{children}</div>
    </section>
  )
}

const TONE = {
  primary: 'bg-primarywash text-primary border-primary/35',
  signal:  'bg-signalwash text-signal border-signal/35',
  caution: 'bg-cautionwash text-caution border-caution/35',
  danger:  'bg-dangerwash text-danger border-danger/35',
  info:    'bg-infowash text-info border-info/35',
  mute:    'bg-surface2 text-inksoft border-rulestrong',
}

export function Chip({ tone = 'mute', children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-px border text-[10.5px] mono leading-[1.5] ${TONE[tone]} ${className}`}>
      {children}
    </span>
  )
}

/**
 * Summary band: one dominant figure carrying the headline, the rest as supporting
 * readings separated by rules. Deliberately not a row of equal cards — the eye
 * should land on the lead number first.
 */
export function SummaryBar({ lead, items = [], right }) {
  return (
    <div className="bg-surface border border-rule flex items-stretch flex-wrap">
      <div className="px-4 py-3 border-r border-rule min-w-[168px]">
        <div className="lbl text-[10px] text-inkfaint">{lead.label}</div>
        <div className="flex items-baseline gap-1.5 mt-0.5">
          <span className="mono text-[30px] leading-none text-primary">{lead.value}</span>
          {lead.unit && <span className="text-[12px] text-inkfaint">{lead.unit}</span>}
        </div>
        {lead.hint && <div className="text-[11px] text-inkfaint mt-1 leading-snug">{lead.hint}</div>}
      </div>
      <div className="flex items-stretch flex-wrap flex-1 min-w-0">
        {items.map((it) => (
          <div key={it.label} className="px-4 py-3 border-r border-rule last:border-r-0 min-w-[124px]">
            <div className="lbl text-[10px] text-inkfaint">{it.label}</div>
            <div className={`mono text-[17px] leading-tight mt-0.5 ${
              it.tone === 'signal' ? 'text-signal'
              : it.tone === 'caution' ? 'text-caution'
              : it.tone === 'danger' ? 'text-danger' : 'text-ink'}`}>
              {it.value}{it.unit && <span className="text-[11px] text-inkfaint ml-0.5">{it.unit}</span>}
            </div>
            {it.hint && <div className="text-[10.5px] text-inkfaint mt-0.5 leading-snug">{it.hint}</div>}
          </div>
        ))}
      </div>
      {right && <div className="px-4 py-3 border-l border-rule flex items-center">{right}</div>}
    </div>
  )
}

export function Stat({ label, value, unit, tone = 'ink', hint }) {
  const color = {
    ink: 'text-ink', primary: 'text-primary', signal: 'text-signal',
    caution: 'text-caution', danger: 'text-danger',
  }[tone]
  return (
    <div className="bg-surface border border-rule px-3 py-2.5">
      <div className="lbl text-[10px] text-inkfaint">{label}</div>
      <div className={`mono text-[19px] leading-tight mt-0.5 ${color}`}>
        {value}
        {unit && <span className="text-[11px] text-inkfaint ml-0.5">{unit}</span>}
      </div>
      {hint && <div className="text-[10.5px] text-inkfaint mt-0.5 leading-snug">{hint}</div>}
    </div>
  )
}

export function DelayChip({ sec }) {
  const m = Math.round(sec / 60)
  if (Math.abs(m) < 1) return <Chip tone="signal">on time</Chip>
  if (m < 0) return <Chip tone="signal">{m}m early</Chip>
  if (m <= 10) return <Chip tone="caution">+{m}m</Chip>
  return <Chip tone="danger">+{m}m</Chip>
}

/** The point estimate as a tick inside its prediction interval. */
export function IntervalBar({ lo, hi, eta, scaleMin = -900, scaleMax = 900, width = 118 }) {
  const span = Math.max(1, scaleMax - scaleMin)
  const x = (v) => ((v - scaleMin) / span) * width
  const a = Math.max(0, x(lo - eta))
  const b = Math.min(width, x(hi - eta))
  const mid = x(0)
  return (
    <svg width={width} height="12" role="img"
         aria-label={`Prediction interval spanning ${Math.round((hi - lo) / 60)} minutes`}>
      <line x1="0" y1="6" x2={width} y2="6" stroke="var(--color-rule)" strokeWidth="1" />
      <rect x={a} y="3" width={Math.max(2, b - a)} height="6" fill="var(--color-primary)" opacity="0.22" />
      <line x1={a} y1="1" x2={a} y2="11" stroke="var(--color-primary)" strokeWidth="1.3" />
      <line x1={b} y1="1" x2={b} y2="11" stroke="var(--color-primary)" strokeWidth="1.3" />
      <rect x={mid - 1} y="1.5" width="2" height="9" fill="var(--color-primary)" />
    </svg>
  )
}

/** Prediction history with the naive estimate drawn faint behind it. */
export function Spark({ points, width = 96, height = 22 }) {
  if (!points || points.length < 2) return <div style={{ width, height }} />
  const vals = points.map((p) => p.eta)
  const bvals = points.map((p) => p.baseline).filter((v) => v != null)
  const all = vals.concat(bvals)
  const min = Math.min(...all), max = Math.max(...all)
  const span = Math.max(60, max - min)
  const x = (i, n) => (i / Math.max(1, n - 1)) * width
  const y = (v) => height - 2 - ((v - min) / span) * (height - 4)
  const path = (arr, key) =>
    arr.map((p, i) => `${i ? 'L' : 'M'}${x(i, arr.length).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')
  const withBase = points.filter((p) => p.baseline != null)
  return (
    <svg width={width} height={height} role="img" aria-label="ETA prediction history">
      {withBase.length > 1 && (
        <path d={path(withBase, 'baseline')} fill="none" stroke="var(--color-inkfaint)"
              strokeWidth="1" strokeDasharray="2 2" />
      )}
      <path d={path(points, 'eta')} fill="none" stroke="var(--color-primary)" strokeWidth="1.5" />
    </svg>
  )
}

export function Btn({ children, onClick, tone = 'mute', active, disabled, className = '', type = 'button', title }) {
  const base = 'px-2.5 py-1 border text-[12px] lbl transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  const tones = {
    mute: active
      ? 'bg-primary border-primary text-white'
      : 'bg-surface border-rulestrong text-inksoft hover:text-ink hover:border-inkfaint',
    danger: 'bg-dangerwash border-danger/50 text-danger hover:border-danger',
    primary: 'bg-primary border-primary text-white hover:bg-primarysoft',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
            className={`${base} ${tones[tone]} ${className}`}>{children}</button>
  )
}

/** Underlined tab strip — reads as navigation, not as a row of buttons. */
export function Tabs({ tabs, value, onChange }) {
  return (
    <nav className="flex items-end gap-0.5" aria-label="Screens">
      {tabs.map(([k, label]) => {
        const on = value === k
        return (
          <button
            key={k}
            onClick={() => onChange(k)}
            aria-current={on ? 'page' : undefined}
            className={`px-3 py-1.5 text-[12.5px] lbl border-b-2 transition-colors ${
              on ? 'border-primary text-primary bg-primarywash'
                 : 'border-transparent text-inkfaint hover:text-ink'}`}
          >
            {label}
          </button>
        )
      })}
    </nav>
  )
}

export function Field({ label, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="lbl text-[10px] text-inkfaint block mb-1">{label}</span>
      {children}
    </label>
  )
}

export const inputCls =
  'w-full bg-surface border border-rulestrong px-2.5 py-1.5 text-[13px] mono text-ink ' +
  'focus:border-primary outline-none placeholder:text-inkfaint'
