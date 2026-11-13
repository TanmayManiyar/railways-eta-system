import React, { useMemo, useState } from 'react'
import { PLACES, PLACE_BY_KEY, STATIONS, fmtClock } from '../data/network.js'
import { planJourney } from '../engine/journey.js'
import { explainCurrentETA } from '../engine/world.js'
import { GROUPS, GROUP_META, horizonBin } from '../engine/predictor.js'
import { useWorld } from '../store.jsx'
import { Panel, Chip, Btn, Field, inputCls, DelayChip } from '../ui/bits.jsx'

const CAT_TONE = { RESERVED: 'info', UNRESERVED: 'signal', METRO: 'caution' }
const CAT_SHORT = { RESERVED: 'RSV', UNRESERVED: 'LOC', METRO: 'MTR' }

const mins = (sec) => `${Math.round(sec / 60)}m`

/** Top reasons this leg's arrival differs from the last published estimate. */
function legReasons(world, leg) {
  if (!leg.live) return null
  const attr = explainCurrentETA(world, leg.train, leg.toIdx)
  if (!attr) return null
  return GROUPS.map((g) => ({ factor: GROUP_META[g].label, minutes: +(attr.phi[g] / 60).toFixed(1) }))
    .filter((r) => Math.abs(r.minutes) >= 0.3)
    .sort((a, b) => Math.abs(b.minutes) - Math.abs(a.minutes))
}

/** Confidence ladder for this leg's arrival: several levels, same prediction. */
function legConfidence(world, leg, calib) {
  if (!leg.arr?.time || leg.arr.lo == null) return null
  const bin = horizonBin(leg.arr.time - world.nowSec)
  const out = {}
  for (const lv of calib.levels || []) {
    const q = calib.bins?.[bin]?.[String(lv)]
    if (q) out[lv] = [leg.arr.time + q[0], leg.arr.time + q[1]]
  }
  return out
}

function connTone(p) {
  if (p == null) return 'mute'
  if (p >= 0.9) return 'signal'
  if (p >= 0.7) return 'caution'
  return 'danger'
}

/** Native searchable picker — 124 places, so a datalist beats a 124-row select. */
function PlacePicker({ label, value, onChange, listId }) {
  const place = value ? PLACE_BY_KEY[value] : null
  const [text, setText] = useState(place?.name ?? '')

  const commit = (raw) => {
    setText(raw)
    const hit = PLACES.find(
      (p) => p.name.toLowerCase() === raw.toLowerCase() ||
             p.codes.some((c) => c.toLowerCase() === raw.toLowerCase())
    )
    if (hit) onChange(hit.key)
  }

  return (
    <Field label={label}>
      <input
        className={inputCls}
        list={listId}
        value={text}
        placeholder="Station name or code…"
        onChange={(e) => commit(e.target.value)}
      />
      <datalist id={listId}>
        {PLACES.map((p) => (
          <option key={p.key} value={p.name}>
            {p.codes.join(' / ')}{p.interchange ? ' · interchange' : ''}
          </option>
        ))}
      </datalist>
    </Field>
  )
}

function TimeCell({ call, label }) {
  return (
    <div>
      <div className="lbl text-[9.5px] text-inkfaint">{label}</div>
      <div className="mono text-[16px] text-ink leading-tight">{fmtClock(call.time)}</div>
      {call.lo != null ? (
        <div className="mono text-[10.5px] text-inksoft">
          {fmtClock(call.lo)}–{fmtClock(call.hi)}
        </div>
      ) : (
        <div className="text-[10.5px] text-inkfaint">{call.scheduled ? 'booked time' : 'actual'}</div>
      )}
    </div>
  )
}

function LegCard({ leg, onSelect, compact, world, calib }) {
  const t = leg.train
  const reasons = world && calib ? legReasons(world, leg) : null
  const topReason = reasons?.[0]
  return (
    <div className={`border border-rule  ${compact ? 'px-3 py-2' : 'px-3.5 py-3'} bg-surface2`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
                    className="mono text-ink hover:text-primary hover:underline">{t.no}</button>
            <Chip tone={CAT_TONE[t.category]}>{CAT_SHORT[t.category]}</Chip>
            <Chip tone="mute">{t.lineShort}</Chip>
            {leg.live && <DelayChip sec={leg.delaySec} />}
            {!leg.live && <Chip tone="mute">not yet running</Chip>}
          </div>
          <div className="text-[11.5px] text-inkfaint mt-0.5">
            {t.name} · {STATIONS[leg.fromCode].name} → {STATIONS[leg.toCode].name}
          </div>
          {topReason && (
            <div className="text-[10.5px] text-inkfaint mt-1">
              Mainly <span className={topReason.minutes > 0 ? 'text-caution' : 'text-signal'}>
                {topReason.factor.toLowerCase()} ({topReason.minutes > 0 ? '+' : ''}{topReason.minutes}m)</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-5 shrink-0">
          <TimeCell call={leg.dep} label="Depart" />
          <div className="text-center">
            <div className="lbl text-[9.5px] text-inkfaint">Journey</div>
            <div className="mono text-[13px] text-inksoft">{mins(leg.durationSec)}</div>
          </div>
          <TimeCell call={leg.arr} label="Arrive" />
        </div>
      </div>
    </div>
  )
}

export default function Journey() {
  const { world, calib } = useWorld()
  const [from, setFrom] = useState('DADAR')
  const [to, setTo] = useState(() => PLACES.find((p) => p.codes.includes('VR'))?.key)

  const fromPlace = from ? PLACE_BY_KEY[from] : null
  const toPlace = to ? PLACE_BY_KEY[to] : null

  const plan = useMemo(
    () => (fromPlace && toPlace ? planJourney(world, fromPlace, toPlace, calib) : { direct: [], viaChange: [] }),
    [from, to, world.nowSec, fromPlace, toPlace, world, calib]
  )

  const swap = () => { const a = from; setFrom(to); setTo(a) }
  const same = fromPlace && toPlace && fromPlace.key === toPlace.key
  const nothing = !same && plan.direct.length === 0 && plan.viaChange.length === 0

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-primarywash border border-primary/30 px-3.5 py-3">
        <p className="lbl text-[11px] text-primary mb-1">What is this screen?</p>
        <p className="text-[13px] text-ink leading-snug">
          This is <b>not</b> a feature for railway staff — it is a demonstration of how an outside app
          (a passenger app on someone's phone, a departure board at a station, a feeder-taxi service) would
          plug into this system. It asks a plain question — <i>"how do I get from A to B?"</i> — and gets back
          the same predictions shown everywhere else in this tool, over a simple web request. Nobody building
          on top of this needs to run their own prediction model; they just ask this one.
        </p>
        <div className="mt-2 bg-surface border border-primary/25 px-2.5 py-1.5">
          <p className="lbl text-[9.5px] text-inkfaint mb-0.5">The actual request being made below</p>
          <div className="mono text-[11.5px] text-primary">
            GET /v1/journey?from={fromPlace?.codes?.[0] ?? '…'}&amp;to={toPlace?.codes?.[0] ?? '…'}&amp;at={fmtClock(world.nowSec)}
          </div>
        </div>
      </div>

      <Panel
        title="Try it: where are you, where are you going?"
        sub="Pick two stations. Everything below is calculated by the same prediction engine used across this whole tool — this screen just asks it a question and displays the answer."
      >
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-end">
          <PlacePicker label="From" value={from} onChange={setFrom} listId="places-from" />
          <Btn onClick={swap} title="Swap origin and destination" className="mb-0.5">Swap</Btn>
          <PlacePicker label="To" value={to} onChange={setTo} listId="places-to" />
        </div>
        {fromPlace && toPlace && (
          <p className="text-[12px] text-inkfaint mt-3">
            Departures from <b className="text-inksoft">{fromPlace.name}</b>
            {fromPlace.interchange && <span className="mono"> ({fromPlace.codes.join('/')})</span>} after{' '}
            <span className="mono">{fmtClock(world.nowSec)}</span>, arriving{' '}
            <b className="text-inksoft">{toPlace.name}</b>.
          </p>
        )}
      </Panel>

      {same && (
        <Panel title="Same station">
          <p className="text-[13px] text-inkfaint">Choose two different places.</p>
        </Panel>
      )}

      {nothing && (
        <Panel title="No route found">
          <p className="text-[13px] text-inksoft">
            Nothing runs between these two places directly or with a single change in the next three hours.
            Journeys needing two or more changes are not planned yet — pick an interchange as an intermediate
            destination to route it in two steps.
          </p>
        </Panel>
      )}

      {plan.direct.length > 0 && (
        <Panel title={`No change needed — ${plan.direct.length} service${plan.direct.length > 1 ? 's' : ''}`}
               sub="Each time shown carries a confidence window wherever the train is already running — the same forecast a passenger app would receive, not a separate estimate.">
          <div className="flex flex-col gap-2">
            {plan.direct.map((l) => <LegCard key={l.train.id} leg={l} world={world} calib={calib} />)}
          </div>
        </Panel>
      )}

      {(plan.direct.length > 0 || plan.viaChange.length > 0) && (
        <Panel
          title="What the app actually gets back"
          sub="This is the raw data — the same numbers shown as cards above, in the machine-readable form a real app would parse. Note it carries a confidence window and a stated reliability, not just a single guess."
          pad={false}
        >
          <pre className="text-[11px] mono text-inksoft p-3.5 overflow-x-auto leading-relaxed max-h-[300px]">
{JSON.stringify({
  query: { from: fromPlace?.codes?.[0], to: toPlace?.codes?.[0], at: fmtClock(world.nowSec) },
  coverage: 0.95,
  direct: plan.direct.slice(0, 2).map((l) => {
    const conf = legConfidence(world, l, calib)
    return {
      service: l.train.no,
      name: l.train.name,
      category: l.train.category,
      depart: { station: l.dep?.stop?.code ?? fromPlace?.codes?.[0], time: fmtClock(l.dep?.time) },
      arrive: {
        station: l.arr?.stop?.code ?? toPlace?.codes?.[0],
        time: fmtClock(l.arr?.time),
        interval95: l.arr?.lo != null ? [fmtClock(l.arr.lo), fmtClock(l.arr.hi)] : null,
        confidence: conf
          ? Object.fromEntries(Object.entries(conf).map(([lv, [lo, hi]]) => [`${Math.round(lv * 100)}%`, [fmtClock(lo), fmtClock(hi)]]))
          : null,
        basis: l.arr?.actual ? 'actual' : l.arr?.predicted ? 'predicted' : 'scheduled',
      },
      delayReasons: legReasons(world, l),
    }
  }),
  viaChange: plan.viaChange.slice(0, 1).map((c) => ({
    via: c.via.codes?.[0] ?? c.via.name,
    depart: fmtClock(c.depTime),
    arrive: fmtClock(c.arrTime),
    changeSeconds: c.changeSec,
    connectionProbability: c.connectionP == null ? null : +c.connectionP.toFixed(3),
  })),
}, null, 2)}
          </pre>
        </Panel>
      )}

      {plan.viaChange.length > 0 && (
        <Panel
          title={`One change — ${plan.viaChange.length} option${plan.viaChange.length > 1 ? 's' : ''}`}
          sub="Connection confidence is read off the same residual distribution that sets the intervals: a tight change behind an uncertain service is flagged even when the timetable says it works."
        >
          <div className="flex flex-col gap-4">
            {plan.viaChange.map((c) => (
              <div key={c.via.key} className="border border-rule overflow-hidden">
                <div className="flex items-center gap-3 flex-wrap px-3.5 py-2 bg-surface3 border-b border-rule">
                  <span className="lbl text-[11px] text-signal">via {c.via.name}</span>
                  <span className="mono text-[12px] text-ink">
                    {fmtClock(c.depTime)} → {fmtClock(c.arrTime)}
                  </span>
                  <span className="mono text-[11.5px] text-inksoft">{mins(c.durationSec)} total</span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="mono text-[11px] text-inkfaint">{mins(c.changeSec)} to change</span>
                    <Chip tone={connTone(c.connectionP)}>
                      {c.connectionP == null ? 'connection n/a' : `${Math.round(c.connectionP * 100)}% connect`}
                    </Chip>
                  </span>
                </div>
                <div className="p-3 flex flex-col gap-2">
                  <LegCard leg={c.legs[0]} compact world={world} calib={calib} />
                  <div className="flex items-center gap-2 pl-1 text-[11.5px] text-inkfaint">
                    <span className="w-1.5 h-1.5 rounded-full bg-signal" />
                    Change at {c.via.name} — {mins(c.changeSec)} available, 5m minimum
                    {c.connectionP != null && c.connectionP < 0.7 && (
                      <span className="text-danger">· tight, the first leg would have to run close to forecast</span>
                    )}
                  </div>
                  <LegCard leg={c.legs[1]} compact world={world} calib={calib} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}
