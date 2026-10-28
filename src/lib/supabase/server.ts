import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getServerConfig } from "@/lib/config/server";

/** Acts as the signed-in user; subject to RLS. */
export async function createUserClient(): Promise<SupabaseClient> {
  // Read cookies first: it marks the caller as request-time, so config is
  // never evaluated during prerendering.
  const cookieStore = await cookies();
  const config = getServerConfig();
  return createServerClient(config.NEXT_PUBLIC_SUPABASE_URL, config.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The proxy refreshes the session instead.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS, so every query must be scoped to the
 * authenticated user id from `getCurrentUser()` or to a validated capability.
 */
export function createAdminClient(): SupabaseClient {
  const config = getServerConfig();
  return createClient(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type CurrentUser = { id: string; email: string | null };

/** Verifies the session with the Auth server; never trusts unverified cookies. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}
