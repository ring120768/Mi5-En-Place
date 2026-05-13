/**
 * Sprint 1 — classify all applications in the database.
 *
 * For each application:
 *   1. Run the rule-based classifier over title + description.
 *   2. Wipe existing signals for that application (idempotent re-runs).
 *   3. Insert detected signals.
 *   4. Upsert the opportunity at that site, taking the higher of existing
 *      score vs. new score.
 *
 * Run from the mi5-app folder:
 *   npx tsx --env-file=.env.local scripts/classify-once.ts
 */

import { supabaseAdmin } from '../lib/db/client'
import { classifyApplication } from '../lib/signals/classifier'
import { scoreOpportunity } from '../lib/scoring/score'

async function main() {
  console.log('[classify-once] fetching applications')

  const { data: applications, error } = await supabaseAdmin
    .from('applications')
    .select('id, site_id, title, description')

  if (error || !applications) {
    console.error('[classify-once] fetch failed:', error)
    process.exit(1)
  }

  console.log(
    `[classify-once] processing ${applications.length} applications`,
  )

  let withSignals = 0
  let totalSignals = 0
  let opportunitiesCreated = 0
  let opportunitiesUpdated = 0
  let opportunitiesUnchanged = 0
  const unmatchedSamples: string[] = []

  for (const app of applications) {
    const text = `${app.title ?? ''} ${app.description ?? ''}`
    const signals = classifyApplication(text)

    if (signals.length === 0) {
      if (unmatchedSamples.length < 10) {
        unmatchedSamples.push(
          (app.description ?? '').replace(/\s+/g, ' ').slice(0, 180),
        )
      }
      continue
    }
    withSignals++

    // 1. Wipe old signals for this application (idempotent)
    const { error: delErr } = await supabaseAdmin
      .from('signals')
      .delete()
      .eq('application_id', app.id)
    if (delErr) {
      console.error(
        `[classify-once] failed to wipe signals for ${app.id}:`,
        delErr,
      )
      continue
    }

    // 2. Insert new signals
    const signalRows = signals.map((s) => ({
      application_id: app.id,
      tier: s.tier,
      type: s.type,
      weight: s.weight,
      lead_time_months: s.leadTimeMonths,
      source_phrase: s.sourcePhrase,
      confidence: s.confidence,
    }))

    const { error: sigErr } = await supabaseAdmin
      .from('signals')
      .insert(signalRows)
    if (sigErr) {
      console.error(
        `[classify-once] signal insert failed for ${app.id}:`,
        sigErr,
      )
      continue
    }
    totalSignals += signals.length

    // 3. Upsert opportunity for this site (max-of-existing-vs-new for now)
    const newScore = scoreOpportunity(signals)

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
        opportunitiesUpdated++
      } else {
        opportunitiesUnchanged++
      }
    } else {
      await supabaseAdmin.from('opportunities').insert({
        site_id: app.site_id,
        opportunity_score: newScore,
        state: 'surveillance',
      })
      opportunitiesCreated++
    }
  }

  console.log('[classify-once] done')
  console.log(
    `  ${withSignals}/${applications.length} applications matched at least one signal`,
  )
  console.log(`  ${totalSignals} signals inserted`)
  console.log(`  opportunities: ${opportunitiesCreated} new, ${opportunitiesUpdated} updated, ${opportunitiesUnchanged} unchanged`)

  if (unmatchedSamples.length > 0) {
    console.log('')
    console.log('--- sample of UNMATCHED descriptions (so we can refine rules) ---')
    unmatchedSamples.forEach((d, i) => console.log(`  ${i + 1}. ${d}`))
  }
}

main().catch((err) => {
  console.error('[classify-once] fatal:', err)
  process.exit(1)
})
