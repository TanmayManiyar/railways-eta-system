import React, { useMemo, useRef, useState } from 'react'
import { TRAINS, fmtClock, searchBlob } from '../data/network.js'
import { Chip } from './bits.jsx'

const CAT_TONE = { RESERVED: 'info', UNRESERVED: 'signal', METRO: 'caution' }
const CAT_SHORT = { RESERVED: 'RSV', UNRESERVED: 'LOC', METRO: 'MTR' }
const MAX_RESULTS = 8

/**
 * The one search box, available on every tab. It doesn't belong to any single
 * screen — it lives in the header, and picking a result opens the same train
 * popup you'd get from clicking a row anywhere else in the app.
 */
export default function GlobalSearch({ world, onOpenTrain }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  const results = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return []
    const out = []
    for (const t of TRAINS) {
      const blob = searchBlob(t)
      if (!terms.every((term) => blob.includes(term))) continue
      out.push(t)
      if (out.length >= MAX_RESULTS) break
    }
    return out
  }, [q])

  const pick = (id) => {
    onOpenTrain(id)
    setQ('')
    setOpen(false)
  }

  return (
    <div className="relative w-full max-w-[280px]" ref={boxRef}>
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); setOpen(false) } }}
        placeholder="Find any train…"
        aria-label="Search trains from any screen"
        className="w-full bg-surface border border-rulestrong px-2.5 py-1.5 text-[12.5px] mono text-ink
                   focus:border-primary outline-none placeholder:text-inkfaint"
      />
      {open && q.trim() && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-surface border border-rulestrong shadow-sm z-40
                        max-h-[320px] overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-2.5 py-2 text-[12px] text-inkfaint">No train matches “{q}”.</p>
          ) : (
            results.map((t) => {
              const st = world.trains[t.id]
              const live = !!st && st.started && !st.done
              return (
                <button key={t.id} onMouseDown={() => pick(t.id)}
                        className="w-full text-left px-2.5 py-1.5 border-b border-rule last:border-b-0
                                   hover:bg-primarywash flex items-center gap-2">
                  <span className="mono text-[12.5px] text-ink shrink-0">{t.no}</span>
                  <Chip tone={CAT_TONE[t.category]}>{CAT_SHORT[t.category]}</Chip>
                  <span className="text-[11.5px] text-inkfaint truncate flex-1">{t.name}</span>
                  {live && <span className="mono text-[10.5px] text-inkfaint shrink-0">now {fmtClock(world.nowSec)}</span>}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
