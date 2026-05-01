import { SupabaseClient } from "@supabase/supabase-js";

export async function logActivity(
  supabase: SupabaseClient,
  userId: string,
  projectId: string | null,
  action: string,
  detail: string = ""
) {
  await supabase.from("activity_log").insert({
    user_id: userId,
    project_id: projectId,
    action,
    detail,
  });
}
