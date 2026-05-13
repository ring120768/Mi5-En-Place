import { supabaseAdmin } from '@/lib/db/client'
import { markSaved, markIgnored, resetMark } from './actions'

// Always re-fetch on each request — local DB, no caching benefit
export const dynamic = 'force-dynamic'

interface SignalRow {
  type: string
  tier: string
  weight: number
  source_phrase: string | null
}

interface ApplicationRow {
  id: string
  planning_ref: string
  description: string | null
  status: string | null
  received_date: string | null
  source_url: string | null
  signals: SignalRow[] | null
}

interface SiteRow {
  address_line: string | null
  postcode: string | null
  applications: ApplicationRow[] | null
}

interface OpportunityRow {
  id: string
  opportunity_score: number
  state: string
  last_updated_at: string
  notes: string | null
  saved: boolean
  ignored: boolean
  sites: SiteRow | null
}

function classifyScore(score: number): { label: string; colour: string } {
  if (score >= 80) return { label: 'High Priority Target', colour: 'text-red-400' }
  if (score >= 60) return { label: 'Warm', colour: 'text-amber-400' }
  if (score >= 40) return { label: 'Cold', colour: 'text-zinc-400' }
  return { label: 'Archive', colour: 'text-zinc-600' }
}

export default async function HomePage() {
  const { data, error } = await supabaseAdmin
    .from('opportunities')
    .select(`
      id,
      opportunity_score,
      state,
      last_updated_at,
      notes,
      saved,
      ignored,
      sites (
        address_line,
        postcode,
        applications (
          id,
          planning_ref,
          description,
          status,
          received_date,
          source_url,
          signals (
            type,
            tier,
            weight,
            source_phrase
          )
        )
      )
    `)
    .order('opportunity_score', { ascending: false })
    .limit(20)

  if (error) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8 font-mono">
        <h1 className="text-xl mb-4">MI5 EN PLACE</h1>
        <pre className="text-red-400 text-sm whitespace-pre-wrap">
          Error: {error.message}
        </pre>
      </main>
    )
  }

  const opportunities = (data ?? []) as unknown as OpportunityRow[]

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <header className="mb-8 border-b border-zinc-800 pb-4">
        <h1 className="text-2xl font-mono tracking-wider">
          MI5 <span className="text-zinc-500">EN PLACE</span>
        </h1>
        <p className="text-sm text-zinc-400 mt-1 font-mono">
          Hospitality Development Intelligence · Westminster ·{' '}
          {opportunities.length} opportunit
          {opportunities.length === 1 ? 'y' : 'ies'}
        </p>
      </header>

      {opportunities.length === 0 && (
        <p className="text-zinc-500 font-mono text-sm">
          No opportunities yet. Run <code>npx tsx --env-file=.env.local scripts/scrape-once.ts</code>
          {' '}then <code>scripts/classify-once.ts</code>.
        </p>
      )}

      <div className="space-y-3">
        {opportunities.map((opp) => {
          const score = Number(opp.opportunity_score)
          const { label, colour } = classifyScore(score)
          const apps = opp.sites?.applications ?? []
          // Flatten all signals across all applications at this site,
          // dedupe by type so we don't show the same signal twice.
          const seenTypes = new Set<string>()
          const signals: SignalRow[] = []
          for (const a of apps) {
            for (const s of a.signals ?? []) {
              if (seenTypes.has(s.type)) continue
              seenTypes.add(s.type)
              signals.push(s)
            }
          }

          const cardClasses = [
            'border rounded transition-colors',
            opp.saved
              ? 'border-emerald-700 bg-emerald-950/30 hover:bg-emerald-950/40'
              : opp.ignored
                ? 'border-zinc-900 bg-zinc-950/40 opacity-40 hover:opacity-60'
                : 'border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900',
          ].join(' ')

          return (
            <article key={opp.id} className={cardClasses}>
              <div className="p-4">
                <div className="flex items-baseline justify-between gap-4 mb-2">
                  <h2 className="text-base font-semibold leading-tight">
                    {opp.sites?.address_line ?? 'Unknown address'}
                  </h2>
                  <div className="text-right shrink-0">
                    <div className={`font-mono text-3xl leading-none ${colour}`}>
                      {score.toFixed(0)}
                    </div>
                    <div className={`text-[10px] uppercase tracking-widest mt-1 ${colour}`}>
                      {label}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 text-xs text-zinc-500 font-mono mb-3 items-center">
                  <span>{opp.sites?.postcode ?? '—'}</span>
                  <span>·</span>
                  <span className="uppercase tracking-wider">{opp.state.replace(/_/g, ' ')}</span>
                  {opp.saved && (
                    <>
                      <span>·</span>
                      <span className="text-emerald-400 uppercase tracking-wider">★ Saved</span>
                    </>
                  )}
                  {opp.ignored && (
                    <>
                      <span>·</span>
                      <span className="text-zinc-500 uppercase tracking-wider">✗ Ignored</span>
                    </>
                  )}
                </div>

                {signals.length > 0 && (
                  <div className="space-y-1 mb-3">
                    {signals.map((s, i) => (
                      <div key={i} className="text-sm">
                        <span className="font-mono text-amber-400">
                          [T{s.tier}] {s.type}
                        </span>
                        {s.source_phrase && (
                          <span className="text-zinc-500 ml-2">
                            — &ldquo;{s.source_phrase}&rdquo;
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 mb-3">
                  {!opp.saved && (
                    <form action={markSaved.bind(null, opp.id)}>
                      <button
                        type="submit"
                        className="px-3 py-1 text-[11px] font-mono uppercase tracking-wider border border-emerald-800 text-emerald-400 hover:bg-emerald-950 transition-colors"
                      >
                        ★ Save
                      </button>
                    </form>
                  )}
                  {!opp.ignored && (
                    <form action={markIgnored.bind(null, opp.id)}>
                      <button
                        type="submit"
                        className="px-3 py-1 text-[11px] font-mono uppercase tracking-wider border border-zinc-700 text-zinc-500 hover:bg-zinc-900 transition-colors"
                      >
                        ✗ Ignore
                      </button>
                    </form>
                  )}
                  {(opp.saved || opp.ignored) && (
                    <form action={resetMark.bind(null, opp.id)}>
                      <button
                        type="submit"
                        className="px-3 py-1 text-[11px] font-mono uppercase tracking-wider border border-zinc-700 text-zinc-400 hover:bg-zinc-900 transition-colors"
                      >
                        ↺ Reset
                      </button>
                    </form>
                  )}
                </div>

                {apps.length > 0 && (
                  <details className="text-xs">
                    <summary className="text-zinc-500 cursor-pointer hover:text-zinc-300 font-mono">
                      {apps.length} application{apps.length === 1 ? '' : 's'}
                    </summary>
                    <div className="mt-2 space-y-2 pl-4 border-l border-zinc-800">
                      {apps.map((a) => (
                        <div key={a.id} className="text-xs">
                          <div className="flex gap-2 items-baseline">
                            <a
                              href={a.source_url ?? '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:underline font-mono"
                            >
                              {a.planning_ref}
                            </a>
                            <span className="text-zinc-600">·</span>
                            <span className="text-zinc-500">{a.status}</span>
                            <span className="text-zinc-600">·</span>
                            <span className="text-zinc-500">{a.received_date ?? '—'}</span>
                          </div>
                          {a.description && (
                            <p className="text-zinc-400 mt-1 leading-snug">
                              {a.description.slice(0, 280)}
                              {a.description.length > 280 && '…'}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </article>
          )
        })}
      </div>

      <footer className="mt-12 pt-4 border-t border-zinc-800 text-[10px] text-zinc-600 font-mono uppercase tracking-widest">
        Sprint 1 · Phase 1a · Metadata only
      </footer>
    </main>
  )
}
