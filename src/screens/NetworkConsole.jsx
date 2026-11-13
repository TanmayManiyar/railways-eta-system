import React, { useEffect, useMemo, useState } from 'react'
import { SECTIONS, STATIONS, TRAINS, LINE_LIST, fmtClock, searchBlob } from '../data/network.js'
import { busiestUpcomingSection, topDelayReason } from '../engine/world.js'
import { buildDisruptionOverview, sectionsForCause, disruptedSectionsOnLine } from '../engine/disruption.js'
import { horizonBin } from '../engine/predictor.js'
import { useWorld } from '../store.jsx'
import { Panel, Chip, Btn, Field, DelayChip, inputCls } from '../ui/bits.jsx'

const SEVERITIES = ['MINOR', 'MAJOR', 'CRITICAL']
const LOOKAHEAD_SEC = 90 * 60

const mins = (sec) => Math.round(sec / 60)

const CAUSE_TONE = { block: 'danger', restriction: 'caution', weather: 'info', congestion: 'caution' }
const CAUSE_BAR = {
  block: 'var(--color-danger)',
  restriction: 'var(--color-caution)',
  weather: 'var(--color-primary)',
  congestion: 'var(--color-primarysoft)',
}
const CAUSE_BLURB = {
  block: 'Track closed completely — trains queue and are released in priority order.',
  restriction: 'Speed limit imposed — trains still run, but slower than the track allows.',
  weather: 'Rain and reduced visibility force slower running across exposed sections.',
  congestion: 'More traffic than the timetable assumed, so trains hold for the one ahead.',
}

/** Which trains are on this section right now, or due to reach it soon. */
function sectionTrains(world, sid) {
  const onNow = []
  const approaching = []
  for (const train of world.liveList) {
    const st = world.trains[train.id]
    if (!st || !st.started || st.done) continue

    const nextLeg = train.route[st.curIdx + 1]
    if (nextLeg?.secs?.includes(sid)) { onNow.push({ train, st }); continue }

    const pred = world.predictions[train.id]
    if (!pred) continue
    for (let k = st.curIdx + 2; k < train.route.length; k++) {
      if (!(train.route[k].secs || []).includes(sid)) continue
      const entry = pred.etas.find((e) => e.idx === k - 1)?.eta
      if (entry != null && entry <= world.nowSec + LOOKAHEAD_SEC) approaching.push({ train, st, entry })
      break
    }
  }
  approaching.sort((a, b) => a.entry - b.entry)
  return { onNow, approaching: approaching.slice(0, 10) }
}

/**
 * The live disruption picture: what is degrading the network right now, which
 * lines it reaches, and how much delay each cause is actually responsible for.
 * Reporting a new problem is a secondary action inside it, not the main event.
 */
export default function NetworkConsole({ onOpenTrain }) {
  const { world, calib, version, addEvent, removeEvent } = useWorld()
  const [pickedSid, setPickedSid] = useState(null)
  const [pickedCause, setPickedCause] = useState(null)
  const [pickedLine, setPickedLine] = useState(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [prefillSid, setPrefillSid] = useState(null)

  const overview = useMemo(() => buildDisruptionOverview(world), [world.nowSec, version])
  const active = world.events.filter((e) => e.active)
  const totalSec = overview.causeList.reduce((s, c) => s + c.seconds, 0)
  const affected = overview.causeList.reduce((s, c) => Math.max(s, c.trains), 0)

  const openReport = (sid) => { setPrefillSid(sid ?? null); setPickedSid(null); setReportOpen(true) }

  return (
    <div className="flex flex-col gap-3">
      {/* headline: is anything wrong, and how bad */}
      <div className="bg-surface border border-rule flex items-stretch flex-wrap">
        <div className="px-4 py-3 border-r border-rule min-w-[190px]">
          <div className="lbl text-[10px] text-inkfaint">Delay being caused right now</div>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="mono text-[30px] leading-none text-primary">{mins(totalSec).toLocaleString()}</span>
            <span className="text-[12px] text-inkfaint">train-minutes</span>
          </div>
          <div className="text-[11px] text-inkfaint mt-1">across {affected} services now running</div>
        </div>
        <div className="px-4 py-3 border-r border-rule flex-1 min-w-[220px]">
          <div className="lbl text-[10px] text-inkfaint">Reported problems in effect</div>
          {active.length === 0 ? (
            <p className="text-[12.5px] text-inksoft mt-1">
              None reported. Any delay below is from weather or traffic, not a declared incident.
            </p>
          ) : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {active.slice(0, 3).map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-[12px]">
                  <Chip tone={e.severity === 'CRITICAL' ? 'danger' : 'caution'}>{e.type}</Chip>
                  <button onClick={() => setPickedSid(e.sectionId)}
                          className="mono text-inksoft hover:text-primary hover:underline">{e.sectionId}</button>
                  <span className="text-inkfaint">until {fmtClock(e.endSec)}</span>
                  <button onClick={() => removeEvent(e.id)}
                          className="lbl text-[9.5px] text-inkfaint hover:text-danger ml-auto">clear</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-4 py-3 flex items-center">
          <Btn tone="danger" onClick={() => openReport(null)}>Report a problem</Btn>
        </div>
      </div>

      {/* what is causing it */}
      <div>
        <p className="lbl text-[10.5px] text-inkfaint mb-1.5">What is causing delay — select one to see where</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {overview.causeList.map((c) => (
            <CauseCard key={c.id} cause={c} onClick={() => setPickedCause(c.id)} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-3 items-start">
        <Panel title="Lines affected"
               sub="Every line with services running, worst first. The bar shows what share of that line's delay comes from each cause — select a line for its full breakdown."
               pad={false}>
          {overview.lineList.length === 0 ? (
            <p className="p-4 text-[12.5px] text-inkfaint">Nothing running right now.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="grid-table min-w-[560px] text-[13px]">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th className="text-right">Running</th>
                    <th className="text-right">Avg delay</th>
                    <th className="text-right">Worst</th>
                    <th>Cause mix</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.lineList.map((l) => (
                    <LineRow key={l.lineId} line={l} onOpenTrain={onOpenTrain}
                             onOpen={() => setPickedLine(l.lineId)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <TrainImpactLookup world={world} calib={calib} overview={overview} onOpenTrain={onOpenTrain} />
      </div>

      {pickedLine && (
        <LineModal lineId={pickedLine} world={world} overview={overview}
                   onClose={() => setPickedLine(null)}
                   onOpenTrain={(id) => { onOpenTrain(id); setPickedLine(null) }}
                   onOpenSection={(sid) => { setPickedLine(null); setPickedSid(sid) }} />
      )}

      {pickedCause && (
        <CauseModal causeId={pickedCause} world={world} overview={overview}
                    onClose={() => setPickedCause(null)}
                    onOpenTrain={(id) => { onOpenTrain(id); setPickedCause(null) }}
                    onOpenSection={(sid) => { setPickedCause(null); setPickedSid(sid) }} />
      )}

      {pickedSid && (
        <SectionModal sid={pickedSid} world={world} onClose={() => setPickedSid(null)}
                      onOpenTrain={(id) => { onOpenTrain(id); setPickedSid(null) }}
                      onReportHere={openReport} />
      )}

      {reportOpen && (
        <ReportModal world={world} addEvent={addEvent} prefillSid={prefillSid}
                     onClose={() => setReportOpen(false)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function CauseCard({ cause, onClick }) {
  const idle = cause.seconds < 30
  return (
    <button onClick={onClick} disabled={idle}
            className={`border text-left px-3 py-2.5 transition-colors ${
              idle ? 'border-rule bg-surface opacity-55 cursor-default'
                   : 'border-rulestrong bg-surface hover:border-primary hover:bg-primarywash'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="lbl text-[10.5px] text-inkfaint">{cause.label}</span>
        {!idle && <Chip tone={CAUSE_TONE[cause.id]}>{cause.lines.length} line{cause.lines.length === 1 ? '' : 's'}</Chip>}
      </div>
      {idle ? (
        <div className="text-[12.5px] text-inkfaint mt-1.5">None active</div>
      ) : (
        <>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="mono text-[22px] leading-none text-ink">{mins(cause.seconds).toLocaleString()}</span>
            <span className="text-[11px] text-inkfaint">train-min</span>
          </div>
          <div className="text-[11px] text-inkfaint mt-1">
            {cause.trains} train{cause.trains === 1 ? '' : 's'} · {cause.sections.length} section{cause.sections.length === 1 ? '' : 's'}
          </div>
        </>
      )}
    </button>
  )
}

function LineRow({ line, onOpenTrain, onOpen }) {
  const total = Object.values(line.causes).reduce((s, v) => s + Math.max(0, v), 0)
  return (
    <tr onClick={onOpen} className="cursor-pointer">
      <td>
        <div className="text-ink">{line.name}</div>
        {line.worstTrain && (
          <button onClick={(e) => { e.stopPropagation(); onOpenTrain(line.worstTrain.id) }}
                  className="text-[10.5px] text-inkfaint hover:text-primary hover:underline">
            worst: {line.worstTrain.no} {line.worstTrain.name}
          </button>
        )}
      </td>
      <td className="text-right mono text-inksoft">{line.running}</td>
      <td className="text-right mono">
        <span className={line.avgDelaySec > 480 ? 'text-danger' : line.avgDelaySec > 180 ? 'text-caution' : 'text-signal'}>
          +{(line.avgDelaySec / 60).toFixed(1)}m
        </span>
      </td>
      <td className="text-right mono text-inkfaint">+{mins(line.worstSec)}m</td>
      <td>
        {total < 30 ? <span className="text-[11px] text-inkfaint">—</span> : (
          <>
            <div className="flex h-2 w-full max-w-[150px] overflow-hidden bg-surface3">
              {Object.entries(line.causes).map(([k, v]) => v <= 0 ? null : (
                <div key={k} style={{ width: `${(v / total) * 100}%`, background: CAUSE_BAR[k] }}
                     title={`${k}: ${mins(v)} train-min`} />
              ))}
            </div>
            <div className="text-[10px] text-inkfaint mt-0.5">
              {Object.entries(line.causes).filter(([, v]) => v > 30)
                .sort((a, b) => b[1] - a[1]).slice(0, 2)
                .map(([k, v]) => `${k} ${mins(v)}m`).join(' · ') || '—'}
            </div>
          </>
        )}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------

function ModalShell({ title, subtitle, onClose, children, width = '720px' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-6 px-4"
         style={{ background: 'rgba(35,38,31,0.45)' }}
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface border border-rulestrong w-full my-auto flex flex-col"
           style={{ maxWidth: width, maxHeight: '90vh' }} role="dialog" aria-modal="true" aria-label={title}>
        <header className="px-4 py-3 bg-surface2 border-b border-rulestrong flex items-start justify-between gap-3 shrink-0">
          <div>
            <div className="text-[16px] text-ink">{title}</div>
            {subtitle && <p className="text-[11.5px] text-inksoft mt-0.5 max-w-[60ch] leading-snug">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close"
                  className="w-8 h-8 shrink-0 border border-rulestrong text-inksoft hover:text-ink hover:border-ink
                             flex items-center justify-center text-[18px] leading-none">×</button>
        </header>
        <div className="overflow-y-auto px-4 py-3.5 flex flex-col gap-4">{children}</div>
      </div>
    </div>
  )
}

function LineModal({ lineId, world, overview, onClose, onOpenTrain, onOpenSection }) {
  const line = overview.lineList.find((l) => l.lineId === lineId)
  const sections = useMemo(
    () => disruptedSectionsOnLine(world, lineId),
    [lineId, world.nowSec, world.events.length]
  )

  const trains = useMemo(() => {
    const rows = []
    for (const entry of overview.perTrain.values()) {
      if (entry.train.lineId !== lineId) continue
      rows.push(entry)
    }
    return rows.sort((a, b) => b.st.delaySec - a.st.delaySec)
  }, [overview, lineId])

  if (!line) return null

  const onTime = trains.filter((t) => t.st.delaySec <= 300).length
  const late = trains.filter((t) => t.st.delaySec > 300 && t.st.delaySec <= 900).length
  const veryLate = trains.filter((t) => t.st.delaySec > 900).length
  const total = Object.values(line.causes).reduce((s, v) => s + Math.max(0, v), 0)
  const causeRows = Object.entries(line.causes)
    .filter(([, v]) => v >= 30)
    .sort((a, b) => b[1] - a[1])

  return (
    <ModalShell
      title={line.name}
      subtitle={`${line.running} service${line.running === 1 ? '' : 's'} running. Average delay +${(line.avgDelaySec / 60).toFixed(1)} min, worst +${mins(line.worstSec)} min.`}
      onClose={onClose}
    >
      <div className="grid grid-cols-3 gap-2.5">
        <MiniStat label="Within 5 min" value={`${trains.length ? Math.round((onTime / trains.length) * 100) : 0}%`}
                  tone={onTime / Math.max(1, trains.length) > 0.7 ? 'signal' : 'caution'} />
        <MiniStat label="5–15 min late" value={late} tone={late ? 'caution' : 'ink'} />
        <MiniStat label="Over 15 min late" value={veryLate} tone={veryLate ? 'danger' : 'ink'} />
      </div>

      <section>
        <h3 className="lbl text-[11px] text-primary mb-1.5">What is delaying this line</h3>
        {causeRows.length === 0 ? (
          <p className="text-[12.5px] text-inkfaint">Nothing significant — this line is running close to plan.</p>
        ) : (
          <>
            <div className="flex h-2.5 w-full overflow-hidden bg-surface3 mb-2">
              {causeRows.map(([k, v]) => (
                <div key={k} style={{ width: `${(v / total) * 100}%`, background: CAUSE_BAR[k] }} />
              ))}
            </div>
            <div className="flex flex-col gap-1">
              {causeRows.map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 text-[12.5px]">
                  <span className="w-2 h-2 shrink-0" style={{ background: CAUSE_BAR[k] }} />
                  <span className="flex-1 text-inksoft capitalize">{k}</span>
                  <span className="text-inkfaint mono text-[11px]">{Math.round((v / total) * 100)}%</span>
                  <span className="mono text-caution w-14 text-right">+{mins(v)}m</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section>
        <h3 className="lbl text-[11px] text-primary mb-1.5">
          Disrupted sections on this line {sections.length > 0 && `(${sections.length})`}
        </h3>
        {sections.length === 0 ? (
          <p className="text-[12.5px] text-inkfaint">No section on this line is currently disrupted.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {sections.slice(0, 8).map((s) => (
              <button key={s.causeId + s.sectionId} onClick={() => onOpenSection(s.sectionId)}
                      className="flex items-center gap-2 px-2.5 py-1.5 border border-rule hover:border-primary hover:bg-primarywash text-left">
                <Chip tone={CAUSE_TONE[s.causeId]}>{s.causeId}</Chip>
                <span className="mono text-[11.5px] text-ink w-[100px] shrink-0">{s.sectionId}</span>
                <span className="text-[11.5px] text-inkfaint truncate flex-1">{s.detail}</span>
                {s.impact === 'closed'
                  ? <span className="mono text-[11px] text-danger shrink-0">closed</span>
                  : s.pctSlower > 0 && (
                      <span className="mono text-[11px] text-caution shrink-0">+{s.pctSlower}%</span>
                    )}
              </button>
            ))}
            {sections.length > 8 && (
              <p className="text-[10.5px] text-inkfaint pl-1">+ {sections.length - 8} more</p>
            )}
          </div>
        )}
      </section>

      <section>
        <h3 className="lbl text-[11px] text-primary mb-1.5">
          Services running on this line ({trains.length})
        </h3>
        <div className="flex flex-col gap-1 max-h-[280px] overflow-y-auto pr-1">
          {trains.map(({ train, st, causes, total: tot }) => {
            const top = Object.entries(causes).filter(([, v]) => v >= 30).sort((a, b) => b[1] - a[1])[0]
            return (
              <button key={train.id} onClick={() => onOpenTrain(train.id)}
                      className="flex items-center gap-2 px-2.5 py-1.5 border border-rule hover:border-primary hover:bg-primarywash text-left">
                <span className="mono text-[12px] text-ink w-16 shrink-0">{train.no}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[11.5px] text-inkfaint truncate">{train.name}</div>
                  {top && (
                    <div className="text-[10px] text-inkfaint">
                      mainly <span className="text-caution">{top[0]} (+{mins(top[1])}m)</span>
                    </div>
                  )}
                </div>
                <DelayChip sec={st.delaySec} />
              </button>
            )
          })}
        </div>
      </section>
    </ModalShell>
  )
}

function CauseModal({ causeId, world, overview, onClose, onOpenTrain, onOpenSection }) {
  const cause = overview.causeList.find((c) => c.id === causeId)
  const sections = useMemo(() => sectionsForCause(world, causeId), [causeId, world.nowSec, world.events.length])

  const worstTrains = useMemo(() => {
    const rows = []
    for (const { train, st, causes } of overview.perTrain.values()) {
      if (causes[causeId] < 30) continue
      rows.push({ train, st, sec: causes[causeId] })
    }
    return rows.sort((a, b) => b.sec - a.sec).slice(0, 12)
  }, [overview, causeId])

  const byLine = useMemo(() => {
    const m = {}
    for (const s of sections) (m[s.lineName] ||= []).push(s)
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length)
  }, [sections])

  return (
    <ModalShell title={cause.label}
                subtitle={`${CAUSE_BLURB[causeId]} Currently adding about ${mins(cause.seconds).toLocaleString()} train-minutes of delay across ${cause.trains} services.`}
                onClose={onClose}>
      <section>
        <h3 className="lbl text-[11px] text-primary mb-1.5">
          Where it is, by line ({sections.length} section{sections.length === 1 ? '' : 's'})
        </h3>
        {sections.length === 0 ? (
          <p className="text-[12.5px] text-inkfaint">Not present anywhere on the network right now.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {byLine.map(([lineName, rows]) => (
              <div key={lineName}>
                <div className="lbl text-[10px] text-inkfaint mb-1">{lineName}</div>
                <div className="flex flex-col gap-1">
                  {rows.slice(0, 6).map((s) => (
                    <button key={s.sectionId} onClick={() => onOpenSection(s.sectionId)}
                            className="flex items-center gap-2 px-2.5 py-1.5 border border-rule hover:border-primary hover:bg-primarywash text-left">
                      <span className="mono text-[11.5px] text-ink w-[104px] shrink-0">{s.sectionId}</span>
                      <span className="text-[11.5px] text-inkfaint truncate flex-1">{s.detail}</span>
                      {s.impact === 'closed'
                        ? <span className="mono text-[11px] text-danger shrink-0">closed</span>
                        : s.pctSlower > 0 && (
                            <span className="mono text-[11px] text-caution shrink-0">+{s.pctSlower}% slower</span>
                          )}
                    </button>
                  ))}
                  {rows.length > 6 && (
                    <p className="text-[10.5px] text-inkfaint pl-1">+ {rows.length - 6} more on this line</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="lbl text-[11px] text-primary mb-1.5">Services most affected by this</h3>
        {worstTrains.length === 0 ? (
          <p className="text-[12.5px] text-inkfaint">No running service is materially affected by this right now.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {worstTrains.map(({ train, st, sec }) => (
              <button key={train.id} onClick={() => onOpenTrain(train.id)}
                      className="flex items-center gap-2 px-2.5 py-1.5 border border-rule hover:border-primary hover:bg-primarywash text-left">
                <span className="mono text-[12px] text-ink w-16 shrink-0">{train.no}</span>
                <span className="text-[11.5px] text-inkfaint truncate flex-1">{train.name}</span>
                <DelayChip sec={st.delaySec} />
                <span className="mono text-[11.5px] text-caution shrink-0 w-[86px] text-right">
                  +{mins(sec)}m from this
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------

function TrainImpactLookup({ world, calib, overview, onOpenTrain }) {
  const [q, setQ] = useState('')

  const match = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return null
    return TRAINS.find((t) => terms.every((term) => searchBlob(t).includes(term))) ?? null
  }, [q])

  const entry = match ? overview.perTrain.get(match.id) : null
  const pred = match ? world.predictions[match.id] : null

  const ladder = useMemo(() => {
    if (!pred) return []
    const bin = horizonBin(pred.destEta - pred.issuedAt)
    return (calib.levels || []).filter((lv) => lv === 0.8 || lv === 0.95).map((lv) => {
      const qq = calib.bins?.[bin]?.[String(lv)]
      return qq ? { level: lv, lo: pred.destEta + qq[0], hi: pred.destEta + qq[1] } : null
    }).filter(Boolean)
  }, [pred, calib])

  const causes = entry ? Object.entries(entry.causes).filter(([, v]) => v >= 30).sort((a, b) => b[1] - a[1]) : []

  return (
    <Panel title="How is one train affected?"
           sub="Search any service to see exactly which of the above is delaying it, and by how many minutes each.">
      <input className={`${inputCls} text-[13px]`} value={q}
             placeholder="Train number or name…"
             onChange={(e) => setQ(e.target.value)} aria-label="Search a train" />

      {!q.trim() ? (
        <p className="text-[12px] text-inkfaint mt-3">Nothing searched yet.</p>
      ) : !match ? (
        <p className="text-[12px] text-inkfaint mt-3">No train matches “{q}”.</p>
      ) : !entry ? (
        <p className="text-[12.5px] text-inksoft mt-3">
          <b className="mono">{match.no}</b> is not currently running, so nothing is affecting it right now.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="mono text-[14px] text-ink">{match.no}</span>
              <DelayChip sec={entry.st.delaySec} />
            </div>
            <p className="text-[11.5px] text-inkfaint mt-0.5">{match.name}</p>
          </div>

          {pred && (
            <div className="border border-rule bg-surface2 px-3 py-2">
              <div className="lbl text-[9.5px] text-inkfaint">Forecast arrival at {match.dest}</div>
              <div className="mono text-[18px] text-primary leading-tight mt-0.5">{fmtClock(pred.destEta)}</div>
              <div className="text-[11px] text-inksoft mt-1 leading-snug">
                {ladder.map((l) => (
                  <div key={l.level}>
                    <b className="mono">{Math.round(l.level * 100)}%</b> confident between{' '}
                    <span className="mono">{fmtClock(l.lo)}</span> and <span className="mono">{fmtClock(l.hi)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="lbl text-[10px] text-inkfaint mb-1">What is delaying it</div>
            {causes.length === 0 ? (
              <p className="text-[12px] text-inkfaint">Nothing significant — running close to a normal journey.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {causes.map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 text-[12.5px]">
                    <span className="w-2 h-2 shrink-0" style={{ background: CAUSE_BAR[k] }} />
                    <span className="flex-1 text-inksoft capitalize">{k}</span>
                    <span className="mono text-caution">+{mins(v)}m</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1.5 mt-0.5 border-t border-rule text-[12.5px]">
                  <span className="text-inksoft">Total from current disruptions</span>
                  <span className="mono text-ink">+{mins(entry.total)}m</span>
                </div>
              </div>
            )}
          </div>

          <Btn tone="primary" onClick={() => onOpenTrain(match.id)}>Open full detail</Btn>
        </div>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------

function ReportModal({ world, addEvent, prefillSid, onClose }) {
  const [type, setType] = useState('BLOCK')
  const [sid, setSid] = useState(prefillSid ?? 'TNA-KYN')
  const [startIn, setStartIn] = useState(0)
  const [durMin, setDurMin] = useState(40)
  const [speedKmph, setSpeedKmph] = useState(30)
  const [severity, setSeverity] = useState('MAJOR')
  const [note, setNote] = useState('')

  const hot = busiestUpcomingSection(world)

  const submit = (e) => {
    e.preventDefault()
    addEvent({
      type, sectionId: sid,
      startSec: world.nowSec + startIn * 60,
      endSec: world.nowSec + (startIn + durMin) * 60,
      speedKmph: type === 'TSR' ? Number(speedKmph) : null,
      severity, note,
    })
    onClose()
  }

  const quickDemo = () => {
    addEvent({
      type: 'BLOCK', sectionId: hot?.sectionId ?? sid,
      startSec: world.nowSec, endSec: world.nowSec + 40 * 60,
      speedKmph: null, severity: 'CRITICAL', note: 'Engineering block — OHE repair',
    })
    onClose()
  }

  return (
    <ModalShell title="Report a problem on the tracks"
                subtitle="Tell it what happened and where. It works out on its own which trains are affected and by how much — you never type in a delay figure."
                onClose={onClose} width="520px">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="1. What happened">
          <div className="flex gap-1.5">
            <Btn active={type === 'BLOCK'} onClick={() => setType('BLOCK')}>Track blocked</Btn>
            <Btn active={type === 'TSR'} onClick={() => setType('TSR')}>Speed restriction</Btn>
          </div>
        </Field>

        <Field label="2. Where">
          <select className={inputCls} value={sid} onChange={(e) => setSid(e.target.value)}>
            {LINE_LIST.map((l) => {
              const secs = Object.values(SECTIONS).filter((s) => s.lineId === l.id)
              if (!secs.length) return null
              return (
                <optgroup key={l.id} label={l.name}>
                  {secs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id} — {STATIONS[s.from].name} → {STATIONS[s.to].name} ({s.km} km)
                    </option>
                  ))}
                </optgroup>
              )
            })}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="3. Starts in, minutes">
            <input className={inputCls} type="number" min="0" max="180" value={startIn}
                   onChange={(e) => setStartIn(Number(e.target.value))} />
          </Field>
          <Field label="Lasts, minutes">
            <input className={inputCls} type="number" min="5" max="240" value={durMin}
                   onChange={(e) => setDurMin(Number(e.target.value))} />
          </Field>
        </div>

        {type === 'TSR' && (
          <Field label="Speed limit while it lasts, km/h">
            <input className={inputCls} type="number" min="5" max="100" value={speedKmph}
                   onChange={(e) => setSpeedKmph(Number(e.target.value))} />
          </Field>
        )}

        <Field label="4. How serious">
          <div className="flex gap-1.5">
            {SEVERITIES.map((s) => <Btn key={s} active={severity === s} onClick={() => setSeverity(s)}>{s}</Btn>)}
          </div>
        </Field>

        <Field label="Note, optional">
          <input className={inputCls} value={note} placeholder="OHE repair, points failure…"
                 onChange={(e) => setNote(e.target.value)} />
        </Field>

        <div className="flex gap-2 pt-1">
          <Btn tone="danger" type="submit" className="flex-1">Report it</Btn>
          <Btn tone="primary" onClick={quickDemo}
               title={hot ? `Blocks ${hot.sectionId} — ${hot.approaching} trains heading there` : 'Blocks the busiest section'}>
            Try an example
          </Btn>
        </div>
        <p className="text-[11.5px] text-inkfaint leading-snug">
          Marking something <span className="mono">CRITICAL</span> updates every affected train's forecast
          immediately, instead of waiting for the usual confirmation cycle.
        </p>
      </form>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------

function SectionModal({ sid, world, onClose, onOpenTrain, onReportHere }) {
  const sec = SECTIONS[sid]
  const line = LINE_LIST.find((l) => l.id === sec?.lineId)
  const c = world.congestion[sid] ?? 0
  const restriction = world.restrictions[sid]
  const event = restriction ? world.events.find((e) => e.id === restriction.eventId) : null
  const { onNow, approaching } = sectionTrains(world, sid)

  if (!sec) return null

  return (
    <ModalShell title={sid}
                subtitle={`${STATIONS[sec.from]?.name} → ${STATIONS[sec.to]?.name} · ${line?.name} · ${sec.km} km`}
                onClose={onClose} width="640px">
      <div className="grid grid-cols-3 gap-2.5">
        <MiniStat label="How full" value={`${Math.round(c * 100)}%`}
                  tone={c > 0.66 ? 'danger' : c > 0.4 ? 'caution' : 'signal'} />
        <MiniStat label="Track speed" value={`${sec.maxKmph} km/h`} />
        <MiniStat label="Tracks" value={sec.tracks} />
      </div>

      {event ? (
        <div className="bg-dangerwash border border-danger/30 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="lbl text-[11px] text-danger">
              {event.blocked ? 'Blocked' : `Speed limited to ${event.speedKmph} km/h`}
            </span>
            <Chip tone="danger">{event.severity}</Chip>
          </div>
          <p className="text-[12px] text-inksoft mt-1">
            {fmtClock(event.startSec)}–{fmtClock(event.endSec)}{event.note ? ` · ${event.note}` : ''}
          </p>
        </div>
      ) : (
        <div className="bg-signalwash border border-signal/25 px-3 py-2.5">
          <p className="text-[12.5px] text-ink">No reported problem here right now.</p>
          <button onClick={() => onReportHere(sid)} className="lbl text-[11px] text-primary hover:underline mt-1">
            Report a problem on this section →
          </button>
        </div>
      )}

      <section>
        <h3 className="lbl text-[11px] text-primary mb-1.5">
          On this section right now {onNow.length > 0 && `(${onNow.length})`}
        </h3>
        {onNow.length === 0
          ? <p className="text-[12px] text-inkfaint">No train is currently between these two stations.</p>
          : <TrainList rows={onNow.map((r) => ({ ...r, tag: null }))} onOpenTrain={onOpenTrain} world={world} />}
      </section>

      <section>
        <h3 className="lbl text-[11px] text-primary mb-1.5">
          Approaching within 90 minutes {approaching.length > 0 && `(${approaching.length})`}
        </h3>
        {approaching.length === 0
          ? <p className="text-[12px] text-inkfaint">Nothing due through here soon.</p>
          : <TrainList rows={approaching.map((r) => ({ ...r, tag: fmtClock(r.entry) }))} onOpenTrain={onOpenTrain} world={world} />}
      </section>
    </ModalShell>
  )
}

function TrainList({ rows, onOpenTrain, world }) {
  return (
    <div className="flex flex-col gap-1">
      {rows.map(({ train, st, tag }) => {
        const reason = world ? topDelayReason(world, train) : null
        return (
          <button key={train.id} onClick={() => onOpenTrain(train.id)}
                  className="flex items-center gap-2 px-2.5 py-1.5 border border-rule hover:border-primary hover:bg-primarywash text-left">
            <span className="mono text-[12.5px] text-ink w-16 shrink-0">{train.no}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11.5px] text-inkfaint truncate">{train.name}</div>
              {reason && (
                <div className="text-[10px] text-inkfaint">
                  mainly <span className={reason.minutes > 0 ? 'text-caution' : 'text-signal'}>
                    {reason.label.toLowerCase()} ({reason.minutes > 0 ? '+' : ''}{reason.minutes}m)</span>
                </div>
              )}
            </div>
            <DelayChip sec={st.delaySec} />
            {tag && <span className="mono text-[11px] text-inkfaint shrink-0">due {tag}</span>}
          </button>
        )
      })}
    </div>
  )
}

function MiniStat({ label, value, tone = 'ink' }) {
  const color = { ink: 'text-ink', signal: 'text-signal', caution: 'text-caution', danger: 'text-danger' }[tone]
  return (
    <div className="border border-rule px-2.5 py-2">
      <div className="lbl text-[9.5px] text-inkfaint">{label}</div>
      <div className={`mono text-[16px] mt-0.5 ${color}`}>{value}</div>
    </div>
  )
}
