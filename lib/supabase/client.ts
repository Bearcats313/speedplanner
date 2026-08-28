import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client. Auth only (login/logout) — every data read and
 * write goes through server actions, never straight from the client. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
