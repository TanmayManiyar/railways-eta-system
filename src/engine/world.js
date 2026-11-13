// World state: ground-truth trajectories, the propagation simulator, the live tick,
// and the broadcast significance policy.
//
// The fleet is ~3,000 services a day, so trains are activated lazily: a service gets
// state and a ground-truth timeline only once it is within the live window, and is
// retired an hour after it arrives.

import { TRAINS, SECTIONS } from '../data/network.js'
import {
  mulberry32, gauss, sectionPrior, dwellPrior, recoveryPrior, recoverySec,
  weatherForSection, typicalCongestion, TYPICAL_RAIN_MM, TYPICAL_LOSS,
} from './core.js'
import {
  buildFeatures, composeETA, baselineETA, applyInterval, attribute, DEFAULT_LEVEL,
  explainVsSchedule, GROUPS, GROUP_META,
} from './predictor.js'

export const SIM_START = 14 * 3600 + 20 * 60   // 14:20 — the network has settled by
                                              // now, so the opening frame shows real
                                              // accumulated delay rather than fresh departures
export const LIVE_WINDOW_SEC = 600             // activate this long before departure

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function hashId(s) {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

// ---------------------------------------------------------------------------
// Ground truth. Deliberately not the same function as the model: it carries a
// latent term the model cannot observe, which is what produces genuine residuals
// and therefore a meaningful reliability diagram.
// ---------------------------------------------------------------------------

function truthRunSec(train, secs, schedRun, world, atSec, rnd) {
  if (!secs || !secs.length) return schedRun
  const totalKm = secs.reduce((s, id) => s + (SECTIONS[id]?.km ?? 0), 0) || 1
  let f = 0, rec = 0
  for (const secId of secs) {
    const sec = SECTIONS[secId]
    const wk = (sec?.km ?? 0) / totalKm
    let g = TYPICAL_LOSS
    g *= 1 + sectionPrior(secId, train.cls, atSec) * 1.05
    g *= 1 + clamp(0.50 * ((world.congestion[secId] ?? 0) - typicalCongestion(secId)), -0.10, 0.62)
    const r = world.restrictions[secId]
    if (r && !r.blocked && sec) g *= clamp(sec.maxKmph / Math.max(5, r.speedKmph ?? sec.maxKmph), 1, 3.4)
    const w = weatherForSection(secId, atSec)
    g *= 1 + clamp((w.rainMm - TYPICAL_RAIN_MM) * 0.007, -0.004, 0.13)
           + (w.visibilityM < 1500 ? 0.05 : 0)
    f += wk * g
    rec += wk * recoveryPrior(secId, train.cls)
  }

  // latent: crew, rake condition, signal luck — unobservable to the model
  f *= 1 + gauss(rnd) * 0.055
  if (rnd() < 0.025) f *= 1 + rnd() * 0.32    // incident tail

  let t = schedRun * f
  const late = Math.max(0, world.trains[train.id]?.delaySec ?? 0)
  if (late > 0) t -= recoverySec(late, schedRun, rec)
  return Math.max(schedRun * 0.68, t)
}

function truthDwellSec(train, stnCode, halt, arrivingSecs, world, atSec, rnd) {
  if (halt <= 0) return 0
  let d = halt * (1 + dwellPrior(stnCode, train.cls, atSec) * 1.1)
  let cg = 0
  for (const s of arrivingSecs || []) cg = Math.max(cg, world.congestion[s] ?? 0)
  d += cg * (train.category === 'RESERVED' ? 52 : 14)
  d *= 1 + gauss(rnd) * 0.1
  return Math.max(train.category === 'RESERVED' ? 30 : 12, d)
}

/**
 * Rebuild the actual timeline from a given stop index forward. Called on activation
 * and again whenever an operational event changes the ground reality ahead.
 */
export function buildTruthFrom(train, world, fromIdx, startSec) {
  const tl = world.trains[train.id].timeline
  // Seeded on identity alone: rebuilding the same train from the same stop must
  // reproduce the same draws, so only the event itself changes the outcome.
  const rnd = mulberry32(hashId(train.id) + fromIdx * 7919)
  let t = startSec

  for (let k = fromIdx + 1; k < train.route.length; k++) {
    const prev = train.route[k - 1]
    const cur = train.route[k]
    const secs = cur.secs || []
    const schedRun = Math.max(30, (cur.schedArr ?? 0) - (prev.schedDep ?? prev.schedArr ?? 0))

    if (k > fromIdx + 1) {
      const dw = truthDwellSec(train, prev.code, prev.halt, prev.secs, world, t, rnd)
      tl[k - 1] = { ...(tl[k - 1] || {}), dep: t + dw }
      t += dw
    }

    // Queue delay behind a block comes from the propagation simulator, which is
    // also what feeds the model's G4 features. Deriving it here independently
    // would double-count the hold: once in the timeline, once in the prediction.
    for (const secId of secs) {
      const q = world.queueDelay[train.id]?.[secId] ?? 0
      if (q > 0) {
        t += q
        tl[k - 1] = { ...(tl[k - 1] || {}), dep: t, held: true }
      }
    }

    t += truthRunSec(train, secs, schedRun, world, t, rnd)
    tl[k] = { ...(tl[k] || {}), arr: t, dep: null }
  }
  const last = train.route.length - 1
  if (tl[last]) tl[last].dep = null
  return tl
}

// ---------------------------------------------------------------------------
// Active fleet
// ---------------------------------------------------------------------------

export function isLive(train, nowSec) {
  return train.schedDep - LIVE_WINDOW_SEC <= nowSec && nowSec <= train.schedArr + 3600
}

const INITIAL_DELAY = {
  '12123': 360, '11007': 120, '22105': 0, '51153': 540, '12951': -60,
  '12009': -60, '12933': 240, '19011': 900, '12809': 150,
  '12533': 180, '12137': 420, '11061': 60,
}

/** Give a service state and a ground-truth timeline the first time it goes live. */
export function ensureTrain(train, world) {
  if (world.trains[train.id]) return world.trains[train.id]

  let d0 = INITIAL_DELAY[train.id]
  if (d0 == null) {
    const r = mulberry32(hashId(train.id))
    const spread = train.category === 'METRO' ? 90 : 300
    d0 = Math.round((r() * 1.7 - 0.5) * spread)
  }

  world.trains[train.id] = {
    curIdx: 0, frac: 0, speedKmph: 0, delaySec: d0, dataAgeSec: 30,
    dwellRemainSec: 0, started: false, done: false, held: false, dwelling: false,
    timeline: [{ arr: null, dep: train.route[0].schedDep + d0 }],
  }
  world.history[train.id] = []
  buildTruthFrom(train, world, 0, world.trains[train.id].timeline[0].dep)
  return world.trains[train.id]
}

export function liveTrains(world) {
  const out = []
  for (const t of TRAINS) if (isLive(t, world.nowSec)) out.push(t)
  return out
}

// ---------------------------------------------------------------------------
// Propagation simulator — deterministic, not learned. Turns declared facts into
// G4 congestion and per-train queue delay.
// ---------------------------------------------------------------------------

export function runPropagation(world) {
  const congestion = {}
  const queueDelay = {}
  const queueRank = {}

  const hour = Math.floor((world.nowSec % 86400) / 3600)
  const peak = (hour >= 8 && hour <= 11) || (hour >= 17 && hour <= 21) ? 1
    : hour >= 12 && hour <= 16 ? 0.45 : 0.15

  for (const [sid, sec] of Object.entries(SECTIONS)) {
    congestion[sid] = sec.density * peak * 0.55
  }

  for (const ev of world.events.filter((e) => e.active)) {
    const sid = ev.sectionId
    const sec = SECTIONS[sid]
    if (!sec) continue

    const affected = []
    for (const train of world.liveList) {
      const st = world.trains[train.id]
      if (!st || st.done || !st.started) continue
      const etas = world.predictions[train.id]?.etas
      if (!etas) continue
      for (let k = st.curIdx + 1; k < train.route.length; k++) {
        if (!(train.route[k].secs || []).includes(sid)) continue
        const entry = k === st.curIdx + 1
          ? world.nowSec
          : (etas.find((e) => e.idx === k - 1)?.eta ?? etas.find((e) => e.idx === k)?.eta)
        if (entry != null && entry < ev.endSec + 2400) affected.push({ train, entry, k })
        break
      }
    }

    // priority order, then first-come within a class
    affected.sort((a, b) => a.train.priority - b.train.priority || a.entry - b.entry)

    if (ev.blocked) {
      let release = ev.endSec
      affected.forEach((a, rank) => {
        queueDelay[a.train.id] = queueDelay[a.train.id] || {}
        queueDelay[a.train.id][sid] = Math.max(0, release - a.entry)
        queueRank[a.train.id] = queueRank[a.train.id] || {}
        queueRank[a.train.id][sid] = rank
        release += sec.headwaySec
      })
      congestion[sid] = clamp(congestion[sid] + affected.length * 0.10, 0, 1)
    } else {
      congestion[sid] = clamp(congestion[sid] + 0.18, 0, 1)
      affected.forEach((a, rank) => {
        queueRank[a.train.id] = queueRank[a.train.id] || {}
        queueRank[a.train.id][sid] = rank
      })
    }

    // spill into the two sections immediately downstream on the same line
    let decay = 0.45
    let cur = sec.to
    for (let d = 0; d < 2; d++) {
      const next = Object.values(SECTIONS).find((s) => s.from === cur && s.lineId === sec.lineId)
      if (!next) break
      congestion[next.id] = clamp((congestion[next.id] ?? 0) + congestion[sid] * decay, 0, 1)
      cur = next.to
      decay *= 0.5
    }
  }

  world.congestion = congestion
  world.queueDelay = queueDelay
  world.queueRank = queueRank
}

/** The event's own section plus the two it spills into downstream on the same line. */
export function impactedSections(sid) {
  const out = new Set([sid])
  const sec = SECTIONS[sid]
  if (!sec) return out
  let cur = sec.to
  for (let d = 0; d < 2; d++) {
    const next = Object.values(SECTIONS).find((s) => s.from === cur && s.lineId === sec.lineId)
    if (!next) break
    out.add(next.id)
    cur = next.to
  }
  return out
}

/** Services with any of these sections still ahead of them. */
function trainsTouching(world, sectionSet) {
  return world.liveList.filter((train) => {
    const st = world.trains[train.id]
    if (!st || !st.started || st.done) return false
    for (let k = st.curIdx + 1; k < train.route.length; k++) {
      for (const s of train.route[k].secs || []) if (sectionSet.has(s)) return true
    }
    return false
  })
}

// ---------------------------------------------------------------------------
// Deriving observed state from the ground-truth timeline
// ---------------------------------------------------------------------------

/** Pure: the train's observed state at `now`. Does not mutate world state. */
export function deriveStateAt(train, tl, now, world) {
  const st = {
    curIdx: 0, frac: 0, speedKmph: 0, delaySec: 0, dataAgeSec: 30,
    dwellRemainSec: 0, started: false, done: false, held: false, dwelling: false,
  }

  if (!tl[0] || now < tl[0].dep) {
    st.delaySec = (tl[0]?.dep ?? train.route[0].schedDep) - train.route[0].schedDep
    st.dwellRemainSec = Math.max(0, (tl[0]?.dep ?? now) - now)
    return st
  }
  st.started = true

  let i = 0
  for (let k = 0; k < tl.length; k++) if (tl[k]?.arr != null && tl[k].arr <= now) i = k

  const last = train.route.length - 1
  if (now >= (tl[last]?.arr ?? Infinity)) {
    st.done = true
    st.curIdx = last
    st.frac = 1
    st.delaySec = tl[last].arr - train.route[last].schedArr
    return st
  }

  const dep = tl[i]?.dep
  if (dep != null && now >= dep) {
    const arrNext = tl[i + 1]?.arr
    if (arrNext == null) return st
    const span = Math.max(1, arrNext - dep)
    st.curIdx = i
    st.frac = clamp((now - dep) / span, 0, 0.999)

    const secs = train.route[i + 1].secs || []
    const sec = SECTIONS[secs[0]]
    const km = Math.abs(train.route[i + 1].km - train.route[i].km)
    const avg = km / (span / 3600)
    st.held = secs.some((s) => {
      const r = world.restrictions[s]
      return r?.blocked && now >= r.startSec && now < r.endSec
    })
    const prof = st.frac < 0.08 ? 0.45 : st.frac > 0.92 ? 0.4 : 1.12
    st.speedKmph = st.held ? 0 : Math.round(clamp(avg * prof, 0, sec ? sec.maxKmph : 120))
    st.delaySec = Math.round(
      (dep - (train.route[i].schedDep ?? train.route[i].schedArr)) * (1 - st.frac) +
      (arrNext - train.route[i + 1].schedArr) * st.frac
    )
  } else {
    st.curIdx = i
    st.dwelling = true
    st.dwellRemainSec = Math.max(0, (dep ?? now) - now)
    st.delaySec = Math.round(tl[i].arr - (train.route[i].schedArr ?? tl[i].arr))
  }

  st.dataAgeSec = 20 + (hashId(train.id + i) % 40)
  return st
}

function deriveState(train, world) {
  const prev = world.trains[train.id]
  Object.assign(prev, deriveStateAt(train, prev.timeline, world.nowSec, world))
  return prev
}

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

export function predictFrom(train, state, world, calib, anchorBase) {
  const base0 = anchorBase ?? world.nowSec
  const anchor = base0 + (state.dwellRemainSec || 0)
  const fv = buildFeatures(train, state, world, base0)
  const etas = composeETA(train, state.curIdx, fv, anchor)
  const base = baselineETA(train, state.curIdx, state.delaySec)

  const withIntervals = etas.map((e) => {
    const iv = applyInterval(e.eta, e.eta - base0, calib, DEFAULT_LEVEL)
    return { ...e, lo: iv.lo, hi: iv.hi, level: iv.level }
  })

  const lastE = withIntervals[withIntervals.length - 1]
  return {
    trainId: train.id,
    issuedAt: base0,
    curIdx: state.curIdx,
    fv, anchor,
    etas: withIntervals,
    baseline: base,
    destEta: lastE?.eta ?? null,
    destLo: lastE?.lo ?? null,
    destHi: lastE?.hi ?? null,
    baselineDestEta: base[base.length - 1]?.eta ?? null,
  }
}

export function predictTrain(train, world, calib) {
  const st = world.trains[train.id]
  if (!st || !st.started || st.done) return null
  return predictFrom(train, st, world, calib)
}

/**
 * What this train's forecast looks like at a future clock time, without advancing
 * the world. Backs the per-train scrubber.
 */
export function previewTrainAt(world, train, targetSec, calib) {
  const st = world.trains[train.id]
  if (!st) return null
  const snap = deriveStateAt(train, st.timeline, targetSec, world)
  if (!snap.started) return { state: snap, pred: null, notStarted: true }
  if (snap.done) {
    return {
      state: snap, done: true, pred: null,
      actualArr: st.timeline[train.route.length - 1]?.arr ?? null,
    }
  }
  return { state: snap, pred: predictFrom(train, snap, world, calib, targetSec) }
}

// ---------------------------------------------------------------------------
// Broadcast significance policy
// ---------------------------------------------------------------------------

export const POLICY = {
  tMinLaterSec: 180,
  tMinEarlierSec: 120,
  intervalFrac: 0.35,
  cooldownSec: 600,
  hysteresisCycles: 2,
}

export function checkSignificance(world, train, pred) {
  const pub = world.published[train.id]
  if (!pub) return { publish: true, reason: 'first prediction of the journey', delta: 0 }

  const delta = pred.destEta - pub.destEta
  const width = (pred.destHi ?? 0) - (pred.destLo ?? 0)
  const tMin = delta >= 0 ? POLICY.tMinLaterSec : POLICY.tMinEarlierSec
  const threshold = Math.max(tMin, POLICY.intervalFrac * width)

  const critical = world.events.some(
    (e) => e.active && e.severity === 'CRITICAL' && !(pub.criticalSeen || []).includes(e.id)
  )
  if (critical) return { publish: true, reason: 'critical operational event on the path', delta, threshold }

  if (Math.abs(delta) < threshold) {
    world.pendingChange[train.id] = 0
    return { publish: false, reason: 'inside dead-band', delta, threshold }
  }
  if (world.nowSec - pub.at < POLICY.cooldownSec) {
    return { publish: false, reason: 'cooldown active', delta, threshold }
  }

  world.pendingChange[train.id] = (world.pendingChange[train.id] || 0) + 1
  if (world.pendingChange[train.id] < POLICY.hysteresisCycles) {
    return { publish: false, reason: 'awaiting second confirming cycle', delta, threshold }
  }

  world.pendingChange[train.id] = 0
  return {
    publish: true, delta, threshold,
    reason: delta > 0 ? 'sustained ETA slip beyond dead-band' : 'sustained ETA gain beyond dead-band',
  }
}

// ---------------------------------------------------------------------------
// Init, tick, seek
// ---------------------------------------------------------------------------

/**
 * Disruptions already in effect when the network is first observed.
 *
 * A real control room is never looking at a clean network — there is always a
 * monsoon restriction somewhere, a flooded cutting, a failed point. Seeding these
 * means the console opens on a realistic mix of causes rather than weather alone,
 * and every one of them is an ordinary declared event with no special handling.
 */
const SEED_EVENTS = [
  {
    type: 'TSR', sectionId: 'KJT-LNL',
    startSec: SIM_START - 30 * 60, endSec: SIM_START + 3 * 3600,
    speedKmph: 30, severity: 'MAJOR',
    note: 'Monsoon speed restriction — Bhor ghat',
  },
  {
    type: 'TSR', sectionId: 'CLA-SIN',
    startSec: SIM_START - 20 * 60, endSec: SIM_START + 80 * 60,
    speedKmph: 40, severity: 'MAJOR',
    note: 'Waterlogging between Kurla and Sion',
  },
  {
    type: 'BLOCK', sectionId: 'VDLR-GTBN',
    startSec: SIM_START - 10 * 60, endSec: SIM_START + 35 * 60,
    speedKmph: null, severity: 'CRITICAL',
    note: 'Points failure at Wadala Road',
  },
]

export function initWorld(calib) {
  const world = {
    nowSec: SIM_START,
    trains: {}, congestion: {}, queueDelay: {}, queueRank: {},
    restrictions: {}, events: [], predictions: {}, published: {},
    history: {}, broadcasts: [], pendingChange: {}, outcomes: [],
    eventSeq: 1, liveList: [], stats: null,
  }

  world.liveList = liveTrains(world)
  for (const t of world.liveList) ensureTrain(t, world)
  runPropagation(world)
  for (const t of world.liveList) deriveState(t, world)
  for (const t of world.liveList) world.predictions[t.id] = predictTrain(t, world, calib)
  runPropagation(world)

  for (const t of world.liveList) {
    const p = predictTrain(t, world, calib)
    world.predictions[t.id] = p
    if (p) {
      world.published[t.id] = {
        destEta: p.destEta, at: world.nowSec, fv: p.fv, curIdx: p.curIdx, criticalSeen: [],
      }
      world.history[t.id].push({ t: world.nowSec, eta: p.destEta, baseline: p.baselineDestEta })
    }
  }
  // seed the standing disruptions — ordinary declared events, nothing special
  for (const spec of SEED_EVENTS) {
    if (!SECTIONS[spec.sectionId]) continue
    declareEvent(world, spec, calib)
  }

  computeStats(world)
  return world
}

export function tickWorld(world, dtSec, calib, opts = {}) {
  world.nowSec += dtSec
  const quiet = !!opts.quiet          // suppress broadcast churn while seeking

  world.liveList = liveTrains(world)
  for (const t of world.liveList) ensureTrain(t, world)

  for (const train of world.liveList) {
    const st = world.trains[train.id]
    const wasDone = st.done
    deriveState(train, world)

    if (st.done && !wasDone) {
      const last = train.route.length - 1
      const pub = world.published[train.id]
      if (pub) {
        const actual = st.timeline[last].arr
        world.outcomes.push({
          trainId: train.id, no: train.no, category: train.category,
          predicted: pub.destEta, actual, errorSec: actual - pub.destEta,
        })
        if (world.outcomes.length > 400) world.outcomes.shift()
      }
    }
  }

  runPropagation(world)

  for (const train of world.liveList) {
    const p = predictTrain(train, world, calib)
    if (!p) { world.predictions[train.id] = null; continue }
    world.predictions[train.id] = p

    const sig = checkSignificance(world, train, p)
    p.significance = sig

    if (sig.publish) {
      const prev = world.published[train.id]
      if (!quiet) {
        world.broadcasts.unshift({
          id: `${train.id}-${world.nowSec}`,
          trainId: train.id, no: train.no, category: train.category,
          at: world.nowSec, from: prev?.destEta ?? null, to: p.destEta,
          delta: sig.delta, reason: sig.reason,
          channels: ['app', 'board', 'api', 'control'],
        })
        if (world.broadcasts.length > 80) world.broadcasts.pop()
      }
      world.published[train.id] = {
        destEta: p.destEta, at: world.nowSec, fv: p.fv, curIdx: p.curIdx,
        prevFv: prev?.fv,
        criticalSeen: world.events.filter((e) => e.active && e.severity === 'CRITICAL').map((e) => e.id),
      }
    }

    const h = world.history[train.id]
    if (h && (!h.length || world.nowSec - h[h.length - 1].t >= 120)) {
      h.push({ t: world.nowSec, eta: p.destEta, baseline: p.baselineDestEta })
      if (h.length > 200) h.shift()
    }
  }

  // retire services that finished well in the past
  for (const id of Object.keys(world.trains)) {
    const st = world.trains[id]
    if (st.done && world.nowSec - (st.timeline[st.timeline.length - 1]?.arr ?? 0) > 3600) {
      delete world.trains[id]
      delete world.predictions[id]
      delete world.published[id]
      delete world.history[id]
    }
  }

  computeStats(world)
  return world
}

/** Advance the clock forward to an absolute time, stepping so the world evolves. */
export function seekTo(world, targetSec, calib, step = 180) {
  if (targetSec <= world.nowSec) return world
  let guard = 0
  while (world.nowSec < targetSec - 1 && guard++ < 600) {
    const dt = Math.min(step, targetSec - world.nowSec)
    tickWorld(world, dt, calib, { quiet: guard % 4 !== 0 })
  }
  return world
}

/**
 * Scrub the clock to any time, forwards or backwards.
 *
 * Rewinding rebuilds from the start and replays: every timeline is a seeded
 * function of its inputs, so the replay is identical to what was seen before.
 * Declared events are re-applied at the point they were originally created.
 */
export function scrubTo(world, targetSec, calib) {
  if (targetSec > world.nowSec) {
    seekTo(world, targetSec, calib)
    return world
  }
  if (Math.abs(targetSec - world.nowSec) < 1) return world

  const declared = world.events
    .filter((e) => e.createdAt <= targetSec)
    .map((e) => ({
      createdAt: e.createdAt,
      spec: {
        type: e.type, sectionId: e.sectionId, startSec: e.startSec, endSec: e.endSec,
        speedKmph: e.speedKmph, severity: e.severity, note: e.note,
      },
    }))
    .sort((a, b) => a.createdAt - b.createdAt)

  const fresh = initWorld(calib)
  for (const d of declared) {
    if (d.createdAt > fresh.nowSec) seekTo(fresh, d.createdAt, calib, 300)
    declareEvent(fresh, d.spec, calib)
  }
  seekTo(fresh, targetSec, calib, 300)

  // adopt the rebuilt state in place so existing references stay valid
  for (const k of Object.keys(world)) delete world[k]
  Object.assign(world, fresh)
  return world
}

function computeStats(world) {
  let running = 0, onTime = 0, delaySum = 0, held = 0
  const byCat = { RESERVED: 0, UNRESERVED: 0, METRO: 0 }
  for (const t of world.liveList) {
    const st = world.trains[t.id]
    if (!st || !st.started || st.done) continue
    running++
    byCat[t.category] = (byCat[t.category] || 0) + 1
    delaySum += st.delaySec
    if (st.delaySec <= 300) onTime++
    if (st.held) held++
  }
  world.stats = {
    running, onTime, held, byCat,
    onTimePct: running ? (onTime / running) * 100 : 0,
    meanDelayMin: running ? delaySum / running / 60 : 0,
  }
}

/**
 * The section with the most services due to enter it shortly.
 *
 * A demo block on a fixed section only bites when trains happen to be approaching
 * it; picking the busiest upcoming section makes the propagation story land at any
 * point on the clock, including after the operator has scrubbed time.
 */
export function busiestUpcomingSection(world, withinSec = 2400, category = null) {
  const score = {}
  for (const train of world.liveList) {
    if (category && train.category !== category) continue
    const st = world.trains[train.id]
    if (!st || !st.started || st.done) continue
    const etas = world.predictions[train.id]?.etas
    if (!etas) continue
    for (let k = st.curIdx + 1; k < train.route.length; k++) {
      const entry = k === st.curIdx + 1
        ? world.nowSec
        : (etas.find((e) => e.idx === k - 1)?.eta ?? null)
      if (entry == null || entry > world.nowSec + withinSec) break
      for (const sid of train.route[k].secs || []) {
        score[sid] = (score[sid] || 0) + 1
      }
    }
  }
  let best = null, bestN = 0
  for (const [sid, n] of Object.entries(score)) {
    // prefer a busy section that several services still have to cross
    if (n > bestN) { best = sid; bestN = n }
  }
  return best ? { sectionId: best, approaching: bestN } : null
}

// ---------------------------------------------------------------------------
// Operational events
// ---------------------------------------------------------------------------

export function declareEvent(world, spec, calib) {
  const { type, sectionId: sid, startSec, endSec, speedKmph, severity, note } = spec
  const id = `EV${String(world.eventSeq++).padStart(3, '0')}`
  const blocked = type === 'BLOCK'
  const ev = {
    id, type, sectionId: sid, startSec, endSec, speedKmph, severity,
    note: note || '', active: true, createdAt: world.nowSec, blocked,
  }
  world.events.push(ev)
  world.restrictions[sid] = { blocked, speedKmph, severity, eventId: id, startSec, endSec }

  const before = {}
  for (const t of world.liveList) before[t.id] = world.predictions[t.id]?.destEta ?? null

  runPropagation(world)

  // Only services that still have an impacted section ahead of them can be
  // affected. Rebuilding everything would shuffle unrelated trains.
  const reach = impactedSections(sid)
  const touched = trainsTouching(world, reach)

  for (const train of touched) {
    const st = world.trains[train.id]
    buildTruthFrom(train, world, st.curIdx, st.timeline[st.curIdx]?.dep ?? world.nowSec)
    deriveState(train, world)
  }
  for (const t of touched) world.predictions[t.id] = predictTrain(t, world, calib)
  runPropagation(world)
  for (const t of touched) world.predictions[t.id] = predictTrain(t, world, calib)

  const impact = touched.map((train) => {
    const after = world.predictions[train.id]?.destEta ?? null
    return {
      trainId: train.id, no: train.no, name: train.name, cls: train.cls,
      category: train.category, priority: train.priority,
      before: before[train.id], after,
      delta: before[train.id] != null && after != null ? after - before[train.id] : null,
      queueRank: world.queueRank[train.id]?.[sid] ?? null,
    }
  }).filter((r) => r.delta != null && Math.abs(r.delta) >= 30)
    .sort((a, b) => b.delta - a.delta)

  ev.impact = impact
  computeStats(world)
  return { event: ev, impact }
}

export function clearEvent(world, eventId, calib) {
  const ev = world.events.find((e) => e.id === eventId)
  if (!ev) return
  ev.active = false
  delete world.restrictions[ev.sectionId]
  runPropagation(world)
  for (const train of trainsTouching(world, impactedSections(ev.sectionId))) {
    const st = world.trains[train.id]
    buildTruthFrom(train, world, st.curIdx, st.timeline[st.curIdx]?.dep ?? world.nowSec)
    deriveState(train, world)
    world.predictions[train.id] = predictTrain(train, world, calib)
  }
  computeStats(world)
}

/** Attribution against the last published prediction for this train. */
export function explainTrain(world, train, targetIdx) {
  const pred = world.predictions[train.id]
  const pub = world.published[train.id]
  if (!pred || !pub) return null
  const prevFv = pub.prevFv || pub.fv
  const idx = targetIdx ?? train.route.length - 1
  return attribute(train, pred.curIdx, prevFv, pred.fv, pred.anchor, idx)
}

/**
 * Why the current forecast differs from a normal run of the rest of the journey.
 * Unlike explainTrain, this needs no prior publication — it always has something
 * to say, from the very first prediction of the journey.
 */
export function explainCurrentETA(world, train, targetIdx) {
  const pred = world.predictions[train.id]
  if (!pred) return null
  const idx = targetIdx ?? train.route.length - 1
  return explainVsSchedule(train, pred.curIdx, pred.fv, pred.anchor, idx)
}

/** The single biggest factor behind a live train's current forecast, if any is significant. */
export function topDelayReason(world, train) {
  const attr = explainCurrentETA(world, train)
  if (!attr) return null
  let best = null
  for (const g of GROUPS) {
    const v = attr.phi[g]
    if (Math.abs(v) < 18) continue
    if (!best || Math.abs(v) > Math.abs(best.v)) best = { g, v }
  }
  return best ? { label: GROUP_META[best.g].label, minutes: +(best.v / 60).toFixed(1) } : null
}
