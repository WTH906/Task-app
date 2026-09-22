# Comfy Board — Path to Production Grade

Written 11 Aug 2026, after a full read of `app/`, `components/`, `lib/`, `middleware.ts` and the complete migration history v1–v18.

---

## 0. First, three corrections to my earlier audit

I audited the code before I had the full SQL. Three things I flagged were wrong, and you should not spend time on them:

| I said | Reality |
|---|---|
| "12 tables may have no RLS" | **Wrong.** Every table has RLS enabled with a correct owner policy. I had only staged 5 of the 21 migration files. |
| "`reorder_rows` may let a client pass another user's id" | **Wrong.** It checks `auth.uid() IS DISTINCT FROM p_user_id` and raises, and has a table allowlist. It's a well-written `SECURITY DEFINER` function. |
| "`contact_tag_links` has no policy" | **Wrong.** v10 gives it a correct `EXISTS (SELECT 1 FROM contacts …)` join policy — the right pattern for a link table with no `user_id`. |

The one security item that was real is **worse** than I described. See P0-1.

---

## 1. Where this actually stands

Let me be straight with you, because I think you'll get more from that than from encouragement.

**This is a good app.** The feature set is unusually coherent for a solo project — daily/weekly/monthly/yearly routines, projects with subtasks and per-task timers, a planner that mirrors both, deadlines, monitoring, contacts, work clock, stats with export, six themes. Most personal productivity tools built by one person stop at "todo list with checkboxes." This didn't.

**The SQL is the strongest part of the codebase.** I did not expect that. v5 in particular — FK backfills, CHECK constraints, trigram indexes for search, `SECURITY DEFINER` functions with `auth.uid()` verification and a table allowlist, storage policies scoped by path segment — is better than what I see in a lot of funded products. The composite indexes in v6 are exactly the ones the query patterns need. Someone thought carefully here.

**The TypeScript is where it falls down**, and there's a clear reason: the app was built feature-first, at speed, with correctness assumed rather than verified. That's a completely reasonable way to build a personal tool. It's not a way to reach production grade. The evidence:

- ~20 database writes that never executed, in code that had shipped and been used for months. The timer's `time_logs` insert has never once run — **every second you have ever tracked is missing from your stats**. Nobody noticed, because nothing checks.
- Zero `useMemo`, `useCallback` on list handlers, or `React.memo` in the entire repository. Not "too few" — zero.
- No tests. No CI. No error reporting. No linting beyond `next lint`, which isn't in any pipeline.
- 47KB and 43KB single-file page components with 30+ `useState` calls.

The gap between "works when I use it" and "production grade" is almost entirely a gap in **verification**, not in ability. You clearly know how to write good SQL and design a sensible feature. What's missing is the machinery that tells you when something silently stopped working.

**Honest verdict:** as a personal tool, it's ~85% there and the remaining 15% is polish. As something other people depend on, it's maybe 40% there, and the missing 60% is mostly infrastructure you haven't needed yet. The good news is that infrastructure is largely mechanical to add.

---

## 2. The one architectural decision that causes most of the bugs

Almost every correctness bug I found traces to a single design choice:

> `week_tasks` and `deadlines` are **denormalized copies** of data that lives in `project_tasks` and `subtasks`, kept in sync by hand-written functions called from ~14 different places.

`week_tasks.text` is `"[Project] Task name"` — a **rendered string**, not a reference. Colour, the tag breakdown in stats, and project attribution are all derived by regex-parsing that string back apart at render time.

Every one of these was a direct consequence:

- Renaming a task didn't update the planner (one of 14 call sites forgot).
- Dragging a task to another project left the old `[Project]` prefix, so it showed the wrong colour and counted under the wrong tag in stats.
- Deleting a task left an unreachable deadline card.
- Archiving a task left it in the planner.
- Editing `est_minutes` un-completed the task everywhere.
- Subtask deadlines were keyed by the rendered label, so two subtasks with the same name deleted each other's.
- Checking a task in the planner vs. the day page vs. the dashboard produced three different persisted states.

I patched all of these. **They will come back**, because the design still requires every future mutation to remember all its mirrors, and nothing enforces that.

### The fix

Make the planner a **view over** the source data rather than a copy of it.

- `week_tasks` keeps only rows it genuinely owns: ad-hoc entries the user typed into a day, with no project link.
- Project tasks and subtasks appear on a day because their `date_key` says so — resolved at query time, not copied.
- Recurrence is computed from the rule, not materialised (except where you need per-occurrence `done` state, which becomes a thin `task_occurrences(task_id, date_key, done)` table — the only thing that needs to persist per occurrence).
- `[Project]` prefixes disappear entirely. The project is a join, and its colour comes from `projects.color`.

A Postgres view or an RPC returning the merged day list would do it. The planner then cannot disagree with the project page, because there is only one copy of the truth.

**This is a real refactor — I'd estimate 2–4 focused days.** It is also the single highest-leverage thing on this entire document. Everything in P1 below is a symptom of not having done it.

---

## 3. P0 — before anyone but you uses this

### P0-1. The file storage bucket is world-readable

`supabase-migration-files.sql` creates the bucket with `public = true`, and v5 kept:

```sql
CREATE POLICY "Anyone can view task files"
  ON storage.objects FOR SELECT USING (bucket_id = 'task-files');
```

No auth check. This isn't "protected by an unguessable URL" — the policy grants `SELECT` on `storage.objects` to **anyone with the anon key**, which ships in the browser bundle of every deployment. That means listing the bucket and downloading every file every user has ever attached to a task.

Right now that's only your files, so the practical exposure is limited. The moment a second person uses this, it's a data breach.

**Fixed and shipped in this pass:** `supabase-migration-v20-storage-private.sql` + an updated `components/FileAttachment.tsx` that stores object paths and mints 1-hour signed URLs on click. It also forces non-image types to download rather than render, so an uploaded `.svg` or `.html` can't execute against the storage origin. Run the migration and deploy the component together — the SQL has a backfill for existing rows.

### P0-2. Nothing tells you when something breaks

You shipped ~20 writes that never executed and used the app for months without noticing. That is the defining problem, and it's not really a code problem.

Minimum viable version, in rough order of value per hour:

1. **An ESLint rule that makes the lazy-thenable bug impossible.** `@typescript-eslint/no-floating-promises` with `checkThenables: true` catches every single one of the ~20 bugs at author time. This is a 20-minute change and it retires the entire bug class permanently. Do this first.
2. **Error reporting.** Sentry's Next.js SDK is a ~30-minute install. Right now a rejected Supabase write is a `console.error` in a browser you aren't looking at.
3. **CI.** A GitHub Action running `tsc --noEmit` and `next build` on every push. Both already pass — you just aren't running them automatically.

### P0-3. `middleware.ts` fails open

```ts
catch { return supabaseResponse; }
```

Any exception from `supabase.auth.getUser()` — outage, DNS blip, oversized cookie — lets the request through. There's no second gate: `AppShell` renders `{children}` when `user` is null instead of redirecting. Data is still RLS-protected so this isn't a breach, but your only route guard is disabled exactly when things are going wrong.

Fail closed: redirect to `/login` on error, and have `AppShell` redirect on a null user.

### P0-4. No backups, no export, no account deletion

There is no way to get your data out of this app. If you fat-finger a delete or Supabase has a bad day, it's gone. Your own pending list already has "full-account data export" and "delete my account" on it — for anything beyond personal use these are also GDPR obligations, not features.

Turn on Supabase PITR, and write the export as a single RPC returning one JSON blob of every table filtered by `auth.uid()`.

---

## 4. P1 — correctness and reliability

**Run migrations v18 and v19.** v18 (recurrence, subtask deadline FKs, the duplicate-occurrence unique index) is required by code already shipped. v19 closes:

- **Four UPDATE policies missing `WITH CHECK`.** `FOR UPDATE USING (user_id = auth.uid())` gates *which* rows you may touch, not what you may set them to — a user can rewrite `user_id` and hand the row to another account. Affects `weekly_routine_tasks`, `monthly_routine_tasks`, `quick_tasks`, `roadmap_data`.
- Missing UPDATE policies on the routine `_checks` tables (latent, not currently hit).
- Three date columns typed `TEXT` (`week_tasks.rescheduled_to`, `projects.start_date`, `time_logs.date_key`) while every other date is `DATE`.
- `monitored_tasks.subtask_id` was `ON DELETE SET NULL` while `task_id` cascades — deleting a monitored subtask silently converted the entry into a monitored parent task.
- Missing indexes for `/deadlines` sorting and the planner's rescheduled filter.
- `updated_at` triggers, so the database owns those timestamps instead of trusting the client to remember.

**Then, in the code:**

1. **Archiving a project doesn't archive its tasks.** `fetchOverdueTasks` and `fetchTaskDeadlines` filter on `project_tasks.archived_at`, never the project's, and `fetchWeekTasksGrouped` has no archived filter at all. Delete a project and its tasks keep haunting the dashboard from a project you can no longer open.
2. **`user_settings` is dead weight.** v9 created it to "replace localStorage feature flags." The app still reads all of them from `localStorage` — theme, card order, monthly/yearly routine toggles. Your preferences don't follow you between browsers or devices. v19 adds the two missing columns so this is now a pure code change.
3. **Silent catch blocks.** `ActiveTimerBadge` renders "no timer" when the query fails. `SearchModal` renders "no results" when search errors. `app/page.tsx:128` swallows every monthly-routine error with a comment claiming it's about a missing table. A user cannot distinguish "nothing found" from "it broke."
4. **No `app/global-error.tsx`.** A crash in `RootLayout` or `AppShell` is uncaught.
5. **`useCurrentUser` never subscribes to `onAuthStateChange`.** Sign out in another tab and every page keeps a stale `userId`, issuing queries that fail — with P0-3's missing redirect, nothing corrects it.

---

## 5. P2 — performance

I fixed the worst of this already (memoisation in the planner, the 1s tick, the polling badge, optimistic add). What remains:

1. **`useStats.ts` has ~20 sequential `await`s that are almost all independent** — roughly 3 seconds of pure serial latency on the stats page. A single `Promise.all` makes it ~150ms. This is the biggest remaining win and it's nearly mechanical.
2. **Two unbounded full-table scans in the same file** (`routine_checks` and done `week_tasks`, all rows ever) reduced client-side to a 7-element histogram. Add `.gte()` bounds like the streak query already does.
3. **`app/projects/[id]/page.tsx` still hands `TaskItem` a fresh `actions` object and three fresh arrow props on every render**, and `TaskItem` isn't memoised. While a timer runs, every task row and every expanded subtask re-renders once per second — for 30 tasks × 5 subtasks that's ~180 component subtrees per second to update one label. Wrap the handlers in `useCallback`, memoise the actions object, `React.memo` the row.
4. **`select('*')` on the planner's hot path.** The week grid reads 8 columns and fetches all of them; `week_days` is fetched whole for two fields. In month view that's 42 days of full rows.
5. **The sidebar fetches projects twice per mutation** — once from a custom DOM event and once from a realtime subscription on the same table. Also, the channel name is a fixed string, so two `Sidebar` mounts collide.

---

## 6. P3 — product gaps that matter for other users

Things that are fine for one person and not fine for two:

- **No onboarding.** A new user lands on an empty dashboard with ten empty cards and no idea what the app is for. You have this on your list already.
- **No mobile story.** The planner is a 7-column grid. I'd want to know whether it's usable on a phone before showing anyone.
- **No empty states worth the name** on most pages.
- **No undo.** For an app whose core interaction is "check things off," a mis-click on a parent task rewrites every subtask's progress with no way back. Even a 5-second toast-with-undo would cover most of it.
- **Accessibility is unaddressed.** Custom checkboxes without labels, colour as the only signal for project identity and priority, no visible focus states, drag-and-drop with no keyboard equivalent. If anyone using this has a visual impairment, several features are simply unavailable.
- **No rate limiting on auth.** Supabase provides some by default, but you should know what your settings are.
- **Privacy Policy and Terms** — on your list, and legally required the moment you have a second user in most jurisdictions.

---

## 7. Practices worth adopting

Ordered by value per unit of effort. The first two are hours, not days, and would have caught most of what I found.

1. **`no-floating-promises` with `checkThenables`.** Retires the entire lazy-thenable bug class. Highest value per minute in this document.
2. **CI running `tsc --noEmit` + `next build`.** Both already pass.
3. **Get the migrations into version control alongside the code.** They currently live in a separate folder from the app, which is how I ended up auditing against an incomplete schema and telling you your RLS was missing when it wasn't. Consider Supabase CLI migrations so schema and code move together.
4. **Integration tests over the sync layer specifically.** Not unit tests of React components — tests that create a task, tick it from three different screens, and assert the database looks the same each time. That's where your bugs actually live. A dozen such tests would have caught nearly everything in the last two passes.
5. **A staging Supabase project.** You currently develop against production data. One bad migration is unrecoverable without PITR.
6. **Split the two 40KB+ page components.** `app/projects/[id]/page.tsx` is ~1,100 lines with 30+ `useState` calls. This isn't aesthetics — it's why a DB write ended up inside a `setTasks` updater, and why the same toggle logic exists in four places with four different behaviours.
7. **Pick one pattern for mutations and use it everywhere.** Right now there are at least four: `await`-and-check, `.then()`-with-toast, `Promise.all`, and bare fire-and-forget. A single `mutate()` helper that always executes, always surfaces errors, and always handles optimistic rollback would eliminate a whole category of drift.

---

## 8. If I could only pick five

1. Run v18 + v19 + v20 and deploy the updated `FileAttachment` (closes the one real security hole and the schema gaps).
2. Add `no-floating-promises` and CI (~1 hour; retires the bug class that caused most of this).
3. Add Sentry (~30 min; you stop finding out about breakage by accident).
4. Fix `useStats` serial awaits and the `TaskItem` re-render storm (~2 hours; the two remaining performance problems you'd actually feel).
5. Then decide about the denormalization refactor in §2. Everything in P1 is a symptom of it, and you'll keep patching symptoms until it's addressed.

Items 1–4 are roughly a day of work and take this from "good personal tool with silent failures" to "solid personal tool I'd trust." Item 5 is what takes it to something other people can depend on.
