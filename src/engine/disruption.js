// Live disruption picture: what is currently degrading the network, where, and how
// many minutes of delay each cause is actually responsible for.
//
// Delay attribution here is computed directly from the same coefficients the
// prediction model applies in sectionFactor(), not estimated separately — so if
// this says "weather is adding 4 minutes to this train", that is literally the
// weather term inside its forecast, not a parallel guess.

import { SECTIONS, STATIONS, LINE_LIST, fmtClock } from '../data/network.js'
import { weatherForSection, typicalCongestion, TYPICAL_RAIN_MM } from './core.js'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Run-time inflation a section's current weather adds, as a fraction. */
export function weatherFactor(w) {
  return clamp((w.rainMm - TYPICAL_RAIN_MM) * 0.006, -0.004, 0.10)
       + (w.visibilityM < 1500 ? 0.035 : 0)
}

/** Run-time inflation from congestion above what the timetable already absorbs. */
export function congestionFactor(secId, congestion) {
  return clamp(0.45 * ((congestion ?? 0) - typicalCongestion(secId)), -0.10, 0.55)
}

/** Run-time inflation from an imposed speed restriction. */
export function restrictionFactor(secId, restriction) {
  const sec = SECTIONS[secId]
  if (!sec || !restriction || restriction.blocked) return 0
  const imposed = Math.max(5, restriction.speedKmph ?? sec.maxKmph)
  return clamp(sec.maxKmph / imposed, 1, 3.2) - 1
}

export const WEATHER_SEVERITY = { NONE: 0, LIGHT: 1, HEAVY: 2 }

export function weatherSeverity(w) {
  if (w.visibilityM < 1500 || w.rainMm >= 7) return WEATHER_SEVERITY.HEAVY
  if (w.rainMm > TYPICAL_RAIN_MM + 1) return WEATHER_SEVERITY.LIGHT
  return WEATHER_SEVERITY.NONE
}

/**
 * How many seconds of delay each cause is adding to one train's remaining journey.
 * Walks only the legs still ahead of it, splitting each leg's scheduled run time
 * across its physical sections by distance.
 */
export function trainCauseSeconds(world, train) {
  const st = world.trains[train.id]
  const out = { block: 0, restriction: 0, weather: 0, congestion: 0 }
  if (!st || !st.started || st.done) return out

  const anchor = world.nowSec
  for (let k = st.curIdx + 1; k < train.route.length; k++) {
    const cur = train.route[k]
    const prev = train.route[k - 1]
    const secs = cur.secs || []
    if (!secs.length) continue

    const schedRun = Math.max(30, (cur.schedArr ?? 0) - (prev.schedDep ?? prev.schedArr ?? 0))
    const totalKm = secs.reduce((s, id) => s + (SECTIONS[id]?.km ?? 0), 0) || 1

    for (const sid of secs) {
      const share = schedRun * ((SECTIONS[sid]?.km ?? 0) / totalKm)

      // a held train's wait comes straight from the propagation simulator
      out.block += world.queueDelay[train.id]?.[sid] ?? 0

      const r = world.restrictions[sid]
      if (r && !r.blocked) out.restriction += share * restrictionFactor(sid, r)

      out.weather += share * weatherFactor(weatherForSection(sid, anchor))
      out.congestion += share * Math.max(0, congestionFactor(sid, world.congestion[sid]))
    }
  }
  return out
}

const CAUSE_META = {
  block:       { id: 'block',       label: 'Track blockages',    tone: 'danger' },
  restriction: { id: 'restriction', label: 'Speed restrictions', tone: 'caution' },
  weather:     { id: 'weather',     label: 'Weather',            tone: 'info' },
  congestion:  { id: 'congestion',  label: 'Congestion',         tone: 'caution' },
}
export const CAUSES = Object.values(CAUSE_META)

/**
 * The whole live disruption picture in one pass: totals per cause, a rollup per
 * line, the specific sections involved, and per-train breakdowns.
 */
export function buildDisruptionOverview(world) {
  const byCause = {
    block:       { ...CAUSE_META.block,       seconds: 0, trains: 0, sections: new Set(), lines: new Set() },
    restriction: { ...CAUSE_META.restriction, seconds: 0, trains: 0, sections: new Set(), lines: new Set() },
    weather:     { ...CAUSE_META.weather,     seconds: 0, trains: 0, sections: new Set(), lines: new Set() },
    congestion:  { ...CAUSE_META.congestion,  seconds: 0, trains: 0, sections: new Set(), lines: new Set() },
  }
  const byLine = {}
  const perTrain = new Map()

  for (const train of world.liveList) {
    const st = world.trains[train.id]
    if (!st || !st.started || st.done) continue

    const causes = trainCauseSeconds(world, train)
    const total = causes.block + causes.restriction + causes.weather + causes.congestion
    perTrain.set(train.id, { train, st, causes, total })

    for (const key of Object.keys(byCause)) {
      if (causes[key] < 30) continue          // ignore sub-half-minute noise
      byCause[key].seconds += causes[key]
      byCause[key].trains += 1
      byCause[key].lines.add(train.lineId)
    }

    const L = (byLine[train.lineId] ||= {
      lineId: train.lineId,
      name: LINE_LIST.find((l) => l.id === train.lineId)?.name ?? train.lineId,
      running: 0, delayedSec: 0, worstSec: 0, worstTrain: null,
      causes: { block: 0, restriction: 0, weather: 0, congestion: 0 },
    })
    L.running += 1
    L.delayedSec += Math.max(0, st.delaySec)
    for (const key of Object.keys(L.causes)) L.causes[key] += causes[key]
    if (st.delaySec > L.worstSec) { L.worstSec = st.delaySec; L.worstTrain = train }
  }

  // which sections each cause is actually present on
  for (const [sid, sec] of Object.entries(SECTIONS)) {
    const r = world.restrictions[sid]
    if (r?.blocked) { byCause.block.sections.add(sid); byCause.block.lines.add(sec.lineId) }
    else if (r) { byCause.restriction.sections.add(sid); byCause.restriction.lines.add(sec.lineId) }

    if (weatherSeverity(weatherForSection(sid, world.nowSec)) > WEATHER_SEVERITY.NONE) {
      byCause.weather.sections.add(sid); byCause.weather.lines.add(sec.lineId)
    }
    if (congestionFactor(sid, world.congestion[sid]) > 0.05) {
      byCause.congestion.sections.add(sid); byCause.congestion.lines.add(sec.lineId)
    }
  }

  const causeList = Object.values(byCause)
    .map((c) => ({ ...c, sections: [...c.sections], lines: [...c.lines] }))
    .sort((a, b) => b.seconds - a.seconds)

  const lineList = Object.values(byLine)
    .map((l) => ({ ...l, avgDelaySec: l.running ? l.delayedSec / l.running : 0 }))
    .sort((a, b) => b.avgDelaySec - a.avgDelaySec)

  return { causeList, lineList, perTrain, totalTrains: perTrain.size }
}

/** Sections currently carrying a given cause, richest-first, for the drill-down. */
export function sectionsForCause(world, causeId) {
  const rows = []
  for (const [sid, sec] of Object.entries(SECTIONS)) {
    const w = weatherForSection(sid, world.nowSec)
    const r = world.restrictions[sid]
    let detail = null, weight = 0

    let impact = null
    if (causeId === 'block' && r?.blocked) {
      const ev = world.events.find((e) => e.id === r.eventId)
      detail = `Blocked until ${fmtClock(r.endSec)}${ev?.note ? ` · ${ev.note}` : ''}`
      weight = 1000                    // sort sentinel only — never shown
      impact = 'closed'
    } else if (causeId === 'restriction' && r && !r.blocked) {
      detail = `Limited to ${r.speedKmph} km/h until ${fmtClock(r.endSec)} (normally ${sec.maxKmph})`
      weight = restrictionFactor(sid, r)
    } else if (causeId === 'weather') {
      const sev = weatherSeverity(w)
      if (sev === WEATHER_SEVERITY.NONE) continue
      detail = `${w.rainMm.toFixed(1)} mm/h rain, visibility ${(w.visibilityM / 1000).toFixed(1)} km`
        + (sev === WEATHER_SEVERITY.HEAVY ? ' — heavy' : '')
      weight = weatherFactor(w)
    } else if (causeId === 'congestion') {
      const f = congestionFactor(sid, world.congestion[sid])
      if (f <= 0.05) continue
      detail = `Running at ${Math.round((world.congestion[sid] ?? 0) * 100)}% of capacity`
      weight = f
    }

    if (!detail) continue
    rows.push({
      sectionId: sid,
      from: STATIONS[sec.from]?.name ?? sec.from,
      to: STATIONS[sec.to]?.name ?? sec.to,
      lineId: sec.lineId,
      lineName: LINE_LIST.find((l) => l.id === sec.lineId)?.name ?? sec.lineId,
      detail,
      weight,
      impact,
      pctSlower: impact === 'closed' ? null : Math.round(weight * 100),
    })
  }
  return rows.sort((a, b) => b.weight - a.weight)
}

/** Every disrupted section on one line, across all causes, worst first. */
export function disruptedSectionsOnLine(world, lineId) {
  const out = []
  for (const causeId of ['block', 'restriction', 'weather', 'congestion']) {
    for (const row of sectionsForCause(world, causeId)) {
      if (row.lineId !== lineId) continue
      out.push({ ...row, causeId })
    }
  }
  const rank = { block: 3, restriction: 2, congestion: 1, weather: 0 }
  return out.sort((a, b) => (rank[b.causeId] - rank[a.causeId]) || (b.weight - a.weight))
}
