# Comfy Board — UX & Product Review

Written 11 Aug 2026. Based on rendering the real components (`Sidebar`, `TaskItem`, the planner grid) with realistic data at 1440px and 390px, plus a read of every page's markup.

---

## 0. Answering the question directly

> *Is that all that makes the boundary between my app and a production grade app?*

No — and I gave you a lopsided answer last time. Let me correct the framing.

**Engineering correctness isn't the boundary. It's the floor.** Nobody calls an app production grade *because* its writes reach the database; they just stop using it when they don't. Everything in the last two passes was me clearing the floor.

The actual boundary is three questions, and none of them are about code:

1. **Does a new user succeed in the first five minutes?** Not "can they" — do they, without being told anything.
2. **Does the daily surface stay calm as data grows?** Most tools are pleasant at 5 tasks and unusable at 200.
3. **When the user is wrong, does the app absorb it?** Mis-clicks, changed minds, wrong dates.

You've explicitly designed for "high end features, easy to start with." That's the right goal and it's the hard one — those two pull against each other, and the only thing that reconciles them is **tiering**: everything on screen earns its place, and the advanced 80% appears when asked for.

You already know this. The "Need a monthly/yearly?" progressive disclosure on routines is exactly the right instinct, and it's the single best interaction decision in the app. My core criticism is that you did it **once**, in the one place where the pressure was lowest, and nowhere in the two surfaces you actually live in.

---

## 1. What's genuinely good

I want to be specific here, because the critique below is long and I don't want it to read as a verdict on the whole thing.

- **The visual language is coherent and it looks like a product.** Dark surface, purple accent, per-day colour coding, consistent 12px radius, subtle card float. Nothing about it reads as "developer built this UI." The six-theme system with `color-mix()` and a blocking anti-flash script in `layout.tsx` is a level of polish most products skip.
- **Colour as project identity is the right call.** Once you know Partnerships is violet, you parse the week at a glance. That's real information design.
- **The sidebar is the best-designed surface in the app.** Clean hierarchy, keyboard hints rendered inline next to each item (D, R, E, W, Q, M…), work clock and timer badge docked at the bottom where they belong. It's calm and it scales.
- **The state borders on task rows work.** Green for a running timer, orange for monitored — instantly readable, no legend needed.
- **The feature set is genuinely differentiated.** Four routine cadences, work clock separate from task timers, monitoring/standby, reschedule-with-accountability, retro planning. The reschedule design in particular — keeping the old entry so your stats show you moved it — is a real product opinion. Most tools let you quietly rewrite history. That one decision says more about your judgment than anything else in the app.
- **`date_key` vs `deadline` as distinct concepts** (when to work on it vs when it's due) is correct and most tools get it wrong. See §3.1 for why it doesn't land yet.

---

## 2. The core problem: density, not features

Here's what a single task row actually contains:

> drag handle · checkbox · play · name · live timer · estimate · work-date chip · deadline chip · GCal button · progress dot · progress % field · progress bar · elapsed time · notes field · file attach · subtask count · ⋯ menu

**Seventeen controls.** A subtask row has eleven. They're all the same size, the same weight, and all present at all times — whether you use two of them or seventeen.

Rendered at 390px this doesn't degrade gracefully, it dissolves. `flex-wrap` on eleven items produces orphaned fragments: a line reading `45` `min` then a line reading `100` `%` then the note. A number floating with no label next to another number with no label.

This is the "easy to start with" claim's biggest problem. A new user opening a project sees seventeen affordances and no indication which two matter. And the fix isn't removing anything — it's deciding what's **primary**.

### Concretely

A task row's primary line should be: **checkbox · name · when · progress**. That's it. Everything else — estimate, elapsed, GCal, file, notes, the ⋯ menu — lives in an expand or a detail panel. You already have a task edit modal; it's underused.

Same for subtasks: **checkbox · name · progress**, expand for the rest.

The information doesn't leave. It stops competing.

### On the numbers

- `text-[10px]` appears **131 times**; `text-[9px]` 13 times; `text-[8px]` 3 times (month view). 10px is below what most people over 40 read comfortably, and the month cells are 8px. Your smallest text is carrying real information — task names in month view — not decoration.
- Checkboxes are `w-3.5 h-3.5` (14px) in the week grid and `w-2.5 h-2.5` (10px) in month view. Apple's guidance is 44px, Google's 48px. Your primary interaction — ticking a task — is a 14px target.
- **28 controls are `opacity-0 group-hover:opacity-100`** — invisible until mouse-over. On a touch device they are unreachable, full stop. That includes delete, reschedule, and "go to project" in the planner.

---

## 3. Specific issues, in the order I'd fix them

### 3.1 The `[Project]` prefix is eating your planner

This is the highest-impact fix in the document and it's mostly a deletion.

At 1440px, seven columns leave each day roughly 100px of text width. Every project-linked row spends the first ~40% of that on `[Partnerships]` before the task name starts. Rendered, "Draft the Q3 partnership agreement" wraps to **three lines**, two of which are the prefix and a fragment.

You are already colouring the text by project. **The prefix is redundant with the colour.** Replace it with a 3px coloured left border or a 6px dot and you get ~40% more line width on every row in the app's central view, for free.

Secondary benefit: `week_tasks.text` stops being a rendered string that has to be regex-parsed back apart, which is the root of half the bugs I fixed in the first pass.

### 3.2 Nothing teaches the one concept the app is built around

`date_key` vs `deadline` is your best design decision and it's invisible. In the UI they're two adjacent chips of identical size, weight and shape, distinguished by a small icon. When a task is complete they become "✓ scheduled" and "✓ deadline" — the only place the app ever names them.

A new user will not discover this. They'll fill in one, wonder why it doesn't appear where they expected, and conclude the app is confusing.

Fix: label them ("Work on" / "Due"), make them visually distinct (filled vs outlined, or different placement), and say it once in onboarding. Also drop the "No date" / "No deadline" placeholder chips — they carry the same visual weight as real data while saying nothing. An empty slot or a faint `+` is enough.

### 3.3 The first run is ten empty boxes

Your stated goal is "easy to start with." The literal first thing a new user sees is a dashboard of ten cards saying "No tasks yet."

This is the single biggest gap between the app's quality and its perceived quality. Options, cheapest first:

- **Make empty states do work.** Not "No tasks yet" but "Your daily routine repeats every morning — add your first" with an inline add button. Six cards × one sentence each is an afternoon and it changes the entire first impression.
- **Seed a starter project.** Three example tasks demonstrating a subtask, a timer and a deadline, with a one-click "remove examples." People learn from a filled-in artifact far faster than from instructions.
- **The 5-step modal on your pending list.** Do this last, not first — it's the most work and the least effective of the three.

### 3.4 Empty days waste the mobile viewport

On a phone the week view is a vertical stack of seven fixed-height cards. Thursday through Sunday render as four ~140px empty boxes — you scroll through 560px of nothing to reach the project section. Collapse empty future days to a single line, or default mobile to the day view with swipe navigation.

### 3.5 Twelve native `confirm()` / `alert()` dialogs remain

Your pending list says seven; it's actually twelve, including three in `FileAttachment`. Each one breaks the visual language completely — a grey OS chrome box in the middle of a carefully themed app. They also block the JS thread and can't be styled or undone.

The `ConfirmModal` component already exists. This is mechanical.

### 3.6 There is no undo, anywhere

For an app whose core interaction is ticking things off, the absence of undo is the biggest reliability-of-experience gap. Concretely: checking a parent task rewrites every subtask's progress to 100; unchecking rewrites them all to 0. Intermediate values (40%, 70%) are gone permanently. That's one mis-click.

A toast with an Undo action, holding the previous state for ~8 seconds, covers 90% of real regret and is maybe half a day's work. It would also let you delete several confirm dialogs — undo is almost always better UX than "are you sure?", because it doesn't tax the 99% of correct actions to protect the 1%.

### 3.7 Accessibility is unaddressed

Not a compliance lecture — several of these make features simply unavailable:

- Project identity, priority and progress are signalled by **colour alone**. Colour-blind users lose project attribution entirely in the planner.
- Custom checkboxes and icon-only buttons (`⋯`, `▶`, `✕`, `📅`) have no accessible labels. Screen readers announce nothing useful.
- Drag-and-drop has no keyboard alternative — reordering projects, tasks and subtasks is mouse-only.
- No visible focus rings; the keyboard shortcuts imply keyboard users, who then can't see where they are.

The cheap 80%: add `aria-label` to icon buttons, a visible focus ring, and one non-colour signal for project identity (the left border from §3.1 does double duty — border + colour).

### 3.8 Smaller things worth a pass

- **Menus can't be reached with a keyboard**, and `openMenuAt` hardcodes a 200px height assumption to decide flip direction — it'll clip against a viewport edge with a longer menu.
- **No loading skeletons.** Pages show a spinner then snap to full content. Skeletons make a 400ms load feel instant.
- **Toast is the only feedback channel** and it's used for both "Task rescheduled" and "Failed to save." Success and failure should not look alike.
- **The progress % field is a raw number input.** Nobody types "45". A slider, or presets (0/25/50/75/100), matches how people actually think.
- **The reschedule flow is a bare `<input type="date">`** appearing inline on hover. For the most common case — "push to tomorrow" — that's four interactions where one button would do.
- **No search inside a project.** ⌘K is global; a project with 40 tasks has no filter.

---

## 4. What I'd actually do, in order

Roughly ordered by (impact ÷ effort). The first three are the ones I'd defend hardest.

| # | Change | Effort | Why |
|---|---|---|---|
| 1 | Drop the `[Project]` prefix → coloured left border | ~2h | +40% line width in the app's core view; also kills a bug class |
| 2 | Tier the task/subtask rows: 4 primary controls, rest on expand | ~1d | Directly serves "high end features, easy to start" |
| 3 | Real empty states with inline actions | ~4h | Transforms the first five minutes |
| 4 | Undo toast for destructive/bulk actions | ~4h | Removes the app's sharpest edge |
| 5 | Label "Work on" vs "Due"; drop the null-state chips | ~2h | Teaches your central concept |
| 6 | Replace the 12 native dialogs with `ConfirmModal` | ~2h | Mechanical, restores visual integrity |
| 7 | Raise minimum font to 11–12px; hit targets to 24px+ | ~3h | Legibility and touch |
| 8 | `aria-label`s, focus rings, one non-colour project signal | ~4h | Makes features usable that currently aren't |
| 9 | Mobile: collapse empty days, fix the wrapping subtask row | ~1d | Mobile goes from tolerable to intentional |
| 10 | Starter project with removable examples | ~4h | Best teaching tool per hour spent |

That's about a week. It would move the app from "impressive personal tool" to "something I'd expect to pay for" — and note that **none of it is a new feature.** You don't have a feature gap. You have a hierarchy gap.

---

## 5. The honest summary

Your instinct about your own app is right: the features are high-end, and the design has real taste behind it. The visual system is better than most of what I see.

Where I'd push back is the second half of the claim. **It isn't easy to start with yet** — not because it's badly designed, but because it's designed for the person who already has the whole model in their head. Every feature is visible because you know what all of them do. A new user sees seventeen controls on a task, two identical-looking date fields with no labels, and a dashboard of ten empty boxes.

The good news is that this is the most tractable class of problem there is. You aren't missing features and you aren't missing taste — the "Need a monthly/yearly?" disclosure proves you have exactly the right instinct. You just haven't applied it to the two screens you use every day, probably because you're the one user who never needed it.

Apply that one idea consistently and the app arrives.
