# BLW York — Christian Club Portal

A membership portal for the Christian Club at York University.

## Tech Stack

| Layer | Library |
|---|---|
| UI | React 18 + TypeScript |
| Routing | React Router v6 |
| Styling | Tailwind CSS 3 |
| Database | Supabase (PostgreSQL) |
| Charts | Recharts |
| Dates | date-fns |

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in your Supabase project URL and anon key:

```
REACT_APP_SUPABASE_URL=https://your-project.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-anon-key
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
│   ├── foundation/     # Button, Card, Input, Badge
│   ├── layout/         # Sidebar
│   └── feature/        # StatCard, EventCard, AnnouncementCard
├── pages/              # Dashboard, Events, Members, Announcements, Profile, AdminPanel, Login
├── hooks/              # useAuth, useEvents
├── lib/
│   ├── supabase.ts     # Supabase client
│   ├── queries.ts      # Database queries
│   └── utils.ts        # Helper functions
├── types/              # TypeScript interfaces
└── styles/
    └── globals.css     # Tailwind + component classes
```

## Supabase Tables Required

| Table | Key columns |
|---|---|
| `profiles` | id, full_name, email, role, joined_at |
| `events` | id, title, date, time, location, category, created_by |
| `event_rsvps` | event_id, user_id |
| `announcements` | id, title, body, author_id, author_name, created_at |
| `prayer_requests` | id, content, author_id, is_anonymous, is_active |

## Color Reference — York Red Theme

| Token | Hex | Use |
|---|---|---|
| `york-600` | `#E31837` | Primary buttons, active nav, accents |
| `york-700` | `#C11628` | Hover state |
| `red-light` | `#F5E9EA` | Active nav background, light tints |
| `york-100` | `#FFEBEB` | Badge backgrounds |

## Deployment Checklist

Full detail: [`docs/production-environment-checklist.md`](docs/production-environment-checklist.md).
Audit/certification evidence: [`docs/production-certification.md`](docs/production-certification.md).

1. Back up the database, then apply the migrations with the Supabase CLI: `supabase db push` (chain `000…010`; replays from an empty database).
2. Promote the first coordinator manually (new accounts are always `member`/`pending`):
   `update public.profiles set role='coordinator', status='active' where email='<owner>';`
3. Set Edge Function secrets (`supabase secrets set …`): email provider key + `EMAIL_FROM`, `UNSUBSCRIBE_SECRET`, `CRON_SECRET`, `PUBLIC_APP_URL`, `ALLOWED_ORIGINS`; deploy `send-email`, `unsubscribe`, `process-scheduled-emails`.
4. Create the scheduler that POSTs to `process-scheduled-emails` with the `x-cron-secret` header.
5. Configure Vercel (build command and SPA rewrite are in `vercel.json`) with `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`, `REACT_APP_PUBLIC_APP_URL`.
6. In Supabase Auth set the Site URL / redirect URLs to the production domain and require email confirmation.
7. Run `npm run test:db` against a staging copy before going live.

## Testing

| Command | What it proves |
|---|---|
| `npm run typecheck && npm test && npm run build` | frontend |
| `npx playwright test` | UI flows against a mocked Supabase |
| `npm run test:functions` | Edge Function authorization, cron secret, signed unsubscribe tokens (Deno) |
| `supabase start && supabase db reset` then `npm run test:db` (env from `supabase status -o env`) | fresh-database replay, RLS/authorization through the real API, email workflow |
| `E2E_REAL_BACKEND=1 … npx playwright test real-backend` | sign-up → pending → approval → login against a real stack |

## Feature Notes

- Global search opens with `Ctrl+K` or `Cmd+K`.
- Admin data exports are available at `/admin/exports`.
- Dark mode is stored in `localStorage` under `blw-theme`.
- The local i18n scaffold starts with English strings for navigation, login, and the dashboard greeting.
