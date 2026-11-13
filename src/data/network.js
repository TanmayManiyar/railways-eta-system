// Mumbai division network configuration.
// Everything geography-specific lives here as data; the engine reads it generically.
//
// Three service categories share one prediction engine and one section graph:
//   RESERVED    mail / express / superfast coaching services
//   UNRESERVED  suburban EMU locals (Western, Central, Harbour, Trans-Harbour)
//   METRO       Mumbai Metro lines 1, 2A/7, 3

import { LINES, CATEGORIES, SERVICE_WINDOW, localDwell, HUBS, MIN_INTERCHANGE_SEC } from './lines.js'

export { CATEGORIES, HUBS, MIN_INTERCHANGE_SEC }

export const STATIONS = {
  CSMT: { code: 'CSMT', name: 'Mumbai CSMT',     lat: 18.9398, lon: 72.8355, platforms: 18, cat: 'terminal' },
  DR:   { code: 'DR',   name: 'Dadar',           lat: 19.0186, lon: 72.8442, platforms: 8,  cat: 'junction' },
  TNA:  { code: 'TNA',  name: 'Thane',           lat: 19.1860, lon: 72.9750, platforms: 10, cat: 'junction' },
  KYN:  { code: 'KYN',  name: 'Kalyan Jn',       lat: 19.2437, lon: 73.1355, platforms: 8,  cat: 'junction' },
  BUD:  { code: 'BUD',  name: 'Badlapur',        lat: 19.1553, lon: 73.2354, platforms: 3,  cat: 'halt' },
  KJT:  { code: 'KJT',  name: 'Karjat Jn',       lat: 18.9107, lon: 73.3235, platforms: 5,  cat: 'junction' },
  LNL:  { code: 'LNL',  name: 'Lonavala',        lat: 18.7546, lon: 73.4062, platforms: 4,  cat: 'crossing' },
  PUNE: { code: 'PUNE', name: 'Pune Jn',         lat: 18.5286, lon: 73.8744, platforms: 6,  cat: 'terminal' },

  MMCT: { code: 'MMCT', name: 'Mumbai Central',  lat: 18.9690, lon: 72.8205, platforms: 9,  cat: 'terminal' },
  BVI:  { code: 'BVI',  name: 'Borivali',        lat: 19.2288, lon: 72.8570, platforms: 9,  cat: 'junction' },
  VAPI: { code: 'VAPI', name: 'Vapi',            lat: 20.3719, lon: 72.9060, platforms: 4,  cat: 'crossing' },
  ST:   { code: 'ST',   name: 'Surat',           lat: 21.2049, lon: 72.8411, platforms: 4,  cat: 'junction' },
  BRC:  { code: 'BRC',  name: 'Vadodara Jn',     lat: 22.3072, lon: 73.1812, platforms: 7,  cat: 'junction' },
  ADI:  { code: 'ADI',  name: 'Ahmedabad Jn',    lat: 23.0225, lon: 72.5714, platforms: 12, cat: 'terminal' },

  LTT:  { code: 'LTT',  name: 'Lokmanya Tilak T',lat: 19.0685, lon: 72.8990, platforms: 6,  cat: 'terminal' },
  IGP:  { code: 'IGP',  name: 'Igatpuri',        lat: 19.6967, lon: 73.5626, platforms: 5,  cat: 'crossing' },
  NK:   { code: 'NK',   name: 'Nashik Road',     lat: 19.9475, lon: 73.8300, platforms: 4,  cat: 'junction' },
  MMR:  { code: 'MMR',  name: 'Manmad Jn',       lat: 20.2540, lon: 74.4390, platforms: 6,  cat: 'junction' },
  BSL:  { code: 'BSL',  name: 'Bhusaval Jn',     lat: 21.0430, lon: 75.7850, platforms: 8,  cat: 'terminal' },
}

// fold every suburban / metro station into the master list
for (const line of Object.values(LINES)) {
  for (const s of line.stops) {
    if (!STATIONS[s.code]) {
      STATIONS[s.code] = {
        code: s.code, name: s.name, lat: s.lat, lon: s.lon,
        platforms: line.category === 'METRO' ? 2 : 4,
        cat: 'halt', line: line.id,
      }
    }
  }
}

// Corridors: ordered stop lists with cumulative distance from the corridor origin.
export const CORRIDORS = {
  CR_PUNE: {
    id: 'CR_PUNE', name: 'CSMT — Pune', zone: 'CR',
    stops: [
      ['CSMT', 0], ['DR', 9], ['TNA', 34], ['KYN', 54],
      ['BUD', 69], ['KJT', 100], ['LNL', 128], ['PUNE', 192],
    ],
  },
  WR_ADI: {
    id: 'WR_ADI', name: 'Mumbai Central — Ahmedabad', zone: 'WR',
    stops: [
      ['MMCT', 0], ['BVI', 34], ['VAPI', 168],
      ['ST', 263], ['BRC', 392], ['ADI', 492],
    ],
  },
  CR_BSL: {
    id: 'CR_BSL', name: 'LTT — Bhusaval', zone: 'CR',
    stops: [
      ['LTT', 0], ['TNA', 16], ['KYN', 36], ['IGP', 120],
      ['NK', 166], ['MMR', 240], ['BSL', 368],
    ],
  },
}

export const sectionId = (a, b) => `${a}-${b}`

// Section attributes. Sections are shared across corridors where the track is shared —
// TNA-KYN carries both the Pune and the Bhusaval traffic, which is what makes
// congestion couple between corridors in the propagation simulator.
const SECTION_OVERRIDES = {
  'CSMT-DR':  { tracks: 4, maxKmph: 80,  signalling: 'auto',     density: 0.92 },
  'DR-TNA':   { tracks: 4, maxKmph: 90,  signalling: 'auto',     density: 0.88 },
  'TNA-KYN':  { tracks: 4, maxKmph: 95,  signalling: 'auto',     density: 0.94 },
  'KYN-BUD':  { tracks: 2, maxKmph: 100, signalling: 'auto',     density: 0.62 },
  'BUD-KJT':  { tracks: 2, maxKmph: 100, signalling: 'absolute', density: 0.55 },
  'KJT-LNL':  { tracks: 2, maxKmph: 45,  signalling: 'absolute', density: 0.71, ghat: true },
  'LNL-PUNE': { tracks: 2, maxKmph: 105, signalling: 'auto',     density: 0.48 },

  'MMCT-BVI': { tracks: 4, maxKmph: 95,  signalling: 'auto',     density: 0.90 },
  'BVI-VAPI': { tracks: 2, maxKmph: 130, signalling: 'auto',     density: 0.58 },
  'VAPI-ST':  { tracks: 2, maxKmph: 130, signalling: 'auto',     density: 0.52 },
  'ST-BRC':   { tracks: 2, maxKmph: 130, signalling: 'auto',     density: 0.55 },
  'BRC-ADI':  { tracks: 2, maxKmph: 130, signalling: 'auto',     density: 0.50 },

  'LTT-TNA':  { tracks: 4, maxKmph: 85,  signalling: 'auto',     density: 0.90 },
  'KYN-IGP':  { tracks: 2, maxKmph: 50,  signalling: 'absolute', density: 0.68, ghat: true },
  'IGP-NK':   { tracks: 2, maxKmph: 105, signalling: 'auto',     density: 0.45 },
  'NK-MMR':   { tracks: 2, maxKmph: 110, signalling: 'auto',     density: 0.42 },
  'MMR-BSL':  { tracks: 2, maxKmph: 110, signalling: 'auto',     density: 0.40 },
}

export const SECTIONS = (() => {
  const out = {}
  for (const corr of Object.values(CORRIDORS)) {
    for (let i = 0; i < corr.stops.length - 1; i++) {
      const [a, da] = corr.stops[i]
      const [b, db] = corr.stops[i + 1]
      const id = sectionId(a, b)
      if (out[id]) continue
      const ov = SECTION_OVERRIDES[id] || {}
      out[id] = {
        id, from: a, to: b, km: db - da,
        tracks: ov.tracks ?? 2,
        maxKmph: ov.maxKmph ?? 110,
        signalling: ov.signalling ?? 'auto',
        density: ov.density ?? 0.5,
        ghat: ov.ghat ?? false,
        headwaySec: (ov.signalling ?? 'auto') === 'auto' ? 300 : 600,
        lineId: corr.id, category: 'RESERVED',
      }
    }
  }
  // Suburban and metro run on their own physical tracks — in Mumbai the fast and
  // slow lines are genuinely separate — so these are distinct sections even where
  // they share a station name with a mail-line section.
  for (const line of Object.values(LINES)) {
    for (let i = 0; i < line.stops.length - 1; i++) {
      const a = line.stops[i], b = line.stops[i + 1]
      const km = +(b.km - a.km).toFixed(2)
      // up and down are physically separate tracks, so each direction is its own
      // section with its own occupancy
      for (const [x, y] of [[a, b], [b, a]]) {
        const id = sectionId(x.code, y.code)
        if (out[id]) continue
        out[id] = {
          id, from: x.code, to: y.code, km,
          tracks: 2, maxKmph: line.maxKmph, signalling: 'auto',
          density: line.density, ghat: false,
          headwaySec: line.headwaySec,
          lineId: line.id, category: line.category,
        }
      }
    }
  }
  return out
})()

export const CLASS_META = {
  RAJ:   { label: 'Rajdhani',   priority: 1, cruiseKmph: 108, dwellBase: 120 },
  SHT:   { label: 'Shatabdi',   priority: 1, cruiseKmph: 105, dwellBase: 120 },
  SF:    { label: 'Superfast',  priority: 2, cruiseKmph: 88,  dwellBase: 150 },
  EXP:   { label: 'Express',    priority: 3, cruiseKmph: 74,  dwellBase: 180 },
  PASS:  { label: 'Passenger',  priority: 4, cruiseKmph: 52,  dwellBase: 240 },
  LOC_F: { label: 'Fast local', priority: 4, cruiseKmph: 68,  dwellBase: 25 },
  LOC_S: { label: 'Slow local', priority: 5, cruiseKmph: 52,  dwellBase: 20 },
  MET:   { label: 'Metro',      priority: 1, cruiseKmph: 62,  dwellBase: 25 },
}

const hm = (h, m) => h * 3600 + m * 60

// ---------------------------------------------------------------------------
// Reserved coaching services
// ---------------------------------------------------------------------------

export const TRAIN_DEFS = [
  { no: '12123', name: 'Deccan Queen',        corridor: 'CR_PUNE', cls: 'SF',   dep: hm(12, 5),  skip: ['BUD'] },
  { no: '11007', name: 'Deccan Express',      corridor: 'CR_PUNE', cls: 'EXP',  dep: hm(12, 40), skip: [] },
  { no: '22105', name: 'Indrayani Express',   corridor: 'CR_PUNE', cls: 'SF',   dep: hm(13, 10), skip: ['BUD', 'LNL'] },
  { no: '51153', name: 'Karjat Passenger',    corridor: 'CR_PUNE', cls: 'PASS', dep: hm(12, 25), skip: [] },

  { no: '12009', name: 'Ahmedabad Shatabdi',  corridor: 'WR_ADI',  cls: 'SHT',  dep: hm(11, 50), skip: ['VAPI'] },
  { no: '12933', name: 'Karnavati Express',   corridor: 'WR_ADI',  cls: 'SF',   dep: hm(12, 30), skip: [] },
  { no: '19011', name: 'Gujarat Express',     corridor: 'WR_ADI',  cls: 'EXP',  dep: hm(11, 20), skip: [] },
  { no: '12951', name: 'Mumbai Rajdhani',     corridor: 'WR_ADI',  cls: 'RAJ',  dep: hm(13, 5),  skip: ['VAPI', 'BVI'] },

  { no: '12533', name: 'Pushpak Express',     corridor: 'CR_BSL',  cls: 'SF',   dep: hm(11, 35), skip: ['NK'] },
  { no: '12137', name: 'Punjab Mail',         corridor: 'CR_BSL',  cls: 'SF',   dep: hm(12, 15), skip: [] },
  { no: '11061', name: 'Pawan Express',       corridor: 'CR_BSL',  cls: 'EXP',  dep: hm(12, 55), skip: [] },
  { no: '12809', name: 'Mumbai Mail',         corridor: 'CR_BSL',  cls: 'SF',   dep: hm(13, 40), skip: ['NK'] },

  // Afternoon and evening wave, so the journey planner still has long-distance
  // options once the midday services have departed.
  { no: '12125', name: 'Pragati Express',     corridor: 'CR_PUNE', cls: 'SF',   dep: hm(14, 25), skip: ['BUD'] },
  { no: '11029', name: 'Koyna Express',       corridor: 'CR_PUNE', cls: 'EXP',  dep: hm(15, 10), skip: [] },
  { no: '12127', name: 'Intercity Express',   corridor: 'CR_PUNE', cls: 'SF',   dep: hm(16, 40), skip: ['BUD', 'LNL'] },
  { no: '51154', name: 'Pune Passenger',      corridor: 'CR_PUNE', cls: 'PASS', dep: hm(17, 55), skip: [] },

  { no: '12931', name: 'Ahmedabad Duronto',   corridor: 'WR_ADI',  cls: 'RAJ',  dep: hm(14, 15), skip: ['VAPI', 'BVI'] },
  { no: '19033', name: 'Gujarat Queen',       corridor: 'WR_ADI',  cls: 'EXP',  dep: hm(15, 30), skip: [] },
  { no: '12935', name: 'Surat Intercity',     corridor: 'WR_ADI',  cls: 'SF',   dep: hm(16, 50), skip: [] },
  { no: '22953', name: 'Gujarat Express SF',  corridor: 'WR_ADI',  cls: 'SF',   dep: hm(18, 20), skip: ['VAPI'] },

  { no: '12139', name: 'Sewagram Express',    corridor: 'CR_BSL',  cls: 'SF',   dep: hm(14, 50), skip: ['NK'] },
  { no: '11401', name: 'Nandigram Express',   corridor: 'CR_BSL',  cls: 'EXP',  dep: hm(16, 5),  skip: [] },
  { no: '12105', name: 'Vidarbha Express',    corridor: 'CR_BSL',  cls: 'SF',   dep: hm(17, 30), skip: [] },
  { no: '11009', name: 'Sinhagad Express',    corridor: 'CR_PUNE', cls: 'EXP',  dep: hm(18, 45), skip: [] },
]

export function buildSchedule(def) {
  const corr = CORRIDORS[def.corridor]
  const all = corr.stops
  const stops = all.filter(([c]) => !def.skip.includes(c))
  const meta = CLASS_META[def.cls]
  const idxOf = (code) => all.findIndex(([c]) => c === code)
  const route = []
  let t = def.dep

  for (let i = 0; i < stops.length; i++) {
    const [code, dist] = stops[i]
    if (i === 0) {
      route.push({ code, km: dist, schedArr: null, schedDep: t, halt: 0, secs: [] })
      continue
    }
    const prev = stops[i - 1]

    // A leg between two booked stops may span several physical sections when the
    // service skips intermediate halts. Running time is the sum over those sections,
    // and the leg inherits every one of them for congestion and restriction purposes.
    const a = idxOf(prev[0]), b = idxOf(code)
    const secs = []
    for (let j = a; j < b; j++) secs.push(sectionId(all[j][0], all[j + 1][0]))

    let runSec = 0
    for (const sid of secs) {
      const sec = SECTIONS[sid]
      let eff = Math.min(meta.cruiseKmph, sec ? sec.maxKmph : meta.cruiseKmph)
      if (sec?.ghat) eff *= 0.78
      // Timetables carry in-built recovery time, but less than a service typically
      // loses: over a long run delay accumulates, which is the cascade the problem
      // statement describes. Padding sits just under the mean running factor.
      runSec += ((sec ? sec.km : dist - prev[1]) / eff) * 3600 * 1.12
    }
    runSec = Math.round(runSec)
    t += runSec

    const isLast = i === stops.length - 1
    const halt = isLast ? 0 : Math.round(meta.dwellBase * (STATIONS[code].cat === 'junction' ? 1.4 : 1))
    route.push({ code, km: dist, schedArr: t, schedDep: isLast ? null : t + halt, halt, secs })
    t += halt
  }
  return route
}

// ---------------------------------------------------------------------------
// Suburban and metro services
//
// A full service day is thousands of trains, so each service stores only its
// departure time and a template id. The stop list is materialised on first access,
// and only for services the engine actually touches.
// ---------------------------------------------------------------------------

const TEMPLATES = {}
/** Stop lists by template key — lets the journey index avoid materialising routes. */
export const TEMPLATE_STOPS = {}

function buildTemplate(line, svc, reversed) {
  const key = `${line.id}|${svc.code}|${reversed ? 'UP' : 'DN'}`
  if (TEMPLATES[key]) return key

  const ordered = reversed ? [...line.stops].reverse() : line.stops
  const total = line.stops[line.stops.length - 1].km
  const calls = svc.fast && line.fastStops
    ? ordered.filter((s) => line.fastStops.includes(s.code))
    : ordered

  const cls = line.category === 'METRO' ? 'MET' : svc.fast ? 'LOC_F' : 'LOC_S'
  const effShare = line.category === 'METRO' ? 0.82 : svc.fast ? 0.85 : 0.75
  const eff = line.maxKmph * effShare
  const dwell = localDwell(line.id, !!svc.fast)

  const idxOf = (code) => ordered.findIndex((s) => s.code === code)
  const stops = []
  let t = 0

  for (let i = 0; i < calls.length; i++) {
    const s = calls[i]
    const km = reversed ? +(total - s.km).toFixed(2) : s.km
    if (i === 0) {
      stops.push({ code: s.code, km, arrOff: null, depOff: 0, halt: 0, secs: [] })
      continue
    }
    const a = idxOf(calls[i - 1].code), b = idxOf(s.code)
    const secs = []
    for (let j = a; j < b; j++) secs.push(sectionId(ordered[j].code, ordered[j + 1].code))

    let runSec = 0
    for (const sid of secs) {
      const sec = SECTIONS[sid]
      const segKm = sec ? sec.km : Math.abs(s.km - calls[i - 1].km)
      // accel / decel penalty dominates on short suburban hops
      runSec += (segKm / eff) * 3600 + 40
    }
    runSec = Math.round(runSec * 1.08)
    t += runSec

    const isLast = i === calls.length - 1
    stops.push({
      code: s.code, km,
      arrOff: t, depOff: isLast ? null : t + dwell,
      halt: isLast ? 0 : dwell, secs,
    })
    if (!isLast) t += dwell
  }

  TEMPLATES[key] = { key, stops, cls, lineId: line.id, reversed }
  TEMPLATE_STOPS[key] = stops
  return key
}

let localSeq = 0
const LINE_NUM_BASE = {
  WR_LOCAL: 90000, CR_LOCAL: 95000, HR_LOCAL: 97000, TH_LOCAL: 98000,
  HRG_LOCAL: 96000, PG_LOCAL: 99000,
}

function makeLocalServices() {
  const out = []
  for (const line of Object.values(LINES)) {
    let svcIdx = -1
    for (const svc of line.services) {
      svcIdx++
      for (const reversed of [false, true]) {
        const tplKey = buildTemplate(line, svc, reversed)
        const tpl = TEMPLATES[tplKey]
        const origin = tpl.stops[0].code
        const dest = tpl.stops[tpl.stops.length - 1].code
        const headway = svc.headwayMin * 60
        const isMetro = line.category === 'METRO'
        // offset the reverse direction so both do not depart on the same minute
        let dep = SERVICE_WINDOW.startSec + (reversed ? Math.round(headway / 2) : 0)
        let n = 0
        while (dep <= SERVICE_WINDOW.endSec) {
          n++
          const no = isMetro
            ? `${line.id.replace('METRO_', 'M')}-${reversed ? 'U' : 'D'}${String(n).padStart(3, '0')}`
            : String((LINE_NUM_BASE[line.id] ?? 80000) + svcIdx * 500 + n * 2 + (reversed ? 1 : 0))
          out.push({
            id: `L${++localSeq}`,
            no,
            name: `${STATIONS[origin].name} — ${STATIONS[dest].name} ${svc.label}`,
            tplKey,
            depSec: dep,
            category: line.category,
            lineId: line.id,
            lineName: line.name,
            lineShort: line.short,
            serviceLabel: svc.label,
            cls: tpl.cls,
            priority: CLASS_META[tpl.cls].priority,
            direction: reversed ? 'UP' : 'DN',
            origin, dest,
          })
          dep += headway
        }
      }
    }
  }
  return out
}

/** Attach a lazily-materialised `route` to a service record. */
function withLazyRoute(svc) {
  const tpl = TEMPLATES[svc.tplKey]
  let cached = null
  Object.defineProperty(svc, 'route', {
    enumerable: false,
    configurable: true,
    get() {
      if (cached) return cached
      cached = tpl.stops.map((s) => ({
        code: s.code, km: s.km, halt: s.halt, secs: s.secs,
        schedArr: s.arrOff == null ? null : svc.depSec + s.arrOff,
        schedDep: s.depOff == null ? null : svc.depSec + s.depOff,
      }))
      return cached
    },
  })
  const last = tpl.stops[tpl.stops.length - 1]
  svc.schedDep = svc.depSec
  svc.schedArr = svc.depSec + last.arrOff
  svc.corridor = svc.lineId
  svc.corridorName = svc.lineName
  svc.stopCount = tpl.stops.length
  return svc
}

// ---------------------------------------------------------------------------
// Unified fleet
// ---------------------------------------------------------------------------

const RESERVED_TRAINS = TRAIN_DEFS.map((d) => {
  const route = buildSchedule(d)
  return {
    id: d.no, no: d.no, name: d.name,
    category: 'RESERVED',
    corridor: d.corridor,
    corridorName: CORRIDORS[d.corridor].name,
    lineId: d.corridor,
    lineName: CORRIDORS[d.corridor].name,
    lineShort: CORRIDORS[d.corridor].name,
    serviceLabel: CLASS_META[d.cls].label,
    cls: d.cls,
    priority: CLASS_META[d.cls].priority,
    direction: 'DN',
    route,
    stopCount: route.length,
    origin: route[0].code,
    dest: route[route.length - 1].code,
    schedDep: route[0].schedDep,
    schedArr: route[route.length - 1].schedArr,
  }
})

const LOCAL_TRAINS = makeLocalServices().map(withLazyRoute)

export const TRAINS = [...RESERVED_TRAINS, ...LOCAL_TRAINS]
export const RESERVED = RESERVED_TRAINS
export const LOCALS = LOCAL_TRAINS
export const TRAIN_BY_ID = Object.fromEntries(TRAINS.map((t) => [t.id, t]))

export const LINE_LIST = [
  ...Object.values(CORRIDORS).map((c) => ({ id: c.id, name: c.name, category: 'RESERVED' })),
  ...Object.values(LINES).map((l) => ({ id: l.id, name: l.name, category: l.category })),
]

export function routeSections(train) {
  return train.route.flatMap((s) => s.secs || [])
}

/** Physical sections still ahead of a train sitting at / just past stop index curIdx. */
export function sectionsAhead(train, curIdx) {
  const out = []
  for (let k = curIdx + 1; k < train.route.length; k++) out.push(...(train.route[k].secs || []))
  return out
}

export const ALL_SECTION_IDS = Object.keys(SECTIONS)

export function fmtClock(sec) {
  if (sec == null || !isFinite(sec)) return '--:--'
  const s = ((sec % 86400) + 86400) % 86400
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function fmtDelta(sec) {
  const m = Math.round(sec / 60)
  if (m === 0) return 'on time'
  return m > 0 ? `+${m}m` : `${m}m`
}

export function fmtMin(sec) {
  const m = sec / 60
  return (m >= 0 ? '+' : '') + m.toFixed(1) + 'm'
}

/** Lower-cased text blob for the search index: number, name, line, every station. */
const BLOB_CACHE = new Map()
export function searchBlob(train) {
  let b = BLOB_CACHE.get(train.id)
  if (b) return b
  const stops = train.route.map((s) => `${s.code} ${STATIONS[s.code]?.name ?? ''}`).join(' ')
  b = `${train.no} ${train.name} ${train.lineName} ${train.serviceLabel} ${train.cls} ${train.origin} ${train.dest} ${stops}`.toLowerCase()
  BLOB_CACHE.set(train.id, b)
  return b
}

// ---------------------------------------------------------------------------
// Interchange hubs and stop lookup
// ---------------------------------------------------------------------------

/** station code -> hub id, for codes that belong to a multi-line interchange */
export const HUB_OF = (() => {
  const m = {}
  for (const h of Object.values(HUBS)) for (const c of h.codes) m[c] = h.id
  return m
})()

/** Every code that shares a physical station with this one (including itself). */
export function codesAt(code) {
  const hub = HUB_OF[code]
  return hub ? HUBS[hub].codes.filter((c) => STATIONS[c]) : [code]
}

/** Display name for a place, preferring the hub name at an interchange. */
export function placeName(code) {
  const hub = HUB_OF[code]
  return hub ? HUBS[hub].name : (STATIONS[code]?.name ?? code)
}

/**
 * A single entry per physical place, for journey pickers. Interchanges collapse
 * to one row; everything else keeps its own code.
 */
export const PLACES = (() => {
  const seen = new Set()
  const out = []
  for (const st of Object.values(STATIONS)) {
    const hub = HUB_OF[st.code]
    const key = hub || st.code
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      key,
      code: st.code,
      name: hub ? HUBS[hub].name : st.name,
      codes: hub ? HUBS[hub].codes.filter((c) => STATIONS[c]) : [st.code],
      interchange: !!hub,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
})()

export const PLACE_BY_KEY = Object.fromEntries(PLACES.map((p) => [p.key, p]))

/**
 * code -> stop position for a service, cached per template so building the index
 * never materialises 3,000 route arrays.
 */
const STOP_IDX_CACHE = new Map()
export function stopIndexMap(train) {
  const key = train.tplKey || `R:${train.id}`
  let m = STOP_IDX_CACHE.get(key)
  if (m) return m
  m = {}
  if (train.tplKey) {
    const stops = TEMPLATE_STOPS[train.tplKey]
    stops.forEach((s, i) => { if (!(s.code in m)) m[s.code] = i })
  } else {
    train.route.forEach((s, i) => { if (!(s.code in m)) m[s.code] = i })
  }
  STOP_IDX_CACHE.set(key, m)
  return m
}

/** Position of a place on a service, or -1. Matches any code at that hub. */
export function stopPos(train, place) {
  const m = stopIndexMap(train)
  for (const c of place.codes) if (c in m) return m[c]
  return -1
}
