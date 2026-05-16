/**
 * Sprint 1.5 — enrich qualified opportunities with detail-page data.
 *
 *   npx tsx --env-file=.env.cloud scripts/enrich-once.ts
 *   npx tsx --env-file=.env.local scripts/enrich-once.ts
 *
 * For every application that has at least one signal, visits the IDOX
 * detail page and pulls out applicant, agent, use class, etc.
 *
 * Cheap because it only runs for qualified hospitality leads — usually 1-5
 * per scrape, not the full 50.
 */

import { supabaseAdmin } from '../lib/db/client'
import { scrapeWestminsterDetail } from '../lib/scrapers/westminster'

async function main() {
  console.log('[enrich-once] finding applications with signals')

  // Get distinct application_ids that have signals
  const { data: sigRows, error: sigErr } = await supabaseAdmin
    .from('signals')
    .select('application_id')

  if (sigErr) {
    console.error('[enrich-once] failed to fetch signals:', sigErr)
    process.exit(1)
  }

  const appIds = Array.from(
    new Set((sigRows ?? []).map((r) => r.application_id).filter(Boolean)),
  )

  if (appIds.length === 0) {
    console.log('[enrich-once] no applications with signals — nothing to enrich')
    return
  }

  const { data: applications, error: appErr } = await supabaseAdmin
    .from('applications')
    .select('id, planning_ref, source_url, applicant, agent')
    .in('id', appIds)

  if (appErr || !applications) {
    console.error('[enrich-once] failed to fetch applications:', appErr)
    process.exit(1)
  }

  console.log(`[enrich-once] enriching ${applications.length} applications`)

  let enriched = 0
  let failed = 0
  let skipped = 0

  for (const app of applications) {
    if (!app.source_url) {
      console.log(`  - ${app.planning_ref}: no source URL, skip`)
      skipped++
      continue
    }

    console.log(`  → ${app.planning_ref}`)
    const detail = await scrapeWestminsterDetail(app.source_url)

    if (!detail) {
      console.log(`    failed`)
      failed++
      continue
    }

    const updates: Record<string, string | null> = {}
    if (detail.applicant) updates.applicant = detail.applicant
    if (detail.agent) updates.agent = detail.agent
    if (detail.use_class) updates.use_class = detail.use_class

    if (Object.keys(updates).length === 0) {
      console.log(`    nothing to update`)
      skipped++
      continue
    }

    const { error: updErr } = await supabaseAdmin
      .from('applications')
      .update(updates)
      .eq('id', app.id)

    if (updErr) {
      console.log(`    update failed: ${updErr.message}`)
      failed++
      continue
    }

    console.log(
      `    ✓ applicant="${detail.applicant ?? '-'}" agent="${detail.agent ?? '-'}" use_class="${detail.use_class ?? '-'}"`,
    )
    enriched++
  }

  console.log('')
  console.log(`[enrich-once] done: ${enriched} enriched, ${skipped} skipped, ${failed} failed`)
}

main().catch((err) => {
  console.error('[enrich-once] fatal:', err)
  process.exit(1)
})
