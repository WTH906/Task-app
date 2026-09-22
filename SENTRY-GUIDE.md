# Adding Sentry to Comfy Board

Written against the current Sentry Next.js SDK (config file layout changed in v8 — older tutorials showing `sentry.client.config.ts` are out of date).

---

## 0. First, the honest question: is this the right tool?

Sentry is built for deployed, multi-user apps. Comfy Board is a local, single-user app you run with `npm run dev`. So it's worth being clear about what you do and don't get.

**What doesn't apply to you:**

- Release tracking and source-map upload — only useful for minified production builds. Your dev build already has readable stack traces.
- Performance monitoring / tracing — real value at scale, pure noise for one user on localhost. Turn it off.
- Alerting on error-rate spikes — meaningless with a sample size of you.

**What does apply, and is the actual reason to do this:**

You already shipped ~20 database writes that never executed and didn't notice for months. The lint rule now prevents that specific class at author time. But everything else still fails the same way — into a console you aren't looking at. Sentry gives you a **persistent, searchable log of every error your app hit, with a stack trace and the state around it**, that survives closing the tab.

That's the whole pitch. Not monitoring — *memory*.

**If you'd rather not use a hosted service**, skip to §7. There's a smaller option that gets most of the benefit.

---

## 1. Account and project

1. Sign up at [sentry.io](https://sentry.io) — the free Developer plan is fine for one person. (Check the [current pricing page](https://sentry.io/pricing/) for the exact monthly event quota and retention window; the numbers move and I'd rather you read them than trust mine.)
2. Create a project, platform **Next.js**.
3. Copy the **DSN** it gives you. It looks like `https://abc123@o12345.ingest.sentry.io/678`.

The DSN is not a secret — it's designed to sit in your browser bundle, exactly like the Supabase anon key. It only allows *writing* events to your project.

---

## 2. Install

```bash
npm install @sentry/nextjs
```

There's a wizard (`npx @sentry/wizard@latest -i nextjs`) which writes the files for you. I'd skip it here: it also rewrites `next.config.js`, adds a tunnel route and an example error page, and you already have a `next.config.js` with `turbopack` and `eslint` settings worth not disturbing. The manual version below is six small files.

---

## 3. The files

Put the DSN in `.env` (it's already gitignored in `comfy-board`):

```bash
NEXT_PUBLIC_SENTRY_DSN=https://abc123@o12345.ingest.sentry.io/678
```

### `instrumentation-client.ts` (project root)

```ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // You're one person on localhost. Tracing would fill the quota with
  // timing data about a machine you're sitting in front of.
  tracesSampleRate: 0,

  // Distinguishes your machine from anything you deploy later.
  environment: process.env.NODE_ENV === "production" ? "production" : "local",

  // See §5 — without this, dev noise drowns the real errors.
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    "NetworkError when attempting to fetch resource",
    "Failed to fetch",
    "AbortError",
  ],

  beforeSend(event, hint) {
    // Next.js dev overlay reports the same error twice under StrictMode.
    if (process.env.NODE_ENV !== "production" && hint.originalException === null) {
      return null;
    }
    return event;
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```

### `sentry.server.config.ts` (project root)

```ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  environment: process.env.NODE_ENV === "production" ? "production" : "local",
});
```

### `sentry.edge.config.ts` (project root)

Your `middleware.ts` runs on the edge runtime, so this one matters — it's where a failing auth check would surface.

```ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  environment: process.env.NODE_ENV === "production" ? "production" : "local",
});
```

### `instrumentation.ts` (project root)

```ts
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures errors thrown in server components, route handlers and middleware.
// Requires @sentry/nextjs >= 8.28.
export const onRequestError = Sentry.captureRequestError;
```

### `next.config.js`

Wrap your existing export. Keep everything already in there:

```js
const { withSentryConfig } = require("@sentry/nextjs");

const nextConfig = {
  /* ... your existing config, unchanged ... */
};

module.exports = withSentryConfig(nextConfig, {
  org: "your-org-slug",
  project: "your-project-slug",
  silent: !process.env.CI,

  // You aren't deploying minified builds, so there's nothing to un-minify.
  // Leaving this on makes every build slower and needs an auth token.
  sourcemaps: { disable: true },
});
```

---

## 4. Where to actually wire it — the part that matters

Steps 1–3 are Sentry's own docs. **This section is the reason it's worth doing on your codebase specifically**, because I've already mapped exactly where Comfy Board fails silently.

Do these in order. The first one alone covers most of it.

### 4.1 `fireAndForget` — one function, every background write

`lib/db-helpers.ts` currently logs to the console and stops. It is the single chokepoint every background database write goes through, so it's the highest-leverage line in the app:

```ts
import * as Sentry from "@sentry/nextjs";

export function fireAndForget(
  query: PromiseLike<{ error: { message: string } | null }>,
  label: string
): void {
  Promise.resolve(query).then(
    ({ error }) => {
      if (error) {
        console.error(`[${label}] ${error.message}`);
        Sentry.captureMessage(`${label}: ${error.message}`, {
          level: "error",
          tags: { area: "supabase-write", op: label },
        });
      }
    },
    (err) => {
      console.error(`[${label}]`, err);
      Sentry.captureException(err, { tags: { area: "supabase-write", op: label } });
    }
  );
}
```

The `op` tag is the useful bit — you'll be able to filter by `timer:stop`, `week:reschedule-link` and so on, and see which specific write is failing.

### 4.2 `lib/queries.ts` — the read path

Around line 14 there's already a central error handler that dispatches a `query-error` window event. Add one line to it:

```ts
Sentry.captureException(error, { tags: { area: "supabase-read", fn } });
```

Between 4.1 and 4.2 you now have every database interaction covered, in two edits.

### 4.3 `app/global-error.tsx` — doesn't exist yet

You have `app/error.tsx` and `app/projects/[id]/error.tsx`, but **no `global-error.tsx`** — so a crash inside `RootLayout` or `AppShell` is currently uncaught and shows the bare Next.js error page. Create it:

```tsx
"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);

  return (
    <html>
      <body style={{ background: "#0f0e17", color: "#fffffe", fontFamily: "system-ui", padding: "3rem" }}>
        <h1 style={{ fontSize: "1.25rem", marginBottom: ".5rem" }}>Something broke badly.</h1>
        <p style={{ opacity: 0.7, fontSize: ".875rem" }}>
          The error has been recorded. Reloading usually fixes it.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{ marginTop: "1.5rem", padding: ".5rem 1rem", borderRadius: 8, border: "1px solid #2e2f3e", background: "#16161f", color: "inherit", cursor: "pointer" }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
```

Add the same `useEffect` capture to the two existing `error.tsx` files.

### 4.4 The silent catches

These swallow failures and render something that looks like a legitimate empty state, which is worse than crashing — you can't tell "nothing found" from "it broke":

| File | Currently | Add |
|---|---|---|
| `components/ActiveTimerBadge.tsx` (~84) | `catch { setTimer(null) }` → renders "no timer running" | `Sentry.captureException(e)` |
| `components/SearchModal.tsx` (~66) | `catch { /* ignore */ }` → renders "no results" | `Sentry.captureException(e)` |
| `app/page.tsx` (~128) | `catch { /* table may not exist */ }` → swallows *every* monthly-routine error | `Sentry.captureException(e)` |
| `components/WorkClock.tsx` (~33) | silent catch on load | `Sentry.captureException(e)` |
| `app/page.tsx` (~57) | `catch {}` on card-order JSON parse | leave it — genuinely unimportant |

Keep the existing UI behaviour in each case. You're adding a record, not changing what the user sees.

### 4.5 Identify yourself

One line in `components/AppShell.tsx`, where the user resolves, makes every event attributable and lets you set context:

```ts
Sentry.setUser(user ? { id: user.id, email: user.email } : null);
```

Trivial today with one user; it's the thing you'd want already in place if anyone else ever uses this.

---

## 5. Noise control

Dev mode generates errors that aren't bugs. Without filtering you'll stop reading the feed within a week, which defeats the point.

- **React StrictMode double-invokes** effects in dev, so some errors arrive twice. Sentry groups them, but the counts look alarming.
- **HMR / fast-refresh** throws chunk-loading errors when you edit a file mid-request. Not real.
- **`ResizeObserver loop` warnings** — browser noise, filtered in the config above.
- **Aborted fetches** on navigation — filtered above.

If it's still noisy, the blunt option is to only send in production-like runs:

```ts
Sentry.init({
  enabled: process.env.NEXT_PUBLIC_SENTRY_ENABLED === "true",
  // ...
});
```

…and set that flag only when you want to record a session. I'd start with it **on** though — your bugs are in normal daily use, which is exactly when you'd have it off.

---

## 6. Verify it works

Add a throwaway button somewhere, click it, confirm the event lands in Sentry within ~30 seconds, then delete it:

```tsx
<button onClick={() => { throw new Error("Sentry smoke test"); }}>Break</button>
```

Then test the path that actually matters — a failing write. Temporarily point `NEXT_PUBLIC_SUPABASE_URL` at a dead host, load the app, and check you get `supabase-read` events. That proves 4.1/4.2 are wired, which the button doesn't.

---

## 7. If you'd rather not use a hosted service

Reasonable position for a personal local app. Two smaller options:

**Self-hosted:** [GlitchTip](https://glitchtip.com) is Sentry-API-compatible, runs in Docker, and the same `@sentry/nextjs` SDK points at it by changing the DSN. Everything in §4 stays identical.

**No service at all:** the minimum viable version of this is a `logError()` helper that appends to a Supabase table you already control:

```sql
CREATE TABLE app_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  area TEXT, op TEXT, message TEXT, stack TEXT,
  url TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE app_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own app_errors" ON app_errors
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

Wire it into the same five places from §4. You lose grouping, search, stack-trace symbolication and alerting — but you get the one thing that actually matters here: **a persistent record you can look at tomorrow.** About an hour's work, no third party, no quota.

Given you're pre-publication and there's exactly one user, this is a genuinely defensible choice. If you ever ship to other people, switch to the real thing — the §4 wiring is the same either way, which is why it's worth doing in that order.

---

## Sources

- [Sentry — Next.js manual setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup)
- [Sentry — pricing](https://sentry.io/pricing/)
- [getsentry/sentry-javascript — App Router auto-instrumentation discussion](https://github.com/getsentry/sentry-javascript/discussions/13442)
