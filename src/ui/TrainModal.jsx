import React, { useEffect, useMemo, useState } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { STATIONS, TRAIN_BY_ID, fmtClock } from '../data/network.js'
import { previewTrainAt, explainTrain, explainCurrentETA } from '../engine/world.js'
import { GROUPS, GROUP_META, horizonBin } from '../engine/predictor.js'
import { Chip, DelayChip, Btn } from './bits.jsx'

const SAMPLES = 14
const LEVEL_LABEL = { '0.5': 'Likely', '0.8': 'Very likely', '0.95': 'Almost certain' }

/**
 * Everything about one service, in a single popup. Opens on click from anywhere in
 * the app, closes with the cross or Escape, and never changes the tab underneath it.
 */
export default function TrainModal({ trainId, world, calib, onClose }) {
  const [pickedIdx, setPickedIdx] = useState(null)
  const [step, setStep] = useState(0)

  useEffect(() => {
    setPickedIdx(null)
    setStep(0)
  }, [trainId])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!trainId) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-6 px-4"
         style={{ background: 'rgba(35,38,31,0.45)' }}
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <TrainModalBody trainId={trainId} world={world} calib={calib} onClose={onClose}
                       pickedIdx={pickedIdx} setPickedIdx={setPickedIdx} step={step} setStep={setStep} />
    </div>
  )
}

function TrainModalBody({ trainId, world, calib, onClose, pickedIdx, setPickedIdx, step, setStep }) {
  const train = TRAIN_BY_ID[trainId]

  if (!train) {
    return (
      <div className="bg-surface border border-rulestrong w-full max-w-[220px] p-4">
        <p className="text-[13px] text-inksoft">That service could not be found.</p>
        <Btn className="mt-2" onClick={onClose}>Close</Btn>
      </div>
    )
  }

  const st = world.trains[train.id]
  const live = !!st && st.started && !st.done

  const series = useMemo(() => {
    if (!live) return []
    const end = st.timeline[train.route.length - 1]?.arr ?? train.schedArr
    const span = Math.max(600, end - world.nowSec)
    const out = []
    for (let i = 0; i <= SAMPLES; i++) {
      const at = world.nowSec + (span * i) / SAMPLES
      const pv = previewTrainAt(world, train, at, calib)
      if (pv?.pred) {
        out.push({
          at, label: fmtClock(at),
          eta: pv.pred.destEta / 60,
          band: [pv.pred.destLo / 60, pv.pred.destHi / 60],
        })
      } else if (pv?.done && pv.actualArr != null) {
        out.push({ at, label: fmtClock(at), eta: pv.actualArr / 60, band: null, arrived: true })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [train.id, world.nowSec, live])

  const maxStep = Math.max(0, series.length - 1)
  const cur = Math.min(step, maxStep)
  const at = series[cur]?.at ?? world.nowSec
  const preview = live && cur > 0 ? previewTrainAt(world, train, at, calib) : null
  const shownState = preview?.state ?? st
  const pred = preview?.pred ?? world.predictions[train.id]

  const schedArr = train.route[train.route.length - 1].schedArr
  const bookedMin = schedArr / 60

  // ---- probability ladder: same prediction, several confidence levels --------
  const ladder = useMemo(() => {
    if (!pred) return []
    const bin = horizonBin(pred.destEta - pred.issuedAt)
    return (calib.levels || []).map((lv) => {
      const q = calib.bins?.[bin]?.[String(lv)]
      if (!q) return null
      return { level: lv, lo: pred.destEta + q[0], hi: pred.destEta + q[1] }
    }).filter(Boolean)
  }, [pred, calib])

  // ---- why the forecast is what it is, vs a normal run — always available ----
  const scheduleReason = useMemo(() => {
    if (!pred || cur > 0) return null
    return explainCurrentETA(world, train, train.route.length - 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [train.id, pred?.issuedAt])

  // ---- attribution: why the forecast moved since it was last announced -------
  const attribution = useMemo(() => {
    if (!pred || cur > 0) return null
    return explainTrain(world, train, train.route.length - 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [train.id, pred?.issuedAt])

  // ---- station map geometry ----------------------------------------------
  const kms = train.route.map((s) => s.km)
  const minKm = Math.min(...kms), maxKm = Math.max(...kms) || 1
  const xOf = (km) => 6 + ((km - minKm) / Math.max(1, maxKm - minKm)) * 88
  const posFrac = shownState.dwelling ? null : shownState.frac
  const posX = live && !shownState.dwelling && shownState.curIdx < train.route.length - 1
    ? xOf(train.route[shownState.curIdx].km) +
      (xOf(train.route[shownState.curIdx + 1].km) - xOf(train.route[shownState.curIdx].km)) * (posFrac ?? 0)
    : live ? xOf(train.route[shownState.curIdx]?.km ?? minKm) : null

  const picked = pickedIdx != null ? train.route[pickedIdx] : null
  const pickedCall = picked ? {
    booked: picked.schedArr ?? picked.schedDep,
    passed: pickedIdx <= shownState.curIdx,
    actual: st?.timeline[pickedIdx]?.arr,
    forecast: pred?.etas.find((e) => e.idx === pickedIdx),
  } : null

  return (
    <div className="bg-surface border border-rulestrong w-full max-w-[880px] my-auto flex flex-col"
         style={{ maxHeight: '92vh' }} role="dialog" aria-modal="true" aria-label={`${train.no} details`}>
      <header className="px-4 py-3 bg-surface2 border-b border-rulestrong flex items-start justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="mono text-[19px] text-ink">{train.no}</span>
            <Chip tone="mute">{train.cls}</Chip>
            {st && <DelayChip sec={st.delaySec} />}
          </div>
          <p className="text-[12px] text-inksoft mt-0.5">{train.name}</p>
          <p className="text-[11px] text-inkfaint mt-0.5">
            {STATIONS[train.origin].name} → {STATIONS[train.dest].name} · {train.lineShort}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close"
                className="w-8 h-8 shrink-0 border border-rulestrong text-inksoft hover:text-ink hover:border-ink
                           flex items-center justify-center text-[18px] leading-none">
          ×
        </button>
      </header>

      <div className="overflow-y-auto px-4 py-3.5 flex flex-col gap-4">
        {!live ? (
          <p className="text-[13px] text-inksoft">
            {!st || !st.started
              ? <>Not yet departed. Booked away {fmtClock(train.route[0].schedDep)} from {STATIONS[train.origin].name}.</>
              : <>Journey complete. Arrived {fmtClock(st.timeline[train.route.length - 1]?.arr)} against a booked{' '}
                 {fmtClock(schedArr)}.</>}
          </p>
        ) : (
          <>
            {/* right now, plainly */}
            <div className="bg-primarywash border border-primary/25 px-3.5 py-2.5">
              <p className="text-[13px] text-ink leading-snug">
                <b className="mono">{train.no}</b> is currently{' '}
                {shownState.held ? <span className="text-danger">held</span>
                  : shownState.dwelling ? <>standing at <b>{STATIONS[train.route[shownState.curIdx].code].name}</b></>
                  : <>running at <b className="mono">{shownState.speedKmph} km/h</b></>},{' '}
                {Math.abs(shownState.delaySec) < 60 ? 'on time against the booked schedule.'
                  : shownState.delaySec > 0
                    ? <>about <b className="text-caution">{Math.round(shownState.delaySec / 60)} minutes behind</b> the booked schedule.</>
                    : <>about <b className="text-signal">{Math.round(-shownState.delaySec / 60)} minutes ahead</b> of the booked schedule.</>}
              </p>
            </div>

            {/* probability ladder */}
            <section>
              <h3 className="lbl text-[11px] text-primary mb-1">How sure are we it reaches {train.dest}?</h3>
              <p className="text-[11.5px] text-inkfaint leading-snug mb-2">
                Not one guess — a range for each confidence level, checked against thousands of past predictions.
                The 95% row means: out of 100 similar forecasts, about 95 land inside that window.
              </p>
              <table className="grid-table text-[12.5px]">
                <thead>
                  <tr><th>Confidence</th><th>Arrival window</th><th className="text-right">Width</th></tr>
                </thead>
                <tbody>
                  {ladder.map((l) => (
                    <tr key={l.level}>
                      <td>
                        <span className="mono text-ink">{Math.round(l.level * 100)}%</span>
                        <span className="text-inkfaint ml-1.5">{LEVEL_LABEL[String(l.level)] ?? ''}</span>
                      </td>
                      <td className="mono whitespace-nowrap">{fmtClock(l.lo)} – {fmtClock(l.hi)}</td>
                      <td className="text-right mono text-inkfaint whitespace-nowrap">
                        ±{Math.round((l.hi - l.lo) / 120)} min
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* why the forecast is what it is — always available, the primary explanation */}
            {scheduleReason && (
              <section>
                <h3 className="lbl text-[11px] text-primary mb-1">Why this arrival time, in detail</h3>
                <p className="text-[11.5px] text-inkfaint leading-snug mb-2">
                  If the rest of this journey ran exactly to normal — average historical timing, typical
                  congestion, no restrictions, ordinary weather — it would arrive around{' '}
                  <b className="mono text-ink">{fmtClock(scheduleReason.base)}</b>. Here is what is pushing the
                  actual forecast of <b className="mono text-ink">{fmtClock(scheduleReason.full)}</b> later or
                  earlier than that, and by how much.
                </p>
                <AttributionList attribution={scheduleReason} threshold={6} />
              </section>
            )}

            {/* why the forecast has moved since the last time it was published */}
            {attribution && (
              <section>
                <h3 className="lbl text-[11px] text-primary mb-1">Since our last update to this forecast</h3>
                <p className="text-[11.5px] text-inkfaint leading-snug mb-2">
                  Compared with the last figure published for this train, here is what changed, and by how much.
                </p>
                <AttributionList attribution={attribution} />
              </section>
            )}

            {/* forecast trend */}
            <section>
              <h3 className="lbl text-[11px] text-primary mb-1">How the estimate has changed through the run</h3>
              <p className="text-[11.5px] text-inkfaint leading-snug mb-1">
                <b>Left/bottom (x-axis):</b> time of day. <b>Up/down (y-axis):</b> the predicted arrival time at{' '}
                {train.dest}, re-forecast at that moment. The shaded band is the 95% window; it narrows as the
                train gets closer. The dotted line is the original booked time.
              </p>
              <div style={{ height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={series} margin={{ top: 4, right: 8, bottom: 2, left: -18 }}>
                    <CartesianGrid stroke="var(--color-rule)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: 'var(--color-inkfaint)', fontSize: 10 }}
                           stroke="var(--color-rule)" minTickGap={24}
                           label={{ value: 'time of day →', position: 'insideBottom', offset: -2,
                                    fill: 'var(--color-inkfaint)', fontSize: 9 }} />
                    <YAxis tick={{ fill: 'var(--color-inkfaint)', fontSize: 10 }} stroke="var(--color-rule)"
                           domain={['dataMin - 2', 'dataMax + 2']} width={46}
                           tickFormatter={(v) => fmtClock(v * 60)}
                           label={{ value: `predicted arrival at ${train.dest}`, angle: -90, position: 'insideLeft',
                                    fill: 'var(--color-inkfaint)', fontSize: 9 }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-rulestrong)', fontSize: 11 }}
                      labelStyle={{ color: 'var(--color-inkfaint)' }}
                      formatter={(v, n) => Array.isArray(v)
                        ? [`${fmtClock(v[0] * 60)}–${fmtClock(v[1] * 60)}`, '95% window']
                        : [fmtClock(v * 60), 'Predicted arrival']} />
                    <ReferenceLine y={bookedMin} stroke="var(--color-inkfaint)" strokeDasharray="4 3"
                                   label={{ value: 'booked', position: 'insideTopRight',
                                            fill: 'var(--color-inkfaint)', fontSize: 9 }} />
                    <Area dataKey="band" stroke="none" fill="var(--color-primarysoft)" fillOpacity={0.3}
                          isAnimationActive={false} />
                    <Line dataKey="eta" stroke="var(--color-primary)" strokeWidth={2} dot={false}
                          isAnimationActive={false} />
                    {series[cur] && <ReferenceLine x={series[cur].label} stroke="var(--color-caution)" strokeWidth={1.5} />}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="flex items-center gap-2.5 pt-2">
                <span className="lbl text-[9.5px] text-inkfaint shrink-0">Preview the future</span>
                <input type="range" min={0} max={maxStep} step={1} value={cur}
                       onChange={(e) => setStep(Number(e.target.value))}
                       aria-label={`Move ${train.no} forward through its journey`}
                       className="scrub scrub-sm flex-1" />
                <span className="mono text-[10.5px] shrink-0 w-[64px] text-right">
                  {cur === 0 ? <span className="text-inkfaint">now</span> : <span className="text-caution">{fmtClock(at)}</span>}
                </span>
                {cur > 0 && <Btn onClick={() => setStep(0)}>Now</Btn>}
              </div>
            </section>

            {/* live map + station-by-station */}
            <section>
              <h3 className="lbl text-[11px] text-primary mb-1">Route and live position</h3>
              <p className="text-[11.5px] text-inkfaint leading-snug mb-2">
                The orange marker is where the train is right now. Click any station below for its booked,
                forecast and actual times.
              </p>

              <svg viewBox="0 0 100 22" className="w-full" style={{ height: 46 }} aria-hidden="true">
                <line x1="4" y1="11" x2="96" y2="11" stroke="var(--color-rulestrong)" strokeWidth="0.6" />
                {train.route.map((s, i) => {
                  const x = xOf(s.km)
                  const passed = i <= shownState.curIdx
                  const isPicked = i === pickedIdx
                  return (
                    <circle key={s.code + i} cx={x} cy="11"
                            r={isPicked ? 2.6 : 1.7}
                            fill={passed ? 'var(--color-inkfaint)' : 'var(--color-surface)'}
                            stroke={isPicked ? 'var(--color-caution)' : passed ? 'var(--color-inkfaint)' : 'var(--color-primary)'}
                            strokeWidth={isPicked ? 0.8 : 0.6} />
                  )
                })}
                {posX != null && (
                  <polygon points={`${posX},5.5 ${posX - 2},9.5 ${posX + 2},9.5`} fill="var(--color-caution)" />
                )}
              </svg>

              <div className="flex gap-1 overflow-x-auto pb-1">
                {train.route.map((s, i) => {
                  const passed = i <= shownState.curIdx
                  const isPicked = i === pickedIdx
                  return (
                    <button key={s.code + i} onClick={() => setPickedIdx(i)}
                            className={`shrink-0 px-1.5 py-1 mono text-[10.5px] border ${
                              isPicked ? 'border-caution bg-cautionwash text-ink'
                                : passed ? 'border-rule text-inkfaint'
                                : 'border-rulestrong text-inksoft hover:border-primary'}`}>
                      {s.code}
                    </button>
                  )
                })}
              </div>

              {pickedCall && (
                <div className="mt-2 border border-rule bg-surface2 px-3 py-2 text-[12.5px]">
                  <div className="flex items-baseline justify-between">
                    <span className="text-ink font-medium">{STATIONS[picked.code].name}</span>
                    <span className="mono text-inkfaint text-[11px]">{picked.code}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-1.5">
                    <MiniStat label="Booked" value={fmtClock(pickedCall.booked)} />
                    <MiniStat label={pickedCall.passed ? 'Actual' : 'Forecast'}
                              value={fmtClock(pickedCall.passed ? pickedCall.actual : pickedCall.forecast?.eta)} />
                    <MiniStat label="vs booked"
                              value={(() => {
                                const v = pickedCall.passed ? pickedCall.actual : pickedCall.forecast?.eta
                                if (v == null || pickedCall.booked == null) return '—'
                                const d = Math.round((v - pickedCall.booked) / 60)
                                return `${d > 0 ? '+' : ''}${d}m`
                              })()} />
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function MiniStat({ label, value }) {
  return (
    <div>
      <div className="lbl text-[9px] text-inkfaint">{label}</div>
      <div className="mono text-[13px] text-ink">{value}</div>
    </div>
  )
}

function AttributionList({ attribution, threshold = 18 }) {
  const { phi, net } = attribution
  const entries = GROUPS.map((g) => ({ g, v: phi[g] }))
    .filter((e) => Math.abs(e.v) >= threshold)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
  const maxAbs = Math.max(60, ...entries.map((e) => Math.abs(e.v)))

  if (entries.length === 0) {
    return <p className="text-[12.5px] text-inksoft">Nothing significant — this is running close to a normal journey.</p>
  }

  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(({ g, v }) => {
        const later = v > 0
        const mins = Math.abs(v / 60)
        return (
          <div key={g} className="flex items-center gap-2 text-[12.5px]">
            <span className={`w-1.5 h-1.5 shrink-0 ${later ? 'bg-caution' : 'bg-signal'}`} />
            <span className="flex-1 text-inksoft">
              <b className="text-ink">{GROUP_META[g].label}</b>{' — '}{GROUP_META[g].hint}
            </span>
            <div className="w-16 h-1.5 bg-surface3 shrink-0">
              <div className="h-full" style={{ width: `${(mins * 60 / maxAbs) * 100}%`,
                                                background: later ? 'var(--color-caution)' : 'var(--color-signal)' }} />
            </div>
            <span className={`mono w-14 text-right shrink-0 ${later ? 'text-caution' : 'text-signal'}`}>
              {later ? '+' : '-'}{mins.toFixed(1)}m
            </span>
          </div>
        )
      })}
      <div className="flex items-center justify-between pt-2 mt-1 border-t border-rule text-[12.5px]">
        <span className="text-inksoft">Net effect</span>
        <span className={`mono ${net > 0 ? 'text-caution' : net < 0 ? 'text-signal' : 'text-inkfaint'}`}>
          {net > 0 ? '+' : ''}{(net / 60).toFixed(1)} min
        </span>
      </div>
    </div>
  )
}
