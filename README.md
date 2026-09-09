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

1. Apply Supabase migrations in order from `supabase/migrations`.
2. Configure Vercel with build command `npm run build` and output directory `build`.
3. Add environment variables from `.env.example` in the Vercel project settings.
4. Confirm the SPA rewrite in `vercel.json` is active so deep links resolve to `index.html`.
5. Set the production domain and verify Supabase auth redirect URLs include it.

## Feature Notes

- Global search opens with `Ctrl+K` or `Cmd+K`.
- Admin data exports are available at `/admin/exports`.
- Dark mode is stored in `localStorage` under `blw-theme`.
- The local i18n scaffold starts with English strings for navigation, login, and the dashboard greeting.
