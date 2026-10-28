"use client";

import { createBrowserClient } from "@supabase/ssr";

// NEXT_PUBLIC_ values are inlined at build time and are safe to expose only
// because every table is protected by tested RLS policies.
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
