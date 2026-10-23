// The first draft of an estimate, built from what the customer told Captain Levi in the website chat:
// lettered sections and line items that name the work, with hours and materials left at zero for the crew
// (or the Quote Desk's Captain Levi) to price. Nothing here invents a price, a rate or a quantity.
import { FOLLOWUPS, SIZES, ZONES, type InquiryDetails } from '../chat/quoteflow.js'

export interface SkeletonSection { title: string; lines: string[] }

const zoneName = (z: string) => (ZONES.find(([k]) => k === z)?.[1] || z).replace(/ \(.*\)$/, '').toLowerCase()
const sizeName = (v: string) => (SIZES.find(([k]) => k === v)?.[1] || v).toLowerCase()

export function skeletonFor(d: Partial<InquiryDetails>): SkeletonSection[] {
  const answers = d.answers || {}
  const has = (id: string, ...vals: string[]) => vals.some((v) => answers[id]?.includes(v))
  const label = (id: string) => {
    const f = d.job ? FOLLOWUPS[d.job]?.find((x) => x.id === id) : undefined
    return (answers[id] || []).map((v) => f?.options.find(([k]) => k === v)?.[1] || v).join(', ').toLowerCase()
  }
  const zones = (d.zones || []).filter((z) => z !== 'unsure')
  const where = zones.length ? ` (${zones.map(zoneName).join(', ')})` : ''
  const about = d.size && d.size !== 'several' ? `, about ${sizeName(d.size)} size` : d.size === 'several' ? ', several spots' : ''
  const out: SkeletonSection[] = []
  const add = (title: string, lines: (string | false | undefined)[]) => out.push({ title, lines: lines.filter((l): l is string => !!l) })

  switch (d.job) {
    case 'impact':
      add(`Impact damage repair${where}`, [
        (has('water', 'yes', 'some') && 'Find and stop the water intrusion; moisture-check the core'),
        `Inspect the impact area and grind back to sound laminate${about}`,
        'Rebuild the laminate to match the original glass schedule',
        'Fair, prime and gelcoat to match',
        'Wet sand, compound and polish the blend area',
      ])
      if (zones.includes('bottom')) add('Below the waterline', ['Barrier coat the repaired area', 'Bottom paint the repaired area'])
      break
    case 'cracks':
      add(`Crack repair${where}`, [
        `Grind out the cracks to sound material${answers.pattern ? ` (${label('pattern')})` : ''}${about}`,
        has('flex', 'yes') && 'Reinforce the substrate behind the cracks (the flex is the cause)',
        has('pattern', 'fittings') && 'Remove, re-bed and re-install the hardware',
        'Fill, fair and gelcoat to match',
        'Wet sand, compound and polish',
      ])
      break
    case 'chips':
      add(`Gelcoat repair${where}`, [
        has('depth', 'surface') && `Wet sand and buff out scuffs and scratches${about}`,
        (has('depth', 'gelcoat', 'unsure') || !answers.depth) && `Fill chips with color-matched gelcoat${answers.count ? ` (${label('count')} spots)` : ''}${about}`,
        has('depth', 'glass') && `Grind and fill the gouge with fiberglass${about}`,
        has('depth', 'glass') && 'Fair and gelcoat to match',
        `Color match${answers.color ? ` (${label('color')})` : ''}`,
        'Wet sand, compound and polish the blend',
      ])
      break
    case 'soft':
      add(`Soft spot and core repair${answers.area ? ` (${label('area')})` : where}`, [
        'Moisture readings and core samples to map the wet area',
        `Cut and remove the top skin over the soft area${about}`,
        'Remove the wet core and install new core',
        'Re-laminate the top skin',
        'Gelcoat and non-skid to match',
      ])
      break
    case 'transom': {
      const engine = !has('engine', 'none')
      add('Transom repair', [
        'Moisture survey and core samples of the transom',
        engine && `Remove ${has('engine', 'twins') ? 'both engines' : 'the engine'}, rigging and transom hardware`,
        'Remove the inner skin and wet core',
        'Install new transom core and laminate',
        'Fair, gelcoat and finish',
        engine && 'Re-install engine and hardware; seal all through-bolts',
      ])
      break
    }
    case 'stringers':
      add('Stringer and bulkhead repair', [
        'Survey the stringer grid (moisture, sounding)',
        'Remove the deck or sole for access',
        'Replace rotten stringers and bulkheads',
        'Tab and re-laminate to the hull',
        'Re-install the deck; gelcoat and non-skid to match',
      ])
      break
    case 'blisters':
      add('Bottom and blister repair', [
        has('paint', 'yes', 'unsure') && 'Strip the bottom paint',
        `Open, wash and dry the blisters${about}`,
        'Fill and fair',
        'Barrier coat',
        (has('paint', 'yes') || has('kept', 'water')) && 'Bottom paint',
      ])
      break
    case 'oxidation':
      add('Gelcoat restoration', [
        'Wash and decontaminate',
        has('state', 'chalky', 'stained') && 'Wet sand the oxidized gelcoat',
        'Compound and polish',
        'Wax or sealant',
      ])
      break
    case 'detailing': {
      const map: [string, string][] = [['wash', 'Wash and wax'], ['compound', 'Compound and polish'], ['ceramic', 'Ceramic coating'], ['interior', 'Interior, vinyl and non-skid cleaning'], ['bottom', 'Bottom cleaning'], ['recommend', 'Detail package (crew to recommend)']]
      const lines = map.filter(([k]) => has('services', k)).map(([, l]) => l)
      add('Detailing', lines.length ? lines : ['Detail package (crew to recommend)'])
      break
    }
    case 'fabrication':
      add(`Custom fabrication${answers.what ? ` (${label('what')})` : ''}`, ['Measurements and design', 'Pattern or mold', 'Lay up and finish the part', 'Fit and install'])
      break
    case 'pwc':
      add(`${has('craft', 'kayak') ? 'Kayak' : 'PWC'} repair`, [
        has('issue', 'crack') && 'Repair the crack or hole (grind, glass, fill)',
        has('issue', 'scuff') && 'Fill and fair the scuffs and gouges',
        has('issue', 'bottom') && 'Repair the bottom and keel damage',
        !answers.issue || has('issue', 'other') ? 'Inspect and repair (see notes)' : undefined,
        'Gelcoat or finish to match',
      ])
      break
    default:
      add(`Repair${where}`, ['Inspect and assess the damage (see notes)'])
  }

  // getting to the boat
  const job = d.job || ''
  const haul = d.inWater === true && (['transom', 'stringers', 'blisters'].includes(job) || zones.includes('bottom'))
  const mobile = !haul && (has('bring', 'no') || ['dock', 'lift', 'storage'].includes(d.whereStatus || ''))
  if (haul) add('Haul-out', ['Haul out, block and launch'])
  else if (mobile) add('Mobile service', ['Travel to the boat'])
  return out
}
