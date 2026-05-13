/**
 * Sprint 1 rule-based classifier.
 *
 * Reads an application's free text and emits zero or more Tier 1 signals.
 * Pure function — no DB access. Easy to unit-test.
 *
 * The patterns are deliberately permissive for Sprint 1. False positives are
 * cheaper than false negatives at this stage — Ian dogfooding the dashboard
 * will tell us where to tighten.
 */

export interface DetectedSignal {
  type: string
  tier: '1' | '2' | '3' | '4' | '5'
  weight: number
  leadTimeMonths: number
  sourcePhrase: string
  confidence: number
}

interface SignalRule {
  type: string
  tier: '1' | '2' | '3' | '4' | '5'
  weight: number
  leadTimeMonths: number
  patterns: RegExp[]
}

const TIER1_RULES: SignalRule[] = [
  {
    type: 'external_flue',
    tier: '1',
    weight: 90,
    leadTimeMonths: 4,
    patterns: [
      /\bexternal\s+flue\b/i,
      /\binstallation\s+of\s+(?:an?\s+)?flue\b/i,
      /\bflue\s+(?:installation|to\s+rear|to\s+side|to\s+elevation)\b/i,
      /\bnew\s+flue\b/i,
    ],
  },
  {
    type: 'extraction_ventilation',
    tier: '1',
    weight: 85,
    leadTimeMonths: 4,
    patterns: [
      /\bkitchen\s+extraction\b/i,
      /\bcommercial\s+extraction\b/i,
      /\bextraction\s+(?:system|duct|fan|unit|equipment|installation|flue)\b/i,
      /\bkitchen\s+ventilation\b/i,
      /\bcommercial\s+ventilation\b/i,
      /\bmechanical\s+ventilation\b/i,
    ],
  },
  {
    type: 'basement_kitchen',
    tier: '1',
    weight: 85,
    leadTimeMonths: 5,
    patterns: [
      /\bbasement\s+kitchen\b/i,
      /\bsubterranean\s+kitchen\b/i,
      /\bbasement\s+(?:restaurant|bar|cafe|café)\b/i,
    ],
  },
  {
    // Restaurants / cafés. In 2020 A3 was absorbed into Class E(b);
    // both phrasings still show up in applications.
    type: 'change_of_use_a3',
    tier: '1',
    weight: 80,
    leadTimeMonths: 5,
    patterns: [
      /\bchange\s+of\s+use[^.]{0,120}\b(?:A3|restaurant|cafe|café|food\s+and\s+drink)\b/i,
      /\bchange\s+of\s+use[^.]{0,120}\bclass\s+E\(b\)/i,
      /\bclass\s+E\(b\)/i,
      /\buse\s+as\s+(?:a\s+)?(?:restaurant|café|cafe)\b/i,
      /\bA3\s+use\b/i,
    ],
  },
  {
    type: 'bar_installation',
    tier: '1',
    weight: 80,
    leadTimeMonths: 5,
    patterns: [
      /\bbar\s+installation\b/i,
      /\binstallation\s+of\s+(?:a\s+)?bar\b/i,
      /\bcocktail\s+bar\b/i,
      /\bbar\s+(?:counter|fit.?out|fitout)\b/i,
    ],
  },
  {
    // Pubs / bars. In 2020 A4 became Sui Generis — drinking establishments
    // are now applied for as "Sui Generis" with specific intent stated.
    type: 'change_of_use_a4',
    tier: '1',
    weight: 75,
    leadTimeMonths: 5,
    patterns: [
      /\bchange\s+of\s+use[^.]{0,120}\b(?:A4|pub|public\s+house|wine\s+bar|champagne\s+bar)\b/i,
      /\bsui\s+generis[^.]{0,80}\b(?:pub|bar|public\s+house|drinking)\b/i,
      /\bdrinking\s+establishment\b/i,
      /\buse\s+as\s+(?:a\s+)?(?:pub|public\s+house|bar|wine\s+bar)\b/i,
      /\bA4\s+(?:use|public\s+house)\b/i,
    ],
  },
  {
    type: 'new_build_hospitality',
    tier: '1',
    weight: 70,
    leadTimeMonths: 7,
    patterns: [
      /\b(?:new\s+build|construction\s+of)[^.]{0,80}\b(?:hotel|restaurant|food\s+hall|members[^.]{0,4}\s+club)\b/i,
      /\b(?:hotel|food\s+hall)\s+development\b/i,
    ],
  },
  {
    type: 'rooftop_plant',
    tier: '1',
    weight: 70,
    leadTimeMonths: 4,
    patterns: [
      /\brooftop\s+plant\b/i,
      /\broof[\s-]level\s+plant\b/i,
      /\brooftop\s+(?:kitchen|bar)\b/i,
      /\bplant\s+to\s+roof\b/i,
    ],
  },
  {
    type: 'outdoor_kitchen',
    tier: '1',
    weight: 70,
    leadTimeMonths: 5,
    patterns: [
      /\boutdoor\s+kitchen\b/i,
      /\bexternal\s+kitchen\b/i,
    ],
  },
  {
    type: 'kitchen_canopy_mention',
    tier: '1',
    weight: 65,
    leadTimeMonths: 5,
    patterns: [
      /\bkitchen\s+canopy\b/i,
      /\bcanopy\s+(?:installation|over\s+cooking)\b/i,
      /\bcommercial\s+kitchen\b/i,
    ],
  },
]

/**
 * Run all Tier 1 rules over the given text. Returns one signal per matching
 * type (first match per type wins — the source_phrase reflects that match).
 */
export function classifyApplication(text: string): DetectedSignal[] {
  if (!text || text.trim().length === 0) return []

  const signals: DetectedSignal[] = []

  for (const rule of TIER1_RULES) {
    for (const pattern of rule.patterns) {
      const match = text.match(pattern)
      if (match) {
        signals.push({
          type: rule.type,
          tier: rule.tier,
          weight: rule.weight,
          leadTimeMonths: rule.leadTimeMonths,
          sourcePhrase: match[0].trim(),
          confidence: 1.0,
        })
        break // one signal per type — move to next rule
      }
    }
  }

  return signals
}
