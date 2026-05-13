/**
 * Sprint 2 — AI-classify all applications in the database.
 *
 *   npx tsx --env-file=.env.local scripts/classify-ai.ts
 *
 * Wipes the existing signals on each app, re-classifies via Anthropic, and
 * upserts opportunities with refreshed scores.
 *
 * Budget protection:
 *   - MAX_APPS_PER_RUN caps how many we hit per invocation.
 *   - 250ms delay between calls keeps us well under Haiku rate limits.
 */

import { supabaseAdmin } from '../lib/db/client'
import { classifyWithAI } from '../lib/ai/classify'
import {
  getSignalMetadata,
  type SignalTypeName,
} from '../lib/ai/prompts/classify'
import { scoreOpportunity } from '../lib/scoring/score'

const MAX_APPS_PER_RUN = 100
const RATE_LIMIT_DELAY_MS = 250

async function main() {
  console.log('[classify-ai] fetching applications')

  const { data: applications, error } = await supabaseAdmin
    .from('applications')
    .select('id, site_id, title, description')
    .limit(MAX_APPS_PER_RUN)

  if (error || !applications) {
    console.error('[classify-ai] fetch failed:', error)
    process.exit(1)
  }

  console.log(
    `[classify-ai] processing ${applications.length} applications (cap ${MAX_APPS_PER_RUN})`,
  )
  console.log('')

  let aiSucceeded = 0
  let aiFailed = 0
  let notHospitality = 0
  let withSignals = 0
  let totalSignals = 0

  for (let i = 0; i < applications.length; i++) {
    const app = applications[i]
    const label = `[${String(i + 1).padStart(3)}/${applications.length}]`

    let result
    try {
      result = await classifyWithAI(app.title, app.description)
      aiSucceeded++
    } catch (err) {
      console.log(`${label} AI ERROR — ${(err as Error).message}`)
      aiFailed++
      await sleep(RATE_LIMIT_DELAY_MS)
      continue
    }

    if (!result || !result.is_hospitality) {
      console.log(`${label} ✗ not hospitality`)
      notHospitality++
      // Wipe any old signals so the dashboard doesn't show stale data
      await supabaseAdmin.from('signals').delete().eq('application_id', app.id)
      await sleep(RATE_LIMIT_DELAY_MS)
      continue
    }

    const venue = result.venue_type ?? 'hospitality'
    const sigSummary = result.signals.map((s) => s.type).join(', ') || 'no signals'
    console.log(`${label} ✓ ${venue} — ${sigSummary}`)

    // Wipe + replace signals
    await supabaseAdmin.from('signals').delete().eq('application_id', app.id)

    if (result.signals.length > 0) {
      withSignals++

      const signalRows = result.signals.map((s) => {
        const meta = getSignalMetadata(s.type)
        return {
          application_id: app.id,
          tier: meta.tier,
          type: s.type,
          weight: meta.weight,
          lead_time_months: meta.leadTimeMonths,
          source_phrase: s.source_phrase,
          confidence: s.confidence,
        }
      })

      const { error: sigErr } = await supabaseAdmin
        .from('signals')
        .insert(signalRows)
      if (sigErr) {
        console.log(`${label}   signal insert failed: ${sigErr.message}`)
      } else {
        totalSignals += result.signals.length

        // Upsert opportunity using detected signals
        const detected = result.signals.map((s) => {
          const meta = getSignalMetadata(s.type)
          return {
            type: s.type as SignalTypeName,
            tier: meta.tier,
            weight: meta.weight,
            leadTimeMonths: meta.leadTimeMonths,
            sourcePhrase: s.source_phrase,
            confidence: s.confidence,
          }
        })
        const newScore = scoreOpportunity(detected)

        const { data: existingOpp } = await supabaseAdmin
          .from('opportunities')
          .select('id, opportunity_score')
          .eq('site_id', app.site_id)
          .maybeSingle()

        if (existingOpp) {
          if (newScore > Number(existingOpp.opportunity_score)) {
            await supabaseAdmin
              .from('opportunities')
              .update({
                opportunity_score: newScore,
                last_updated_at: new Date().toISOString(),
              })
              .eq('id', existingOpp.id)
          }
        } else {
          await supabaseAdmin.from('opportunities').insert({
            site_id: app.site_id,
            opportunity_score: newScore,
            state: 'surveillance',
          })
        }
      }
    }

    await sleep(RATE_LIMIT_DELAY_MS)
  }

  console.log('')
  console.log('[classify-ai] done')
  console.log(`  AI calls: ${aiSucceeded} succeeded, ${aiFailed} failed`)
  console.log(`  Not hospitality: ${notHospitality}`)
  console.log(`  Hospitality with signals: ${withSignals}`)
  console.log(`  Total signals inserted: ${totalSignals}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((err) => {
  console.error('[classify-ai] fatal:', err)
  process.exit(1)
})
