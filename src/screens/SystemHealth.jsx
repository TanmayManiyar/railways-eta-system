import React, { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line,
} from 'recharts'
import { useWorld } from '../store.jsx'
import { Panel, Stat, Chip, Btn, DelayChip, inputCls } from '../ui/bits.jsx'
import { TRAINS, TRAIN_BY_ID, LINE_LIST, fmtClock, searchBlob } from '../data/network.js'
import { explainCurrentETA } from '../engine/world.js'
import { GROUPS, GROUP_META } from '../engine/predictor.js'

const axis = { fill: 'var(--color-inkfaint)', fontSize: 11 }
const tipStyle = {
  background: 'var(--color-surface2)', border: '1px solid var(--color-rule)',
  borderRadius: 6, fontSize: 12,
}

/**
 * "Can this be trusted right now?" for whoever is accountable for the system, not
 * a data-science report. One status strip, the confidence check, how far out it
 * still holds, and a live self-check as trains actually arrive.
 */
export default function SystemHealth({ onOpenTrain }) {
  const { evaluation, world } = useWorld()
  const { headline, reliability, byHorizon, byCondition, calib } = evaluation

  const relData = reliability.map((r) => ({ nominal: r.nominal, Realised: +r.realised.toFixed(1), Ideal: r.nominal }))
  const cov95 = reliability.find((r) => r.nominal === 95)
  const calibrationOk = cov95 && Math.abs(cov95.realised - 95) < 2.5

  const outcomes = world.outcomes
  const liveMae = outcomes.length
    ? outcomes.reduce((s, o) => s + Math.abs(o.errorSec), 0) / outcomes.length / 60
    : null
  const liveOk = liveMae == null || liveMae <= headline.model.mae * 1.6

  return (
    <div className="flex flex-col gap-4">
      <div className={`border px-4 py-3 ${calibrationOk ? 'bg-signalwash border-signal/30' : 'bg-cautionwash border-caution/30'}`}>
        <p className="text-[14px] text-ink leading-snug">
          On {headline.n.toLocaleString()} test predictions, our forecasts were off by{' '}
          <b className="mono">{headline.model.mae.toFixed(1)} minutes</b> on average — the current method
          (scheduled time plus however late the train is right now) was off by{' '}
          <b className="mono">{headline.baseline.mae.toFixed(1)} minutes</b>, roughly{' '}
          <b>{Math.round(headline.baseline.mae / headline.model.mae)}× worse</b>.{' '}
          {cov95 && (
            <>When we say we are 95% confident, we are right{' '}
              <b className={calibrationOk ? 'text-signal' : 'text-caution'}>{cov95.realised.toFixed(1)}% of the time</b>
              {' '}— {calibrationOk ? 'that number can be trusted.' : 'that is drifting from what it claims.'}</>
          )}
        </p>
      </div>

      {/* status strip — the three things someone accountable for this system checks */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <StatusCard
          ok={calibrationOk}
          label="Confidence calibration"
          detail={cov95 ? `Stated 95%, measured ${cov95.realised.toFixed(1)}%` : 'Not enough data yet'}
        />
        <StatusCard
          ok={liveOk}
          label="Live accuracy this session"
          detail={liveMae != null
            ? `${liveMae.toFixed(1)} min average error over ${outcomes.length} completed run${outcomes.length === 1 ? '' : 's'}`
            : 'No service has completed its run yet'}
        />
        <StatusCard
          ok={null}
          label="Model freshness"
          detail="Prototype — trained once on synthetic data. In production this card shows days since last retrain."
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Stat label="Typical error" value={headline.model.mae.toFixed(1)} unit="min" tone="signal"
              hint="half the time, closer than this" />
        <Stat label="Old method's error" value={headline.baseline.mae.toFixed(1)} unit="min" tone="ink"
              hint="schedule + current delay" />
        <Stat label="Worst case (90 of 100)" value={headline.model.p90.toFixed(1)} unit="min"
              hint={`old method: ${headline.baseline.p90.toFixed(0)}m`} />
        <Stat label="Confidence, verified" value={cov95 ? cov95.realised.toFixed(1) : '—'} unit="%"
              tone={calibrationOk ? 'signal' : 'caution'} hint="target 95%" />
      </div>

<RouteAndTrainLookup world={world} evaluation={evaluation} onOpenTrain={onOpenTrain} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Is our confidence honest?"
               sub="We claim different confidence levels (50%, 80%, 95%). This checks whether the claim holds up. If the blue line sits on the dashed diagonal, a stated confidence means what it says — our 95%-confidence windows really do contain the true arrival about 95% of the time.">
          <div style={{ height: 230 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={relData} margin={{ top: 6, right: 14, bottom: 16, left: -14 }}>
                <CartesianGrid stroke="var(--color-rule)" strokeDasharray="3 3" />
                <XAxis dataKey="nominal" tick={axis} stroke="var(--color-rule)" type="number"
                       domain={[45, 100]} ticks={[50, 60, 70, 80, 90, 95]}
                       label={{ value: 'Stated confidence %', position: 'insideBottom', offset: -8,
                                fill: 'var(--color-inkfaint)', fontSize: 11 }} />
                <YAxis tick={axis} stroke="var(--color-rule)" domain={[45, 100]} width={44}
                       label={{ value: 'Actually correct %', angle: -90, position: 'insideLeft',
                                fill: 'var(--color-inkfaint)', fontSize: 10 }} />
                <Tooltip contentStyle={tipStyle} labelStyle={{ color: 'var(--color-inkfaint)' }} formatter={(v) => `${v}%`} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-inksoft)' }} />
                <Line type="linear" dataKey="Ideal" stroke="var(--color-inkfaint)" strokeWidth={1.2}
                      strokeDasharray="4 3" dot={false} isAnimationActive={false} name="Perfectly honest" />
                <Line type="monotone" dataKey="Realised" stroke="var(--color-primary)" strokeWidth={2.2}
                      dot={{ r: 3, fill: 'var(--color-primary)' }} isAnimationActive={false} name="What we actually deliver" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Does accuracy hold up further into the future?"
               sub="Average error in minutes, for predictions made that far ahead of arrival. The old method (grey) gets much worse the further out you look; ours (blue) stays close to accurate.">
          <div style={{ height: 230 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byHorizon} margin={{ top: 6, right: 14, bottom: 4, left: -18 }}>
                <CartesianGrid stroke="var(--color-rule)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="bin" tick={axis} stroke="var(--color-rule)" />
                <YAxis tick={axis} stroke="var(--color-rule)" width={44} />
                <Tooltip contentStyle={tipStyle} labelStyle={{ color: 'var(--color-inkfaint)' }}
                         formatter={(v) => `${v.toFixed(2)} min`} cursor={{ fill: 'var(--color-surface3)' }} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-inksoft)' }} />
                <Bar dataKey="baseline" name="Old method" fill="var(--color-inkfaint)" isAnimationActive={false} />
                <Bar dataKey="model" name="This system" fill="var(--color-primary)" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Does it still work when things go wrong?"
               sub="Average error, split by what was happening on the network. Anyone can predict a train running to plan — the value is in disruption and congestion, where the old method falls apart and ours does not.">
          <div style={{ height: 230 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCondition} margin={{ top: 6, right: 14, bottom: 4, left: -18 }}>
                <CartesianGrid stroke="var(--color-rule)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="cond" tick={axis} stroke="var(--color-rule)" />
                <YAxis tick={axis} stroke="var(--color-rule)" width={44} />
                <Tooltip contentStyle={tipStyle} labelStyle={{ color: 'var(--color-inkfaint)' }}
                         formatter={(v) => `${v.toFixed(2)} min`} cursor={{ fill: 'var(--color-surface3)' }} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-inksoft)' }} />
                <Bar dataKey="baseline" name="Old method" fill="var(--color-inkfaint)" isAnimationActive={false} />
                <Bar dataKey="model" name="This system" fill="var(--color-primary)" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Checking ourselves against reality, live"
               sub="As trains actually finish their runs during this session, we compare what we predicted against what really happened — the same check that would run continuously in production.">
          {outcomes.length === 0 ? (
            <p className="text-[12.5px] text-inkfaint">
              No service has reached its destination yet in this session. Press Play and wait for a few arrivals.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-3">
                <Chip tone="signal">{outcomes.length} completed</Chip>
                <span className="text-[12.5px] text-inksoft">
                  Session average error <span className="mono text-ink">{liveMae.toFixed(2)} min</span>
                </span>
              </div>
              <div className="overflow-x-auto max-h-[168px] overflow-y-auto">
                <table className="w-full text-[13px] min-w-[380px]">
                  <thead>
                    <tr className="lbl text-[10.5px] text-inkfaint border-b border-rule">
                      <th className="text-left font-semibold px-2 py-1.5">Service</th>
                      <th className="text-right font-semibold px-2 py-1.5">We said</th>
                      <th className="text-right font-semibold px-2 py-1.5">Actually</th>
                      <th className="text-right font-semibold px-2 py-1.5">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outcomes.slice(-12).reverse().map((o, i) => (
                      <tr key={i} className="border-b border-rule/50">
                        <td className="px-2 py-1.5 mono">{o.no ?? o.trainId}</td>
                        <td className="px-2 py-1.5 text-right mono text-inkfaint">{fmtClock(o.predicted)}</td>
                        <td className="px-2 py-1.5 text-right mono">{fmtClock(o.actual)}</td>
                        <td className="px-2 py-1.5 text-right mono">
                          <span className={Math.abs(o.errorSec) > 300 ? 'text-caution' : 'text-signal'}>
                            {o.errorSec > 0 ? '+' : ''}{(o.errorSec / 60).toFixed(1)}m
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="text-[11px] text-inkfaint mt-3 leading-snug">
            In a real deployment, these rows trigger retraining — if accuracy starts slipping or the confidence
            numbers stop being honest, that shows up here first, not months later in a complaint.
          </p>
        </Panel>
      </div>
    </div>
  )
}

/**
 * On-demand drill-down: pick a train or a route and see exactly what history
 * exists for it. Nothing here is fabricated -- this simulation runs a single
 * continuous session, so "history" means what has actually happened in it:
 * completed journeys this session, the live reason breakdown for anything
 * still running, and the offline-calibrated accuracy for that route.
 */
function RouteAndTrainLookup({ world, evaluation, onOpenTrain }) {
  const [q, setQ] = useState('')
  const [lineId, setLineId] = useState('')

  const trainMatch = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return null
    const terms = needle.split(/\s+/)
    return TRAINS.find((t) => terms.every((term) => searchBlob(t).includes(term))) ?? null
  }, [q])

  const line = lineId ? LINE_LIST.find((l) => l.id === lineId) : null
  const corridorStats = line ? evaluation.byCorridor.find((c) => c.corridor === line.name) : null

  const lineOutcomes = line
    ? world.outcomes.filter((o) => TRAIN_BY_ID[o.trainId]?.lineId === line.id)
    : []
  const lineLive = line
    ? world.liveList.filter((t) => t.lineId === line.id && world.trains[t.id]?.started && !world.trains[t.id]?.done)
    : []

  return (
    <Panel title="Look up a train or route"
           sub="For an operator asking about a specific service or corridor: what actually happened this session, what's happening right now, and how that route performs on average.">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <label className="block">
          <span className="lbl text-[10px] text-inkfaint block mb-1">Train number or name</span>
          <input className={inputCls} value={q} placeholder="e.g. 12009, or a name..."
                 onChange={(e) => { setQ(e.target.value); setLineId('') }} />
        </label>
        <label className="block">
          <span className="lbl text-[10px] text-inkfaint block mb-1">Or a whole route</span>
          <select className={inputCls} value={lineId} onChange={(e) => { setLineId(e.target.value); setQ('') }}>
            <option value="">Choose a line...</option>
            {LINE_LIST.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      </div>

      {trainMatch && <TrainLookupResult train={trainMatch} world={world} onOpenTrain={onOpenTrain} />}

      {line && (
        <div className="flex flex-col gap-3">
          <div className="border border-rule bg-surface2 px-3 py-2.5">
            <p className="lbl text-[10.5px] text-primary mb-1">Typical performance on {line.name}</p>
            {corridorStats ? (
              <p className="text-[12.5px] text-inksoft leading-snug">
                Based on {corridorStats.n.toLocaleString()} simulated historical journeys on this route: our
                forecasts are typically off by <b className="mono text-ink">{corridorStats.model.toFixed(1)} min</b>,
                against <b className="mono text-inkfaint">{corridorStats.baseline.toFixed(1)} min</b> for the old
                schedule-plus-delay method.
              </p>
            ) : (
              <p className="text-[12.5px] text-inkfaint">Not enough simulated journeys on this route yet to report a figure.</p>
            )}
          </div>

          <div>
            <p className="lbl text-[10.5px] text-inkfaint mb-1">
              Completed this session on {line.name} {lineOutcomes.length > 0 && `(${lineOutcomes.length})`}
            </p>
            {lineOutcomes.length === 0 ? (
              <p className="text-[12px] text-inkfaint">No service on this route has finished its run yet this session.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px] min-w-[380px]">
                  <thead>
                    <tr className="lbl text-[10px] text-inkfaint border-b border-rule">
                      <th className="text-left px-2 py-1">Service</th>
                      <th className="text-right px-2 py-1">We said</th>
                      <th className="text-right px-2 py-1">Actually</th>
                      <th className="text-right px-2 py-1">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineOutcomes.slice(-8).reverse().map((o, i) => (
                      <tr key={i} className="border-b border-rule/50">
                        <td className="px-2 py-1 mono">{o.no ?? o.trainId}</td>
                        <td className="px-2 py-1 text-right mono text-inkfaint">{fmtClock(o.predicted)}</td>
                        <td className="px-2 py-1 text-right mono">{fmtClock(o.actual)}</td>
                        <td className="px-2 py-1 text-right mono">
                          <span className={Math.abs(o.errorSec) > 300 ? 'text-caution' : 'text-signal'}>
                            {o.errorSec > 0 ? '+' : ''}{(o.errorSec / 60).toFixed(1)}m
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <p className="lbl text-[10.5px] text-inkfaint mb-1">
              Running right now on {line.name} {lineLive.length > 0 && `(${lineLive.length})`}
            </p>
            {lineLive.length === 0 ? (
              <p className="text-[12px] text-inkfaint">Nothing currently running on this route.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {lineLive.slice(0, 8).map((t) => {
                  const st = world.trains[t.id]
                  return (
                    <button key={t.id} onClick={() => onOpenTrain?.(t.id)}
                            className="flex items-center gap-2 px-2.5 py-1.5 border border-rule hover:border-primary hover:bg-primarywash text-left">
                      <span className="mono text-[12px] text-ink w-16 shrink-0">{t.no}</span>
                      <span className="text-[11.5px] text-inkfaint truncate flex-1">{t.name}</span>
                      <DelayChip sec={st.delaySec} />
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {!trainMatch && !line && (
        <p className="text-[12px] text-inkfaint">Search a train, or choose a route, to see its detail.</p>
      )}
    </Panel>
  )
}

function TrainLookupResult({ train, world, onOpenTrain }) {
  const st = world.trains[train.id]
  const outcome = world.outcomes.find((o) => o.trainId === train.id)
  const reason = st?.started && !st?.done ? explainCurrentETA(world, train, train.route.length - 1) : null

  return (
    <div className="border border-rule bg-surface2 px-3 py-2.5 mb-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <span className="mono text-[14px] text-ink">{train.no}</span>
          <span className="text-[12px] text-inksoft ml-2">{train.name}</span>
        </div>
        {st?.started && (
          <Btn tone="primary" onClick={() => onOpenTrain?.(train.id)}>Open full detail</Btn>
        )}
      </div>

      {outcome ? (
        <p className="text-[12.5px] text-inksoft mt-1.5">
          Completed this session: we said <b className="mono text-ink">{fmtClock(outcome.predicted)}</b>, it actually
          arrived <b className="mono text-ink">{fmtClock(outcome.actual)}</b> --{' '}
          <span className={Math.abs(outcome.errorSec) > 300 ? 'text-caution' : 'text-signal'}>
            {outcome.errorSec > 0 ? '+' : ''}{(outcome.errorSec / 60).toFixed(1)} min off</span>.
        </p>
      ) : !st?.started ? (
        <p className="text-[12.5px] text-inksoft mt-1.5">
          Not running yet this session -- booked away at <span className="mono">{fmtClock(train.route[0].schedDep)}</span>.
        </p>
      ) : (
        <>
          <p className="text-[12.5px] text-inksoft mt-1.5">
            Currently running, {Math.abs(st.delaySec) < 60 ? 'on time' : st.delaySec > 0
              ? <><span className="text-caution">{Math.round(st.delaySec / 60)} min behind</span> schedule</>
              : <><span className="text-signal">{Math.round(-st.delaySec / 60)} min ahead of</span> schedule</>}.
          </p>
          {reason && <ReasonRows attribution={reason} />}
        </>
      )}
    </div>
  )
}

function ReasonRows({ attribution }) {
  const entries = GROUPS.map((g) => ({ g, v: attribution.phi[g] }))
    .filter((e) => Math.abs(e.v) >= 6)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
  if (entries.length === 0) return null
  return (
    <div className="mt-2 flex flex-col gap-1">
      {entries.map(({ g, v }) => (
        <div key={g} className="flex items-center justify-between text-[11.5px]">
          <span className="text-inkfaint">{GROUP_META[g].label}</span>
          <span className={`mono ${v > 0 ? 'text-caution' : 'text-signal'}`}>
            {v > 0 ? '+' : ''}{(v / 60).toFixed(1)}m
          </span>
        </div>
      ))}
    </div>
  )
}

function StatusCard({ ok, label, detail }) {
  const tone = ok == null ? 'mute' : ok ? 'signal' : 'caution'
  const dot = { mute: 'bg-inkfaint', signal: 'bg-signal', caution: 'bg-caution' }[tone]
  const word = ok == null ? 'Info' : ok ? 'Healthy' : 'Check needed'
  return (
    <div className="border border-rule bg-surface px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 shrink-0 ${dot}`} />
        <span className="lbl text-[10.5px] text-inkfaint">{label}</span>
      </div>
      <div className={`text-[13px] mt-1 ${tone === 'signal' ? 'text-signal' : tone === 'caution' ? 'text-caution' : 'text-ink'}`}>
        {word}
      </div>
      <div className="text-[11px] text-inkfaint mt-0.5 leading-snug">{detail}</div>
    </div>
  )
}
