/**
 * Clean a deadline value from the old desktop app format.
 * Converts "—", "—", empty strings, and invalid dates to null.
 */
export function cleanDeadline(d: unknown): string | null {
  if (!d) return null;
  if (typeof d !== "string") return null;
  const trimmed = d.trim();
  if (!trimmed || trimmed === "—" || trimmed === "\u2014" || trimmed === "-" || trimmed === "N/A") return null;
  // Validate it looks like a date
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  // Try parsing
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split("T")[0];
}

/**
 * Detect the type of JSON file from old desktop app.
 */
export function detectFileType(data: Record<string, unknown>): "project" | "template" | "projects_list" | "routine" | "unknown" {
  if (Array.isArray(data.projects)) return "projects_list";
  if (data.tasks && Array.isArray(data.tasks) && "checked" in data) return "routine";
  if (data.tasks && Array.isArray(data.tasks) && ("title" in data || "description" in data || "elapsed_seconds" in data)) return "project";
  if (data.tasks && Array.isArray(data.tasks) && "name" in data && !("title" in data)) return "template";
  return "unknown";
}
