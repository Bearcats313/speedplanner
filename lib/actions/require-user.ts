import { createClient } from "@/lib/supabase/server";

/** Every server action needs the caller's id for RLS-scoped queries and to
 * refuse a signed-out request outright. Not exported as a server action
 * itself — just a shared guard. */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Not signed in");
  return { supabase, userId: user.id };
}
