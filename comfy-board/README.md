# Comfy Board

A unified productivity web app combining a **dashboard**, **daily routine checklist**, **project manager with time tracking & subtasks**, **7-day weekly planner**, and **deadline countdown dashboard**.

Built with **Next.js 15** (App Router), **TypeScript**, **Tailwind CSS**, and **Supabase** (PostgreSQL + Auth).

---

## Features

### 🏠 Dashboard (`/`)
- Today's date and live clock
- Routine completion snapshot with progress bar
- Today's weekly tasks with completion status
- Active projects with color labels and time tracked
- Upcoming deadlines with countdown
- Recent activity log

### ☰ Daily Routine (`/routine`)
- Recurring daily checklist that resets each day
- Estimated time tracking per task
- Progress bar with completion counter
- Drag-and-drop reordering
- Add/edit/remove tasks via modals

### 📁 Project Manager (`/projects/[id]`)
- Create unlimited projects with descriptions
- **Color labels** — pick a color per project, shown in sidebar and dashboard
- Per-task time tracking (start/stop chrono) with **overtime detection**
- Subtasks (max 5 per task) with auto-calculated parent progress
- Inline editing for progress %, notes, deadlines
- File attachments on tasks and subtasks (via Supabase Storage, 10MB limit)
- Calendar-based deadline picker syncs tasks to weekly planner **and** deadlines tab
- **Google Calendar sync** — modal showing all tasks/subtasks, click to add as calendar events with full notes in description
- **Save as template** / **Export as JSON**
- 80% time alarm via Web Audio API
- **Activity logging** — tracks task creation, removal, timer sessions
- Drag-and-drop task and project list reordering

### 📅 Weekly Planner (`/week`)
- 7-column grid with colored day headers
- **Click day to open detail modal** — view tasks, check/uncheck, add new, see notes
- **Per-project tag breakdown** at the top — shows done/total per project with mini progress bars
- Today highlighted with live clock
- Week navigation (prev/today/next)
- **Two-way sync** with project task deadlines
- Day themes with recurring templates

### ⏳ Deadline Dashboard (`/deadlines`)
- Live countdown timers (days/hours/minutes/seconds)
- **Recurring deadlines** — daily, weekly, monthly, yearly auto-renewal
- Color-coded urgency: green (>3d), amber (1-3d), red (<24h), muted (passed)
- Progress bar showing elapsed time since creation
- Responsive card grid

### 🔍 Global Search
- **Ctrl/Cmd+K** to open search anywhere
- Searches across projects, tasks, subtasks, routine items, deadlines
- Keyboard navigation (↑↓ to browse, Enter to open)
- Instant fuzzy search with type indicators

### 📥 Import / Export
- **Drag & drop import modal** — drop multiple JSON files at once
- Auto-detects file types: projects, templates, project lists, routine tasks
- Handles old desktop app format (cleans invalid deadlines)
- Import results log showing what was created
- **Export project as JSON** from project header
- **Save/load templates** from sidebar or project header

### General
- **Next.js 15** — 0 known vulnerabilities
- Dark theme with red (routine/projects) and violet (week/deadlines) accents
- Email/password authentication via Supabase Auth
- Row Level Security — users only see their own data
- Responsive: sidebar on desktop, hamburger on mobile
- Optimistic UI updates

---

## Quick Start

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project

### 2. Get Your Project URL and Key

1. Click the **Connect** button at the top of your Supabase dashboard
2. Copy your **Project URL** (e.g. `https://abcdefgh.supabase.co`)
3. Copy the **Publishable key** (`sb_publishable_...`) or legacy **anon** key

### 3. Run the Database Schema

In **SQL Editor**, run these files in order:
1. `supabase-schema.sql` — creates all base tables + RLS
2. `supabase-migration-files.sql` — adds file attachment columns + storage bucket
3. `supabase-migration-v2.sql` — adds project colors, recurring deadlines, activity log

### 4. Setup & Install

```bash
unzip merged-app.zip -d comfy-board
cd comfy-board
npm install
```

### 5. Configure Environment

Edit the existing `.env.local` and replace the placeholder values:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxx...
```

### 6. Run Locally

```bash
npm run dev
```

### 7. Deploy to Vercel

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

1. Import the repo in [vercel.com](https://vercel.com)
2. Add env vars: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Deploy

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + K` | Open global search |
| `D` | Go to Dashboard |
| `R` | Go to Routine |
| `W` | Go to Week |
| `N` | New Project |
| `Escape` | Close any modal/search |

---

## Project Structure

```
merged-app/
├── app/
│   ├── page.tsx                Dashboard
│   ├── layout.tsx              Root layout + AppShell
│   ├── login/page.tsx          Auth
│   ├── routine/page.tsx        Daily routine
│   ├── projects/
│   │   ├── page.tsx            Project list + import + templates
│   │   └── [id]/page.tsx       Project detail + timer
│   ├── week/
│   │   ├── page.tsx            Weekly planner + day modal
│   │   └── [date]/page.tsx     Day detail
│   └── deadlines/page.tsx      Countdown + recurring
├── components/
│   ├── AppShell.tsx            Auth-aware layout
│   ├── Sidebar.tsx             Nav + search + colors + templates
│   ├── SearchModal.tsx         Global search (Cmd+K)
│   ├── ImportModal.tsx         Drag & drop import
│   ├── GCalButton.tsx          Google Calendar sync modal
│   ├── CalendarPicker.tsx      Date picker (portal)
│   ├── ColorPicker.tsx         Project color picker
│   ├── FileAttachment.tsx      File upload/display
│   ├── Modal.tsx               Shared modal
│   ├── ProgressBar.tsx         Color-scaled progress
│   └── InlineEdit.tsx          Click-to-edit
├── lib/
│   ├── supabase.ts             Browser client
│   ├── supabase-server.ts      Server client (async)
│   ├── types.ts                TypeScript interfaces
│   ├── utils.ts                Formatters, colors, helpers
│   ├── sync.ts                 Project ↔ Week ↔ Deadlines sync
│   ├── activity.ts             Activity log helper
│   └── import-helpers.ts       Import format detection
├── middleware.ts                Auth redirect
├── supabase-schema.sql         Base schema
├── supabase-migration-files.sql File attachments + storage
└── supabase-migration-v2.sql   Colors, recurring, activity log
```

---

## License

MIT
