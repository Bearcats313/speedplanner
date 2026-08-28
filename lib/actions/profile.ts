"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "./require-user";
import type { Profile } from "@/lib/db/types";

export async function getProfile(): Promise<Profile> {
  const { supabase, userId } = await requireUser();
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (error || !data) throw new Error(error?.message ?? "Profile not found");
  return data as Profile;
}

export async function updateProfile(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const difficulty = Number(formData.get("difficulty"));
  const speedianceEmail = String(formData.get("speediance_email") ?? "").trim() || null;

  const { error } = await supabase
    .from("profiles")
    .update({ difficulty, speediance_email: speedianceEmail })
    .eq("id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}
