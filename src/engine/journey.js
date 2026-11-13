// Journey planning: given a place to start and a place to reach, find the services
// that get you there and forecast each leg with the same engine the control room uses.
//
// This is the passenger-facing view of the prediction layer — it consumes ETAs,
// it never computes its own.

import { TRAINS, HUBS, MIN_INTERCHANGE_SEC, stopPos } from '../data/network.js'
import { horizonBin } from './predictor.js'

const MAX_DIRECT = 12
const MAX_CHANGE = 6
const SEARCH_WINDOW_SEC = 3 * 3600

/**
 * Probability the actual arrival lands at or before `deadline`, read off the
 * empirical residual distribution for this horizon.
 *
 * This is what makes a connection answerable as a probability: a five-minute
 * change behind a service whose interval is ±20 min is not the same bet as the
 * same five minutes behind one running to ±2.
 */
export function probArriveBy(etaSec, deadlineSec, horizonSec, calib) {
  const bin = calib?.bins?.[horizonBin(horizonSec)]
  const sample = bin?.sample
  if (!sample || !sample.length) return null
  const slack = deadlineSec - etaSec
  let hit = 0
  for (const r of sample) if (r <= slack) hit++
  return hit / sample.length
}

/** When this service is forecast to call at a given stop index. */
function callAt(world, train, pred, idx) {
  if (idx == null || idx < 0) return null
  const st = world.trains[train.id]
  const stop = train.route[idx]

  if (st && st.timeline[idx]?.arr != null && st.timeline[idx].arr <= world.nowSec) {
    return { time: st.timeline[idx].arr, lo: null, hi: null, actual: true, passed: true }
  }
  const e = pred?.etas.find((x) => x.idx === idx)
  if (e) return { time: e.eta, lo: e.lo, hi: e.hi, predicted: true, passed: false }

  const t = stop.schedDep ?? stop.schedArr
  return t == null ? null : { time: t, lo: null, hi: null, scheduled: true, passed: false }
}

function legFor(world, train, from, to) {
  const i = stopPos(train, from)
  const j = stopPos(train, to)
  if (i < 0 || j < 0 || i >= j) return null

  const st = world.trains[train.id]
  // no use offering a service that has already left the origin
  if (st?.started && st.curIdx >= i) return null

  const pred = world.predictions[train.id] ?? null
  const dep = callAt(world, train, pred, i)
  const arr = callAt(world, train, pred, j)
  if (!dep || !arr) return null
  if (dep.time < world.nowSec - 60) return null

  return {
    train, fromIdx: i, toIdx: j,
    fromCode: train.route[i].code, toCode: train.route[j].code,
    dep, arr,
    durationSec: arr.time - dep.time,
    live: !!(st && st.started && !st.done),
    delaySec: st?.delaySec ?? 0,
  }
}

/** Services running between two places without a change. */
export function findDirect(world, from, to) {
  const out = []
  for (const train of TRAINS) {
    if (train.schedDep > world.nowSec + SEARCH_WINDOW_SEC) continue
    if (train.schedArr < world.nowSec) continue
    const leg = legFor(world, train, from, to)
    if (leg) out.push(leg)
  }
  out.sort((a, b) => a.dep.time - b.dep.time)
  return out.slice(0, MAX_DIRECT)
}

/** One-change journeys via any interchange hub, scored for connection risk. */
export function findViaChange(world, from, to, calib) {
  const results = []

  for (const hub of Object.values(HUBS)) {
    const via = { key: hub.id, name: hub.name, codes: hub.codes, interchange: true }
    if (via.codes.some((c) => from.codes.includes(c) || to.codes.includes(c))) continue

    const first = [], second = []
    for (const train of TRAINS) {
      if (train.schedArr < world.nowSec) continue
      if (train.schedDep > world.nowSec + SEARCH_WINDOW_SEC) continue
      const a = legFor(world, train, from, via)
      if (a) first.push(a)
      const b = legFor(world, train, via, to)
      if (b) second.push(b)
    }
    if (!first.length || !second.length) continue

    first.sort((a, b) => a.arr.time - b.arr.time)
    second.sort((a, b) => a.dep.time - b.dep.time)

    for (const a of first.slice(0, 5)) {
      const ready = a.arr.time + MIN_INTERCHANGE_SEC
      const b = second.find((x) => x.dep.time >= ready && x.train.id !== a.train.id)
      if (!b) continue

      const horizon = Math.max(60, a.arr.time - world.nowSec)
      const p = probArriveBy(a.arr.time, b.dep.time - MIN_INTERCHANGE_SEC, horizon, calib)

      results.push({
        via, legs: [a, b],
        changeSec: b.dep.time - a.arr.time,
        connectionP: p,
        depTime: a.dep.time,
        arrTime: b.arr.time,
        durationSec: b.arr.time - a.dep.time,
      })
    }
  }

  results.sort((x, y) => x.arrTime - y.arrTime)
  const seen = new Set()
  const uniq = []
  for (const r of results) {
    if (seen.has(r.via.key)) continue
    seen.add(r.via.key)
    uniq.push(r)
  }
  return uniq.slice(0, MAX_CHANGE)
}

export function planJourney(world, from, to, calib) {
  if (!from || !to || from.key === to.key) return { direct: [], viaChange: [] }
  const direct = findDirect(world, from, to)
  // only bother routing through an interchange when direct options are thin
  const viaChange = direct.length >= 3 ? [] : findViaChange(world, from, to, calib)
  return { direct, viaChange }
}
