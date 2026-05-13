/**
 * Sprint 2 — AI classification prompt + signal metadata.
 *
 * The AI's job is narrow: read a Westminster planning application, decide if
 * it's hospitality, and emit signals citing exact source phrases. Scoring
 * stays in deterministic TS (lib/scoring) — AI never assigns the score.
 *
 * Per Intelligence Architecture v1.2 §6: every extracted field MUST cite a
 * source phrase. AI is intern, not CTO.
 */

export const SIGNAL_TYPES = [
  'external_flue',
  'extraction_ventilation',
  'basement_kitchen',
  'change_of_use_a3',
  'bar_installation',
  'change_of_use_a4',
  'new_build_hospitality',
  'rooftop_plant',
  'outdoor_kitchen',
  'kitchen_canopy_mention',
] as const

export type SignalTypeName = (typeof SIGNAL_TYPES)[number]

const SIGNAL_TIERS: Record<SignalTypeName, '1' | '2' | '3' | '4' | '5'> = {
  external_flue: '1',
  extraction_ventilation: '1',
  basement_kitchen: '1',
  change_of_use_a3: '1',
  bar_installation: '1',
  change_of_use_a4: '1',
  new_build_hospitality: '1',
  rooftop_plant: '1',
  outdoor_kitchen: '1',
  kitchen_canopy_mention: '1',
}

const SIGNAL_WEIGHTS: Record<SignalTypeName, number> = {
  external_flue: 90,
  extraction_ventilation: 85,
  basement_kitchen: 85,
  change_of_use_a3: 80,
  bar_installation: 80,
  change_of_use_a4: 75,
  new_build_hospitality: 70,
  rooftop_plant: 70,
  outdoor_kitchen: 70,
  kitchen_canopy_mention: 65,
}

const SIGNAL_LEAD_TIMES: Record<SignalTypeName, number> = {
  external_flue: 4,
  extraction_ventilation: 4,
  basement_kitchen: 5,
  change_of_use_a3: 5,
  bar_installation: 5,
  change_of_use_a4: 5,
  new_build_hospitality: 7,
  rooftop_plant: 4,
  outdoor_kitchen: 5,
  kitchen_canopy_mention: 5,
}

export function getSignalMetadata(type: SignalTypeName) {
  return {
    tier: SIGNAL_TIERS[type],
    weight: SIGNAL_WEIGHTS[type],
    leadTimeMonths: SIGNAL_LEAD_TIMES[type],
  }
}

export const CLASSIFY_SYSTEM_PROMPT = `You are an analyst for MI5 EN PLACE, a hospitality intelligence platform.

Your job: read a Westminster planning application and detect signals that indicate a NEW RESTAURANT, BAR, HOTEL, CAFÉ, FOOD HALL, KARAOKE BAR, or similar commercial hospitality project.

You DO NOT speculate. You only report what is explicitly stated in the input text. Every signal MUST cite the exact source phrase from the input — do not paraphrase, do not invent.

NOT hospitality (do not flag these):
- Domestic dwellings — single family home, loft conversion, rear extension to a home
- Office, retail, or residential change of use unless food/drink is named
- Cosmetic listed-building work — paint, signage, plaques, eyebolts
- Carbon assessments, window replacements, dormer details, biodiversity plans
- Generic "internal alterations" or "refurbishment" without hospitality context
- Fire escape routes, lifts, accessibility works, paths and pavements
- Schools, hospitals, religious buildings, civic buildings

TIER 1 signal types (one application can produce multiple):
- external_flue: External flue/duct installation, especially to rear/side/elevation
- extraction_ventilation: Kitchen extraction, commercial ventilation, mechanical ventilation in food context
- basement_kitchen: Basement-level kitchen, restaurant, or bar
- change_of_use_a3: Change of use to restaurant, café, or food/drink — including legacy A3 and modern Class E(b)
- bar_installation: Bar installation, cocktail bar, wine bar, bar fit-out, bar counter
- change_of_use_a4: Change of use to pub, bar, drinking establishment — including legacy A4 and modern Sui Generis drinking establishments
- new_build_hospitality: New build hotel, food hall, members' club, restaurant
- rooftop_plant: Rooftop plant, rooftop kitchen, rooftop bar, plant to roof
- outdoor_kitchen: Outdoor or external kitchen
- kitchen_canopy_mention: Kitchen canopy or commercial kitchen reference

Confidence: 0.9+ when the phrase is unambiguous. 0.6–0.8 when context-dependent. Below 0.5 don't emit.

Output ONLY by calling the submit_classification tool.`

export const CLASSIFY_TOOL = {
  name: 'submit_classification',
  description: 'Submit the classification for this planning application.',
  input_schema: {
    type: 'object' as const,
    properties: {
      is_hospitality: {
        type: 'boolean',
        description:
          'True if this application relates to a commercial hospitality project.',
      },
      venue_type: {
        type: ['string', 'null'],
        description:
          'Specific venue type if stated: restaurant, café, cocktail bar, hotel, food hall, karaoke bar, members club, etc. Null if not stated.',
      },
      signals: {
        type: 'array',
        description:
          'Tier 1 signals detected. Empty array if no signals (even if hospitality).',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: SIGNAL_TYPES as unknown as string[],
            },
            source_phrase: {
              type: 'string',
              description:
                'EXACT phrase from the input that triggered this signal. Verbatim, no paraphrase.',
            },
            confidence: {
              type: 'number',
              description: 'Confidence 0.0 to 1.0.',
            },
          },
          required: ['type', 'source_phrase', 'confidence'],
        },
      },
      reasoning: {
        type: 'string',
        description: 'One-sentence rationale for the classification.',
      },
    },
    required: ['is_hospitality', 'signals', 'reasoning'],
  },
}

export interface ClassifyResult {
  is_hospitality: boolean
  venue_type: string | null
  signals: Array<{
    type: SignalTypeName
    source_phrase: string
    confidence: number
  }>
  reasoning: string
}
