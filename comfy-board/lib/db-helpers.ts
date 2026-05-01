import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Batch-reorder rows using a single RPC call instead of N individual UPDATEs.
 * Requires the `reorder_rows` function from migration v5.
 */
export async function reorderRows(
  supabase: SupabaseClient,
  table: string,
  ids: string[],
  userId: string
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("reorder_rows", {
    p_table: table,
    p_ids: ids,
    p_user_id: userId,
  });
  if (error) return { error: error.message };
  return {};
}

/**
 * Batch-reorder subtasks (keyed by user_id).
 */
export async function reorderSubtasks(
  supabase: SupabaseClient,
  ids: string[],
  userId: string
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("reorder_subtasks", {
    p_ids: ids,
    p_user_id: userId,
  });
  if (error) return { error: error.message };
  return {};
}

/**
 * Clean up old activity log entries, keeping the most recent N.
 */
export async function cleanupActivityLog(
  supabase: SupabaseClient,
  userId: string,
  keep: number = 500
): Promise<number> {
  const { data, error } = await supabase.rpc("cleanup_activity_log", {
    p_user_id: userId,
    p_keep: keep,
  });
  if (error) return 0;
  return data ?? 0;
}
