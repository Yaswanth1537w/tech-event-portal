import { isUserRole } from "@/lib/auth/roles";
import { getSupabasePublicEnvOrNull } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/database";

export async function getCurrentProfile(): Promise<Profile | null> {
  if (!getSupabasePublicEnvOrNull()) {
    return null;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, full_name, roll_number, department, role")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile || !isUserRole(profile.role)) {
    return null;
  }

  return profile;
}
