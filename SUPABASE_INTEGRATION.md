# Supabase Integration

This project is backed by **Supabase** (PostgreSQL) instead of Firebase.
All data access goes through the Supabase client in `src/lib/supabase.ts` and
the service layer in `src/services/db.ts`.

## Setup

1. **Run the database scripts** — two SQL files live in `supabase/`:
   - **`supabase/schema.sql`** — creates/upgrades the tables, indexes, and
     strict Row-Level Security policies without dropping data. It is safe to
     rerun on a fresh or existing project.
   - **`supabase/security.sql`** — creates/upgrades `user_roles`, the
     `board_members` catalog, storage, and role-based policies. It also removes
     the obsolete profile-image column from `user_roles`. **Run this on any
     project** (existing or fresh) before going live. It is idempotent.
   - For an **existing database**, run `security.sql` first or by itself. It
     now creates the missing `board_members` catalog before applying its
     policies. Run `schema.sql` afterward only if the base tables also need to
     be created/upgraded.

   ```text
   Supabase Dashboard → SQL Editor → New query → paste → Run
   ```

2. **Environment variables** — copy `.env.example` to `.env` and fill in:

   ```env
   VITE_SUPABASE_URL=https://tguimzatilpqxnpoammo.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_0NlnRQHlQlrzMvgHvSUSWQ_MMqwWZh3
   ```

   These come from **Project Settings → API** in the dashboard
   (the "Publishable key", which is the browser-safe replacement for the anon
   key; the anon key works too).

3. **Run the app**

   ```bash
   npm install
   npm run dev
   ```

## Officer accounts (sign-in)

The admin area is protected by **real Supabase Auth**. Authentication accounts
must be provisioned through Supabase Authentication; the SQL files do not create
accounts or set passwords. The role synchronization scripts recognize these
officer email addresses:

| Role         | Email                         | Access |
| ------------ | ----------------------------- | ------ |
| Admin        | `admin@studentboard.ph`       | Full administration |
| Secretary    | `secretary@studentboard.ph`   | Attendance and read access |
| Treasurer    | `treasurer@studentboard.ph`   | Payments and financial records |
| Auditor      | `auditor@studentboard.ph`     | Payments and financial records |
| Board Member | `boardmember@studentboard.ph` | Assigned events and read access |

Roles live in the `public.user_roles` table (`user_id` → `role`). To add more
officers later:

```sql
-- create the auth user first (Dashboard > Authentication > Users > Add user),
-- then assign the role:
INSERT INTO public.user_roles (user_id, role, name)
VALUES ('<the auth user id>', 'admin', 'Display Name');
```

### Temporary officer identity display

Officer profile images are not stored in Supabase. The dashboard always renders
the local application asset `/DSSC-logo.png`, and displays the authenticated
Supabase user's actual `auth.users.email` below it. `public.user_roles` stores
only the account's role and display name used by application workflows.

`supabase/security.sql` includes `DROP COLUMN IF EXISTS profile_image_url` to
remove the image field left by an earlier version. It does not modify
`auth.users`, passwords, role assignments, or permissions. Do not add a profile
image column, profile-picture record, upload flow, or Supabase Storage object
for this temporary display.

The repository includes the local asset at `public/DSSC-logo.png`. Keep that
file available at the deployed application's site root. The older
`DSSC-logo.png` filename remains only for receipt-generation compatibility.

## Production data cleanup

Run `supabase/production_cleanup.sql` in the Supabase SQL Editor when preparing
the project for production:

1. Run the two preview queries at the top and review every candidate row.
2. If a legitimate record matches a marker word (`test`, `dummy`, `sample`,
   `mock`, `placeholder`, `fake`, `fixture`, `demo`, or `seed`), remove it from
   the candidate logic before proceeding.
3. Change `v_confirm` from `false` to `true` in the cleanup block and run the
   complete script in one execution.
4. Confirm the final account query still lists every required officer and role.

The script deletes only strongly marked operational records and unlinked,
strongly marked board-member catalog rows. It removes attendance,
contributions, payments, transactions, feedback, allocations, and then their
marked event/student records in dependency order. It preserves the production
financial summary row (`id = 'main'`), all account-linked board members, every
`public.user_roles` row, and every `auth.users` row. It does not drop or alter
tables, relationships, functions, triggers, RLS policies, grants, or storage.

Do not use broad `DELETE FROM <table>` statements for this task. With
`v_confirm = false`, the cleanup block performs no deletes and returns a notice
so the SQL Editor reports a successful, safe preview-only execution. Only the
project owner can identify a live row as test data from the Supabase preview
results.

## Receipts

- The seeded receipts are **real image files** served from `public/receipts/`
  (`receipt1.svg`, `expense2.svg`, …). Regenerate them anytime with
  `node scripts/generate-receipts.mjs`.
- The Receipt viewer dialog has **Open in new tab** and **Download** buttons.
  Auto-generated (SVG) receipts can be exported as **SVG, PNG, or JPG**.
- When the **treasurer, auditor, or admin** adds or edits a transaction in the
  ledger, they can upload a scanned physical receipt or photo (PDF or image,
  up to 10 MB). The file is stored in the public Supabase Storage bucket
  `receipts` (created by `security.sql`) and its URL is stored in
  `transactions.receipt_url`.
- The ledger's authorized users can use **Preview** to view an attached image
  or PDF inline without downloading it. Existing generated receipt files remain
  viewable for historical records; new transaction receipts are not generated
  automatically.

## Schema (tables)

| Table                  | Purpose                                     | App type                     |
| ---------------------- | ------------------------------------------- | ---------------------------- |
| `students`             | Student roster                              | `Student`                    |
| `events`               | Events with allocation amounts, Morning + Afternoon scheduled attendance windows (`morning_time_in`/`morning_time_out`, `afternoon_time_in`/`afternoon_time_out`; legacy single-session `time_in`/`time_out` kept), + assigned board members (`assigned_member_ids`/`assigned_member_names` text arrays) | `Event`            |
| `attendance`        | Per-student attendance per event + scan-captured shift times (`time_in`/`time_out`, 24h HH:MM) | `AttendanceRecord` |
| `contributions`        | Required vs paid amounts per student/event  | `ContributionRecord`         |
| `payments`             | Cash receipts                               | `PaymentRecord`              |
| `transactions`         | Income/expense ledger entries               | `Transaction`                |
| `feedback`             | Student feedback (inquiry/complaint/suggestion) | `FeedbackItem`            |

Column names are `snake_case` in the database and are mapped to the app's
`camelCase` fields inside `src/services/db.ts`.

## Attendance (QR scans + auto status)

The Attendance Tracking tab (admin/secretary) lets the secretary record every
event and student:

- A single **search bar** filters students by **full name or student ID**
  (one box for both).
- **QR scanner** with two modes — **Scan Time In** and **Scan Time Out**. The
  actual scan time is captured automatically as the student's Time In / Time
  Out, never typed by hand. Times are stored as 24h `HH:MM` and displayed in
  12-hour labels (e.g. "6:00 AM – 12:00 PM").
- **Attendance is saved automatically** — every QR scan, status toggle, and
  time edit persists to the `attendance` table immediately (upsert) and the
  table shows the saved row instantly. There is no "Save Attendance" button.
- **Status is auto-derived from the event's Morning / Afternoon schedule**
  (`events.morning_time_in` + `afternoon_time_in`, set on the event create/edit
  form which has a Morning Schedule and an Afternoon Schedule, both 12-hour
  inputs):
  - **Present** – scanned on/before the applicable session's Time In (the
    Morning Time In until the Afternoon session begins, then the Afternoon
    Time In).
  - **Late** – scanned after that session's Time In.
  - **Absent** – never scanned; the system **automatically marks the student
    Absent at 10:00 PM** on the event day (checks on the Attendance tab and on
    a 1-minute timer, idempotent so it never duplicates saved scans/edits).
- `supabase/security.sql` adds the new `morning_time_in`/`morning_time_out` and
  `afternoon_time_in`/`afternoon_time_out` columns to an existing `events`
  table non-destructively (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, along
  with the older `time_in`/`time_out` additions); fresh setups get them from
  `schema.sql`. Existing events with only `time_in`/`time_out` are treated as
  a Morning-only schedule.
- The `attendance` table also carries a **`session`** column
  (`morning` | `afternoon`, default `morning`) so each student gets separate
  Time In / Time Out rows per shift.
  ⚠️ **Existing databases MUST re-run `supabase/security.sql`** (or at least
  its section 3b `ALTER TABLE` statements) before using attendance recording:
  every insert/update sent by the app includes `session`, so a database
  without that column rejects ALL Time In / Time Out writes with
  *"Could not find the 'session' column of 'attendance' in the schema cache"*.

## Production catalog

The database setup intentionally contains no demo students, events, or
payments. Board members are maintained in the `public.board_members` catalog;
add the authoritative names with an idempotent SQL seed only after the official
roster has been confirmed. Catalog rows do not create authentication accounts.

## Security (roles & RLS)

Row Level Security is enabled on every table. The old open `public_all`
policies are gone — the current policies are strict and role-based:

| Data            | Public (anyone)                                   | Staff write access                       |
| --------------- | ------------------------------------------------- | ---------------------------------------- |
| Transparency data (students, events, attendance, contributions, payments, transactions, financial summaries, allocations) | Read only | `admin` (all), `secretary` (attendance), `treasurer` + `auditor` (payments/finances) |
| `feedback`      | Can submit (`INSERT`)                             | Staff read; `admin` updates/deletes      |
| `user_roles`    | none                                              | Each user reads their own role row; staff may read the board-member roster for event assignment |

Implementation notes:

- The policies call `public.has_role(text)` / `public.is_staff()` (security
  definer helpers reading `public.user_roles`), so role checks happen on the
  server, not in the app.
- The app signs in with `auth.signInWithPassword` (`src/services/auth.ts`),
  resolves the officer's role, and gates every admin screen by role.
- Storage: a public `receipts` bucket is created; signed-in staff may upload
  to it.

## Service API (unchanged for UI components)

`src/services/db.ts` exports exactly the same services and method signatures
that the Firebase version had, so the UI sections do not need changes:

- `studentsService` — `getAll`, `getById`, `getByStudentId`, `getByName`, `create`, `update`, `delete`, `search`
- `eventsService` — `getAll`, `getById`, `create`, `update`, `delete`
- `attendanceService` — `getAll`, `getById`, `getByStudentId`, `getByEventId`, `create`, `update`, `delete`
- `contributionsService` — `getAll`, `getByStudentId`, `getByEventId`, `create`, `update`, `delete`
- `paymentsService` — `getAll`, `getById`, `getByStudentId`, `getByEventId`, `create`, `update`, `delete`
- `transactionsService` — `getAll`, `getById`, `getByEventId`, `create`, `update`, `delete`
- `feedbackService` — `getAll`, `getById`, `getByType`, `getByStatus`, `create`, `update`, `delete`, `updateStatus`
- `boardMembersService` — `listBoardMembers`
- `financialReportingService` — `getReport`, `subscribe`
- `subscribeToTables` — helper for live postgres change subscriptions
- `studentRequirementFilesService` — `getAll`, `getPublished`, `create`, `update`, `replaceFile`, `delete`
