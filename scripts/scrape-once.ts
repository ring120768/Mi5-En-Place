/**
 * Sprint 1 — one-shot Westminster scrape.
 *
 * Pulls recent planning applications, finds-or-creates the site, and upserts
 * the application. Run from the mi5-app folder:
 *
 *   npx tsx --env-file=.env.local scripts/scrape-once.ts
 */

import { scrapeWestminster } from '../lib/scrapers/westminster'
import { supabaseAdmin } from '../lib/db/client'

async function main() {
  console.log('[scrape-once] starting Westminster scrape')

  const apps = await scrapeWestminster({
    daysBack: 30,
    maxResults: 50,
    headless: true,
  })

  console.log(`[scrape-once] scraper returned ${apps.length} applications`)

  let created = 0
  let updated = 0
  let failed = 0

  for (const app of apps) {
    try {
      // 1. Find or create the site (exact address match for now)
      const postcode = extractPostcode(app.address) ?? 'UNKNOWN'
      const siteId = await findOrCreateSite(app.address, postcode)

      // 2. Upsert the application (idempotent on source + planning_ref)
      const { error: appErr, data: appData } = await supabaseAdmin
        .from('applications')
        .upsert(
          {
            site_id: siteId,
            source: 'westminster_planning',
            planning_ref: app.planning_ref,
            // IDOX has no separate title — use the truncated description
            title: app.description.slice(0, 200),
            description: app.description,
            status: app.status,
            received_date: app.received_date,
            source_url: app.source_url,
          },
          {
            onConflict: 'source,planning_ref',
            ignoreDuplicates: false,
          },
        )
        .select('id, created_at, updated_at')
        .single()

      if (appErr || !appData) {
        console.error(
          `[scrape-once] upsert failed for ${app.planning_ref}:`,
          appErr,
        )
        failed++
        continue
      }

      // Rough "created vs updated" — if created and updated are the same,
      // this was a fresh insert.
      const wasInsert =
        new Date(appData.updated_at).getTime() -
          new Date(appData.created_at).getTime() <
        1000
      if (wasInsert) created++
      else updated++
    } catch (err) {
      console.error(`[scrape-once] error on ${app.planning_ref}:`, err)
      failed++
    }
  }

  console.log(
    `[scrape-once] done: ${created} created, ${updated} updated, ${failed} failed`,
  )
}

async function findOrCreateSite(
  address: string,
  postcode: string,
): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from('sites')
    .select('id')
    .eq('address_line', address)
    .eq('postcode', postcode)
    .maybeSingle()

  if (existing) return existing.id

  const { data: created, error } = await supabaseAdmin
    .from('sites')
    .insert({
      address_line: address,
      postcode,
      borough: 'westminster',
    })
    .select('id')
    .single()

  if (error || !created) {
    throw new Error(`failed to create site: ${error?.message}`)
  }
  return created.id
}

function extractPostcode(address: string): string | null {
  // Rough UK postcode regex; good enough for first pass
  const match = address.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)
  return match ? match[0].toUpperCase().replace(/\s+/g, ' ') : null
}

main().catch((err) => {
  console.error('[scrape-once] fatal:', err)
  process.exit(1)
})
