'use server'

/**
 * Server Actions for the dashboard.
 *
 * These run on the server (never in the browser), use the admin Supabase
 * client to bypass RLS, and revalidate the page cache so the UI reflects
 * the change immediately after the form submit.
 *
 * Per Intelligence Architecture v1.2 §9, save/ignore are first-class
 * signals — Ian's clicks become training data for the scorer in Phase 2+.
 */

import { supabaseAdmin } from '@/lib/db/client'
import { revalidatePath } from 'next/cache'

export async function markSaved(opportunityId: string) {
  await supabaseAdmin
    .from('opportunities')
    .update({
      saved: true,
      ignored: false,
      last_updated_at: new Date().toISOString(),
    })
    .eq('id', opportunityId)
  revalidatePath('/')
}

export async function markIgnored(opportunityId: string) {
  await supabaseAdmin
    .from('opportunities')
    .update({
      saved: false,
      ignored: true,
      last_updated_at: new Date().toISOString(),
    })
    .eq('id', opportunityId)
  revalidatePath('/')
}

export async function resetMark(opportunityId: string) {
  await supabaseAdmin
    .from('opportunities')
    .update({
      saved: false,
      ignored: false,
      last_updated_at: new Date().toISOString(),
    })
    .eq('id', opportunityId)
  revalidatePath('/')
}
