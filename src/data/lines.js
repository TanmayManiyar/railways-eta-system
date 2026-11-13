// Mumbai suburban and metro networks.
//
// Three service categories share one prediction engine:
//   RESERVED    mail / express / superfast coaching services  (network.js)
//   UNRESERVED  suburban EMU locals — Western, Central, Harbour, Trans-Harbour
//   METRO       Mumbai Metro lines 1, 2A, 7, 3
//
// Suburban and metro run on their own physical corridors. In Mumbai the fast and
// slow lines are genuinely separate tracks, so a local sharing a station name with
// a mail service does not share its section — which is exactly how the congestion
// model should treat them.

export const CATEGORIES = {
  RESERVED:   { id: 'RESERVED',   label: 'Reserved',   hint: 'Mail, express and superfast coaching services' },
  UNRESERVED: { id: 'UNRESERVED', label: 'Unreserved', hint: 'Suburban EMU locals' },
  METRO:      { id: 'METRO',      label: 'Metro',      hint: 'Mumbai Metro' },
}

// [code, name, cumulative km from line origin]
const WESTERN = [
  ['CCG', 'Churchgate', 0], ['MRNL', 'Marine Lines', 1.3], ['CYR', 'Charni Road', 2.3],
  ['GTR', 'Grant Road', 3.5], ['BCT', 'Mumbai Central (local)', 4.6], ['MX', 'Mahalaxmi', 5.8],
  ['LPR', 'Lower Parel', 7.2], ['PBHD', 'Prabhadevi', 8.0], ['DDR', 'Dadar West', 9.0],
  ['MRU', 'Matunga Road', 10.5], ['MM', 'Mahim Jn', 11.7], ['BA', 'Bandra', 13.6],
  ['KHAR', 'Khar Road', 15.0], ['STC', 'Santacruz', 16.3], ['VLP', 'Vile Parle', 18.0],
  ['ADH', 'Andheri', 20.0], ['JOS', 'Jogeshwari', 22.0], ['RMAR', 'Ram Mandir', 23.3],
  ['GMN', 'Goregaon', 24.8], ['MDD', 'Malad', 27.0], ['KILE', 'Kandivali', 29.4],
  ['BVIW', 'Borivali (local)', 31.5], ['DIC', 'Dahisar', 34.4], ['MIRA', 'Mira Road', 38.6],
  ['BYR', 'Bhayandar', 41.5], ['NIG', 'Naigaon', 45.9], ['BSR', 'Vasai Road', 50.0],
  ['NSP', 'Nallasopara', 54.4], ['VR', 'Virar', 60.0],
]

const CENTRAL = [
  ['CSTM', 'Mumbai CSMT (local)', 0], ['MSD', 'Masjid', 1.4], ['SNRD', 'Sandhurst Road', 2.3],
  ['BY', 'Byculla', 4.0], ['CHF', 'Chinchpokli', 5.0], ['CRD', 'Currey Road', 6.0],
  ['PR', 'Parel', 7.0], ['DDRC', 'Dadar (CR)', 9.0], ['MTN', 'Matunga', 10.4],
  ['SIN', 'Sion', 12.0], ['CLA', 'Kurla', 15.5], ['VVH', 'Vidyavihar', 17.0],
  ['GC', 'Ghatkopar', 18.5], ['VK', 'Vikhroli', 21.0], ['KJMG', 'Kanjurmarg', 22.7],
  ['BND', 'Bhandup', 24.2], ['NHU', 'Nahur', 25.5], ['MLND', 'Mulund', 27.2],
  ['TNAL', 'Thane (local)', 33.0], ['KLVA', 'Kalva', 35.5], ['MBQ', 'Mumbra', 39.0],
  ['DIVA', 'Diva Jn', 42.0], ['KOPR', 'Kopar', 44.5], ['DI', 'Dombivli', 47.0],
  ['TL', 'Thakurli', 49.0], ['KYNL', 'Kalyan (local)', 54.0],
]

const HARBOUR = [
  ['CSTM', 'Mumbai CSMT (local)', 0], ['MSD', 'Masjid', 1.4], ['SNRD', 'Sandhurst Road', 2.3],
  ['DKRD', 'Dockyard Road', 3.5], ['RRD', 'Reay Road', 4.5], ['CTGN', 'Cotton Green', 5.5],
  ['SVE', 'Sewri', 6.7], ['VDLR', 'Wadala Road', 9.0], ['GTBN', 'GTB Nagar', 10.5],
  ['CHVI', 'Chunabhatti', 12.5], ['CLAH', 'Kurla (Harbour)', 15.5], ['TNR', 'Tilak Nagar', 17.0],
  ['CMBR', 'Chembur', 18.5], ['GV', 'Govandi', 20.2], ['MNKD', 'Mankhurd', 22.0],
  ['VSH', 'Vashi', 26.0], ['SNPD', 'Sanpada', 28.0], ['JNJ', 'Juinagar', 30.0],
  ['NRL', 'Nerul', 32.0], ['SWDD', 'Seawoods Darave', 34.0], ['BEPR', 'Belapur CBD', 36.5],
  ['KHAG', 'Kharghar', 39.5], ['MSRV', 'Mansarovar', 41.0], ['KNDS', 'Khandeshwar', 43.0],
  ['PNVL', 'Panvel', 45.5],
]


// The Harbour line's second arm, CSMT to Goregaon via Bandra. It shares station
// names with Western from Mahim northwards — which is precisely what gives the
// Harbour network an interchange with Western.
const HARBOUR_GOREGAON = [
  ['CSTM', 'Mumbai CSMT (local)', 0], ['MSD', 'Masjid', 1.4], ['SNRD', 'Sandhurst Road', 2.3],
  ['DKRD', 'Dockyard Road', 3.5], ['RRD', 'Reay Road', 4.5], ['CTGN', 'Cotton Green', 5.5],
  ['SVE', 'Sewri', 6.7], ['VDLR', 'Wadala Road', 9.0], ['KCE', "King's Circle", 11.2],
  ['MM', 'Mahim Jn', 13.4], ['BA', 'Bandra', 15.3], ['KHAR', 'Khar Road', 16.7],
  ['STC', 'Santacruz', 18.0], ['VLP', 'Vile Parle', 19.7], ['ADH', 'Andheri', 21.7],
  ['JOS', 'Jogeshwari', 23.7], ['RMAR', 'Ram Mandir', 25.0], ['GMN', 'Goregaon', 26.5],
]


// Panvel through services to Goregaon: the Harbour arm as far as Wadala Road,
// then the Bandra branch. Built from the two lists so the shared stretch cannot
// drift out of step with them.
const PANVEL_GOREGAON = (() => {
  const toVadala = HARBOUR.slice(HARBOUR.findIndex(([c]) => c === 'VDLR'))   // VDLR..PNVL
  const pnvlKm = HARBOUR[HARBOUR.length - 1][2]
  const arm = toVadala
    .slice()
    .reverse()
    .map(([code, name, km]) => [code, name, +(pnvlKm - km).toFixed(1)])      // PNVL..VDLR
  const base = arm[arm.length - 1][2]
  const tail = HARBOUR_GOREGAON
    .slice(HARBOUR_GOREGAON.findIndex(([c]) => c === 'KCE'))
    .map(([code, name, km]) => [code, name, +(base + (km - 9.0)).toFixed(1)])
  return [...arm, ...tail]
})()

const TRANS_HARBOUR = [
  ['TNAL', 'Thane (local)', 0], ['ARLI', 'Airoli', 6.0], ['RABE', 'Rabale', 8.5],
  ['GNSL', 'Ghansoli', 11.0], ['KPHN', 'Koparkhairane', 14.0], ['TUR', 'Turbhe', 17.5],
  ['SNPD', 'Sanpada', 21.0], ['VSH', 'Vashi', 23.0],
]

const METRO_1 = [
  ['VRSV', 'Versova', 0], ['DNNR', 'D N Nagar', 1.2], ['AZNR', 'Azad Nagar', 2.1],
  ['ADHM', 'Andheri (Metro)', 3.4], ['WEHY', 'Western Express Hwy', 4.6], ['CHKL', 'Chakala', 5.9],
  ['ARDP', 'Airport Road', 7.0], ['MAOL', 'Marol Naka', 8.2], ['SAKI', 'Saki Naka', 9.6],
  ['ASLP', 'Asalpha', 10.6], ['JAGR', 'Jagruti Nagar', 11.4], ['GCMT', 'Ghatkopar (Metro)', 11.4 + 0.9],
]

const METRO_2A7 = [
  ['DHSE', 'Dahisar East', 0], ['ANDN', 'Anand Nagar', 1.1], ['KAND', 'Kandarpada', 2.0],
  ['MAND', 'Mandapeshwar', 3.0], ['ESHW', 'Eksar', 3.9], ['BVIP', 'Borivali (Metro)', 5.0],
  ['SHIM', 'Shimpoli', 6.1], ['KANW', 'Kandivali West', 7.2], ['DAHV', 'Dahanukarwadi', 8.1],
  ['VLNR', 'Valnai', 9.3], ['MALW', 'Malad West', 10.4], ['LOWR', 'Lower Malad', 11.5],
  ['GORW', 'Goregaon West', 12.6], ['PAHD', 'Pahadi Goregaon', 13.7], ['JOSW', 'Jogeshwari West', 14.9],
  ['MPUR', 'Mahavir Nagar', 16.0], ['DNNM', 'D N Nagar (Metro)', 17.6],
]

const METRO_3 = [
  ['AREY', 'Aarey JVLR', 0], ['SEEP', 'SEEPZ', 1.6], ['MIDC', 'MIDC Andheri', 2.5],
  ['MAOM', 'Marol Naka (M3)', 3.6], ['CSIA2', 'CSMIA T2', 5.4], ['SAHR', 'Sahar Road', 6.8],
  ['CSIA1', 'CSMIA T1', 8.3], ['SANC', 'Santacruz Metro', 9.6], ['BKC', 'Bandra Kurla Complex', 11.4],
  ['DHRV', 'Dharavi', 13.5], ['SITL', 'Sitaladevi', 15.2], ['DDRM', 'Dadar (Metro)', 16.6],
]

// Approximate geography: interpolate between real endpoints for map placement.
const ENDPOINTS = {
  WR:   [[18.9322, 72.8264], [19.4559, 72.8115]],
  CR:   [[18.9398, 72.8355], [19.2437, 73.1355]],
  HR:   [[18.9398, 72.8355], [18.9894, 73.1175]],
  TH:   [[19.1860, 72.9750], [19.0770, 72.9989]],
  HRG:  [[18.9398, 72.8355], [19.1646, 72.8493]],
  PG:   [[18.9894, 73.1175], [19.1646, 72.8493]],
  M1:   [[19.1310, 72.8148], [19.0860, 72.9080]],
  M2A7: [[19.2500, 72.8590], [19.1240, 72.8310]],
  M3:   [[19.1520, 72.8760], [19.0180, 72.8440]],
}

function withGeo(list, key) {
  const [[la1, lo1], [la2, lo2]] = ENDPOINTS[key]
  const total = list[list.length - 1][2] || 1
  return list.map(([code, name, km]) => ({
    code, name, km,
    lat: la1 + (la2 - la1) * (km / total),
    lon: lo1 + (lo2 - lo1) * (km / total),
  }))
}

export const LINES = {
  WR_LOCAL: {
    id: 'WR_LOCAL', name: 'Western Line', short: 'Western', category: 'UNRESERVED',
    zone: 'WR', stops: withGeo(WESTERN, 'WR'),
    maxKmph: 100, headwaySec: 180, density: 0.96,
    // fast services call only at these
    fastStops: ['CCG', 'BCT', 'DDR', 'BA', 'ADH', 'GMN', 'BVIW', 'BYR', 'BSR', 'VR'],
    services: [
      { label: 'Slow', code: 'S', headwayMin: 5, fast: false },
      { label: 'Fast', code: 'F', headwayMin: 7, fast: true },
    ],
  },
  CR_LOCAL: {
    id: 'CR_LOCAL', name: 'Central Line', short: 'Central', category: 'UNRESERVED',
    zone: 'CR', stops: withGeo(CENTRAL, 'CR'),
    maxKmph: 100, headwaySec: 180, density: 0.97,
    fastStops: ['CSTM', 'BY', 'DDRC', 'CLA', 'GC', 'MLND', 'TNAL', 'DI', 'KYNL'],
    services: [
      { label: 'Slow', code: 'S', headwayMin: 5, fast: false },
      { label: 'Fast', code: 'F', headwayMin: 8, fast: true },
    ],
  },
  HR_LOCAL: {
    id: 'HR_LOCAL', name: 'Harbour Line', short: 'Harbour', category: 'UNRESERVED',
    zone: 'CR', stops: withGeo(HARBOUR, 'HR'),
    maxKmph: 90, headwaySec: 240, density: 0.82,
    fastStops: ['CSTM', 'VDLR', 'CLAH', 'MNKD', 'VSH', 'NRL', 'BEPR', 'PNVL'],
    services: [
      { label: 'Slow', code: 'S', headwayMin: 8, fast: false },
    ],
  },
  HRG_LOCAL: {
    id: 'HRG_LOCAL', name: 'Harbour Line (Goregaon)', short: 'Harbour-GMN', category: 'UNRESERVED',
    zone: 'CR', stops: withGeo(HARBOUR_GOREGAON, 'HRG'),
    maxKmph: 85, headwaySec: 300, density: 0.74,
    fastStops: null,
    services: [{ label: 'Slow', code: 'S', headwayMin: 12, fast: false }],
  },
  PG_LOCAL: {
    id: 'PG_LOCAL', name: 'Panvel — Goregaon', short: 'Panvel-GMN', category: 'UNRESERVED',
    zone: 'CR', stops: withGeo(PANVEL_GOREGAON, 'PG'),
    maxKmph: 85, headwaySec: 300, density: 0.70,
    fastStops: null,
    services: [{ label: 'Slow', code: 'S', headwayMin: 15, fast: false }],
  },
  TH_LOCAL: {
    id: 'TH_LOCAL', name: 'Trans-Harbour Line', short: 'Trans-Harbour', category: 'UNRESERVED',
    zone: 'CR', stops: withGeo(TRANS_HARBOUR, 'TH'),
    maxKmph: 90, headwaySec: 300, density: 0.66,
    fastStops: null,
    services: [
      { label: 'Slow', code: 'S', headwayMin: 12, fast: false },
    ],
  },
  METRO_1: {
    id: 'METRO_1', name: 'Metro Line 1 (Blue)', short: 'Metro 1', category: 'METRO',
    zone: 'MMRDA', stops: withGeo(METRO_1, 'M1'),
    maxKmph: 80, headwaySec: 240, density: 0.70,
    fastStops: null,
    services: [{ label: 'Metro', code: 'M', headwayMin: 5, fast: false }],
  },
  METRO_2A7: {
    id: 'METRO_2A7', name: 'Metro Lines 2A & 7', short: 'Metro 2A/7', category: 'METRO',
    zone: 'MMRDA', stops: withGeo(METRO_2A7, 'M2A7'),
    maxKmph: 80, headwaySec: 300, density: 0.55,
    fastStops: null,
    services: [{ label: 'Metro', code: 'M', headwayMin: 7, fast: false }],
  },
  METRO_3: {
    id: 'METRO_3', name: 'Metro Line 3 (Aqua)', short: 'Metro 3', category: 'METRO',
    zone: 'MMRC', stops: withGeo(METRO_3, 'M3'),
    maxKmph: 85, headwaySec: 300, density: 0.48,
    fastStops: null,
    services: [{ label: 'Metro', code: 'M', headwayMin: 6, fast: false }],
  },
}

// Service window and generation parameters.
export const SERVICE_WINDOW = { startSec: 5 * 3600, endSec: 23.5 * 3600 }

/** Dwell at a suburban / metro halt, in seconds. */
export function localDwell(lineId, isFast) {
  if (lineId.startsWith('METRO')) return 25
  return isFast ? 25 : 20
}

/**
 * Physical interchange hubs. Mumbai gives the same place different codes on
 * different lines — Dadar is DR on the mail line, DDR on Western, DDRC on
 * Central and DDRM on Metro 3 — so a journey planner has to know they are one
 * station before it can offer a change there.
 */
export const HUBS = {
  CSMT_HUB:    { id: 'CSMT_HUB',    name: 'Mumbai CSMT',      codes: ['CSMT', 'CSTM'] },
  DADAR:       { id: 'DADAR',       name: 'Dadar',            codes: ['DR', 'DDR', 'DDRC', 'DDRM'] },
  THANE:       { id: 'THANE',       name: 'Thane',            codes: ['TNA', 'TNAL'] },
  KALYAN:      { id: 'KALYAN',      name: 'Kalyan Jn',        codes: ['KYN', 'KYNL'] },
  MUM_CENTRAL: { id: 'MUM_CENTRAL', name: 'Mumbai Central',   codes: ['MMCT', 'BCT'] },
  BORIVALI:    { id: 'BORIVALI',    name: 'Borivali',         codes: ['BVI', 'BVIW', 'BVIP'] },
  ANDHERI:     { id: 'ANDHERI',     name: 'Andheri',          codes: ['ADH', 'ADHM'] },
  GHATKOPAR:   { id: 'GHATKOPAR',   name: 'Ghatkopar',        codes: ['GC', 'GCMT'] },
  KURLA:       { id: 'KURLA',       name: 'Kurla',            codes: ['CLA', 'CLAH'] },
  DN_NAGAR:    { id: 'DN_NAGAR',    name: 'D N Nagar',        codes: ['DNNR', 'DNNM'] },
  MAROL:       { id: 'MAROL',       name: 'Marol Naka',       codes: ['MAOL', 'MAOM'] },
  JOGESHWARI:  { id: 'JOGESHWARI',  name: 'Jogeshwari',       codes: ['JOS', 'JOSW'] },
  GOREGAON:    { id: 'GOREGAON',    name: 'Goregaon',         codes: ['GMN', 'GORW'] },
  MALAD:       { id: 'MALAD',       name: 'Malad',            codes: ['MDD', 'MALW'] },
  KANDIVALI:   { id: 'KANDIVALI',   name: 'Kandivali',        codes: ['KILE', 'KANW'] },
}

/** Minimum time to change platforms, by hub size. */
export const MIN_INTERCHANGE_SEC = 300
