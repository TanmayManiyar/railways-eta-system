// Seeded randomness, learned priors, and weather. Deterministic across reloads so the
// demo tells the same story twice.

import { SECTIONS, STATIONS, CLASS_META } from '../data/network.js'

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

// Standard normal via Box-Muller, from a uniform generator.
export function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), v = rnd()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// ---------------------------------------------------------------------------
// G2 / G3 — historical priors.
// These stand in for what a nightly job would compute from the RunEvent table:
// a multiplicative bias per (section x class x hour-bucket) and per (station x class).
// ---------------------------------------------------------------------------

const HOUR_BUCKET = (sec) => Math.floor((((sec % 86400) + 86400) % 86400) / 3600)

// Peak-hour path contention approaching the terminals.
function peakFactor(hour) {
  if (hour >= 8 && hour <= 11) return 1.0
  if (hour >= 17 && hour <= 21) return 1.0
  if (hour >= 12 && hour <= 16) return 0.45
  return 0.15
}

/**
 * Typical congestion for a section — what the timetable was written to absorb.
 * Predictions respond to the DEVIATION from this, not to the absolute level,
 * because the scheduled running time already prices the typical day in.
 */
export function typicalCongestion(secId) {
  const sec = SECTIONS[secId]
  return sec ? sec.density * 0.25 : 0.12
}

/**
 * What a service typically loses against its booked running time on a normal day.
 * Timetables are written optimistically and delay accumulates over a long run —
 * the cascade the problem statement describes. Applied to the model and the ground
 * truth alike, so it shifts realised delay without biasing the prediction.
 */
export const TYPICAL_LOSS = 1.06

/** Typical rainfall the timetable absorbs, in mm/h. */
export const TYPICAL_RAIN_MM = 3.0

export function sectionPrior(secId, cls, atSec) {
  const sec = SECTIONS[secId]
  if (!sec) return 0
  const hour = HOUR_BUCKET(atSec)
  const rnd = mulberry32(hashStr(secId + cls + hour))
  // Mean-zero learned bias for this section, plus a peak-hour term centred on the
  // midday baseline. Ghat gradient is already in the schedule via the speed profile,
  // so it does not reappear here.
  const base = (rnd() - 0.5) * 0.09
  const peak = sec.density * (peakFactor(hour) - 0.45) * 0.10
  return base + peak
}

export function dwellPrior(stnCode, cls, atSec) {
  const st = STATIONS[stnCode]
  if (!st) return 0
  const hour = HOUR_BUCKET(atSec)
  const rnd = mulberry32(hashStr('D' + stnCode + cls + hour))
  const base = (rnd() - 0.45) * 0.22
  const junction = st.cat === 'junction' ? 0.18 : 0
  return base + junction
}

// How much delay this service historically recovers per section — the "in-built
// recovery" the problem statement mentions, but learned rather than tabulated.
export function recoveryPrior(secId, cls) {
  const sec = SECTIONS[secId]
  if (!sec) return 0
  // Fraction of a leg's own running time that a late service can claw back from
  // the padding built into the timetable. Higher-priority services get the path.
  return (CLASS_META[cls]?.priority ?? 4) <= 2 ? 0.06 : 0.04
}

/** Cap on recovery per leg: bounded by both the delay held and the leg's slack. */
export function recoverySec(late, schedRunSec, recFrac) {
  return Math.max(0, Math.min(late * 0.10, schedRunSec * recFrac))
}

// ---------------------------------------------------------------------------
// G6 — weather. A synthetic monsoon day over the Mumbai grid, standing in for the
// Open-Meteo archive. Rain concentrates on the coastal sections.
// ---------------------------------------------------------------------------

export function weatherAt(atSec, lat) {
  const hour = HOUR_BUCKET(atSec)
  const rnd = mulberry32(hashStr('W' + hour + Math.round(lat * 4)))
  const coastal = Math.max(0, 1 - Math.abs(lat - 19.1) / 3.2)
  const diurnal = 0.35 + 0.65 * Math.max(0, Math.sin(((hour - 6) / 24) * Math.PI * 2))
  const rainMm = Math.max(0, (rnd() * 14 - 3.2) * coastal * diurnal)
  const visibilityM = rainMm > 6 ? 900 + rnd() * 800 : 4000 + rnd() * 6000
  return {
    rainMm: +rainMm.toFixed(1),
    visibilityM: Math.round(visibilityM),
    isMonsoon: true,
    hour,
    dow: 4,
  }
}

export function weatherForSection(secId, atSec) {
  const sec = SECTIONS[secId]
  const lat = sec ? (STATIONS[sec.from].lat + STATIONS[sec.to].lat) / 2 : 19.1
  return weatherAt(atSec, lat)
}
