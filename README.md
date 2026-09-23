# نظام إدارة المدرسة — School Management System

Express API + vanilla JS frontend (Arabic, RTL). Database: **Supabase** (Postgres). Hosting: **Vercel**.

## Live
- App: https://school-system-clinic-system.vercel.app
- Supabase project: `School-Systems` (olapenhgwtnntvxxlfuh)
- Vercel project: `school-system`

## Login / staff accounts
Only emails listed in the `public.staff` table can see any data (enforced by Row Level Security in Postgres).
To add a staff member:
1. Supabase → Authentication → Users → **Add user** → Create new user (email + password, tick *Auto Confirm*).
2. Supabase → SQL Editor: `insert into public.staff (email) values ('person@example.com');`

## Run locally
```
npm install
npm start          # http://localhost:3000  (reads .env)
```
`Launch System.bat` still works after `npm install`.

## Layout
- `app.js` — all API routes (Supabase queries). Each request runs as the logged-in user.
- `server.js` — local entry point. `api/index.js` — Vercel entry point.
- `public/` — frontend. `vercel.json` — hosting config.
- `data/` — real student/payment CSVs (git-ignored, never deploy).
- `_legacy/` — old SQLite version + backup of `school.db` (git-ignored).
