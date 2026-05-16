import { chromium, type Page } from 'playwright'
import { writeFile } from 'fs/promises'
import { join } from 'path'

const BASE_URL = 'https://idoxpa.westminster.gov.uk/online-applications'

export interface ScrapedApplication {
  planning_ref: string
  address: string
  description: string
  status: string
  received_date: string | null   // ISO YYYY-MM-DD
  source_url: string
}

export interface ScrapeOptions {
  daysBack?: number      // how far back to search; default 30
  maxResults?: number    // cap on total rows; default 50
  headless?: boolean     // run browser headless; default true
}

/**
 * Scrape recent planning applications from Westminster's IDOX PublicAccess
 * portal. Returns up to `maxResults` applications received in the last
 * `daysBack` days.
 */
export async function scrapeWestminster(
  opts: ScrapeOptions = {},
): Promise<ScrapedApplication[]> {
  const daysBack = opts.daysBack ?? 30
  const maxResults = opts.maxResults ?? 50
  const headless = opts.headless ?? true

  console.log(
    `[westminster] starting: last ${daysBack} days, max ${maxResults} results`,
  )

  const browser = await chromium.launch({ headless })
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()

  try {
    const today = new Date()
    const fromDate = new Date(today.getTime() - daysBack * 24 * 60 * 60 * 1000)
    const fromStr = formatDateUK(fromDate)
    const toStr = formatDateUK(today)

    console.log(`[westminster] navigating to advanced search`)
    await page.goto(`${BASE_URL}/search.do?action=advanced`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    console.log(`[westminster]   url: ${page.url()}`)
    console.log(`[westminster]   title: ${await page.title()}`)

    // Dismiss any cookie banner if present
    await dismissCookieBanner(page)

    console.log(`[westminster] filling date range: ${fromStr} -> ${toStr}`)
    await page.fill('input[name="date(applicationReceivedStart)"]', fromStr)
    await page.fill('input[name="date(applicationReceivedEnd)"]', toStr)

    console.log(`[westminster] submitting search`)
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.click('input[type="submit"][value="Search"]'),
    ])
    console.log(`[westminster]   url after submit: ${page.url()}`)
    console.log(`[westminster]   title after submit: ${await page.title()}`)

    // Wait for either the results list or a "no results" indicator
    await page
      .waitForSelector('#searchresults, .messagebox, .pageContent', {
        timeout: 15_000,
      })
      .catch(() => {})

    const results: ScrapedApplication[] = []
    let pageNum = 1

    while (results.length < maxResults) {
      console.log(`[westminster] parsing page ${pageNum}`)
      const pageResults = await parseResultsPage(page)
      console.log(`[westminster]   found ${pageResults.length} rows`)

      if (pageResults.length === 0) {
        // Dump debug artefacts so we can see what we got
        await dumpDebug(page, `westminster-page${pageNum}`)
        break
      }
      results.push(...pageResults)

      if (results.length >= maxResults) break

      const nextCount = await page.locator('a.next').count()
      if (nextCount === 0) {
        console.log(`[westminster]   no more pages`)
        break
      }

      await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        page.click('a.next'),
      ])
      pageNum++
      await page.waitForTimeout(1000) // be polite
    }

    return results.slice(0, maxResults)
  } finally {
    await browser.close()
  }
}

/**
 * Parse the current results page. Returns one entry per IDOX search row.
 * Selectors verified against Westminster IDOX HTML (May 2026).
 *
 * NOTE: Everything is inlined — no nested `function` declarations — because
 * tsx/esbuild adds a `__name` helper that isn't available in browser context.
 */
async function parseResultsPage(page: Page): Promise<ScrapedApplication[]> {
  return page.evaluate(() => {
    const origin = 'https://idoxpa.westminster.gov.uk'
    const monthMap: Record<string, number> = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    }

    const items = Array.from(
      document.querySelectorAll('#searchresults li.searchresult'),
    )

    return items
      .map((item) => {
        const linkEl = item.querySelector(
          'a.summaryLink',
        ) as HTMLAnchorElement | null
        const detailHref = linkEl?.getAttribute('href') ?? ''

        const descRaw =
          item.querySelector('.summaryLinkTextClamp')?.textContent ?? ''
        const description = descRaw.replace(/\s+/g, ' ').trim()

        const addressRaw =
          item.querySelector('p.address')?.textContent ?? ''
        const address = addressRaw.replace(/\s+/g, ' ').trim()

        const statusRaw =
          item.querySelector('.badge-status .value')?.textContent ?? ''
        const status = statusRaw.replace(/\s+/g, ' ').trim()

        // metaInfo contains plain text labels like:
        //   "Ref. No: 26/03075/ADFULL · Received: Mon 11 May 2026 · Validated: ..."
        const metaRaw =
          item.querySelector('p.metaInfo')?.textContent ?? ''
        const metaText = metaRaw.replace(/\s+/g, ' ').trim()

        const refMatch = metaText.match(
          /Ref\.\s*No\.?\s*:?\s*([0-9A-Za-z/\-_]+)/i,
        )
        const planning_ref = refMatch ? refMatch[1].trim() : ''

        let received_date: string | null = null
        const receivedMatch = metaText.match(
          /Received:\s*(?:\w{3}\s+)?(\d{1,2})\s+(\w{3})\s+(\d{4})/i,
        )
        if (receivedMatch) {
          const day = parseInt(receivedMatch[1], 10)
          const month = monthMap[receivedMatch[2]]
          const year = parseInt(receivedMatch[3], 10)
          if (month !== undefined) {
            const d = new Date(Date.UTC(year, month, day))
            received_date = d.toISOString().slice(0, 10)
          }
        }

        const fullUrl = detailHref.startsWith('http')
          ? detailHref
          : `${origin}${detailHref}`

        return {
          planning_ref,
          address,
          description,
          status,
          received_date,
          source_url: fullUrl,
        }
      })
      .filter((r) => r.planning_ref) // drop any row we couldn't parse
  })
}

function formatDateUK(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

// ====================================================================
// DETAIL PAGE SCRAPING — visit a specific application's detail page
// and pull out applicant, agent, use class, etc.
// ====================================================================

export interface ScrapedDetail {
  applicant: string | null
  agent: string | null
  use_class: string | null
  application_type: string | null
  case_officer: string | null
  decision: string | null
}

/**
 * Visit an IDOX application detail page and extract richer fields.
 * Returns null if the page can't be parsed.
 *
 * IDOX detail pages have multiple tabs (summary, furtherInformation,
 * contacts, dates). We visit each and accumulate fields.
 */
export async function scrapeWestminsterDetail(
  detailUrl: string,
  opts: { headless?: boolean } = {},
): Promise<ScrapedDetail | null> {
  const headless = opts.headless ?? true
  const browser = await chromium.launch({ headless })
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()

  try {
    const fieldMap: Record<string, string> = {}
    const tabsToTry = ['summary', 'furtherInformation', 'contacts', 'dates']

    for (const tab of tabsToTry) {
      const tabUrl = /activeTab=\w+/.test(detailUrl)
        ? detailUrl.replace(/activeTab=\w+/, `activeTab=${tab}`)
        : `${detailUrl}${detailUrl.includes('?') ? '&' : '?'}activeTab=${tab}`

      try {
        await page.goto(tabUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        })
      } catch (err) {
        console.log(`[westminster] failed to load tab '${tab}': ${(err as Error).message}`)
        continue
      }

      // Accumulate fields from this tab
      const tabFields = await page.evaluate(() => {
        const map: Record<string, string> = {}
        // Generic: any table row with th + td, any dt/dd pair
        document
          .querySelectorAll(
            '#applicationDetails table tr, #simpleDetailsTable tr, table tr',
          )
          .forEach((tr) => {
            const th =
              tr.querySelector('th')?.textContent?.replace(/\s+/g, ' ').trim() ??
              ''
            const td =
              tr.querySelector('td')?.textContent?.replace(/\s+/g, ' ').trim() ??
              ''
            if (th && td) {
              const key = th.toLowerCase().replace(/[:\s]+$/, '')
              map[key] = td
            }
          })
        document.querySelectorAll('dl dt').forEach((dt) => {
          const label = dt.textContent?.replace(/\s+/g, ' ').trim() ?? ''
          const dd = dt.nextElementSibling
          if (dd && dd.tagName === 'DD') {
            const value = dd.textContent?.replace(/\s+/g, ' ').trim() ?? ''
            if (label && value) {
              const key = label.toLowerCase().replace(/[:\s]+$/, '')
              map[key] = value
            }
          }
        })
        return map
      })

      Object.assign(fieldMap, tabFields)
    }

    // If we got nothing, dump the last page's HTML so we can debug
    if (Object.keys(fieldMap).length === 0) {
      const html = await page.content()
      const dumpPath = join(process.cwd(), 'debug-detail.html')
      await writeFile(dumpPath, html, 'utf8')
      const png = join(process.cwd(), 'debug-detail.png')
      await page.screenshot({ path: png, fullPage: true }).catch(() => {})
      console.log(`[westminster] DEBUG: saved ${dumpPath} (no fields found on any tab)`)
    } else {
      console.log(
        `[westminster] detail keys found (${Object.keys(fieldMap).length}):`,
      )
      Object.entries(fieldMap).forEach(([k, v]) => {
        console.log(`    "${k}" = "${v.slice(0, 80)}${v.length > 80 ? '…' : ''}"`)
      })
    }

    // Look up the fields we want from the accumulated field map.
    // Pure Node-side code — no page.evaluate, no __name helper risk.
    const pickField = (keys: string[]): string | null => {
      for (const k of keys) {
        if (fieldMap[k] && fieldMap[k].trim() !== '') return fieldMap[k].trim()
      }
      return null
    }

    return {
      applicant: pickField([
        'applicant name',
        'applicant',
        'name of applicant',
      ]),
      agent: pickField(['agent name', 'agent', 'name of agent']),
      use_class: pickField([
        'existing use class',
        'proposed use class',
        'use class',
      ]),
      application_type: pickField(['application type', 'application']),
      case_officer: pickField(['case officer', 'officer']),
      decision: pickField(['decision', 'decision issued']),
    }
  } catch (err) {
    console.error(`[westminster] detail scrape failed for ${detailUrl}:`, err)
    return null
  } finally {
    await browser.close()
  }
}

async function dismissCookieBanner(page: Page): Promise<void> {
  // Common cookie banner patterns
  const candidates = [
    'button:has-text("Accept all")',
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
    'button:has-text("I agree")',
    '#ccc-notify-accept',
    'a.ccc-notify-accept',
  ]
  for (const sel of candidates) {
    const el = page.locator(sel).first()
    if ((await el.count()) > 0) {
      try {
        await el.click({ timeout: 2000 })
        console.log(`[westminster] dismissed cookie banner (${sel})`)
        await page.waitForTimeout(500)
        return
      } catch {
        // try next
      }
    }
  }
}

async function dumpDebug(page: Page, label: string): Promise<void> {
  const outDir = process.cwd()
  const htmlPath = join(outDir, `debug-${label}.html`)
  const pngPath = join(outDir, `debug-${label}.png`)

  try {
    const html = await page.content()
    await writeFile(htmlPath, html, 'utf8')
    await page.screenshot({ path: pngPath, fullPage: true })
    console.log(`[westminster] DEBUG: saved ${htmlPath} and ${pngPath}`)

    // Also log a quick summary of what's on the page (everything inlined)
    const summary = await page.evaluate(() => ({
      counts: {
        searchresults_li:
          document.querySelectorAll('#searchresults li').length,
        searchresult_li:
          document.querySelectorAll('li.searchresult').length,
        any_li: document.querySelectorAll('li').length,
        tables: document.querySelectorAll('table').length,
        forms: document.querySelectorAll('form').length,
        messagebox: document.querySelectorAll('.messagebox').length,
      },
      headings: Array.from(document.querySelectorAll('h1, h2, h3'))
        .map((h) => (h.textContent ?? '').trim())
        .filter((t) => t.length > 0)
        .slice(0, 5),
    }))
    console.log(`[westminster] DEBUG summary:`, JSON.stringify(summary, null, 2))
  } catch (err) {
    console.error(`[westminster] DEBUG dump failed:`, err)
  }
}
