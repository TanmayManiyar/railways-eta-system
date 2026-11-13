import React, { useMemo, useState, memo } from 'react'
import { TRAINS, LINE_LIST, CATEGORIES, fmtClock, searchBlob } from '../data/network.js'
import { useWorld } from '../store.jsx'
import { Panel, Chip, SummaryBar, DelayChip, Btn, inputCls } from '../ui/bits.jsx'

const CAT_TONE = { RESERVED: 'info', UNRESERVED: 'signal', METRO: 'caution' }
const CAT_SHORT = { RESERVED: 'RSV', UNRESERVED: 'LOC', METRO: 'MTR' }
const PAGE = 40

const STATUSES = [
  ['running', 'Running'],
  ['delayed', 'Delayed 5m+'],
  ['held', 'Held'],
  ['scheduled', 'Not started'],
  ['all', 'All'],
]

const SORTS = [
  ['dep', 'Departure time'],
  ['delay', 'Delay, worst first'],
  ['eta', 'Destination ETA'],
  ['no', 'Service number'],
]

/** How far this service's forecast has moved since the journey began. */
function drift(history) {
  if (!history || history.length < 2) return null
  return (history[history.length - 1].eta - history[0].eta) / 60
}

/**
 * The find-and-track screen. Selecting a train never navigates anywhere — it opens
 * the detail popup (rendered once, at the app root) via onOpenTrain.
 */
export default function Dashboard({ onOpenTrain }) {
  const { world, evaluation } = useWorld()

  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [line, setLine] = useState('all')
  const [status, setStatus] = useState('running')
  const [sort, setSort] = useState('dep')
  const [page, setPage] = useState(0)

  const stats = world.stats || { running: 0, onTimePct: 0, meanDelayMin: 0, held: 0, byCat: {} }
  const activeEvents = world.events.filter((e) => e.active)
  const recent = world.broadcasts.filter((b) => world.nowSec - b.at < 3600)
  const cov = evaluation.reliability.find((r) => r.nominal === 95)

  const rows = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const out = []
    for (const t of TRAINS) {
      if (cat !== 'all' && t.category !== cat) continue
      if (line !== 'all' && t.lineId !== line) continue

      const st = world.trains[t.id]
      const live = !!st && st.started && !st.done
      const done = !!st && st.done
      const scheduled = !st || !st.started

      if (status === 'running' && !live) continue
      if (status === 'delayed' && (!live || st.delaySec < 300)) continue
      if (status === 'held' && (!live || !st.held)) continue
      if (status === 'scheduled' && !scheduled) continue

      if (terms.length) {
        const blob = searchBlob(t)
        if (!terms.every((term) => blob.includes(term))) continue
      }
      out.push({ t, st, live, done, scheduled, pred: world.predictions[t.id] })
    }
    out.sort((a, b) => {
      if (sort === 'delay') return (b.st?.delaySec ?? -1e9) - (a.st?.delaySec ?? -1e9)
      if (sort === 'no') return a.t.no.localeCompare(b.t.no, undefined, { numeric: true })
      if (sort === 'eta') return (a.pred?.destEta ?? a.t.schedArr) - (b.pred?.destEta ?? b.t.schedArr)
      return a.t.schedDep - b.t.schedDep
    })
    return out
  }, [q, cat, line, status, sort, world.nowSec])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE))
  const cur = Math.min(page, pageCount - 1)
  const visible = rows.slice(cur * PAGE, cur * PAGE + PAGE)
  const lineOptions = LINE_LIST.filter((l) => cat === 'all' || l.category === cat)
  const reset = (fn) => (v) => { fn(v); setPage(0) }

  return (
    <div className="flex flex-col gap-3">
      <SummaryBar
        lead={{
          label: 'Services live',
          value: stats.running,
          hint: `${stats.byCat.RESERVED || 0} reserved · ${stats.byCat.UNRESERVED || 0} suburban · ${stats.byCat.METRO || 0} metro`,
        }}
        items={[
          { label: 'Within 5 min', value: stats.onTimePct.toFixed(0), unit: '%',
            tone: stats.onTimePct > 70 ? 'signal' : stats.onTimePct > 45 ? 'caution' : 'danger' },
          { label: 'Mean delay', value: stats.meanDelayMin.toFixed(1), unit: 'min',
            tone: stats.meanDelayMin > 8 ? 'danger' : stats.meanDelayMin > 3 ? 'caution' : 'signal' },
          { label: 'Held', value: stats.held, tone: stats.held ? 'danger' : 'ink', hint: 'behind a block' },
          { label: 'Broadcasts / hr', value: recent.length, hint: 'post-significance' },
          { label: 'Confidence, verified', value: cov ? cov.realised.toFixed(1) : '95', unit: '%',
            tone: 'signal', hint: 'target 95%' },
        ]}
      />

      <div className="bg-surface border border-rule">
        <div className="flex items-center gap-2.5 px-3 py-2 border-b border-rule">
          <input
            className={`${inputCls} text-[13.5px] flex-1`}
            placeholder="Search by number, name, line or any station — “virar fast”, “ghatkopar”, “12123”…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0) }}
            aria-label="Search services"
          />
          <span className="mono text-[12px] text-inksoft shrink-0 tnum">
            {rows.length.toLocaleString()}<span className="text-inkfaint"> / {TRAINS.length.toLocaleString()}</span>
          </span>
        </div>

        <div className="flex items-center gap-x-5 gap-y-2 px-3 py-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="lbl text-[9.5px] text-inkfaint w-8">Type</span>
            <Btn active={cat === 'all'} onClick={() => { reset(setCat)('all'); setLine('all') }}>All</Btn>
            {Object.values(CATEGORIES).map((c) => (
              <Btn key={c.id} active={cat === c.id} title={c.hint}
                   onClick={() => { reset(setCat)(c.id); setLine('all') }}>{c.label}</Btn>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="lbl text-[9.5px] text-inkfaint w-10">Status</span>
            {STATUSES.map(([k, label]) => (
              <Btn key={k} active={status === k} onClick={() => reset(setStatus)(k)}>{label}</Btn>
            ))}
          </div>

          <label className="flex items-center gap-1.5">
            <span className="lbl text-[9.5px] text-inkfaint">Line</span>
            <select className={`${inputCls} w-auto py-1 text-[12px]`} value={line}
                    onChange={(e) => reset(setLine)(e.target.value)}>
              <option value="all">All lines</option>
              {lineOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>

          <label className="flex items-center gap-1.5 ml-auto">
            <span className="lbl text-[9.5px] text-inkfaint">Sort</span>
            <select className={`${inputCls} w-auto py-1 text-[12px]`} value={sort}
                    onChange={(e) => setSort(e.target.value)}>
              {SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>

          {pageCount > 1 && (
            <span className="flex items-center gap-1.5">
              <Btn disabled={cur === 0} onClick={() => setPage(cur - 1)}>Prev</Btn>
              <span className="mono text-[11.5px] text-inksoft tnum w-14 text-center">{cur + 1} / {pageCount}</span>
              <Btn disabled={cur >= pageCount - 1} onClick={() => setPage(cur + 1)}>Next</Btn>
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-3 items-start">
        <Panel
          title="Running board"
          sub="Click any service for its full prediction, confidence and live position. Every forecast is a range, not a single guess."
          pad={false}
          className="min-w-0"
        >
          {visible.length === 0 ? (
            <p className="p-4 text-[13px] text-inkfaint">
              No service matches. Clear the search or set status to “All”.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="grid-table min-w-[760px] text-[13px]">
                <colgroup>
                  <col style={{ width: '26%' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '17%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Route</th>
                    <th>Status</th>
                    <th className="text-right">Delay</th>
                    <th className="text-right">Arrival</th>
                    <th className="text-right">Forecast drift</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <Row key={r.t.id} row={r} world={world} onOpen={() => onOpenTrain(r.t.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-3 min-w-0">
          <Panel title="Active events" pad={false}>
            {activeEvents.length === 0 ? (
              <p className="px-3.5 py-3 text-[12px] text-inkfaint">Network running to plan.</p>
            ) : (
              <ul>
                {activeEvents.map((e) => (
                  <li key={e.id} className="px-3 py-2 border-b border-rule last:border-b-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="mono text-[11.5px] text-danger">{e.type} · {e.sectionId}</span>
                      <Chip tone="danger">{e.severity}</Chip>
                    </div>
                    <div className="text-[11px] text-inksoft mt-1 mono">
                      {fmtClock(e.startSec)}–{fmtClock(e.endSec)}
                      {!e.blocked && e.speedKmph ? ` · ${e.speedKmph} km/h` : ''}
                    </div>
                    {e.impact?.length > 0 && (
                      <div className="text-[10.5px] text-inkfaint mt-0.5">
                        {e.impact.length} service{e.impact.length > 1 ? 's' : ''} revised
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Broadcast feed"
                 sub="Only changes big enough to publish. Select one to open that service."
                 pad={false}>
            {world.broadcasts.length === 0 ? (
              <p className="px-3.5 py-3 text-[12px] text-inkfaint">
                Nothing published yet. Press Play to advance the network.
              </p>
            ) : (
              <ul className="max-h-[520px] overflow-y-auto">
                {world.broadcasts.slice(0, 30).map((b) => {
                  const up = b.delta > 0
                  return (
                    <li key={b.id} onClick={() => onOpenTrain(b.trainId)}
                        className="px-3 py-2 border-b border-rule last:border-b-0 cursor-pointer hover:bg-primarywash">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="mono text-[12px] text-ink">{b.no}</span>
                        <span className="mono text-[10.5px] text-inkfaint">{fmtClock(b.at)}</span>
                      </div>
                      <div className="mono text-[12px] mt-0.5">
                        {b.from != null && <span className="text-inkfaint line-through mr-1">{fmtClock(b.from)}</span>}
                        <span className="text-ink">{fmtClock(b.to)}</span>
                        {b.delta != null && Math.abs(b.delta) >= 30 && (
                          <span className={`ml-1.5 ${up ? 'text-caution' : 'text-signal'}`}>
                            {up ? '+' : ''}{Math.round(b.delta / 60)}m
                          </span>
                        )}
                      </div>
                      <div className="text-[10.5px] text-inkfaint mt-0.5 leading-snug">{b.reason}</div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

const Row = memo(function Row({ row, world, onOpen }) {
  const { t, st, live, done, scheduled, pred } = row
  const nextStop = live ? t.route[Math.min(st.curIdx + 1, t.route.length - 1)] : null
  const d = drift(world.history[t.id])

  return (
    <tr onClick={onOpen} className="align-top cursor-pointer">
      <td>
        <div className="flex items-center gap-1.5">
          <span className="mono text-ink">{t.no}</span>
          <Chip tone={CAT_TONE[t.category]}>{CAT_SHORT[t.category]}</Chip>
        </div>
        <div className="text-[11px] text-inkfaint mt-0.5 truncate max-w-[220px]" title={t.name}>{t.name}</div>
      </td>

      <td>
        <div className="mono text-[12px] whitespace-nowrap">{t.origin} → {t.dest}</div>
        <div className="text-[10.5px] text-inkfaint truncate" title={`${t.lineName} · ${t.stopCount} stops`}>
          {t.lineShort} · {t.stopCount} stops
        </div>
      </td>

      <td>
        {scheduled ? <Chip tone="mute">dep {fmtClock(t.schedDep)}</Chip>
          : done ? <Chip tone="signal">arrived</Chip>
          : st.held ? <Chip tone="danger">held</Chip>
          : st.dwelling ? <Chip tone="info">at {t.route[st.curIdx].code}</Chip>
          : <span className="mono text-[12px] text-inksoft whitespace-nowrap">{st.speedKmph} km/h</span>}
        {live && nextStop && !st.dwelling && (
          <div className="text-[10.5px] text-inkfaint mt-0.5 whitespace-nowrap">next {nextStop.code}</div>
        )}
      </td>

      <td className="text-right">
        {st ? <DelayChip sec={st.delaySec} /> : <span className="text-inkfaint">—</span>}
      </td>

      <td className="text-right">
        <div className="mono text-[15px] text-ink whitespace-nowrap">
          {pred ? fmtClock(pred.destEta)
            : done ? fmtClock(st.timeline[t.route.length - 1]?.arr)
            : fmtClock(t.schedArr)}
        </div>
        <div className="text-[10px] text-inkfaint mono whitespace-nowrap">bk {fmtClock(t.schedArr)}</div>
      </td>

      <td className="text-right">
        {d == null ? <span className="text-inkfaint text-[12px]">—</span> : (
          <>
            <div className={`mono text-[13px] whitespace-nowrap ${
              Math.abs(d) < 1 ? 'text-inkfaint' : d > 0 ? 'text-caution' : 'text-signal'}`}>
              {d > 0 ? '▲ +' : d < 0 ? '▼ ' : ''}{Math.abs(d) < 1 ? 'steady' : `${d.toFixed(0)}m`}
            </div>
            <div className="text-[10px] text-inkfaint whitespace-nowrap">since departure</div>
          </>
        )}
      </td>
    </tr>
  )
})
