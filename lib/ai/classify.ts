/**
 * Anthropic-backed classifier. Wraps the Messages API + tool use to get
 * structured JSON back reliably.
 *
 * Model: claude-haiku-4-5 — fast, cheap, plenty good enough for
 * classification. Sonnet/Opus reserved for Phase 1b commercial estimates
 * where reasoning is harder.
 */

import Anthropic from '@anthropic-ai/sdk'
import {
  CLASSIFY_SYSTEM_PROMPT,
  CLASSIFY_TOOL,
  SIGNAL_TYPES,
  type ClassifyResult,
  type SignalTypeName,
} from './prompts/classify'

const MODEL = 'claude-haiku-4-5'

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (_client) return _client
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is missing. Add it to .env.local — get one at ' +
        'https://console.anthropic.com/settings/keys',
    )
  }
  _client = new Anthropic({ apiKey })
  return _client
}

const VALID_SIGNAL_TYPES = new Set<string>(SIGNAL_TYPES)

export async function classifyWithAI(
  title: string | null,
  description: string | null,
): Promise<ClassifyResult | null> {
  const client = getClient()

  const titleClean = (title ?? '').trim()
  const descClean = (description ?? '').trim()
  const userText = [
    titleClean && `Title: ${titleClean}`,
    descClean && `Description: ${descClean}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  if (!userText) return null

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: CLASSIFY_SYSTEM_PROMPT,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [CLASSIFY_TOOL as any],
    tool_choice: { type: 'tool', name: CLASSIFY_TOOL.name },
    messages: [{ role: 'user', content: userText }],
  })

  const toolUse = response.content.find((c) => c.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') return null

  const raw = toolUse.input as Record<string, unknown>

  // Validate the shape so a malformed AI response doesn't poison the DB
  if (typeof raw.is_hospitality !== 'boolean') return null
  if (!Array.isArray(raw.signals)) return null

  const signals = (raw.signals as Array<Record<string, unknown>>)
    .filter(
      (s) =>
        typeof s.type === 'string' &&
        VALID_SIGNAL_TYPES.has(s.type) &&
        typeof s.source_phrase === 'string' &&
        typeof s.confidence === 'number' &&
        s.confidence >= 0.5,
    )
    .map((s) => ({
      type: s.type as SignalTypeName,
      source_phrase: s.source_phrase as string,
      confidence: s.confidence as number,
    }))

  return {
    is_hospitality: raw.is_hospitality,
    venue_type:
      typeof raw.venue_type === 'string' ? raw.venue_type : null,
    signals,
    reasoning:
      typeof raw.reasoning === 'string' ? raw.reasoning : '',
  }
}
