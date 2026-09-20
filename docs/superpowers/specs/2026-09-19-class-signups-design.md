# Class Signups: Volunteer & Student Signup System

## Summary

Add a SignUpGenius-style signup system to the TORCH site: anyone can create a
class session, sign up as a teaching volunteer or as a student (via a
parent/guardian), and edit or remove entries on the public roster. A
volunteer teaching the class posts the Zoom link/time directly on the class
page. An admin dashboard provides oversight (audit log + spam cleanup) over
the otherwise fully public, self-serve flow.

Email-based features (magic-link login, automated Zoom reminder emails) are
explicitly out of scope for this phase and are called out below as future
work, but the data model is designed so they can be added without rework.

## Goals

- Let any volunteer create a class (topic, description, date/time).
- Let volunteers sign up to teach/help with a class.
- Let parents/guardians sign up a student for a class.
- Let anyone edit/cancel a class or remove a roster entry (SignUpGenius trust
  model — no login required for this).
- Let a volunteer post the Zoom link/start time on the class page for
  students and other volunteers to see before the session.
- Keep an audit trail of every create/edit/add/remove so organizers can see
  what changed, since the roster itself has no access control.
- Give organizers a password-protected view of that audit trail plus the
  ability to hard-delete spam.

## Non-goals (deferred to a future phase)

- Sending any email (magic-link login, signup confirmations, Zoom reminder
  emails). No email provider is integrated in this phase.
- Login/accounts for volunteers or students.
- Signup capacity limits.
- Recurring/multi-session classes — each class is a single date/time session.

## Architecture

- **Frontend**: stays static HTML/CSS/JS on GitHub Pages, consistent with
  the rest of the site (no framework, no build step). New `classes.html`
  page plus a password-gated `admin.html`, both calling a JSON API with
  plain `fetch()`.
- **Backend**: Cloudflare Pages Functions (serverless functions deployed
  alongside the static site) backed by Cloudflare D1 (SQLite). Chosen so the
  whole project — static site, API, and database — deploys from one repo on
  one platform.
- **Admin auth**: a single shared admin password stored as a Cloudflare
  secret. The admin login endpoint checks it and sets a signed session
  cookie; no per-organizer accounts and no self-serve signup/reset.

## Data model (Cloudflare D1)

```sql
CREATE TABLE classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  date TEXT NOT NULL,           -- ISO date
  start_time TEXT NOT NULL,     -- e.g. "16:00"
  end_time TEXT,
  zoom_link TEXT,               -- nullable, filled in later by a volunteer
  zoom_notes TEXT,              -- optional meeting ID/passcode etc.
  status TEXT NOT NULL DEFAULT 'upcoming', -- upcoming | cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE volunteer_signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role_note TEXT,               -- optional, e.g. "leading" / "assisting"
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE student_signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  student_name TEXT NOT NULL,
  grade TEXT,
  parent_name TEXT NOT NULL,
  parent_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE signup_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,    -- 'class' | 'volunteer_signup' | 'student_signup'
  action TEXT NOT NULL,         -- 'created' | 'edited' | 'removed'
  snapshot TEXT NOT NULL,       -- JSON blob of the record at time of action
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

No capacity fields, per requirements. No `users` table — the admin
password is a secret, not a DB row; participants have no accounts.

Every mutating API call (create/edit/delete class, add/remove a signup)
writes a `signup_audit_log` row with a snapshot of the affected record
*before* it's changed/deleted, so history survives even after a public
edit/removal.

## Public "Classes" page (`classes.html`)

- Lists classes sorted soonest-first; classes with `status = 'cancelled'` or
  with `date` in the past collapse into a separate section below the
  upcoming list ("past" is derived from `date`, not a stored status).
- **Create a Class** button, open to anyone: title, description, date,
  start/end time. The form includes an optional "sign yourself up as the
  teaching volunteer" checkbox (pre-checked) that also creates a
  `volunteer_signups` row for the creator in the same submission.
- Each class card/detail view shows:
  - **Volunteer roster**: name + role note, an "Add yourself" form (name,
    email, optional role note), and a public "Remove" button per entry.
  - **Student roster**: student name + grade, an "Add a student" form
    (student name, grade, parent name, parent email), and a public "Remove"
    button per entry.
  - **Zoom section**: if `zoom_link` is set, show the link, start time, and
    any `zoom_notes` prominently; otherwise show "Zoom link will be posted
    by the volunteer before class."
  - **Edit** and **Cancel/Delete** actions on the class itself, open to
    anyone (same trust model as the rosters).
- No login anywhere on this page. Layout follows SignUpGenius conventions
  (clear list of who's signed up, obvious add/remove affordances) for
  familiarity.

## Admin dashboard (`admin.html`)

Since the public page is fully self-serve, the admin dashboard exists only
for oversight:

- Password-gated (shared admin password → session cookie).
- Shows the full `signup_audit_log` across all classes — who/what
  changed, with snapshots and timestamps — as the safety net for the
  "anyone can edit" model.
- A **hard delete** action for spam/garbage classes or entries — bypasses
  the normal public edit flow, for cleanup organizers do that isn't just a
  regular "remove."

## Zoom link handling

The Zoom link is a plain field on the class, editable through the same
public edit form as the rest of the class details. The volunteer teaching
the class fills it in whenever they have it; there's no automation in this
phase — visibility on the page is the entire distribution mechanism.

## Future phase (explicitly deferred, not built now)

- Integrate an email provider (e.g. Resend) for transactional email.
- Magic-link login for volunteers/students, replacing the fully-public edit
  model with a private-per-person edit link.
- A Cloudflare Cron Trigger that emails the Zoom link to everyone on both
  rosters a set time before `start_time` (e.g. 1 hour before).
- Optional capacity limits per class.

The data model already carries what these need (`zoom_link`, `start_time`,
`email`/`parent_email` columns), so this phase should only require adding a
`sent_at` column and a scheduled function — no schema rework.

## Testing approach

- Cloudflare Pages Functions (API handlers) covered with unit tests (e.g.
  Vitest + Miniflare) against a local D1 instance: create/edit/delete class,
  add/remove volunteer signup, add/remove student signup, audit log writes
  on every mutation.
- Manual browser testing of the full public flow (create a class → sign up
  as volunteer → sign up a student → edit the class → post a Zoom link →
  remove entries → confirm each action produced an audit log row) and the
  admin login/dashboard (view log, hard-delete an entry).
