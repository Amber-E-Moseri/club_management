# BLW York Hub

Ministry operating hub for the BLW York campus — member portal, outreach CRM, growth tracking, and admin tools built on React + Supabase.

## Tech Stack

| Layer | Library |
|---|---|
| UI | React 18 + TypeScript |
| Routing | React Router v6 |
| Styling | Tailwind CSS 3 |
| Database | Supabase (PostgreSQL) |
| Email | Gmail relay via Nodemailer (`api/email-relay.ts`) — Supabase Edge Function forwards to Vercel |
| Push | Web Push API (Supabase-backed subscriptions) |
| Charts | Recharts |
| Dates | date-fns |
| Deployment | Vercel |

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Required variables:

```
REACT_APP_SUPABASE_URL=https://your-project.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-anon-key
REACT_APP_PUBLIC_APP_URL=https://your-app.vercel.app
REACT_APP_VAPID_PUBLIC_KEY=...

# Vercel environment variables (set in Vercel dashboard, not .env):
GMAIL_USER=blwyorkuni@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx   # Google App Password
EMAIL_RELAY_SECRET=<random 32-char token>

# Supabase project secrets (Dashboard > Edge Functions > Secrets):
# EMAIL_RELAY_URL=https://<your-vercel-app>.vercel.app/api/email-relay
# EMAIL_RELAY_SECRET=<same token as above>
# EMAIL_FROM=BLW York Hub <blwyorkuni@gmail.com>
# VAPID_PRIVATE_KEY=...
```

### 3. Run the dev server

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Build for production

```bash
npm run build
```

## Project Structure

```
src/
├── components/
│   ├── foundation/     # Button, Card, Input, Badge, Modal, Tag
│   ├── layout/         # MainLayout, Navigation, Sidebar, Header, ProtectedRoute
│   └── feature/        # StatCard, EventCard, ContactCard, MeetingCard, HabitCard,
│                       # TestimonyCard, QuickAddModal, GlobalSearch, and more
├── pages/              # One file per route — see Navigation below
├── hooks/              # useAuth, useEvents, useContacts, useHabits, useMeetings,
│                       # useTestimonies, useConfessions, useWeeklyMessages, …
├── lib/
│   ├── supabase.ts     # Supabase client
│   ├── queries/        # Typed query modules per domain
│   ├── email/          # Email template helpers
│   ├── push/           # Push notification helpers
│   ├── zoom.ts         # Zoom meeting link helpers
│   └── utils.ts        # Shared utilities
├── types/              # TypeScript interfaces
└── styles/
    └── globals.css     # Tailwind + component classes
api/
└── email-relay.ts      # Vercel serverless function — Gmail SMTP relay
supabase/
└── migrations/         # Numbered SQL migrations (apply in order)
docs/                   # Architecture docs, prototype audit, data model
```

## Navigation (7 primary destinations)

| Route | Page | Description |
|---|---|---|
| `/` | Dashboard | Ministry ops header, stat chips, upcoming events + meetings |
| `/people` | Members | Member directory with filters, person detail panel |
| `/outreach` | Outreach | Contact CRM — list, pipeline board, follow-up tracking |
| `/growth` | Growth | Devotionals, habits, confessions, testimonies, books, messages |
| `/events` | Events | Event list, RSVP management |
| `/meetings` | MeetingsHub | Meeting log, agenda items, action tracking |
| `/admin` | AdminHub | Roles, approvals, data exports, email log, Zoom settings |

## Supabase Schema (key tables)

| Table | Purpose |
|---|---|
| `profiles` | Member records — name, email, role, cell, joined_at |
| `events` / `event_rsvps` | Events and attendance |
| `contacts` | Outreach CRM contacts (includes `follow_up_date`) |
| `contact_tags` | Tags on outreach contacts |
| `contact_follow_ups` | Follow-up assignments per contact |
| `contact_audit_log` | Admin-visible audit trail for contact changes |
| `devotionals` | Daily devotional content |
| `habits` / `habit_entries` | Personal habit tracking |
| `confessions` | Daily confessions log |
| `testimonies` | Testimony submissions + comments |
| `weekly_messages` | Weekly message library |
| `books` | Book of the month |
| `meetings` / `meeting_items` | Meeting records and agenda items |
| `push_subscriptions` | Web push device tokens |
| `email_notification_prefs` | Per-user email opt-in settings |

Apply migrations 001–013 in order from `supabase/migrations/`.

Migration 013 adds the `account_approved` email template type to `email_log`. Migration 012 adds `follow_up_date` to `contacts`. Migration 011 adds `contact_tags`, `contact_follow_ups`, and `contact_audit_log`.

## Testing

```bash
npm test          # Unit tests (Jest + React Testing Library)
npm run e2e       # End-to-end (Playwright)
npm run e2e:ui    # Playwright UI mode
```

Seed a coordinator test account:

```bash
npm run seed:proto
npm run seed:proto:reset   # reset and re-seed
```

## Color Reference — York Red Theme

| Token | Hex | Use |
|---|---|---|
| `york-600` | `#E31837` | Primary buttons, active nav, accents |
| `york-700` | `#C11628` | Hover state |
| `red-light` | `#F5E9EA` | Active nav background, light tints |
| `york-100` | `#FFEBEB` | Badge backgrounds |

## Deployment

1. Apply Supabase migrations 001–013 in order from `supabase/migrations/`.
2. Configure Vercel: build command `npm run build`, output directory `build`.
3. Add all environment variables in Vercel project settings.
4. Confirm the SPA rewrite in `vercel.json` routes all paths to `index.html`.
5. Add the production domain to Supabase auth redirect URLs.
6. Set `GMAIL_USER` / `GMAIL_APP_PASSWORD` in Vercel env vars for the email relay function.

## Feature Notes

- Global search opens with `Ctrl+K` / `Cmd+K`.
- New members require admin approval before accessing the hub.
- Push notifications use the Web Push API; VAPID keys must be set in env vars.
- Dark mode is stored in `localStorage` under `blw-theme`.
- Prototype reference: `BLW_York_Hub_v2.html` — canonical UX reference for all UI decisions.
