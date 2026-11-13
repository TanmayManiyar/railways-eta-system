// Offline calibration and evaluation, run once at app start.
//
// Produces: conformal residual quantiles (which become the prediction intervals),
// model-vs-baseline error metrics, a reliability curve, error by horizon, and error
// by operating condition. Everything on the Model Performance screen is computed
// here from simulated held-out journeys — none of it is hardcoded.

import { TRAINS, RESERVED, LOCALS, SECTIONS, sectionId, CLASS_META } from '../data/network.js'

// Calibrating against all ~3,000 daily services would materialise every route.
// A representative subset — every reserved service plus a regular sample of locals
// and metro across all lines and directions — gives the same residual distribution.
const CAL_FLEET = [...RESERVED, ...LOCALS.filter((_, i) => i % 11 === 0)]
import {
  mulberry32, gauss, sectionPrior, dwellPrior, recoveryPrior, recoverySec,
  weatherForSection, typicalCongestion, TYPICAL_RAIN_MM, TYPICAL_LOSS,
} from './core.js'
import { composeETA, HORIZON_BINS, horizonBin } from './predictor.js'

const LEVELS = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95]
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function quantile(sorted, p) {
  if (!sorted.length) return 0
  const i = clamp((sorted.length - 1) * p, 0, sorted.length - 1)
  const lo = Math.floor(i), hi = Math.ceil(i)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

// A synthetic operating scenario: congestion, weather offset, maybe a restriction.
function makeScenario(rnd, train, curIdx) {
  const congestion = {}, restrictions = {}
  let disrupted = false, congested = false

  for (let k = curIdx + 1; k < train.route.length; k++) {
    for (const sid of train.route[k].secs || []) {
      const sec = SECTIONS[sid]
      const base = (sec?.density ?? 0.5) * (0.05 + rnd() * 0.5)
      congestion[sid] = clamp(base, 0, 1)
      if (congestion[sid] > 0.62) congested = true
      if (rnd() < 0.03) {
        restrictions[sid] = { blocked: false, speedKmph: 25 + Math.floor(rnd() * 40), severity: 'MAJOR' }
        disrupted = true
      }
    }
  }
  return { congestion, restrictions, disrupted, congested }
}

function buildFv(train, curIdx, state, scen, anchor) {
  const G2 = {}, G3 = {}, G6 = {}
  const G4 = { congestion: scen.congestion, queueDelay: {}, headwaySec: 1800 }
  for (let k = curIdx; k < train.route.length; k++) {
    G3[train.route[k].code] = dwellPrior(train.route[k].code, train.cls, anchor)
    for (const sid of train.route[k].secs || []) {
      G2[sid] = sectionPrior(sid, train.cls, anchor)
      G6[sid] = weatherForSection(sid, anchor)
    }
  }
  return {
    G1: { delaySec: state.delaySec, speedKmph: state.speedKmph, frac: state.frac, dataAgeSec: 30 },
    G2: { bias: G2 }, G3: { bias: G3 }, G4,
    G5: { restrict: scen.restrictions }, G6: { bySection: G6 },
  }
}

// Truth generator — mirrors world.js but standalone, and carries the same latent
// term the model cannot see.
function truthDestArrival(train, curIdx, state, scen, anchor, rnd) {
  let t = anchor
  for (let k = curIdx + 1; k < train.route.length; k++) {
    const prev = train.route[k - 1], cur = train.route[k]
    const secs = cur.secs || []
    const schedRun = Math.max(60, (cur.schedArr ?? 0) - (prev.schedDep ?? prev.schedArr ?? 0))

    if (k > curIdx + 1) {
      let d = prev.halt * (1 + dwellPrior(prev.code, train.cls, t) * 1.1)
      let cg = 0
      for (const s of prev.secs || []) cg = Math.max(cg, scen.congestion[s] ?? 0)
      d += cg * 52
      d *= 1 + gauss(rnd) * 0.1
      t += Math.max(prev.halt > 0 ? 30 : 0, d)
    }

    const totalKm = secs.reduce((s, id) => s + (SECTIONS[id]?.km ?? 0), 0) || 1
    let f = 0, rec = 0
    for (const sid of secs) {
      const sec = SECTIONS[sid]
      const wk = (sec?.km ?? 0) / totalKm
      let g = TYPICAL_LOSS
      g *= 1 + sectionPrior(sid, train.cls, t) * 1.05
      g *= 1 + clamp(0.50 * ((scen.congestion[sid] ?? 0) - typicalCongestion(sid)), -0.10, 0.62)
      const r = scen.restrictions[sid]
      if (r && sec) g *= clamp(sec.maxKmph / Math.max(5, r.speedKmph), 1, 3.4)
      const w = weatherForSection(sid, t)
      g *= 1 + clamp((w.rainMm - TYPICAL_RAIN_MM) * 0.007, -0.004, 0.13)
             + (w.visibilityM < 1500 ? 0.05 : 0)
      f += wk * g
      rec += wk * recoveryPrior(sid, train.cls)
    }
    f *= 1 + gauss(rnd) * 0.055
    if (rnd() < 0.025) f *= 1 + rnd() * 0.32

    let run = schedRun * f
    const late = Math.max(0, state.delaySec)
    if (late > 0) run -= recoverySec(late, schedRun, rec)

    if (k === curIdx + 1) {
      const remainingFrac = clamp(1 - state.frac, 0, 1)
      const sec0 = SECTIONS[secs[0]]
      const cruise = Math.min(CLASS_META[train.cls].cruiseKmph, sec0 ? sec0.maxKmph : 100)
      const ratio = state.speedKmph / cruise
      const explained = secs.some((id) => scen.restrictions[id]?.blocked)
      const speedAdj = explained ? 1
        : ratio < 0.12 ? 2.2
        : clamp(1 / Math.max(ratio, 0.3), 0.85, 2.2)
      t += Math.max(schedRun * 0.7, run) * remainingFrac * speedAdj
    } else {
      t += Math.max(schedRun * 0.7, run)
    }
  }
  return t
}

function sample(rnd) {
  const train = CAL_FLEET[Math.floor(rnd() * CAL_FLEET.length)]
  const curIdx = Math.floor(rnd() * Math.max(1, train.route.length - 2))
  const frac = rnd() * 0.95
  const delaySec = Math.round((rnd() * 2 - 0.6) * 900)
  const speedKmph = rnd() < 0.08 ? 0 : Math.round(35 + rnd() * 65)
  const state = { delaySec, speedKmph, frac }
  const scen = makeScenario(rnd, train, curIdx)
  const anchor = (train.route[curIdx].schedDep ?? train.route[curIdx].schedArr ?? 0) + delaySec

  const fv = buildFv(train, curIdx, state, scen, anchor)
  const etas = composeETA(train, curIdx, fv, anchor)
  const pred = etas[etas.length - 1]?.eta
  if (pred == null) return null

  const truth = truthDestArrival(train, curIdx, state, scen, anchor, rnd)
  const baseline = train.route[train.route.length - 1].schedArr + delaySec
  const horizon = pred - anchor

  return {
    train: train.id, corridor: train.corridor, category: train.category,
    horizon, residual: truth - pred,
    baselineResidual: truth - baseline,
    disrupted: scen.disrupted, congested: scen.congested,
    rain: (fv.G6.bySection[Object.keys(fv.G6.bySection)[0]]?.rainMm ?? 0) > 4,
  }
}

export function calibrate(nCal = 2600, nTest = 2600) {
  const rnd = mulberry32(20260825)

  const cal = []
  while (cal.length < nCal) { const s = sample(rnd); if (s) cal.push(s) }

  // residual quantiles per horizon bin per coverage level
  const bins = HORIZON_BINS.map(() => ({}))
  for (let b = 0; b < HORIZON_BINS.length; b++) {
    const rs = cal.filter((s) => horizonBin(s.horizon) === b).map((s) => s.residual).sort((a, x) => a - x)
    for (const lv of LEVELS) {
      const a = (1 - lv) / 2
      bins[b][String(lv)] = rs.length
        ? [quantile(rs, a), quantile(rs, 1 - a)]
        : [-120, 180]
    }
    // Keep a downsampled residual sample per bin. It is the empirical error
    // distribution, which is what makes "will I make this connection?" answerable
    // as a probability rather than a guess.
    const stride = Math.max(1, Math.floor(rs.length / 240))
    bins[b].sample = rs.filter((_, i) => i % stride === 0)
  }
  const calib = { bins, levels: LEVELS, nCal }

  // held-out evaluation
  const test = []
  while (test.length < nTest) { const s = sample(rnd); if (s) test.push(s) }

  const abs = (a) => Math.abs(a)
  const mae = (arr, f) => arr.reduce((s, x) => s + abs(f(x)), 0) / Math.max(1, arr.length) / 60
  const rmse = (arr, f) => Math.sqrt(arr.reduce((s, x) => s + f(x) ** 2, 0) / Math.max(1, arr.length)) / 60
  const pct = (arr, f, p) => {
    const s = arr.map((x) => abs(f(x))).sort((a, b) => a - b)
    return quantile(s, p) / 60
  }
  const med = (arr, f) => pct(arr, f, 0.5)

  const R = (x) => x.residual
  const B = (x) => x.baselineResidual

  const headline = {
    model:    { mae: mae(test, R), rmse: rmse(test, R), med: med(test, R), p90: pct(test, R, 0.9), p95: pct(test, R, 0.95) },
    baseline: { mae: mae(test, B), rmse: rmse(test, B), med: med(test, B), p90: pct(test, B, 0.9), p95: pct(test, B, 0.95) },
    n: test.length,
  }
  headline.improvement = (1 - headline.model.mae / headline.baseline.mae) * 100

  // reliability: realised coverage at each nominal level
  const reliability = LEVELS.map((lv) => {
    let hit = 0
    for (const s of test) {
      const q = bins[horizonBin(s.horizon)][String(lv)]
      if (s.residual >= q[0] && s.residual <= q[1]) hit++
    }
    return { nominal: lv * 100, realised: (hit / test.length) * 100 }
  })

  // error by horizon bin
  const binLabels = ['0–30 min', '30–90 min', '90–240 min', '240 min +']
  const byHorizon = HORIZON_BINS.map((_, b) => {
    const g = test.filter((s) => horizonBin(s.horizon) === b)
    return { bin: binLabels[b], n: g.length, model: mae(g, R), baseline: mae(g, B) }
  }).filter((r) => r.n > 20)

  // error by operating condition
  const cond = [
    ['Clear',      (s) => !s.disrupted && !s.congested && !s.rain],
    ['Congested',  (s) => s.congested && !s.disrupted],
    ['Rain',       (s) => s.rain && !s.disrupted],
    ['Disrupted',  (s) => s.disrupted],
  ]
  const byCondition = cond.map(([label, f]) => {
    const g = test.filter(f)
    return { cond: label, n: g.length, model: mae(g, R), baseline: mae(g, B) }
  }).filter((r) => r.n > 20)

  // error by corridor
  const corrNames = {
    CR_PUNE: 'CSMT — Pune', WR_ADI: 'MMCT — Ahmedabad', CR_BSL: 'LTT — Bhusaval',
    WR_LOCAL: 'Western Line', CR_LOCAL: 'Central Line', HR_LOCAL: 'Harbour Line',
    TH_LOCAL: 'Trans-Harbour', METRO_1: 'Metro 1', METRO_2A7: 'Metro 2A/7', METRO_3: 'Metro 3',
  }
  const byCorridor = Object.keys(corrNames).map((c) => {
    const g = test.filter((s) => s.corridor === c)
    return { corridor: corrNames[c], n: g.length, model: mae(g, R), baseline: mae(g, B) }
  }).filter((r) => r.n > 20)

  const catNames = { RESERVED: 'Reserved', UNRESERVED: 'Unreserved', METRO: 'Metro' }
  const byCategory = Object.keys(catNames).map((c) => {
    const g = test.filter((s) => s.category === c)
    return { category: catNames[c], n: g.length, model: mae(g, R), baseline: mae(g, B) }
  }).filter((r) => r.n > 20)

  return { calib, headline, reliability, byHorizon, byCondition, byCorridor, byCategory }
}
