import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

// Public client — read-only paths, safe in browser/Server Components.
export const supabase: SupabaseClient = createClient(
  supabaseUrl,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
)

// Admin client — server-only, bypasses RLS. Use for scrapers & writers.
export const supabaseAdmin: SupabaseClient = createClient(
  supabaseUrl,
  process.env.SUPABASE_SECRET_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
)
