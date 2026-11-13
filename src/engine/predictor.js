// The prediction model: two per-hop heads, forward composition, conformal intervals,
// and exact Shapley attribution over the six feature groups.
//
// Everything here is a pure function of the feature vector, which is what makes the
// group-swap attribution in attribute() valid.

import { SECTIONS, CLASS_META, sectionId } from '../data/network.js'
import {
  sectionPrior, dwellPrior, recoveryPrior, recoverySec, weatherForSection,
  typicalCongestion, TYPICAL_RAIN_MM, TYPICAL_LOSS,
} from './core.js'

/**
 * Coverage level every published interval is calibrated to.
 *
 * The interval is what carries uncertainty, not a varying confidence number: a 95%
 * interval is 95% reliable on every prediction, and a train the model is unsure
 * about simply gets a wider window. Verified on held-out data in calibrate.js.
 */
export const DEFAULT_LEVEL = 0.95

export const GROUPS = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']

export const GROUP_META = {
  G1: { label: 'Train state',    short: 'State',       hint: 'current delay, speed, position in section' },
  G2: { label: 'Section priors', short: 'Section hist', hint: 'learned run-time behaviour for this stretch' },
  G3: { label: 'Dwell priors',   short: 'Dwell hist',   hint: 'learned station dwell behaviour' },
  G4: { label: 'Network state',  short: 'Congestion',   hint: 'headway, occupancy, queue ahead' },
  G5: { label: 'Restrictions',   short: 'Ops events',   hint: 'declared blocks and speed restrictions' },
  G6: { label: 'Weather',        short: 'Weather',      hint: 'rainfall and visibility on the path ahead' },
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// --- feature vector -------------------------------------------------------

export function buildFeatures(train, state, world, anchorSec) {
  const { curIdx, delaySec, speedKmph, frac, dataAgeSec } = state
  const anchor = anchorSec ?? world.nowSec
  const route = train.route

  const G2 = {}, G3 = {}, G4 = { congestion: {}, queueDelay: {}, headwaySec: state.headwaySec ?? 1800 }
  const G5 = {}, G6 = {}

  // Part of a queue wait may already be visible as the train sitting at a platform.
  // The prediction anchor advances by that dwell, so only the remainder is still
  // ahead of the train — counting the whole queue again would double the hold.
  const served = Math.max(0, state.dwellRemainSec || 0)

  for (let k = curIdx; k < route.length; k++) {
    G3[route[k].code] = k === route.length - 1 ? 0 : dwellPrior(route[k].code, train.cls, anchor)
    for (const sid of route[k].secs || []) {
      G2[sid] = sectionPrior(sid, train.cls, anchor)
      G4.congestion[sid] = world.congestion[sid] ?? 0
      const raw = (world.queueDelay[train.id] || {})[sid] ?? 0
      G4.queueDelay[sid] = k === curIdx + 1 ? Math.max(0, raw - served) : raw
      const r = world.restrictions[sid]
      if (r) G5[sid] = r
      G6[sid] = weatherForSection(sid, anchor)
    }
  }

  return {
    G1: { delaySec, speedKmph, frac, dataAgeSec },
    G2: { bias: G2 },
    G3: { bias: G3 },
    G4,
    G5: { restrict: G5 },
    G6: { bySection: G6 },
  }
}

// --- the two heads --------------------------------------------------------

/** Multiplicative run-time factor for one physical section. */
function sectionFactor(secId, fv) {
  const sec = SECTIONS[secId]
  let f = TYPICAL_LOSS
  f *= 1 + (fv.G2.bias[secId] ?? 0)                                   // G2

  // deviation from the typical congestion the timetable already absorbs
  const dCong = (fv.G4.congestion[secId] ?? 0) - typicalCongestion(secId)
  f *= 1 + clamp(0.45 * dCong, -0.10, 0.55)                           // G4

  const r = fv.G5.restrict[secId]                                      // G5
  if (r && sec) {
    const imposed = Math.max(5, r.speedKmph ?? sec.maxKmph)
    f *= r.blocked ? 1 : clamp(sec.maxKmph / imposed, 1, 3.2)
  }

  const w = fv.G6.bySection[secId]                                     // G6
  if (w) {
    f *= 1 + clamp((w.rainMm - TYPICAL_RAIN_MM) * 0.006, -0.004, 0.10)
           + (w.visibilityM < 1500 ? 0.035 : 0)
  }
  return f
}

export function legCongestion(secs, fv) {
  let m = 0
  for (const s of secs) m = Math.max(m, fv.G4.congestion[s] ?? 0)
  return m
}

/**
 * Run time for one booked leg. A leg may span several physical sections when the
 * service skips halts, so the factor is distance-weighted across them.
 */
/** Running time for a leg, excluding any queue wait. */
function runTimeSec(train, secs, schedRunSec, fv) {
  if (!secs || secs.length === 0) return schedRunSec

  const totalKm = secs.reduce((s, id) => s + (SECTIONS[id]?.km ?? 0), 0) || 1
  let f = 0, rec = 0
  for (const id of secs) {
    const w = (SECTIONS[id]?.km ?? 0) / totalKm
    f += w * sectionFactor(id, fv)
    rec += w * recoveryPrior(id, train.cls)
  }

  let t = schedRunSec * f

  const late = Math.max(0, fv.G1.delaySec)                             // G1
  if (late > 0) t -= recoverySec(late, schedRunSec, rec)

  return Math.max(schedRunSec * 0.7, t)
}

/**
 * Absolute wait behind a block on this leg. Kept separate from running time
 * because it is a fixed duration — scaling it by a speed factor would inflate a
 * wait we already know the length of.
 */
export function legQueueSec(secs, fv) {
  let q = 0
  for (const id of secs || []) q += fv.G4.queueDelay[id] ?? 0          // G4
  return q
}

function dwellSec(train, stnCode, schedHalt, arrivingSecs, fv) {
  if (schedHalt <= 0) return 0
  let d = schedHalt * (1 + (fv.G3.bias[stnCode] ?? 0))
  d += legCongestion(arrivingSecs || [], fv) * 45
  return Math.max(30, d)
}

// Remaining time in the section the train is currently inside. Conditioned on
// instantaneous speed, not naive distance-fraction scaling: a train stopped at a
// signal has covered the distance but not the time.
function partialHopSec(train, secs, schedRunSec, fv) {
  const full = runTimeSec(train, secs, schedRunSec, fv)
  const remainingFrac = clamp(1 - fv.G1.frac, 0, 1)
  const sec = SECTIONS[secs?.[0]]
  const cruise = Math.min(CLASS_META[train.cls].cruiseKmph, sec ? sec.maxKmph : 100)
  const ratio = fv.G1.speedKmph / cruise

  // If a modelled queue wait already explains why the train is stopped, the queue
  // term carries that wait; applying the generic low-speed penalty as well would
  // double-count it. This is keyed to the queue itself (G4), not to whether a
  // restriction was declared (G5) — a speed restriction alone does not stop a
  // train, and tying it to G5 created a spurious interaction between the two
  // groups when explaining which factor caused a delay.
  const explained = (secs || []).some((id) => (fv.G4.queueDelay[id] ?? 0) > 0)
  const speedAdj = explained ? 1
    : ratio < 0.12 ? 2.2
    : clamp(1 / Math.max(ratio, 0.3), 0.85, 2.2)

  return full * remainingFrac * speedAdj + legQueueSec(secs, fv)
}

// --- forward composition --------------------------------------------------

/**
 * ETA at every station downstream of the train's current position.
 * curIdx is the index of the last stop passed; the train is inside the section
 * running from route[curIdx] to route[curIdx+1].
 */
export function composeETA(train, curIdx, fv, anchorSec) {
  const route = train.route
  const out = []
  let t = anchorSec

  for (let k = curIdx + 1; k < route.length; k++) {
    const secs = route[k].secs || []
    const schedRun = (route[k].schedArr ?? 0) - (route[k - 1].schedDep ?? route[k - 1].schedArr ?? 0)

    if (k === curIdx + 1) {
      t += partialHopSec(train, secs, Math.max(60, schedRun), fv)
    } else {
      t += dwellSec(train, route[k - 1].code, route[k - 1].halt, route[k - 1].secs, fv)
      t += runTimeSec(train, secs, Math.max(60, schedRun), fv) + legQueueSec(secs, fv)
    }
    out.push({ idx: k, code: route[k].code, eta: t })
  }
  return out
}

// Naive baseline the problem statement describes: scheduled arrival plus current delay.
export function baselineETA(train, curIdx, delaySec) {
  const out = []
  for (let k = curIdx + 1; k < train.route.length; k++) {
    out.push({ idx: k, code: train.route[k].code, eta: train.route[k].schedArr + delaySec })
  }
  return out
}

// --- conformal intervals --------------------------------------------------

export const HORIZON_BINS = [30 * 60, 90 * 60, 240 * 60, Infinity]

export function horizonBin(horizonSec) {
  for (let i = 0; i < HORIZON_BINS.length; i++) if (horizonSec <= HORIZON_BINS[i]) return i
  return HORIZON_BINS.length - 1
}

/**
 * Interval from the calibrated residual quantiles for this horizon bin.
 * Note it is applied to the aggregate ETA at each horizon, never assembled by
 * summing per-hop quantiles.
 */
export function applyInterval(etaSec, horizonSec, calib, level = 0.8) {
  const bin = horizonBin(horizonSec)
  const q = calib?.bins?.[bin]?.[String(level)]
  if (!q) return { lo: etaSec - 120, hi: etaSec + 180, level }
  return { lo: etaSec + q[0], hi: etaSec + q[1], level }
}

// --- exact delta attribution ---------------------------------------------

/**
 * A neutral feature vector: same position and moment in time, but no current
 * delay to recover from, average historical section/dwell behaviour, typical
 * congestion, no active restrictions, and typical weather.
 *
 * This is the "normal run" reference used to explain a live forecast even when
 * there is no previously published prediction to diff against — attribute() only
 * needs two feature vectors to compare, and this manufactures one that always
 * exists.
 */
export function neutralFeatures(train, fv) {
  const G4 = { congestion: {}, queueDelay: {}, headwaySec: fv.G4.headwaySec }
  for (const sid of Object.keys(fv.G4.congestion)) G4.congestion[sid] = typicalCongestion(sid)
  const G6 = {}
  for (const sid of Object.keys(fv.G6.bySection)) G6[sid] = { rainMm: TYPICAL_RAIN_MM, visibilityM: 8000 }

  // A stalled train's real speed (often 0, e.g. held behind a block) would trip the
  // "assume it is crawling" penalty in partialHopSec's neutral scenario, which G5
  // then appears to "fix" once the real restriction explains the stop — showing
  // restrictions as reducing the delay, backwards from what actually happened. A
  // neutral run assumes the train is moving at its normal cruising speed instead.
  const cruiseKmph = CLASS_META[train.cls]?.cruiseKmph ?? fv.G1.speedKmph

  return {
    G1: { ...fv.G1, delaySec: 0, speedKmph: cruiseKmph },
    G2: { bias: Object.fromEntries(Object.keys(fv.G2.bias).map((k) => [k, 0])) },
    G3: { bias: Object.fromEntries(Object.keys(fv.G3.bias).map((k) => [k, 0])) },
    G4,
    G5: { restrict: {} },
    G6: { bySection: G6 },
  }
}

/**
 * Why the live forecast differs from a normal run of the rest of the journey.
 * Always available — unlike attribute() called against a previous publication,
 * this needs nothing but the current prediction, so it works from the very first
 * forecast of the journey.
 */
export function explainVsSchedule(train, curIdx, fvNow, anchorSec, targetIdx) {
  return attribute(train, curIdx, neutralFeatures(train, fvNow), fvNow, anchorSec, targetIdx)
}

const FACT = [1, 1, 2, 6, 24, 120, 720]

/**
 * Shapley values of the six feature groups on the difference between two
 * predictions, both evaluated at the same anchor. Sum(phi) === full - base
 * exactly, by the efficiency axiom.
 */
export function attribute(train, curIdx, fvPrev, fvNow, anchorSec, targetIdx) {
  const n = GROUPS.length
  const memo = new Map()

  const gOf = (mask) => {
    if (memo.has(mask)) return memo.get(mask)
    const fv = {}
    for (let i = 0; i < n; i++) fv[GROUPS[i]] = (mask >> i) & 1 ? fvNow[GROUPS[i]] : fvPrev[GROUPS[i]]
    const etas = composeETA(train, curIdx, fv, anchorSec)
    const hit = etas.find((e) => e.idx === targetIdx) || etas[etas.length - 1]
    const v = hit ? hit.eta : anchorSec
    memo.set(mask, v)
    return v
  }

  const phi = {}
  for (let i = 0; i < n; i++) {
    const others = []
    for (let j = 0; j < n; j++) if (j !== i) others.push(j)
    let sum = 0
    for (let sub = 0; sub < 1 << (n - 1); sub++) {
      let mask = 0, size = 0
      for (let j = 0; j < n - 1; j++) if ((sub >> j) & 1) { mask |= 1 << others[j]; size++ }
      const w = (FACT[size] * FACT[n - size - 1]) / FACT[n]
      sum += w * (gOf(mask | (1 << i)) - gOf(mask))
    }
    phi[GROUPS[i]] = sum
  }

  const base = gOf(0)
  const full = gOf((1 << n) - 1)
  return { phi, base, full, net: full - base, evals: memo.size }
}
