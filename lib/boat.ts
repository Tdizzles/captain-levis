// Best-effort parsing of free-text boat descriptions ("2004 Boston Whaler Outrage 24") into make/model/year.
// Also shared by the chat's deterministic (no-key) extraction.

export const BOAT_MAKES = [
  'Boston Whaler', 'Sea Ray', 'Grady-White', 'Grady White', 'Bayliner', 'Yamaha', 'Sea-Doo', 'Sea Doo', 'SeaDoo', 'Kawasaki',
  'Mako', 'Pursuit', 'Contender', 'Yellowfin', 'Pathfinder', 'Hewes', 'Maverick', 'Scout', 'Sportsman', 'Sea Hunt', 'Sea Fox',
  'Sea Pro', 'Key West', 'Carolina Skiff', 'Robalo', 'Cobia', 'Pro-Line', 'Proline', 'Pro Line', 'Wellcraft', 'Chaparral',
  'Four Winns', 'Regal', 'Formula', 'Donzi', 'Cigarette', 'Fountain', 'Outerlimits', 'Baja', 'Rinker', 'Monterey', 'Cobalt',
  'MasterCraft', 'Malibu', 'Nautique', 'Correct Craft', 'Moomba', 'Supra', 'Tige', 'Axis', 'Centurion', 'Stingray',
  'Glastron', 'Larson', 'Crownline', 'Hurricane', 'Sweetwater', 'Bennington', 'Tracker', 'Sun Tracker', 'Ranger', 'Skeeter',
  'Nitro', 'Triton', 'Bass Cat', 'Lund', 'Alumacraft', 'Hydra-Sports', 'Hydrasports', 'Intrepid', 'Jupiter', 'Regulator',
  'Everglades', 'Edgewater', 'Parker', 'Albemarle', 'Bertram', 'Hatteras', 'Viking', 'Luhrs', 'Silverton', 'Carver',
  'Cruisers', 'Tiara', 'Pursuit', 'Blackfin', 'Dusky', 'Angler', 'Seaswirl', 'Trophy', 'Aquasport', 'Hydra Sport', 'Stamas',
  'Bruno', 'Stillman', 'Catalina', 'Hunter', 'Beneteau', 'Hobie', 'Action Craft', 'Shearwater', 'Ranger Tugs', 'Sailfish',
  'Nautic Star', 'NauticStar', 'Tidewater', 'Blue Wave', 'Pioneer', 'Sea Chaser', 'Twin Vee', 'World Cat', 'Glacier Bay',
  'Striper', 'Polar', 'Mariah', 'Caravelle', 'Thunderbird', 'Marlin', 'Pro Craft', 'Bay Boat', 'Flats Boat',
] as const

export interface ParsedBoat { make: string | null; model: string | null; year: number | null; raw: string }

const YEAR_RE = /\b(19[5-9]\d|20[0-4]\d)\b/
const TWO_DIGIT_YEAR_RE = /(?:^|\s)'?(\d{2})\b(?=\s|$)/

export function parseBoat(raw: string | null | undefined): ParsedBoat {
  const text = (raw || '').trim().replace(/\s+/g, ' ')
  if (!text) return { make: null, model: null, year: null, raw: '' }
  if (/^(not sure|unsure|unknown|n\/a|idk|dont know|don't know)$/i.test(text)) return { make: null, model: null, year: null, raw: text }
  let rest = text
  let year: number | null = null
  const y = rest.match(YEAR_RE)
  if (y) { year = Number(y[1]); rest = rest.replace(y[0], ' ') }
  else {
    const y2 = rest.match(TWO_DIGIT_YEAR_RE)
    if (y2 && /^'/.test(y2[0].trim()) || (y2 && Number(y2[1]) >= 50)) { const n = Number(y2![1]); year = n >= 50 ? 1900 + n : 2000 + n; rest = rest.replace(y2![0], ' ') }
  }
  let make: string | null = null
  const lower = rest.toLowerCase()
  // longest make name first so "Sea Ray" beats "Ray" style collisions
  for (const m of [...BOAT_MAKES].sort((a, b) => b.length - a.length)) {
    const idx = lower.indexOf(m.toLowerCase())
    if (idx < 0) continue
    const before = idx === 0 ? ' ' : lower[idx - 1]
    const after = idx + m.length >= lower.length ? ' ' : lower[idx + m.length]
    if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue
    make = m
    rest = rest.slice(0, idx) + ' ' + rest.slice(idx + m.length)
    break
  }
  let model: string | null = rest.replace(/[,;|]+/g, ' ').replace(/\s+/g, ' ').trim() || null
  if (model) {
    model = model.replace(/^(a|an|my|the|its|it's|is|boat|footer|ft|foot)\s+/i, '').trim() || null
    if (model && model.length > 60) model = model.slice(0, 60).trim()
  }
  if (!make && !year && model && model.split(' ').length > 6) model = null // probably not a boat description at all
  return { make, model, year, raw: text }
}

export function describeBoat(b: { make?: string | null; model?: string | null; year?: number | null; raw?: string | null }): string {
  const parts = [b.year ? String(b.year) : '', b.make || '', b.model || ''].filter(Boolean)
  return parts.length ? parts.join(' ') : (b.raw || '')
}
