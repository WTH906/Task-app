import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Execute a Supabase query builder without blocking the caller.
 *
 * IMPORTANT: a PostgREST query builder is a *lazy thenable* — it only issues
 * the HTTP request when `.then()` is called. Writing
 *
 *     supabase.from("x").update({...}).eq("id", id);   // ← never runs
 *
 * silently does nothing at all. Every background write must go through this
 * helper (or be awaited) so the request is actually sent and failures surface
 * in the console instead of vanishing.
 */
export function fireAndForget(
  query: PromiseLike<{ error: { message: string } | null }>,
  label: string
): void {
  Promise.resolve(query).then(
    ({ error }) => { if (error) console.error(`[${label}] ${error.message}`); },
    (err) => console.error(`[${label}]`, err)
  );
}

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

/**
 * Start a handler that may or may not be asynchronous, without leaving a
 * floating promise behind.
 *
 * Event handlers can't be `async` without confusing React, and `void fn()` is
 * banned by the lint config for good reason: `void supabase.from(...)` looks
 * like it dispatches a write and doesn't, which is the single bug class that
 * config exists to catch. So callbacks whose props are typed
 * `() => void | Promise<void>` route through here instead — the promise is
 * settled, and a rejection is reported rather than swallowed by the runtime.
 *
 * This is for handlers that already surface their own errors to the user;
 * the console line is the last resort, not the user-facing message.
 */
export function run(result: void | Promise<void>, label: string): void {
  if (result && typeof (result as Promise<void>).then === "function") {
    (result as Promise<void>).catch((err) => console.error(`[${label}]`, err));
  }
}
