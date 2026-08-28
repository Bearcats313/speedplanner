import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client, scoped to the signed-in user via cookies.
 * RLS enforces the two-user isolation — this client never bypasses it.
 * Use this from server actions and route handlers.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component render; the middleware
            // refreshes the session cookie instead. Safe to ignore.
          }
        },
      },
    },
  );
}

/**
 * Service-role client. Bypasses RLS entirely. Never import this from
 * anything that renders or handles a request on behalf of a browser —
 * it is for scripts/*.ts only (catalog import and enrichment).
 */
export function createServiceRoleClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
