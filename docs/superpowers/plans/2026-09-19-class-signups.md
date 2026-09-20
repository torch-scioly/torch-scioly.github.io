# Class Signups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a SignUpGenius-style class signup system to the TORCH static site — anyone can create a class, sign up as a volunteer or student, edit/cancel a class, and see the Zoom link a volunteer posts — with a password-gated admin dashboard for audit-log oversight and spam cleanup.

**Architecture:** The existing static HTML/CSS/JS site (GitHub Pages) gets two new pages (`classes.html`, `admin.html`) that call a JSON API implemented as Cloudflare Pages Functions, backed by a Cloudflare D1 (SQLite) database. Every mutation writes a row to a `signup_audit_log` table before/at the time of the change.

**Tech Stack:** Cloudflare Pages Functions (ES modules), Cloudflare D1, Vitest + `@cloudflare/vitest-pool-workers` for backend tests, plain HTML/CSS/vanilla JS for the frontend (no build step, matching the existing site).

**Spec:** `docs/superpowers/specs/2026-09-19-class-signups-design.md`

## Global Constraints

- No email sending in this phase — no magic-link login, no automated Zoom reminder emails. The Zoom link is a plain field a volunteer fills in and is displayed on the page.
- No login/accounts for volunteers or students. Every class-creation, signup, edit, and removal endpoint is unauthenticated.
- Admin access is a single shared password (env var `ADMIN_PASSWORD`), verified by `functions/api/admin/login.js`, which issues a signed session cookie. No per-organizer accounts.
- No signup capacity limits anywhere.
- Classes are single sessions only — one `date`/`start_time`/`end_time`, no recurring series.
- Every mutating API call (create/edit/cancel/hard-delete a class; add/remove a volunteer or student signup) must write a `signup_audit_log` row with a JSON snapshot of the affected record.
- D1 binding name is always `DB`; session-signing secret env var is `SESSION_SECRET`.

---

## Task 1: Project Scaffolding (Cloudflare Pages Functions + D1 + Vitest)

**Files:**
- Create: `package.json`
- Create: `wrangler.toml`
- Create: `migrations/0001_init.sql`
- Create: `vitest.config.js`
- Create: `tests/apply-migrations.js`
- Create: `tests/smoke.test.js`

**Interfaces:**
- Produces: a D1 database bound as `env.DB` in both Cloudflare Pages Functions and Vitest tests (via `@cloudflare/vitest-pool-workers`), already migrated with the schema below. `npm test` runs the full backend test suite. `npm run dev` serves the static site + API locally.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "torch-signups",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "wrangler pages dev . --d1=DB=torch-signups"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.90.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: installs without errors, creates `package-lock.json` and `node_modules/`.

- [ ] **Step 3: Create the D1 database**

Run: `npx wrangler d1 create torch-signups`
This prints a `database_id` (a UUID). Copy it — you'll need it in the next step.

- [ ] **Step 4: Create `wrangler.toml`**

```toml
name = "torch-signups"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "."

[[d1_databases]]
binding = "DB"
database_name = "torch-signups"
database_id = "PASTE_THE_DATABASE_ID_FROM_STEP_3_HERE"
```

Replace `PASTE_THE_DATABASE_ID_FROM_STEP_3_HERE` with the `database_id` printed in Step 3.

- [ ] **Step 5: Create the schema migration `migrations/0001_init.sql`**

```sql
CREATE TABLE classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  zoom_link TEXT,
  zoom_notes TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE volunteer_signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role_note TEXT,
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
  entity_type TEXT NOT NULL,
  action TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 6: Create `vitest.config.js`**

```js
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
import path from 'node:path';

export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(__dirname, 'migrations');
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      setupFiles: ['./tests/apply-migrations.js'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              ADMIN_PASSWORD: 'test-admin-password',
              SESSION_SECRET: 'test-session-secret',
            },
          },
        },
      },
    },
  };
});
```

- [ ] **Step 7: Create `tests/apply-migrations.js`**

```js
import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

This runs once before the test suite and applies `migrations/0001_init.sql` to the in-memory D1 instance. `@cloudflare/vitest-pool-workers` isolates storage per test (writes made during a test are rolled back afterward), so every test starts from this freshly migrated, empty-tables state — no manual cleanup needed between tests.

- [ ] **Step 8: Write the smoke test `tests/smoke.test.js`**

```js
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';

describe('D1 binding', () => {
  it('is bound and migrated', async () => {
    const result = await env.DB.prepare('SELECT COUNT(*) as count FROM classes').first();
    expect(result.count).toBe(0);
  });
});
```

- [ ] **Step 9: Run the test suite**

Run: `npm test`
Expected: PASS (1 test) — confirms the D1 binding, migrations, and Vitest harness all work together.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json wrangler.toml migrations vitest.config.js tests/apply-migrations.js tests/smoke.test.js
git commit -m "chore: scaffold Cloudflare Pages Functions + D1 + Vitest"
```

---

## Task 2: Database & Audit Log Helpers

**Files:**
- Create: `functions/api/_lib/db.js`
- Create: `functions/api/_lib/audit.js`
- Test: `tests/lib/db.test.js`
- Test: `tests/lib/audit.test.js`

**Interfaces:**
- Consumes: `env.DB` (D1 binding from Task 1).
- Produces (`functions/api/_lib/db.js`):
  - `createClass(db, {title, description, date, startTime, endTime}) -> classRow`
  - `listClasses(db) -> classRow[]`
  - `getClassById(db, id) -> classRow | null`
  - `updateClass(db, id, fields: object) -> classRow`
  - `hardDeleteClass(db, id) -> void`
  - `addVolunteerSignup(db, classId, {name, email, roleNote}) -> volunteerSignupRow`
  - `listVolunteerSignups(db, classId) -> volunteerSignupRow[]`
  - `getVolunteerSignup(db, id) -> volunteerSignupRow | null`
  - `removeVolunteerSignup(db, id) -> void`
  - `addStudentSignup(db, classId, {studentName, grade, parentName, parentEmail}) -> studentSignupRow`
  - `listStudentSignups(db, classId) -> studentSignupRow[]`
  - `getStudentSignup(db, id) -> studentSignupRow | null`
  - `removeStudentSignup(db, id) -> void`
- Produces (`functions/api/_lib/audit.js`):
  - `writeAuditLog(db, {classId, entityType, action, snapshot}) -> void`
  - `listAuditLog(db) -> logRow[]` (each row's `snapshot` field parsed back into an object)

- [ ] **Step 1: Write the failing tests for `db.js`**

Create `tests/lib/db.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import {
  createClass,
  listClasses,
  getClassById,
  updateClass,
  hardDeleteClass,
  addVolunteerSignup,
  listVolunteerSignups,
  getVolunteerSignup,
  removeVolunteerSignup,
  addStudentSignup,
  listStudentSignups,
  getStudentSignup,
  removeStudentSignup,
} from '../../functions/api/_lib/db.js';

describe('classes', () => {
  it('creates and lists a class with a default upcoming status', async () => {
    const created = await createClass(env.DB, {
      title: 'Genetics',
      description: 'Intro to heredity',
      date: '2026-10-01',
      startTime: '16:00',
      endTime: '17:00',
    });

    expect(created.title).toBe('Genetics');
    expect(created.status).toBe('upcoming');

    const all = await listClasses(env.DB);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(created.id);
  });

  it('gets a class by id, returning null when missing', async () => {
    const created = await createClass(env.DB, {
      title: 'Astronomy',
      date: '2026-10-02',
      startTime: '15:00',
    });

    expect((await getClassById(env.DB, created.id)).title).toBe('Astronomy');
    expect(await getClassById(env.DB, 999999)).toBeNull();
  });

  it('updates only the given fields', async () => {
    const created = await createClass(env.DB, {
      title: 'Chemistry',
      date: '2026-10-03',
      startTime: '14:00',
    });

    const updated = await updateClass(env.DB, created.id, {
      zoom_link: 'https://zoom.us/j/123',
      status: 'cancelled',
    });

    expect(updated.zoom_link).toBe('https://zoom.us/j/123');
    expect(updated.status).toBe('cancelled');
    expect(updated.title).toBe('Chemistry');
  });

  it('hard deletes a class and cascades its signups', async () => {
    const created = await createClass(env.DB, {
      title: 'Water Quality',
      date: '2026-10-04',
      startTime: '13:00',
    });
    await addVolunteerSignup(env.DB, created.id, { name: 'Ana', email: 'ana@example.com' });
    await addStudentSignup(env.DB, created.id, {
      studentName: 'Sam',
      parentName: 'Pat',
      parentEmail: 'pat@example.com',
    });

    await hardDeleteClass(env.DB, created.id);

    expect(await getClassById(env.DB, created.id)).toBeNull();
    expect(await listVolunteerSignups(env.DB, created.id)).toHaveLength(0);
    expect(await listStudentSignups(env.DB, created.id)).toHaveLength(0);
  });
});

describe('volunteer signups', () => {
  it('adds, lists, gets, and removes a volunteer signup', async () => {
    const cls = await createClass(env.DB, { title: 'CAD Design', date: '2026-10-05', startTime: '10:00' });

    const signup = await addVolunteerSignup(env.DB, cls.id, {
      name: 'Priya',
      email: 'priya@example.com',
      roleNote: 'leading',
    });

    expect(signup.class_id).toBe(cls.id);
    expect(await listVolunteerSignups(env.DB, cls.id)).toHaveLength(1);
    expect((await getVolunteerSignup(env.DB, signup.id)).name).toBe('Priya');

    await removeVolunteerSignup(env.DB, signup.id);

    expect(await listVolunteerSignups(env.DB, cls.id)).toHaveLength(0);
    expect(await getVolunteerSignup(env.DB, signup.id)).toBeNull();
  });
});

describe('student signups', () => {
  it('adds, lists, gets, and removes a student signup', async () => {
    const cls = await createClass(env.DB, { title: 'Code Busters', date: '2026-10-06', startTime: '11:00' });

    const signup = await addStudentSignup(env.DB, cls.id, {
      studentName: 'Jamie',
      grade: '5',
      parentName: 'Lee',
      parentEmail: 'lee@example.com',
    });

    expect(signup.class_id).toBe(cls.id);
    expect(await listStudentSignups(env.DB, cls.id)).toHaveLength(1);
    expect((await getStudentSignup(env.DB, signup.id)).student_name).toBe('Jamie');

    await removeStudentSignup(env.DB, signup.id);

    expect(await listStudentSignups(env.DB, cls.id)).toHaveLength(0);
    expect(await getStudentSignup(env.DB, signup.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/db.test.js`
Expected: FAIL — `functions/api/_lib/db.js` does not exist yet.

- [ ] **Step 3: Implement `functions/api/_lib/db.js`**

```js
export async function createClass(db, { title, description, date, startTime, endTime }) {
  return db
    .prepare(
      `INSERT INTO classes (title, description, date, start_time, end_time)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(title, description ?? null, date, startTime, endTime ?? null)
    .first();
}

export async function listClasses(db) {
  const { results } = await db.prepare(`SELECT * FROM classes ORDER BY date ASC, start_time ASC`).all();
  return results;
}

export async function getClassById(db, id) {
  return db.prepare(`SELECT * FROM classes WHERE id = ?`).bind(id).first();
}

export async function updateClass(db, id, fields) {
  const columns = Object.keys(fields);
  const values = Object.values(fields);
  const setClause = columns.map((column) => `${column} = ?`).join(', ');

  return db
    .prepare(`UPDATE classes SET ${setClause} WHERE id = ? RETURNING *`)
    .bind(...values, id)
    .first();
}

export async function hardDeleteClass(db, id) {
  await db.prepare(`DELETE FROM volunteer_signups WHERE class_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM student_signups WHERE class_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM classes WHERE id = ?`).bind(id).run();
}

export async function addVolunteerSignup(db, classId, { name, email, roleNote }) {
  return db
    .prepare(
      `INSERT INTO volunteer_signups (class_id, name, email, role_note)
       VALUES (?, ?, ?, ?)
       RETURNING *`
    )
    .bind(classId, name, email, roleNote ?? null)
    .first();
}

export async function listVolunteerSignups(db, classId) {
  const { results } = await db
    .prepare(`SELECT * FROM volunteer_signups WHERE class_id = ? ORDER BY created_at ASC`)
    .bind(classId)
    .all();
  return results;
}

export async function getVolunteerSignup(db, id) {
  return db.prepare(`SELECT * FROM volunteer_signups WHERE id = ?`).bind(id).first();
}

export async function removeVolunteerSignup(db, id) {
  await db.prepare(`DELETE FROM volunteer_signups WHERE id = ?`).bind(id).run();
}

export async function addStudentSignup(db, classId, { studentName, grade, parentName, parentEmail }) {
  return db
    .prepare(
      `INSERT INTO student_signups (class_id, student_name, grade, parent_name, parent_email)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(classId, studentName, grade ?? null, parentName, parentEmail)
    .first();
}

export async function listStudentSignups(db, classId) {
  const { results } = await db
    .prepare(`SELECT * FROM student_signups WHERE class_id = ? ORDER BY created_at ASC`)
    .bind(classId)
    .all();
  return results;
}

export async function getStudentSignup(db, id) {
  return db.prepare(`SELECT * FROM student_signups WHERE id = ?`).bind(id).first();
}

export async function removeStudentSignup(db, id) {
  await db.prepare(`DELETE FROM student_signups WHERE id = ?`).bind(id).run();
}
```

- [ ] **Step 4: Run tests to verify `db.js` tests pass**

Run: `npm test -- tests/lib/db.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing tests for `audit.js`**

Create `tests/lib/audit.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { writeAuditLog, listAuditLog } from '../../functions/api/_lib/audit.js';

describe('audit log', () => {
  it('writes and lists entries with the snapshot parsed back to an object', async () => {
    await writeAuditLog(env.DB, {
      classId: 42,
      entityType: 'class',
      action: 'created',
      snapshot: { id: 42, title: 'Genetics' },
    });

    const entries = await listAuditLog(env.DB);

    expect(entries).toHaveLength(1);
    expect(entries[0].class_id).toBe(42);
    expect(entries[0].entity_type).toBe('class');
    expect(entries[0].action).toBe('created');
    expect(entries[0].snapshot).toEqual({ id: 42, title: 'Genetics' });
  });

  it('lists most recent entries first', async () => {
    await writeAuditLog(env.DB, { classId: 1, entityType: 'class', action: 'created', snapshot: { id: 1 } });
    await writeAuditLog(env.DB, { classId: 1, entityType: 'class', action: 'edited', snapshot: { id: 1 } });

    const entries = await listAuditLog(env.DB);

    expect(entries[0].action).toBe('edited');
    expect(entries[1].action).toBe('created');
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test -- tests/lib/audit.test.js`
Expected: FAIL — `functions/api/_lib/audit.js` does not exist yet.

- [ ] **Step 7: Implement `functions/api/_lib/audit.js`**

```js
export async function writeAuditLog(db, { classId, entityType, action, snapshot }) {
  await db
    .prepare(
      `INSERT INTO signup_audit_log (class_id, entity_type, action, snapshot)
       VALUES (?, ?, ?, ?)`
    )
    .bind(classId, entityType, action, JSON.stringify(snapshot))
    .run();
}

export async function listAuditLog(db) {
  const { results } = await db.prepare(`SELECT * FROM signup_audit_log ORDER BY created_at DESC, id DESC`).all();
  return results.map((row) => ({ ...row, snapshot: JSON.parse(row.snapshot) }));
}
```

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: PASS (all tests, including Task 1's smoke test)

- [ ] **Step 9: Commit**

```bash
git add functions/api/_lib/db.js functions/api/_lib/audit.js tests/lib/db.test.js tests/lib/audit.test.js
git commit -m "feat: add D1 data access and audit log helpers"
```

---

## Task 3: Classes Collection Endpoint (GET list / POST create)

**Files:**
- Create: `functions/api/classes.js`
- Test: `tests/api/classes.test.js`

**Interfaces:**
- Consumes: `createClass`, `listClasses`, `addVolunteerSignup` (Task 2 `db.js`), `writeAuditLog` (Task 2 `audit.js`).
- Produces: `GET /api/classes` (returns `classRow[]`), `POST /api/classes` (body `{title, description?, date, startTime, endTime?, signUpAsVolunteer?, volunteerName?, volunteerEmail?, volunteerRoleNote?}`, returns the created `classRow` with status 201).

- [ ] **Step 1: Write the failing tests**

Create `tests/api/classes.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet, onRequestPost } from '../../functions/api/classes.js';
import { listVolunteerSignups } from '../../functions/api/_lib/db.js';
import { listAuditLog } from '../../functions/api/_lib/audit.js';

function jsonRequest(body) {
  return new Request('https://example.com/api/classes', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('GET /api/classes', () => {
  it('returns an empty list when there are no classes', async () => {
    const response = await onRequestGet({ env });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});

describe('POST /api/classes', () => {
  it('creates a class and logs it in the audit log', async () => {
    const response = await onRequestPost({
      request: jsonRequest({
        title: 'Genetics',
        description: 'Intro to heredity',
        date: '2026-10-01',
        startTime: '16:00',
        endTime: '17:00',
      }),
      env,
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.title).toBe('Genetics');
    expect(body.status).toBe('upcoming');

    const list = await (await onRequestGet({ env })).json();
    expect(list).toHaveLength(1);

    const log = await listAuditLog(env.DB);
    expect(log).toHaveLength(1);
    expect(log[0].entity_type).toBe('class');
    expect(log[0].action).toBe('created');
  });

  it('rejects a class missing required fields', async () => {
    const response = await onRequestPost({ request: jsonRequest({ title: 'Missing date' }), env });
    expect(response.status).toBe(400);
  });

  it('signs the creator up as a volunteer when requested', async () => {
    const response = await onRequestPost({
      request: jsonRequest({
        title: 'Astronomy',
        date: '2026-10-02',
        startTime: '15:00',
        signUpAsVolunteer: true,
        volunteerName: 'Priya',
        volunteerEmail: 'priya@example.com',
      }),
      env,
    });

    const created = await response.json();
    const volunteers = await listVolunteerSignups(env.DB, created.id);
    expect(volunteers).toHaveLength(1);
    expect(volunteers[0].name).toBe('Priya');

    const log = await listAuditLog(env.DB);
    expect(log.some((entry) => entry.entity_type === 'volunteer_signup')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/api/classes.test.js`
Expected: FAIL — `functions/api/classes.js` does not exist yet.

- [ ] **Step 3: Implement `functions/api/classes.js`**

```js
import { createClass, listClasses, addVolunteerSignup } from './_lib/db.js';
import { writeAuditLog } from './_lib/audit.js';

export async function onRequestGet({ env }) {
  const classes = await listClasses(env.DB);
  return Response.json(classes);
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();

  if (!body.title || !body.date || !body.startTime) {
    return Response.json({ error: 'title, date, and startTime are required' }, { status: 400 });
  }

  const newClass = await createClass(env.DB, {
    title: body.title,
    description: body.description,
    date: body.date,
    startTime: body.startTime,
    endTime: body.endTime,
  });

  await writeAuditLog(env.DB, {
    classId: newClass.id,
    entityType: 'class',
    action: 'created',
    snapshot: newClass,
  });

  if (body.signUpAsVolunteer && body.volunteerName && body.volunteerEmail) {
    const signup = await addVolunteerSignup(env.DB, newClass.id, {
      name: body.volunteerName,
      email: body.volunteerEmail,
      roleNote: body.volunteerRoleNote,
    });

    await writeAuditLog(env.DB, {
      classId: newClass.id,
      entityType: 'volunteer_signup',
      action: 'created',
      snapshot: signup,
    });
  }

  return Response.json(newClass, { status: 201 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/api/classes.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/api/classes.js tests/api/classes.test.js
git commit -m "feat: add classes collection endpoint (list + create)"
```

---

## Task 4: Class Item Endpoint (GET detail / PUT edit / DELETE cancel)

**Files:**
- Create: `functions/api/classes/[id].js`
- Test: `tests/api/classes-item.test.js`

**Interfaces:**
- Consumes: `getClassById`, `updateClass`, `listVolunteerSignups`, `listStudentSignups` (Task 2 `db.js`), `writeAuditLog` (Task 2 `audit.js`), `onRequestPost` from `functions/api/classes.js` (Task 3, to create fixture classes in tests).
- Produces: `GET /api/classes/:id` (returns `{...classRow, volunteers, students}` or 404), `PUT /api/classes/:id` (partial update, accepts `title`, `description`, `date`, `startTime`, `endTime`, `zoom_link`, `zoom_notes`; returns updated `classRow`), `DELETE /api/classes/:id` (soft-cancels by setting `status = 'cancelled'`, logged as an `edited` audit action; returns the updated `classRow`).

- [ ] **Step 1: Write the failing tests**

Create `tests/api/classes-item.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as createClassRequest } from '../../functions/api/classes.js';
import { onRequestGet, onRequestPut, onRequestDelete } from '../../functions/api/classes/[id].js';
import { listAuditLog } from '../../functions/api/_lib/audit.js';

async function createFixtureClass(overrides = {}) {
  const response = await createClassRequest({
    request: new Request('https://example.com/api/classes', {
      method: 'POST',
      body: JSON.stringify({ title: 'Genetics', date: '2026-10-01', startTime: '16:00', ...overrides }),
    }),
    env,
  });
  return response.json();
}

describe('GET /api/classes/:id', () => {
  it('returns 404 for a missing class', async () => {
    const response = await onRequestGet({ env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('returns the class with empty rosters', async () => {
    const cls = await createFixtureClass();
    const response = await onRequestGet({ env, params: { id: String(cls.id) } });
    const body = await response.json();

    expect(body.title).toBe('Genetics');
    expect(body.volunteers).toEqual([]);
    expect(body.students).toEqual([]);
  });
});

describe('PUT /api/classes/:id', () => {
  it('updates the given fields and logs an edit', async () => {
    const cls = await createFixtureClass();

    const response = await onRequestPut({
      request: new Request('https://example.com', {
        method: 'PUT',
        body: JSON.stringify({ zoom_link: 'https://zoom.us/j/123', zoom_notes: 'Passcode: 4242' }),
      }),
      env,
      params: { id: String(cls.id) },
    });

    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated.zoom_link).toBe('https://zoom.us/j/123');

    const log = await listAuditLog(env.DB);
    expect(log.some((entry) => entry.action === 'edited')).toBe(true);
  });

  it('returns 404 for a missing class', async () => {
    const response = await onRequestPut({
      request: new Request('https://example.com', { method: 'PUT', body: JSON.stringify({ title: 'x' }) }),
      env,
      params: { id: '999999' },
    });
    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/classes/:id', () => {
  it('soft-cancels the class', async () => {
    const cls = await createFixtureClass();

    const response = await onRequestDelete({ env, params: { id: String(cls.id) } });
    expect(response.status).toBe(200);
    const cancelled = await response.json();
    expect(cancelled.status).toBe('cancelled');

    const stillThere = await onRequestGet({ env, params: { id: String(cls.id) } });
    expect(stillThere.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/api/classes-item.test.js`
Expected: FAIL — `functions/api/classes/[id].js` does not exist yet.

- [ ] **Step 3: Implement `functions/api/classes/[id].js`**

```js
import { getClassById, updateClass, listVolunteerSignups, listStudentSignups } from '../_lib/db.js';
import { writeAuditLog } from '../_lib/audit.js';

const EDITABLE_FIELDS = {
  title: 'title',
  description: 'description',
  date: 'date',
  startTime: 'start_time',
  endTime: 'end_time',
  zoom_link: 'zoom_link',
  zoom_notes: 'zoom_notes',
};

export async function onRequestGet({ env, params }) {
  const classId = Number(params.id);
  const record = await getClassById(env.DB, classId);
  if (!record) {
    return Response.json({ error: 'Class not found' }, { status: 404 });
  }

  const volunteers = await listVolunteerSignups(env.DB, classId);
  const students = await listStudentSignups(env.DB, classId);
  return Response.json({ ...record, volunteers, students });
}

export async function onRequestPut({ request, env, params }) {
  const classId = Number(params.id);
  const existing = await getClassById(env.DB, classId);
  if (!existing) {
    return Response.json({ error: 'Class not found' }, { status: 404 });
  }

  const body = await request.json();
  const fields = {};
  for (const [bodyKey, column] of Object.entries(EDITABLE_FIELDS)) {
    if (bodyKey in body) fields[column] = body[bodyKey];
  }

  if (Object.keys(fields).length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 });
  }

  const updated = await updateClass(env.DB, classId, fields);

  await writeAuditLog(env.DB, { classId, entityType: 'class', action: 'edited', snapshot: updated });

  return Response.json(updated);
}

export async function onRequestDelete({ env, params }) {
  const classId = Number(params.id);
  const existing = await getClassById(env.DB, classId);
  if (!existing) {
    return Response.json({ error: 'Class not found' }, { status: 404 });
  }

  const cancelled = await updateClass(env.DB, classId, { status: 'cancelled' });

  await writeAuditLog(env.DB, { classId, entityType: 'class', action: 'edited', snapshot: cancelled });

  return Response.json(cancelled);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/api/classes-item.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add "functions/api/classes/[id].js" tests/api/classes-item.test.js
git commit -m "feat: add class detail, edit, and cancel endpoint"
```

---

## Task 5: Volunteer Signup Endpoints (POST add / DELETE remove)

**Files:**
- Create: `functions/api/classes/[id]/volunteers.js`
- Create: `functions/api/classes/[id]/volunteers/[signupId].js`
- Test: `tests/api/volunteers.test.js`

**Interfaces:**
- Consumes: `getClassById`, `addVolunteerSignup`, `getVolunteerSignup`, `removeVolunteerSignup` (Task 2 `db.js`), `writeAuditLog` (Task 2 `audit.js`), `onRequestPost` from `functions/api/classes.js` (Task 3, for test fixtures).
- Produces: `POST /api/classes/:id/volunteers` (body `{name, email, roleNote?}`, returns created signup, 201), `DELETE /api/classes/:id/volunteers/:signupId` (removes the signup, returns 204).

- [ ] **Step 1: Write the failing tests**

Create `tests/api/volunteers.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as createClassRequest } from '../../functions/api/classes.js';
import { onRequestPost as addVolunteer } from '../../functions/api/classes/[id]/volunteers.js';
import { onRequestDelete as removeVolunteer } from '../../functions/api/classes/[id]/volunteers/[signupId].js';
import { listVolunteerSignups } from '../../functions/api/_lib/db.js';
import { listAuditLog } from '../../functions/api/_lib/audit.js';

async function createFixtureClass() {
  const response = await createClassRequest({
    request: new Request('https://example.com/api/classes', {
      method: 'POST',
      body: JSON.stringify({ title: 'CAD Design', date: '2026-10-05', startTime: '10:00' }),
    }),
    env,
  });
  return response.json();
}

describe('POST /api/classes/:id/volunteers', () => {
  it('adds a volunteer signup', async () => {
    const cls = await createFixtureClass();

    const response = await addVolunteer({
      request: new Request('https://example.com', {
        method: 'POST',
        body: JSON.stringify({ name: 'Priya', email: 'priya@example.com', roleNote: 'leading' }),
      }),
      env,
      params: { id: String(cls.id) },
    });

    expect(response.status).toBe(201);
    expect(await listVolunteerSignups(env.DB, cls.id)).toHaveLength(1);
  });

  it('rejects a signup missing required fields', async () => {
    const cls = await createFixtureClass();

    const response = await addVolunteer({
      request: new Request('https://example.com', { method: 'POST', body: JSON.stringify({ name: 'No Email' }) }),
      env,
      params: { id: String(cls.id) },
    });

    expect(response.status).toBe(400);
  });

  it('returns 404 for a missing class', async () => {
    const response = await addVolunteer({
      request: new Request('https://example.com', {
        method: 'POST',
        body: JSON.stringify({ name: 'Priya', email: 'priya@example.com' }),
      }),
      env,
      params: { id: '999999' },
    });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/classes/:id/volunteers/:signupId', () => {
  it('removes the signup and logs it', async () => {
    const cls = await createFixtureClass();
    const created = await (
      await addVolunteer({
        request: new Request('https://example.com', {
          method: 'POST',
          body: JSON.stringify({ name: 'Priya', email: 'priya@example.com' }),
        }),
        env,
        params: { id: String(cls.id) },
      })
    ).json();

    const response = await removeVolunteer({ env, params: { id: String(cls.id), signupId: String(created.id) } });

    expect(response.status).toBe(204);
    expect(await listVolunteerSignups(env.DB, cls.id)).toHaveLength(0);

    const log = await listAuditLog(env.DB);
    expect(log.some((entry) => entry.entity_type === 'volunteer_signup' && entry.action === 'removed')).toBe(true);
  });

  it('returns 404 for a signup that does not belong to the class', async () => {
    const clsA = await createFixtureClass();
    const clsB = await createFixtureClass();
    const created = await (
      await addVolunteer({
        request: new Request('https://example.com', {
          method: 'POST',
          body: JSON.stringify({ name: 'Priya', email: 'priya@example.com' }),
        }),
        env,
        params: { id: String(clsA.id) },
      })
    ).json();

    const response = await removeVolunteer({ env, params: { id: String(clsB.id), signupId: String(created.id) } });
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/api/volunteers.test.js`
Expected: FAIL — the two new function files don't exist yet.

- [ ] **Step 3: Implement `functions/api/classes/[id]/volunteers.js`**

```js
import { getClassById, addVolunteerSignup } from '../../_lib/db.js';
import { writeAuditLog } from '../../_lib/audit.js';

export async function onRequestPost({ request, env, params }) {
  const classId = Number(params.id);
  const existing = await getClassById(env.DB, classId);
  if (!existing) {
    return Response.json({ error: 'Class not found' }, { status: 404 });
  }

  const body = await request.json();
  if (!body.name || !body.email) {
    return Response.json({ error: 'name and email are required' }, { status: 400 });
  }

  const signup = await addVolunteerSignup(env.DB, classId, {
    name: body.name,
    email: body.email,
    roleNote: body.roleNote,
  });

  await writeAuditLog(env.DB, { classId, entityType: 'volunteer_signup', action: 'created', snapshot: signup });

  return Response.json(signup, { status: 201 });
}
```

- [ ] **Step 4: Implement `functions/api/classes/[id]/volunteers/[signupId].js`**

```js
import { getVolunteerSignup, removeVolunteerSignup } from '../../../_lib/db.js';
import { writeAuditLog } from '../../../_lib/audit.js';

export async function onRequestDelete({ env, params }) {
  const signupId = Number(params.signupId);
  const existing = await getVolunteerSignup(env.DB, signupId);
  if (!existing || existing.class_id !== Number(params.id)) {
    return Response.json({ error: 'Signup not found' }, { status: 404 });
  }

  await removeVolunteerSignup(env.DB, signupId);

  await writeAuditLog(env.DB, {
    classId: existing.class_id,
    entityType: 'volunteer_signup',
    action: 'removed',
    snapshot: existing,
  });

  return new Response(null, { status: 204 });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/api/volunteers.test.js`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add "functions/api/classes/[id]/volunteers.js" "functions/api/classes/[id]/volunteers/[signupId].js" tests/api/volunteers.test.js
git commit -m "feat: add volunteer signup add/remove endpoints"
```

---

## Task 6: Student Signup Endpoints (POST add / DELETE remove)

**Files:**
- Create: `functions/api/classes/[id]/students.js`
- Create: `functions/api/classes/[id]/students/[signupId].js`
- Test: `tests/api/students.test.js`

**Interfaces:**
- Consumes: `getClassById`, `addStudentSignup`, `getStudentSignup`, `removeStudentSignup` (Task 2 `db.js`), `writeAuditLog` (Task 2 `audit.js`), `onRequestPost` from `functions/api/classes.js` (Task 3, for fixtures).
- Produces: `POST /api/classes/:id/students` (body `{studentName, grade?, parentName, parentEmail}`, returns created signup, 201), `DELETE /api/classes/:id/students/:signupId` (removes the signup, returns 204).

- [ ] **Step 1: Write the failing tests**

Create `tests/api/students.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as createClassRequest } from '../../functions/api/classes.js';
import { onRequestPost as addStudent } from '../../functions/api/classes/[id]/students.js';
import { onRequestDelete as removeStudent } from '../../functions/api/classes/[id]/students/[signupId].js';
import { listStudentSignups } from '../../functions/api/_lib/db.js';
import { listAuditLog } from '../../functions/api/_lib/audit.js';

async function createFixtureClass() {
  const response = await createClassRequest({
    request: new Request('https://example.com/api/classes', {
      method: 'POST',
      body: JSON.stringify({ title: 'Code Busters', date: '2026-10-06', startTime: '11:00' }),
    }),
    env,
  });
  return response.json();
}

describe('POST /api/classes/:id/students', () => {
  it('adds a student signup', async () => {
    const cls = await createFixtureClass();

    const response = await addStudent({
      request: new Request('https://example.com', {
        method: 'POST',
        body: JSON.stringify({ studentName: 'Jamie', grade: '5', parentName: 'Lee', parentEmail: 'lee@example.com' }),
      }),
      env,
      params: { id: String(cls.id) },
    });

    expect(response.status).toBe(201);
    expect(await listStudentSignups(env.DB, cls.id)).toHaveLength(1);
  });

  it('rejects a signup missing required fields', async () => {
    const cls = await createFixtureClass();

    const response = await addStudent({
      request: new Request('https://example.com', {
        method: 'POST',
        body: JSON.stringify({ studentName: 'Jamie' }),
      }),
      env,
      params: { id: String(cls.id) },
    });

    expect(response.status).toBe(400);
  });

  it('returns 404 for a missing class', async () => {
    const response = await addStudent({
      request: new Request('https://example.com', {
        method: 'POST',
        body: JSON.stringify({ studentName: 'Jamie', parentName: 'Lee', parentEmail: 'lee@example.com' }),
      }),
      env,
      params: { id: '999999' },
    });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/classes/:id/students/:signupId', () => {
  it('removes the signup and logs it', async () => {
    const cls = await createFixtureClass();
    const created = await (
      await addStudent({
        request: new Request('https://example.com', {
          method: 'POST',
          body: JSON.stringify({ studentName: 'Jamie', parentName: 'Lee', parentEmail: 'lee@example.com' }),
        }),
        env,
        params: { id: String(cls.id) },
      })
    ).json();

    const response = await removeStudent({ env, params: { id: String(cls.id), signupId: String(created.id) } });

    expect(response.status).toBe(204);
    expect(await listStudentSignups(env.DB, cls.id)).toHaveLength(0);

    const log = await listAuditLog(env.DB);
    expect(log.some((entry) => entry.entity_type === 'student_signup' && entry.action === 'removed')).toBe(true);
  });

  it('returns 404 for a signup that does not belong to the class', async () => {
    const clsA = await createFixtureClass();
    const clsB = await createFixtureClass();
    const created = await (
      await addStudent({
        request: new Request('https://example.com', {
          method: 'POST',
          body: JSON.stringify({ studentName: 'Jamie', parentName: 'Lee', parentEmail: 'lee@example.com' }),
        }),
        env,
        params: { id: String(clsA.id) },
      })
    ).json();

    const response = await removeStudent({ env, params: { id: String(clsB.id), signupId: String(created.id) } });
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/api/students.test.js`
Expected: FAIL — the two new function files don't exist yet.

- [ ] **Step 3: Implement `functions/api/classes/[id]/students.js`**

```js
import { getClassById, addStudentSignup } from '../../_lib/db.js';
import { writeAuditLog } from '../../_lib/audit.js';

export async function onRequestPost({ request, env, params }) {
  const classId = Number(params.id);
  const existing = await getClassById(env.DB, classId);
  if (!existing) {
    return Response.json({ error: 'Class not found' }, { status: 404 });
  }

  const body = await request.json();
  if (!body.studentName || !body.parentName || !body.parentEmail) {
    return Response.json({ error: 'studentName, parentName, and parentEmail are required' }, { status: 400 });
  }

  const signup = await addStudentSignup(env.DB, classId, {
    studentName: body.studentName,
    grade: body.grade,
    parentName: body.parentName,
    parentEmail: body.parentEmail,
  });

  await writeAuditLog(env.DB, { classId, entityType: 'student_signup', action: 'created', snapshot: signup });

  return Response.json(signup, { status: 201 });
}
```

- [ ] **Step 4: Implement `functions/api/classes/[id]/students/[signupId].js`**

```js
import { getStudentSignup, removeStudentSignup } from '../../../_lib/db.js';
import { writeAuditLog } from '../../../_lib/audit.js';

export async function onRequestDelete({ env, params }) {
  const signupId = Number(params.signupId);
  const existing = await getStudentSignup(env.DB, signupId);
  if (!existing || existing.class_id !== Number(params.id)) {
    return Response.json({ error: 'Signup not found' }, { status: 404 });
  }

  await removeStudentSignup(env.DB, signupId);

  await writeAuditLog(env.DB, {
    classId: existing.class_id,
    entityType: 'student_signup',
    action: 'removed',
    snapshot: existing,
  });

  return new Response(null, { status: 204 });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/api/students.test.js`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add "functions/api/classes/[id]/students.js" "functions/api/classes/[id]/students/[signupId].js" tests/api/students.test.js
git commit -m "feat: add student signup add/remove endpoints"
```

---

## Task 7: Admin Auth Helper & Login Endpoint

**Files:**
- Create: `functions/api/_lib/auth.js`
- Create: `functions/api/admin/login.js`
- Test: `tests/api/admin-login.test.js`

**Interfaces:**
- Consumes: `env.ADMIN_PASSWORD`, `env.SESSION_SECRET` (test values set in Task 1's `vitest.config.js`; real secrets set later via `wrangler pages secret put`).
- Produces (`functions/api/_lib/auth.js`): `SESSION_COOKIE_NAME` (string constant), `createSessionCookie(env) -> Promise<string>` (a `Set-Cookie` header value), `isValidAdminSession(request, env) -> Promise<boolean>`.
- Produces (`functions/api/admin/login.js`): `POST /api/admin/login` (body `{password}`; returns 200 with a `Set-Cookie` header on success, 401 on wrong password).

Note: the session cookie omits the `Secure` attribute so it also works over plain `http://localhost` during local `wrangler pages dev` testing. It keeps `HttpOnly` and `SameSite=Strict`; production traffic is served entirely over HTTPS via Cloudflare regardless.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/admin-login.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as login } from '../../functions/api/admin/login.js';
import { isValidAdminSession, SESSION_COOKIE_NAME } from '../../functions/api/_lib/auth.js';

function loginRequest(password) {
  return new Request('https://example.com/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

describe('POST /api/admin/login', () => {
  it('rejects an incorrect password', async () => {
    const response = await login({ request: loginRequest('wrong-password'), env });
    expect(response.status).toBe(401);
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  it('accepts the correct password and issues a valid session cookie', async () => {
    const response = await login({ request: loginRequest(env.ADMIN_PASSWORD), env });
    expect(response.status).toBe(200);

    const setCookie = response.headers.get('Set-Cookie');
    expect(setCookie).toContain(SESSION_COOKIE_NAME);

    const cookieValue = setCookie.split(';')[0];
    const authedRequest = new Request('https://example.com', { headers: { Cookie: cookieValue } });
    expect(await isValidAdminSession(authedRequest, env)).toBe(true);
  });

  it('rejects a request with no cookie', async () => {
    const request = new Request('https://example.com');
    expect(await isValidAdminSession(request, env)).toBe(false);
  });

  it('rejects a tampered cookie', async () => {
    const response = await login({ request: loginRequest(env.ADMIN_PASSWORD), env });
    const cookieValue = response.headers.get('Set-Cookie').split(';')[0];
    const tampered = cookieValue.slice(0, -1) + (cookieValue.endsWith('0') ? '1' : '0');

    const request = new Request('https://example.com', { headers: { Cookie: tampered } });
    expect(await isValidAdminSession(request, env)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/api/admin-login.test.js`
Expected: FAIL — neither file exists yet.

- [ ] **Step 3: Implement `functions/api/_lib/auth.js`**

```js
export const SESSION_COOKIE_NAME = 'torch_admin_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createSessionCookie(env) {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const signature = await hmac(env.SESSION_SECRET, String(expiresAt));
  const value = `${expiresAt}.${signature}`;
  return `${SESSION_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`;
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  const match = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

export async function isValidAdminSession(request, env) {
  const value = readCookie(request, SESSION_COOKIE_NAME);
  if (!value) return false;

  const [expiresAtStr, signature] = value.split('.');
  if (!expiresAtStr || !signature) return false;

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expectedSignature = await hmac(env.SESSION_SECRET, expiresAtStr);
  return signature === expectedSignature;
}
```

- [ ] **Step 4: Implement `functions/api/admin/login.js`**

```js
import { createSessionCookie } from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  const body = await request.json();

  if (body.password !== env.ADMIN_PASSWORD) {
    return Response.json({ error: 'Invalid password' }, { status: 401 });
  }

  const cookie = await createSessionCookie(env);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie },
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/api/admin-login.test.js`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add functions/api/_lib/auth.js functions/api/admin/login.js tests/api/admin-login.test.js
git commit -m "feat: add admin session auth and login endpoint"
```

---

## Task 8: Admin Audit Log Endpoint

**Files:**
- Create: `functions/api/admin/audit-log.js`
- Test: `tests/api/admin-audit-log.test.js`

**Interfaces:**
- Consumes: `isValidAdminSession` (Task 7 `auth.js`), `listAuditLog` (Task 2 `audit.js`), `onRequestPost` from `functions/api/admin/login.js` (Task 7, for test cookies) and `functions/api/classes.js` (Task 3, for fixtures).
- Produces: `GET /api/admin/audit-log` (401 without a valid session cookie; 200 with `logRow[]` when authenticated).

- [ ] **Step 1: Write the failing tests**

Create `tests/api/admin-audit-log.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as login } from '../../functions/api/admin/login.js';
import { onRequestGet as getAuditLog } from '../../functions/api/admin/audit-log.js';
import { onRequestPost as createClassRequest } from '../../functions/api/classes.js';

async function adminCookie() {
  const response = await login({
    request: new Request('https://example.com', {
      method: 'POST',
      body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
    }),
    env,
  });
  return response.headers.get('Set-Cookie').split(';')[0];
}

describe('GET /api/admin/audit-log', () => {
  it('rejects a request with no session', async () => {
    const response = await getAuditLog({ request: new Request('https://example.com'), env });
    expect(response.status).toBe(401);
  });

  it('returns the audit log for an authenticated admin', async () => {
    await createClassRequest({
      request: new Request('https://example.com/api/classes', {
        method: 'POST',
        body: JSON.stringify({ title: 'Genetics', date: '2026-10-01', startTime: '16:00' }),
      }),
      env,
    });

    const cookie = await adminCookie();
    const response = await getAuditLog({
      request: new Request('https://example.com', { headers: { Cookie: cookie } }),
      env,
    });

    expect(response.status).toBe(200);
    const log = await response.json();
    expect(log).toHaveLength(1);
    expect(log[0].entity_type).toBe('class');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/api/admin-audit-log.test.js`
Expected: FAIL — `functions/api/admin/audit-log.js` does not exist yet.

- [ ] **Step 3: Implement `functions/api/admin/audit-log.js`**

```js
import { isValidAdminSession } from '../_lib/auth.js';
import { listAuditLog } from '../_lib/audit.js';

export async function onRequestGet({ request, env }) {
  if (!(await isValidAdminSession(request, env))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const log = await listAuditLog(env.DB);
  return Response.json(log);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/api/admin-audit-log.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/api/admin/audit-log.js tests/api/admin-audit-log.test.js
git commit -m "feat: add password-gated admin audit log endpoint"
```

---

## Task 9: Admin Hard-Delete Endpoints

**Files:**
- Create: `functions/api/admin/classes/[id].js`
- Create: `functions/api/admin/volunteer-signups/[id].js`
- Create: `functions/api/admin/student-signups/[id].js`
- Test: `tests/api/admin-hard-delete.test.js`

**Interfaces:**
- Consumes: `isValidAdminSession` (Task 7), `getClassById`, `hardDeleteClass`, `getVolunteerSignup`, `removeVolunteerSignup`, `getStudentSignup`, `removeStudentSignup` (Task 2 `db.js`), `writeAuditLog` (Task 2 `audit.js`), login/create helpers (Tasks 3, 5, 6, 7 for fixtures).
- Produces: `DELETE /api/admin/classes/:id` (401 unauthenticated, 404 missing, 204 on hard delete — cascades signups), `DELETE /api/admin/volunteer-signups/:id`, `DELETE /api/admin/student-signups/:id` (same shape, for a single signup).

- [ ] **Step 1: Write the failing tests**

Create `tests/api/admin-hard-delete.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as login } from '../../functions/api/admin/login.js';
import { onRequestPost as createClassRequest } from '../../functions/api/classes.js';
import { onRequestPost as addVolunteer } from '../../functions/api/classes/[id]/volunteers.js';
import { onRequestPost as addStudent } from '../../functions/api/classes/[id]/students.js';
import { onRequestDelete as hardDeleteClass } from '../../functions/api/admin/classes/[id].js';
import { onRequestDelete as hardDeleteVolunteer } from '../../functions/api/admin/volunteer-signups/[id].js';
import { onRequestDelete as hardDeleteStudent } from '../../functions/api/admin/student-signups/[id].js';
import { getClassById, getVolunteerSignup, getStudentSignup } from '../../functions/api/_lib/db.js';

async function adminCookie() {
  const response = await login({
    request: new Request('https://example.com', {
      method: 'POST',
      body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
    }),
    env,
  });
  return response.headers.get('Set-Cookie').split(';')[0];
}

async function createFixtureClass() {
  const response = await createClassRequest({
    request: new Request('https://example.com/api/classes', {
      method: 'POST',
      body: JSON.stringify({ title: 'Scrambler', date: '2026-10-07', startTime: '09:00' }),
    }),
    env,
  });
  return response.json();
}

describe('DELETE /api/admin/classes/:id', () => {
  it('rejects an unauthenticated request', async () => {
    const cls = await createFixtureClass();
    const response = await hardDeleteClass({
      request: new Request('https://example.com'),
      env,
      params: { id: String(cls.id) },
    });
    expect(response.status).toBe(401);
  });

  it('permanently deletes the class', async () => {
    const cls = await createFixtureClass();
    const cookie = await adminCookie();

    const response = await hardDeleteClass({
      request: new Request('https://example.com', { headers: { Cookie: cookie } }),
      env,
      params: { id: String(cls.id) },
    });

    expect(response.status).toBe(204);
    expect(await getClassById(env.DB, cls.id)).toBeNull();
  });
});

describe('DELETE /api/admin/volunteer-signups/:id', () => {
  it('permanently deletes a volunteer signup', async () => {
    const cls = await createFixtureClass();
    const signup = await (
      await addVolunteer({
        request: new Request('https://example.com', {
          method: 'POST',
          body: JSON.stringify({ name: 'Priya', email: 'priya@example.com' }),
        }),
        env,
        params: { id: String(cls.id) },
      })
    ).json();
    const cookie = await adminCookie();

    const response = await hardDeleteVolunteer({
      request: new Request('https://example.com', { headers: { Cookie: cookie } }),
      env,
      params: { id: String(signup.id) },
    });

    expect(response.status).toBe(204);
    expect(await getVolunteerSignup(env.DB, signup.id)).toBeNull();
  });
});

describe('DELETE /api/admin/student-signups/:id', () => {
  it('permanently deletes a student signup', async () => {
    const cls = await createFixtureClass();
    const signup = await (
      await addStudent({
        request: new Request('https://example.com', {
          method: 'POST',
          body: JSON.stringify({ studentName: 'Jamie', parentName: 'Lee', parentEmail: 'lee@example.com' }),
        }),
        env,
        params: { id: String(cls.id) },
      })
    ).json();
    const cookie = await adminCookie();

    const response = await hardDeleteStudent({
      request: new Request('https://example.com', { headers: { Cookie: cookie } }),
      env,
      params: { id: String(signup.id) },
    });

    expect(response.status).toBe(204);
    expect(await getStudentSignup(env.DB, signup.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/api/admin-hard-delete.test.js`
Expected: FAIL — none of the three files exist yet.

- [ ] **Step 3: Implement `functions/api/admin/classes/[id].js`**

```js
import { isValidAdminSession } from '../../_lib/auth.js';
import { getClassById, hardDeleteClass } from '../../_lib/db.js';
import { writeAuditLog } from '../../_lib/audit.js';

export async function onRequestDelete({ request, env, params }) {
  if (!(await isValidAdminSession(request, env))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const classId = Number(params.id);
  const existing = await getClassById(env.DB, classId);
  if (!existing) {
    return Response.json({ error: 'Class not found' }, { status: 404 });
  }

  await writeAuditLog(env.DB, { classId, entityType: 'class', action: 'removed', snapshot: existing });
  await hardDeleteClass(env.DB, classId);

  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Implement `functions/api/admin/volunteer-signups/[id].js`**

```js
import { isValidAdminSession } from '../../_lib/auth.js';
import { getVolunteerSignup, removeVolunteerSignup } from '../../_lib/db.js';
import { writeAuditLog } from '../../_lib/audit.js';

export async function onRequestDelete({ request, env, params }) {
  if (!(await isValidAdminSession(request, env))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const signupId = Number(params.id);
  const existing = await getVolunteerSignup(env.DB, signupId);
  if (!existing) {
    return Response.json({ error: 'Signup not found' }, { status: 404 });
  }

  await writeAuditLog(env.DB, {
    classId: existing.class_id,
    entityType: 'volunteer_signup',
    action: 'removed',
    snapshot: existing,
  });
  await removeVolunteerSignup(env.DB, signupId);

  return new Response(null, { status: 204 });
}
```

- [ ] **Step 5: Implement `functions/api/admin/student-signups/[id].js`**

```js
import { isValidAdminSession } from '../../_lib/auth.js';
import { getStudentSignup, removeStudentSignup } from '../../_lib/db.js';
import { writeAuditLog } from '../../_lib/audit.js';

export async function onRequestDelete({ request, env, params }) {
  if (!(await isValidAdminSession(request, env))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const signupId = Number(params.id);
  const existing = await getStudentSignup(env.DB, signupId);
  if (!existing) {
    return Response.json({ error: 'Signup not found' }, { status: 404 });
  }

  await writeAuditLog(env.DB, {
    classId: existing.class_id,
    entityType: 'student_signup',
    action: 'removed',
    snapshot: existing,
  });
  await removeStudentSignup(env.DB, signupId);

  return new Response(null, { status: 204 });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/api/admin-hard-delete.test.js`
Expected: PASS (4 tests)

- [ ] **Step 7: Run the full backend test suite**

Run: `npm test`
Expected: PASS (all tests across all files) — the backend API is now complete.

- [ ] **Step 8: Commit**

```bash
git add "functions/api/admin/classes/[id].js" "functions/api/admin/volunteer-signups/[id].js" "functions/api/admin/student-signups/[id].js" tests/api/admin-hard-delete.test.js
git commit -m "feat: add password-gated admin hard-delete endpoints"
```

---

## Task 10: Add "Classes" Nav Link to Existing Pages

**Files:**
- Modify: `index.html`
- Modify: `courses.html`
- Modify: `volunteers.html`
- Modify: `events.html`
- Modify: `results.html`

**Interfaces:**
- Produces: a `<li><a href="classes.html">Classes</a></li>` nav entry, present and consistent across all five existing pages, linking to the page built in Task 11.

- [ ] **Step 1: Edit `index.html`**

Find:
```html
        <li><a href="courses.html">Courses</a></li>
        <li><a href="volunteers.html">Volunteers</a></li>
```
Replace with:
```html
        <li><a href="courses.html">Courses</a></li>
        <li><a href="classes.html">Classes</a></li>
        <li><a href="volunteers.html">Volunteers</a></li>
```

- [ ] **Step 2: Edit `courses.html`**

Find:
```html
        <li><a href="courses.html" class="active">Courses</a></li>
        <li><a href="volunteers.html">Volunteers</a></li>
```
Replace with:
```html
        <li><a href="courses.html" class="active">Courses</a></li>
        <li><a href="classes.html">Classes</a></li>
        <li><a href="volunteers.html">Volunteers</a></li>
```

- [ ] **Step 3: Edit `volunteers.html`**

Find:
```html
        <li><a href="courses.html">Courses</a></li>
        <li><a href="volunteers.html" class="active">Volunteers</a></li>
```
Replace with:
```html
        <li><a href="courses.html">Courses</a></li>
        <li><a href="classes.html">Classes</a></li>
        <li><a href="volunteers.html" class="active">Volunteers</a></li>
```

- [ ] **Step 4: Edit `events.html`**

Find:
```html
        <li><a href="courses.html">Courses</a></li>
        <li><a href="volunteers.html">Volunteers</a></li>
```
Replace with:
```html
        <li><a href="courses.html">Courses</a></li>
        <li><a href="classes.html">Classes</a></li>
        <li><a href="volunteers.html">Volunteers</a></li>
```

- [ ] **Step 5: Edit `results.html`**

Find:
```html
        <li><a href="courses.html">Courses</a></li>
        <li><a href="volunteers.html">Volunteers</a></li>
```
Replace with:
```html
        <li><a href="courses.html">Courses</a></li>
        <li><a href="classes.html">Classes</a></li>
        <li><a href="volunteers.html">Volunteers</a></li>
```

- [ ] **Step 6: Manually verify**

Open each edited file in a browser (or `npm run dev` and visit each page). Confirm a "Classes" link appears in the nav between "Courses" and "Volunteers" (it will 404 until Task 11 creates `classes.html` — that's expected at this point).

- [ ] **Step 7: Commit**

```bash
git add index.html courses.html volunteers.html events.html results.html
git commit -m "feat: add Classes nav link to existing pages"
```

---

## Task 11: `classes.html` Page Shell & CSS

**Files:**
- Create: `classes.html`
- Modify: `css/styles.css`

**Interfaces:**
- Produces: `classes.html` with element ids `show-create-form`, `create-class-form` (fields: `title`, `description`, `date`, `startTime`, `endTime`, `signUpAsVolunteer`, `volunteerName`, `volunteerEmail`), `creator-volunteer-fields`, `cancel-create-form`, `upcoming-classes`, `past-classes`, `class-detail-modal`, `close-detail-modal`, `class-detail-body` — all consumed by `js/classes.js` in Tasks 12–13. CSS classes `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.signup-form`, `.checkbox-label`, `.class-list`, `.class-card`, `.class-card.cancelled`, `.class-meta`, `.modal`, `.modal-content`, `.modal-close`, `.roster-list`, `.remove-btn`, `.zoom-box`, `.audit-log-table` — reused by `admin.html` in Task 14.

- [ ] **Step 1: Create `classes.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Classes - TORCH</title>
  <link rel="stylesheet" href="css/styles.css">
</head>
<body>
  <nav class="navbar">
    <div class="nav-container">
      <a href="index.html" class="nav-logo">
        <span class="logo-icon">&#9670;</span> TORCH
      </a>
      <button class="nav-toggle" aria-label="Toggle navigation">&#9776;</button>
      <ul class="nav-links">
        <li><a href="index.html">Home</a></li>
        <li><a href="courses.html">Courses</a></li>
        <li><a href="classes.html" class="active">Classes</a></li>
        <li><a href="volunteers.html">Volunteers</a></li>
        <li><a href="events.html">Events</a></li>
        <li><a href="results.html">Results</a></li>
      </ul>
    </div>
  </nav>

  <div class="page-header">
    <h1>Class Sign-Ups</h1>
    <p>Create a class, sign up to teach, or sign up a student to attend &mdash; just like SignUpGenius.</p>
  </div>

  <section class="section">
    <button id="show-create-form" class="btn btn-primary">+ Create a Class</button>

    <form id="create-class-form" class="signup-form" hidden>
      <h3>New Class</h3>
      <label>Title
        <input type="text" name="title" required>
      </label>
      <label>Description
        <textarea name="description"></textarea>
      </label>
      <label>Date
        <input type="date" name="date" required>
      </label>
      <label>Start Time
        <input type="time" name="startTime" required>
      </label>
      <label>End Time
        <input type="time" name="endTime">
      </label>
      <label class="checkbox-label">
        <input type="checkbox" name="signUpAsVolunteer" checked>
        Sign me up as the teaching volunteer
      </label>
      <div id="creator-volunteer-fields">
        <label>Your Name
          <input type="text" name="volunteerName">
        </label>
        <label>Your Email
          <input type="email" name="volunteerEmail">
        </label>
      </div>
      <button type="submit" class="btn btn-primary">Create Class</button>
      <button type="button" id="cancel-create-form" class="btn btn-secondary">Cancel</button>
    </form>

    <h2 class="section-title">Upcoming Classes</h2>
    <div id="upcoming-classes" class="class-list"></div>

    <h2 class="section-title">Past &amp; Cancelled Classes</h2>
    <div id="past-classes" class="class-list"></div>
  </section>

  <div id="class-detail-modal" class="modal" hidden>
    <div class="modal-content">
      <button id="close-detail-modal" class="modal-close" aria-label="Close">&times;</button>
      <div id="class-detail-body"></div>
    </div>
  </div>

  <script src="js/main.js"></script>
  <script src="js/classes.js"></script>
</body>
</html>
```

- [ ] **Step 2: Append the new styles to `css/styles.css`**

Add at the end of the file:

```css
/* ===== Class Sign-Ups ===== */
.btn {
  display: inline-block;
  padding: 0.6rem 1.25rem;
  border: none;
  border-radius: var(--radius);
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
}

.btn-primary {
  background: var(--primary);
  color: #fff;
}

.btn-primary:hover {
  background: var(--primary-light);
}

.btn-secondary {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
}

.btn-danger {
  background: #c0392b;
  color: #fff;
}

.signup-form {
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.5rem;
  margin: 1rem 0;
  max-width: 480px;
}

.signup-form label {
  display: block;
  margin-bottom: 0.75rem;
  font-weight: 600;
}

.signup-form input,
.signup-form textarea {
  display: block;
  width: 100%;
  margin-top: 0.25rem;
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
}

.checkbox-label {
  display: flex !important;
  align-items: center;
  gap: 0.5rem;
}

.checkbox-label input {
  width: auto !important;
}

.class-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1.5rem;
  margin: 1.5rem 0;
}

.class-card {
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.25rem;
  box-shadow: var(--shadow);
  cursor: pointer;
}

.class-card:hover {
  box-shadow: var(--shadow-hover);
}

.class-card.cancelled {
  opacity: 0.6;
}

.class-card .class-meta {
  color: var(--text-light);
  font-size: 0.9rem;
}

.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.modal-content {
  background: var(--bg-white);
  border-radius: var(--radius);
  padding: 2rem;
  max-width: 600px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  position: relative;
}

.modal-close {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
}

.roster-list {
  list-style: none;
  margin: 0.5rem 0 1rem;
}

.roster-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--border);
}

.roster-list .remove-btn {
  background: none;
  border: none;
  color: #c0392b;
  cursor: pointer;
  font-size: 0.85rem;
}

.zoom-box {
  background: var(--bg);
  border-left: 4px solid var(--secondary);
  padding: 1rem;
  border-radius: var(--radius);
  margin: 1rem 0;
}

.audit-log-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1rem;
}

.audit-log-table th,
.audit-log-table td {
  text-align: left;
  padding: 0.5rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.9rem;
}
```

- [ ] **Step 3: Manually verify**

Run `npm run dev`, open `http://localhost:8788/classes.html`. Confirm the page loads with the nav, the "+ Create a Class" button, an empty "Upcoming Classes" / "Past & Cancelled Classes" layout, and that clicking "+ Create a Class" reveals the form (no JS wired up yet, so submitting it will do nothing — that's expected until Task 12).

- [ ] **Step 4: Commit**

```bash
git add classes.html css/styles.css
git commit -m "feat: add classes page shell and signup CSS"
```

---

## Task 12: Class List Rendering & Create-Class Form

**Files:**
- Create: `js/classes.js`
- Modify: `classes.html` (already references `js/classes.js` from Task 11 — no change needed here)

**Interfaces:**
- Consumes: `GET /api/classes`, `POST /api/classes` (Task 3); element ids from Task 11's `classes.html`.
- Produces: `loadClasses()`, `renderClassList(container, classes)`, `escapeHtml(value)` — module-level functions in `js/classes.js`, reused and extended by Task 13.

- [ ] **Step 1: Create `js/classes.js`**

```js
document.addEventListener('DOMContentLoaded', function () {
  var showFormBtn = document.getElementById('show-create-form');
  var createForm = document.getElementById('create-class-form');
  var cancelFormBtn = document.getElementById('cancel-create-form');
  var volunteerCheckbox = createForm ? createForm.querySelector('[name="signUpAsVolunteer"]') : null;
  var creatorFields = document.getElementById('creator-volunteer-fields');

  if (showFormBtn && createForm) {
    showFormBtn.addEventListener('click', function () {
      createForm.hidden = false;
      showFormBtn.hidden = true;
    });
  }

  if (cancelFormBtn && createForm) {
    cancelFormBtn.addEventListener('click', function () {
      createForm.hidden = true;
      showFormBtn.hidden = false;
      createForm.reset();
    });
  }

  if (volunteerCheckbox && creatorFields) {
    var toggleCreatorFields = function () {
      creatorFields.hidden = !volunteerCheckbox.checked;
    };
    volunteerCheckbox.addEventListener('change', toggleCreatorFields);
    toggleCreatorFields();
  }

  if (createForm) {
    createForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var formData = new FormData(createForm);
      var payload = {
        title: formData.get('title'),
        description: formData.get('description'),
        date: formData.get('date'),
        startTime: formData.get('startTime'),
        endTime: formData.get('endTime') || undefined,
        signUpAsVolunteer: formData.get('signUpAsVolunteer') === 'on',
        volunteerName: formData.get('volunteerName'),
        volunteerEmail: formData.get('volunteerEmail'),
      };

      fetch('/api/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          if (!res.ok) throw new Error('Failed to create class');
          return res.json();
        })
        .then(function () {
          createForm.reset();
          createForm.hidden = true;
          showFormBtn.hidden = false;
          loadClasses();
        })
        .catch(function (err) {
          alert(err.message);
        });
    });
  }

  loadClasses();
});

function loadClasses() {
  var upcomingEl = document.getElementById('upcoming-classes');
  var pastEl = document.getElementById('past-classes');
  if (!upcomingEl || !pastEl) return;

  fetch('/api/classes')
    .then(function (res) { return res.json(); })
    .then(function (classes) {
      var today = new Date().toISOString().slice(0, 10);
      var upcoming = classes.filter(function (c) { return c.status !== 'cancelled' && c.date >= today; });
      var past = classes.filter(function (c) { return c.status === 'cancelled' || c.date < today; });

      renderClassList(upcomingEl, upcoming);
      renderClassList(pastEl, past);
    });
}

function renderClassList(container, classes) {
  container.innerHTML = '';
  if (classes.length === 0) {
    container.innerHTML = '<p>No classes here yet.</p>';
    return;
  }

  classes.forEach(function (cls) {
    var card = document.createElement('div');
    card.className = 'class-card' + (cls.status === 'cancelled' ? ' cancelled' : '');
    card.innerHTML =
      '<h3>' + escapeHtml(cls.title) + '</h3>' +
      '<p class="class-meta">' + escapeHtml(cls.date) + ' at ' + escapeHtml(cls.start_time) + '</p>' +
      (cls.status === 'cancelled' ? '<p class="class-meta">Cancelled</p>' : '');
    card.addEventListener('click', function () {
      openClassDetail(cls.id);
    });
    container.appendChild(card);
  });
}

function escapeHtml(value) {
  var div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}
```

Note: `openClassDetail` is called here but defined in Task 13 — clicking a card will throw until then, which is expected at this checkpoint.

- [ ] **Step 2: Manually verify**

Run `npm run dev`, open `http://localhost:8788/classes.html`.
1. Fill out "+ Create a Class" with a title, date, and start time, leave "Sign me up as the teaching volunteer" checked, fill in your name/email, submit.
2. Confirm the form closes and a new card appears under "Upcoming Classes" showing the title and date/time.
3. Create a second class with a past date (e.g. yesterday); confirm it appears under "Past & Cancelled Classes" instead.
4. Open the Network tab and confirm `POST /api/classes` returned 201 and `GET /api/classes` returned both classes.

- [ ] **Step 3: Commit**

```bash
git add js/classes.js
git commit -m "feat: render class list and wire up create-class form"
```

---

## Task 13: Class Detail Modal (Rosters, Signups, Zoom, Edit, Cancel)

**Files:**
- Modify: `js/classes.js`

**Interfaces:**
- Consumes: `GET/PUT/DELETE /api/classes/:id` (Task 4), `POST/DELETE` volunteer and student signup endpoints (Tasks 5, 6); `escapeHtml` (Task 12); `class-detail-modal`, `close-detail-modal`, `class-detail-body` element ids (Task 11).
- Produces: `openClassDetail(classId)`, `renderClassDetailHtml(cls)`, `wireClassDetailEvents(cls)`, `renderEditClassSection(cls)` appended to `js/classes.js`.

- [ ] **Step 1: Append the modal close handler to the `DOMContentLoaded` listener in `js/classes.js`**

Find:
```js
  loadClasses();
});
```
Replace with:
```js
  var closeModalBtn = document.getElementById('close-detail-modal');
  var detailModal = document.getElementById('class-detail-modal');
  if (closeModalBtn && detailModal) {
    closeModalBtn.addEventListener('click', function () {
      detailModal.hidden = true;
    });
  }

  loadClasses();
});
```

- [ ] **Step 2: Append the detail-view functions to `js/classes.js`**

Add at the end of the file:

```js
function openClassDetail(classId) {
  var modal = document.getElementById('class-detail-modal');
  var body = document.getElementById('class-detail-body');
  if (!modal || !body) return;

  fetch('/api/classes/' + classId)
    .then(function (res) { return res.json(); })
    .then(function (cls) {
      body.innerHTML = renderClassDetailHtml(cls);
      wireClassDetailEvents(cls);
      modal.hidden = false;
    });
}

function renderClassDetailHtml(cls) {
  var zoomHtml = cls.zoom_link
    ? '<div class="zoom-box"><strong>Join here:</strong> ' +
      '<a href="' + escapeHtml(cls.zoom_link) + '" target="_blank" rel="noopener">' + escapeHtml(cls.zoom_link) + '</a>' +
      (cls.zoom_notes ? '<p>' + escapeHtml(cls.zoom_notes) + '</p>' : '') +
      '</div>'
    : '<div class="zoom-box">Zoom link will be posted by the volunteer before class.</div>';

  var volunteersHtml = cls.volunteers.map(function (v) {
    return '<li>' + escapeHtml(v.name) + (v.role_note ? ' (' + escapeHtml(v.role_note) + ')' : '') +
      ' <button class="remove-btn" data-type="volunteers" data-id="' + v.id + '">Remove</button></li>';
  }).join('');

  var studentsHtml = cls.students.map(function (s) {
    return '<li>' + escapeHtml(s.student_name) + (s.grade ? ' (Grade ' + escapeHtml(s.grade) + ')' : '') +
      ' <button class="remove-btn" data-type="students" data-id="' + s.id + '">Remove</button></li>';
  }).join('');

  return (
    '<h2>' + escapeHtml(cls.title) + '</h2>' +
    '<p class="class-meta">' + escapeHtml(cls.date) + ' at ' + escapeHtml(cls.start_time) + '</p>' +
    '<p>' + escapeHtml(cls.description || '') + '</p>' +
    zoomHtml +
    '<h3>Volunteers</h3>' +
    '<ul class="roster-list" id="volunteer-roster">' + volunteersHtml + '</ul>' +
    '<form id="add-volunteer-form" class="signup-form">' +
      '<label>Name<input type="text" name="name" required></label>' +
      '<label>Email<input type="email" name="email" required></label>' +
      '<label>Role note<input type="text" name="roleNote"></label>' +
      '<button type="submit" class="btn btn-primary">Add yourself</button>' +
    '</form>' +
    '<h3>Students</h3>' +
    '<ul class="roster-list" id="student-roster">' + studentsHtml + '</ul>' +
    '<form id="add-student-form" class="signup-form">' +
      '<label>Student name<input type="text" name="studentName" required></label>' +
      '<label>Grade<input type="text" name="grade"></label>' +
      '<label>Parent name<input type="text" name="parentName" required></label>' +
      '<label>Parent email<input type="email" name="parentEmail" required></label>' +
      '<button type="submit" class="btn btn-primary">Add student</button>' +
    '</form>' +
    '<div id="edit-class-section"></div>'
  );
}

function wireClassDetailEvents(cls) {
  var body = document.getElementById('class-detail-body');

  body.querySelectorAll('.remove-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var type = btn.getAttribute('data-type');
      var id = btn.getAttribute('data-id');
      fetch('/api/classes/' + cls.id + '/' + type + '/' + id, { method: 'DELETE' })
        .then(function () {
          openClassDetail(cls.id);
          loadClasses();
        });
    });
  });

  var addVolunteerForm = document.getElementById('add-volunteer-form');
  if (addVolunteerForm) {
    addVolunteerForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var formData = new FormData(addVolunteerForm);
      fetch('/api/classes/' + cls.id + '/volunteers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.get('name'),
          email: formData.get('email'),
          roleNote: formData.get('roleNote'),
        }),
      }).then(function () { openClassDetail(cls.id); });
    });
  }

  var addStudentForm = document.getElementById('add-student-form');
  if (addStudentForm) {
    addStudentForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var formData = new FormData(addStudentForm);
      fetch('/api/classes/' + cls.id + '/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName: formData.get('studentName'),
          grade: formData.get('grade'),
          parentName: formData.get('parentName'),
          parentEmail: formData.get('parentEmail'),
        }),
      }).then(function () { openClassDetail(cls.id); });
    });
  }

  renderEditClassSection(cls);
}

function renderEditClassSection(cls) {
  var container = document.getElementById('edit-class-section');
  if (!container) return;

  container.innerHTML =
    '<h3>Edit Class</h3>' +
    '<form id="edit-class-form" class="signup-form">' +
      '<label>Title<input type="text" name="title" value="' + escapeHtml(cls.title) + '" required></label>' +
      '<label>Description<textarea name="description">' + escapeHtml(cls.description || '') + '</textarea></label>' +
      '<label>Date<input type="date" name="date" value="' + escapeHtml(cls.date) + '" required></label>' +
      '<label>Start Time<input type="time" name="startTime" value="' + escapeHtml(cls.start_time) + '" required></label>' +
      '<label>End Time<input type="time" name="endTime" value="' + escapeHtml(cls.end_time || '') + '"></label>' +
      '<label>Zoom Link<input type="url" name="zoom_link" value="' + escapeHtml(cls.zoom_link || '') + '"></label>' +
      '<label>Zoom Notes<input type="text" name="zoom_notes" value="' + escapeHtml(cls.zoom_notes || '') + '"></label>' +
      '<button type="submit" class="btn btn-primary">Save Changes</button>' +
    '</form>' +
    (cls.status === 'cancelled'
      ? '<p class="class-meta">This class is cancelled.</p>'
      : '<button id="cancel-class-btn" class="btn btn-danger">Cancel This Class</button>');

  var editForm = document.getElementById('edit-class-form');
  editForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var formData = new FormData(editForm);
    fetch('/api/classes/' + cls.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: formData.get('title'),
        description: formData.get('description'),
        date: formData.get('date'),
        startTime: formData.get('startTime'),
        endTime: formData.get('endTime') || null,
        zoom_link: formData.get('zoom_link') || null,
        zoom_notes: formData.get('zoom_notes') || null,
      }),
    }).then(function () {
      openClassDetail(cls.id);
      loadClasses();
    });
  });

  var cancelBtn = document.getElementById('cancel-class-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      if (!confirm('Cancel this class?')) return;
      fetch('/api/classes/' + cls.id, { method: 'DELETE' })
        .then(function () {
          openClassDetail(cls.id);
          loadClasses();
        });
    });
  }
}
```

- [ ] **Step 3: Manually verify**

Run `npm run dev`, open `http://localhost:8788/classes.html`.
1. Click a class card; confirm the modal opens showing the description, an empty Volunteers list, an empty Students list, and "Zoom link will be posted by the volunteer before class."
2. Add yourself as a volunteer via the form; confirm your name appears in the roster with a "Remove" button, and clicking "Remove" removes it.
3. Add a student via the form (student name, grade, parent name, parent email); confirm it appears in the Students roster and can be removed.
4. In the "Edit Class" form at the bottom, fill in a Zoom link and notes, click "Save Changes"; confirm the modal reloads showing the Zoom box with the link instead of the placeholder text.
5. Click "Cancel This Class"; confirm the modal shows "This class is cancelled" and the card moves to "Past & Cancelled Classes" after closing the modal.
6. Click the modal's close (&times;) button; confirm the modal hides.

- [ ] **Step 4: Commit**

```bash
git add js/classes.js
git commit -m "feat: add class detail modal with rosters, zoom display, edit, and cancel"
```

---

## Task 14: Admin Page & Login Flow

**Files:**
- Create: `admin.html`
- Create: `js/admin.js`

**Interfaces:**
- Consumes: `POST /api/admin/login` (Task 7).
- Produces: `admin.html` with element ids `admin-login-form`, `login-error`, `admin-dashboard`, `audit-log-body`; `js/admin.js` login handler. Not linked from the public nav (kept unlisted, reached by direct URL) since it's an internal oversight tool, not part of the public site flow.

- [ ] **Step 1: Create `admin.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin - TORCH</title>
  <link rel="stylesheet" href="css/styles.css">
</head>
<body>
  <div class="page-header">
    <h1>Admin Dashboard</h1>
    <p>Audit log and cleanup tools for class sign-ups.</p>
  </div>

  <section class="section">
    <form id="admin-login-form" class="signup-form">
      <label>Admin Password
        <input type="password" name="password" required>
      </label>
      <button type="submit" class="btn btn-primary">Log In</button>
      <p id="login-error" class="class-meta" hidden>Incorrect password.</p>
    </form>

    <div id="admin-dashboard" hidden>
      <h2 class="section-title">Audit Log</h2>
      <table class="audit-log-table">
        <thead>
          <tr><th>When</th><th>Class</th><th>Entity</th><th>Action</th><th>Details</th><th></th></tr>
        </thead>
        <tbody id="audit-log-body"></tbody>
      </table>
    </div>
  </section>

  <script src="js/admin.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `js/admin.js`**

```js
document.addEventListener('DOMContentLoaded', function () {
  var loginForm = document.getElementById('admin-login-form');
  var loginError = document.getElementById('login-error');
  var dashboard = document.getElementById('admin-dashboard');

  if (loginForm) {
    loginForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var formData = new FormData(loginForm);

      fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: formData.get('password') }),
        credentials: 'same-origin',
      }).then(function (res) {
        if (!res.ok) {
          loginError.hidden = false;
          return;
        }
        loginError.hidden = true;
        loginForm.hidden = true;
        dashboard.hidden = false;
        loadAuditLog();
      });
    });
  }
});
```

Note: `loadAuditLog` is called here but defined in Task 15 — logging in will throw until then, which is expected at this checkpoint.

- [ ] **Step 3: Manually verify**

Run `npm run dev`, open `http://localhost:8788/admin.html`.
1. Submit the wrong password; confirm "Incorrect password." appears and the form stays visible.
2. To test the correct password locally, first set a local secret: create a `.dev.vars` file (do not commit it — add `.dev.vars` to `.gitignore` if not already ignored) containing `ADMIN_PASSWORD=your-local-test-password` and `SESSION_SECRET=your-local-test-secret`, then restart `npm run dev`.
3. Submit the correct password; confirm the login form hides and the (currently broken, until Task 15) dashboard section becomes visible — check the browser console for the expected `loadAuditLog is not defined` error at this checkpoint.

- [ ] **Step 4: Commit**

```bash
git add admin.html js/admin.js
git commit -m "feat: add admin login page"
```

---

## Task 15: Admin Audit Log Rendering & Hard-Delete Actions

**Files:**
- Modify: `js/admin.js`

**Interfaces:**
- Consumes: `GET /api/admin/audit-log` (Task 8), `DELETE /api/admin/classes/:id`, `DELETE /api/admin/volunteer-signups/:id`, `DELETE /api/admin/student-signups/:id` (Task 9); `audit-log-body` element id (Task 14).
- Produces: `loadAuditLog()`, `renderAuditLog(entries)`, `auditEntryDeleteEndpoint(entry)`, `escapeHtmlAdmin(value)` appended to `js/admin.js`.

- [ ] **Step 1: Append the audit log functions to `js/admin.js`**

Add at the end of the file:

```js
function loadAuditLog() {
  fetch('/api/admin/audit-log', { credentials: 'same-origin' })
    .then(function (res) { return res.json(); })
    .then(renderAuditLog);
}

function renderAuditLog(entries) {
  var tbody = document.getElementById('audit-log-body');
  if (!tbody) return;

  tbody.innerHTML = entries.map(function (entry) {
    var endpoint = auditEntryDeleteEndpoint(entry);
    var deleteHtml = endpoint
      ? '<button class="btn btn-danger remove-btn" data-endpoint="' + endpoint + '">Hard delete</button>'
      : '';

    return (
      '<tr>' +
        '<td>' + escapeHtmlAdmin(entry.created_at) + '</td>' +
        '<td>' + entry.class_id + '</td>' +
        '<td>' + escapeHtmlAdmin(entry.entity_type) + '</td>' +
        '<td>' + escapeHtmlAdmin(entry.action) + '</td>' +
        '<td>' + escapeHtmlAdmin(JSON.stringify(entry.snapshot)) + '</td>' +
        '<td>' + deleteHtml + '</td>' +
      '</tr>'
    );
  }).join('');

  tbody.querySelectorAll('.remove-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!confirm('Permanently delete this?')) return;
      fetch(btn.getAttribute('data-endpoint'), { method: 'DELETE', credentials: 'same-origin' })
        .then(function () { loadAuditLog(); });
    });
  });
}

function auditEntryDeleteEndpoint(entry) {
  if (entry.action === 'removed') return null;
  if (entry.entity_type === 'class') return '/api/admin/classes/' + entry.class_id;
  if (entry.entity_type === 'volunteer_signup') return '/api/admin/volunteer-signups/' + entry.snapshot.id;
  if (entry.entity_type === 'student_signup') return '/api/admin/student-signups/' + entry.snapshot.id;
  return null;
}

function escapeHtmlAdmin(value) {
  var div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}
```

- [ ] **Step 2: Manually verify**

With `npm run dev` running and `.dev.vars` set from Task 14:
1. On `classes.html`, create a class and add a volunteer and a student signup to it.
2. On `admin.html`, log in; confirm the audit log table lists the `created` entries for the class, the volunteer signup, and the student signup, each with a "Hard delete" button (entries already `removed` show no button).
3. Click "Hard delete" on the class's `created` row; confirm the row disappears from the table after reload and, back on `classes.html`, the class itself is gone entirely (not just cancelled).
4. Repeat for a volunteer or student signup's `created` row; confirm hard-deleting it removes that signup from its class's roster on `classes.html`.

- [ ] **Step 3: Commit**

```bash
git add js/admin.js
git commit -m "feat: render admin audit log with hard-delete actions"
```

---

## Post-Plan Notes (not tasks — for awareness only)

- **Deployment** is a manual, account-specific step outside this plan: `npx wrangler pages deploy .` after running `npx wrangler pages secret put ADMIN_PASSWORD` and `npx wrangler pages secret put SESSION_SECRET` against the real Cloudflare Pages project.
- **Future email phase** (deferred per the spec): integrate an email provider, add magic-link login, and add a Cloudflare Cron Trigger that emails the Zoom link before `start_time`. The schema already has the columns this needs.
