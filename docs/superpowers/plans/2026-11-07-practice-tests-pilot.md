# Practice Tests Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Tests page on TORCH where parents register kids, kids take auto-graded practice tests (at home or with a session code) and review their answers, and volunteers upload xlsx tests and see results — ready for a QVMS pilot on Nov 8–9, 2026.

**Architecture:** New D1 tables plus Cloudflare Pages Functions under `functions/api/tests/**` (kid/parent) and `functions/api/admin/tests/**` (staff, existing admin cookie). Pure libraries for test validation, grading and secrets are unit-tested in the workers pool. Frontend is one new page `tests.html` (kids/parents) and `tests-admin.html` (staff) with vanilla JS in the style of `js/sbe.js`. Written answers are graded by Workers AI through an `AI` binding.

**Tech Stack:** Cloudflare Pages Functions, D1, Workers AI, Web Crypto (PBKDF2, SHA-256, HMAC), vanilla JS, SheetJS 0.18.5 from cdnjs, vitest + `@cloudflare/vitest-pool-workers`, happy-dom.

**Spec:** `docs/superpowers/specs/2026-11-07-practice-tests-design.md`

## Global Constraints

- Sign-in exists **only** on `tests.html` / `tests-admin.html`. No other page changes except one nav link `Tests` → `tests.html` in every page's `.nav-links`.
- Never collect kid email, birthday, address or photo. Kid = display name (first name + last initial), grade, school.
- Answer keys (`answer`, `explanation`) are never in any response to a kid/parent before that attempt is submitted **and** its session (if any) has ended.
- PINs: 4–6 digits, stored as PBKDF2-SHA256 (10,000 iterations — Workers CPU limit, see review I5 — 16-byte salt). Parent link secrets stored only as SHA-256 hex.
- Lockout: 5 wrong PINs → username locked 15 minutes, clears automatically.
- Kid/parent auth is **not** cookies: kid uses `Authorization: Bearer <token>` (token in `sessionStorage`); parent uses header `X-Parent-Key: <secret>` (secret lives in the URL hash `tests.html#parent=<secret>` and `sessionStorage`).
- Staff endpoints use the existing `isValidAdminSession(request, env)` from `functions/api/_lib/auth.js`.
- Schools: `QVMS`, `SBE` (reuse `SCHOOLS` list from `functions/api/classes.js`; export it from `functions/api/_lib/schools.js`).
- Workers AI model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. On any AI error or unparseable output → answer status `needs_volunteer`.
- Terms version: `v1`. Terms page copy must say written answers are sent to Cloudflare Workers AI for grading without names.
- Question images are not supported in the pilot: a non-empty `Image` cell is a validation error: `Row N: images aren't supported yet — remove the Image value.`
- Match existing code style: vanilla JS, `escapeHtml`-style escaping for all user text, `API_BASE = 'https://torch-signups.pages.dev'`.
- Run `npm test` before every push; do not push with failing tests (ignore failures under `.claude/worktrees/`).

## Review Focus

1. **Kid reloads or loses connection mid-test** → expects their saved answers back and the same deadline. (Task 6: `GET /api/tests/attempts/:id` returns saved responses for an in-progress attempt.)
2. **Spreadsheet values arrive in odd shapes** (answer `b`, `A, C`, numeric `2.7` as a number, `Points` blank, trailing empty rows) → expects them normalized, not rejected. (Task 2 tests.)
3. **Two kids with the same first name + last initial at one school** → expects distinct usernames. (Task 4 test.)
4. **Timer runs out while the kid is offline** → expects the submit to be accepted within the 60 s grace, and answers saved after grace to be refused with a clear message. (Task 6 tests.)
5. **AI returns prose, points above the max, or negative points** → expects clamped points, or `needs_volunteer` when unparseable — never a crash or a lost test. (Task 3 tests.)

---

### Task 1: Schema, secrets library, CORS and AI binding

**Files:**
- Create: `migrations/0008_practice_tests.sql`
- Create: `functions/api/_lib/secrets.js`, `functions/api/_lib/schools.js`
- Modify: `functions/_middleware.js` (allow headers), `functions/api/classes.js` (import `SCHOOLS`), `wrangler.toml` (`[ai] binding = "AI"`)
- Test: `tests/lib/secrets.test.js`, `tests/lib/migrations.test.js`

**Interfaces:**
- Produces tables (exact columns):
  - `parents(id INTEGER PK, name TEXT NOT NULL, email TEXT NOT NULL, school TEXT NOT NULL, consent_terms_version TEXT NOT NULL, consent_at TEXT NOT NULL, link_hash TEXT NOT NULL UNIQUE, created_at TEXT DEFAULT datetime('now'))`
  - `kids(id INTEGER PK, parent_id INTEGER NOT NULL REFERENCES parents(id), school TEXT NOT NULL, display_name TEXT NOT NULL, grade TEXT, username TEXT NOT NULL UNIQUE, pin_hash TEXT NOT NULL, pin_salt TEXT NOT NULL, failed_pins INTEGER NOT NULL DEFAULT 0, locked_until TEXT, created_at TEXT DEFAULT datetime('now'))`
  - `tests(id INTEGER PK, school TEXT NOT NULL, title TEXT NOT NULL, event TEXT NOT NULL, division TEXT NOT NULL, format TEXT NOT NULL, time_limit_min INTEGER, written_by TEXT, notes TEXT, published INTEGER NOT NULL DEFAULT 1, session_only INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT datetime('now'))`
  - `test_questions(id INTEGER PK, test_id INTEGER NOT NULL REFERENCES tests(id), position INTEGER NOT NULL, topic TEXT, type TEXT NOT NULL, prompt TEXT NOT NULL, choices_json TEXT, answer TEXT NOT NULL, tolerance REAL, points REAL NOT NULL, explanation TEXT)`
  - `test_sessions(id INTEGER PK, test_id INTEGER NOT NULL, code TEXT NOT NULL UNIQUE, created_at TEXT DEFAULT datetime('now'), expires_at TEXT NOT NULL, ended_at TEXT)`
  - `attempts(id INTEGER PK, test_id INTEGER NOT NULL, kid_id INTEGER NOT NULL, session_id INTEGER, started_at TEXT NOT NULL, deadline_at TEXT, submitted_at TEXT, score REAL, max_score REAL, is_first INTEGER NOT NULL DEFAULT 0)`
  - `attempt_answers(id INTEGER PK, attempt_id INTEGER NOT NULL, question_id INTEGER NOT NULL, response TEXT, points REAL, status TEXT, graded_by TEXT, feedback TEXT, override_note TEXT, UNIQUE(attempt_id, question_id))` — `status ∈ correct|partial|wrong|needs_volunteer`, `graded_by ∈ auto|ai|override`
  - `study_resources(id INTEGER PK, event TEXT NOT NULL, topic TEXT, title TEXT NOT NULL, url TEXT NOT NULL, added_by TEXT)` — seeded in the same migration: for each of Heredity, Crime Busters, Circuit Lab, History of Science, Meteorology, at least one event-wide free link (Scioly.org wiki `https://scioly.org/wiki/index.php/<Event_Name>` where the page exists, plus Khan Academy / CK-12 / NOAA JetStream / OpenStax pages). Implementer verifies each URL returns HTTP 200 with `curl -sIL` before committing.
- Produces in `secrets.js`:
  - `randomSecret(bytes = 32): string` (base64url)
  - `sha256Hex(text: string): Promise<string>`
  - `hashPin(pin: string, saltHex?: string): Promise<{ hash: string, salt: string }>`
  - `verifyPin(pin: string, hash: string, salt: string): Promise<boolean>`
  - `signToken(env, { kind: 'kid', id: number }, ttlMs = 4 * 3600_000): Promise<string>` — format `kind.id.expiresAt.hmac`, HMAC-SHA256 with `env.SESSION_SECRET`
  - `readBearer(request, env): Promise<{ kind: string, id: number } | null>`
- Produces `schools.js`: `export const SCHOOLS = ['QVMS', 'SBE'];`

- [ ] **Step 1: Write failing tests** — `secrets.test.js`: `verifyPin('4821', ...hashPin('4821'))` is true and `verifyPin('4822', …)` false; two `hashPin` calls of the same PIN give different salts; `readBearer` returns `{kind:'kid', id:7}` for a fresh `signToken`, `null` for a tampered signature, `null` for an expired token (ttlMs = -1). `migrations.test.js`: after migrations, `study_resources` has ≥ 5 rows and inserting two `kids` with the same `username` throws.
- [ ] **Step 2: Run** `npx vitest run tests/lib/secrets.test.js tests/lib/migrations.test.js` — expect FAIL (module/table missing).
- [ ] **Step 3: Implement** migration, `secrets.js`, `schools.js`; `_middleware.js` `Access-Control-Allow-Headers: 'Content-Type, Authorization, X-Parent-Key'`; `wrangler.toml` add `[ai]\nbinding = "AI"`.
- [ ] **Step 4: Run** `npm test` — expect all PASS.
- [ ] **Step 5: Commit** `feat(tests): schema, secrets helpers, CORS headers, AI binding`

### Task 2: Test format validation

**Files:**
- Create: `functions/api/_lib/test-format.js`
- Test: `tests/lib/test-format.test.js`

**Interfaces:**
- Produces: `QUESTION_TYPES = ['Multiple choice', 'Pick all that apply', 'Number', 'Short answer', 'Written answer']`
- Produces: `validateTest(payload): { errors: string[], test: NormalizedTest | null }` where payload is `{ info: {Title, Event, Division, Format, 'Time limit (min)', School, 'Written by', Notes}, questions: [{ '#', Topic, Type, Question, A..F, Answer, Tolerance, Points, Image, Explanation }] }` (the exact header names of `TORCH-test-template.xlsx`), and `NormalizedTest = { title, event, division, format, timeLimitMin|null, school, writtenBy, notes, questions: [{ position, topic, type, prompt, choices: string[]|null, answer: string, tolerance: number|null, points: number, explanation }] }`.
- Normalization rules: rows whose Question and Type are both blank are dropped; Type matched case-insensitively; choice answers uppercased, spaces removed, letters sorted (`'a, c'` → `'A,C'`); Number answer stored as string of the number; Points blank → 1; Format ∈ `Quiz|Tournament`; Division ∈ `B|C`; School ∈ `SCHOOLS`.
- Error messages are prefixed `Row N:` (N = spreadsheet row, header is row 1) or `Test info:`.

- [ ] **Step 1: Write failing tests** using the sample spreadsheets' shapes: valid Heredity-like payload → no errors, 11 questions; answer `'b'` → `'B'`; `'A, C'` → `'A,C'`; MC answer `'E'` with no E choice → `Row 3: answer E is not one of the choices`; Number answer `'abc'` → error; `Image: 'map1.png'` → the Global Constraints image error; Type `'essay'` → `Row 2: unknown type "essay"`; trailing blank rows dropped; missing Title → `Test info: Title is required`; School `'XYZ'` → error.
- [ ] **Step 2: Run** `npx vitest run tests/lib/test-format.test.js` — FAIL.
- [ ] **Step 3: Implement** `validateTest`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(tests): spreadsheet test validation`

### Task 3: Grading

**Files:**
- Create: `functions/api/_lib/grading.js`
- Test: `tests/lib/grading.test.js`

**Interfaces:**
- Consumes: question rows shaped like `test_questions` (`type, answer, tolerance, points, prompt, choices_json`).
- Produces: `gradeAuto(question, response: string|null): { points: number, status: 'correct'|'partial'|'wrong' }` for every type except `Written answer`.
  - MC: exact letter match. Pick-all: `max(0, (right − wrong) / correctCount) × points`, response like `'A,C'`. Number: `|x − answer| ≤ (tolerance ?? 0)`. Short answer: compare after lowercase, trim, collapse whitespace, strip trailing `.`, against each `|`-separated accepted answer. Empty/null response → wrong, 0.
  - status: full points → `correct`, 0 → `wrong`, else `partial`.
- Produces: `gradeWritten(ai, question, response): Promise<{ points, status, feedback, gradedBy: 'ai' } | { points: null, status: 'needs_volunteer', feedback: null, gradedBy: null }>`
  - Calls `ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { messages })`; system prompt asks for JSON only: `{"points": <number>, "feedback": "<1–2 sentences to the student>"}` given question, model answer/rubric, max points, student answer. Never include the kid's name.
  - Extract the first `{…}` from `result.response`; points clamped to `[0, max]` and rounded to nearest 0.5. Empty response → 0 points, `wrong`, feedback `No answer given.` without calling AI.

- [ ] **Step 1: Write failing tests** — pick-all `'A,B,D'` key with response `'A,B'` on 2 pts → 1.33 (`toBeCloseTo`), `'A,B,C'` → 0.67, `'C'` → 0; Number 2.68 with tol 0.05 vs 2.7 → correct; Short `' Gregor  Mendel. '` vs `'Mendel|Gregor Mendel'` → correct; Written with fake `ai.run` returning `'Sure! {"points": 5, "feedback": "Good"}'` on a 3-pt question → points 3; returning `'{"points": -1}'` → 0; returning `'I think it is good'` → `needs_volunteer`; `ai.run` throwing → `needs_volunteer`; 2.2 → 2 (rounded to 0.5).
- [ ] **Step 2: Run** `npx vitest run tests/lib/grading.test.js` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(tests): auto and AI grading`

### Task 4: Parents and kids API

**Files:**
- Create: `functions/api/tests/parents.js` (POST register), `functions/api/tests/parent.js` (GET own data), `functions/api/tests/parent/kids.js` (POST add kid), `functions/api/tests/parent/kids/[id]/pin.js` (POST reset PIN), `functions/api/tests/parent/link.js` (POST rotate link), `functions/api/tests/login.js` (POST kid login), `functions/api/admin/tests/parents/[id]/link.js` (POST staff reissue), `functions/api/tests/_lib/parents.js` (shared queries: `findParentByKey(db, key)`, `makeUsername(db, displayName, school)`, `createKid(db, parentId, school, {displayName, grade, pin})`)
- Test: `tests/api/tests-parents.test.js`, `tests/api/tests-login.test.js`

**Interfaces:**
- `POST /api/tests/parents` body `{ parentName, parentEmail, school, consent: true, kids: [{ firstName, lastInitial, grade, pin }] }` → 201 `{ parentKey, kids: [{ id, displayName, username }] }`. 400 if `consent !== true` (`error: 'Parent consent is required'`), no kids, PIN not 4–6 digits, bad school. Stores `consent_terms_version = 'v1'`, `consent_at = now`.
- `makeUsername`: `${first}-${lastInitial}-${school}` lowercased, non `[a-z0-9]` → `-`; if taken append `-2`, `-3`, ….
- `GET /api/tests/parent` (header `X-Parent-Key`) → `{ parent: {name, school}, kids: [{ id, displayName, username, grade, attempts: [{ id, testTitle, event, submittedAt, score, maxScore }] }] }`; 401 on bad key.
- `POST /api/tests/parent/kids/:id/pin` `{ pin }` → 204; also clears `failed_pins` and `locked_until`; 404 if kid isn't this parent's.
- `POST /api/tests/parent/link` → `{ parentKey }` (old key stops working).
- `POST /api/admin/tests/parents/:id/link` (admin cookie) → `{ parentKey }`.
- `POST /api/tests/login` `{ username, pin }` → `{ token, kid: { id, displayName, school } }`; 401 `{ error: 'Wrong username or PIN' }`; 423 `{ error: 'Too many tries. Try again in 15 minutes.' }` when locked.

- [ ] **Step 1: Write failing tests** — register returns a key and username `aarav-k-qvms`; second kid "Aarav K" at QVMS → `aarav-k-qvms-2`; missing consent → 400; GET parent with key → kid listed, with wrong key → 401; rotate link → old key 401, new key 200; reset PIN then login with new PIN → 200; 5 wrong PINs → 6th attempt with the right PIN → 423; after setting `locked_until` to the past → login 200 and `failed_pins` back to 0; other parent's kid PIN reset → 404; admin reissue without cookie → 401.
- [ ] **Step 2: Run** `npx vitest run tests/api/tests-parents.test.js tests/api/tests-login.test.js` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(tests): parent registration, parent link, kid login with lockout`

### Task 5: Staff test upload and sessions

**Files:**
- Create: `functions/api/admin/tests.js` (GET list, POST create), `functions/api/admin/tests/[id].js` (PUT flags, DELETE), `functions/api/admin/tests/[id]/sessions.js` (POST start), `functions/api/admin/test-sessions/[code]/end.js` (POST end)
- Test: `tests/api/admin-tests.test.js`

**Interfaces:**
- Consumes: `validateTest` (Task 2), `isValidAdminSession`.
- `POST /api/admin/tests` body = `validateTest` payload → 201 `{ id, questionCount }`, or 400 `{ errors: string[] }`.
- `GET /api/admin/tests` → `[{ id, title, event, school, format, published, sessionOnly, questionCount, attemptCount }]`.
- `PUT /api/admin/tests/:id` `{ published?, sessionOnly? }` → 200 updated row. `DELETE` → 204 only when it has no attempts, else 409.
- `POST /api/admin/tests/:id/sessions` → 201 `{ code, expiresAt }`; code = 6 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, expires in 3 hours.
- `POST /api/admin/test-sessions/:code/end` → 200, sets `ended_at`.

- [ ] **Step 1: Write failing tests** — all four endpoints 401 without admin cookie; valid upload → 201 with 11 questions stored in order; invalid upload → 400 with the validator's errors and nothing stored; session code matches `/^[A-HJ-NP-Z2-9]{6}$/`; ending a session sets `ended_at`; DELETE with an attempt → 409.
- [ ] **Step 2: Run** `npx vitest run tests/api/admin-tests.test.js` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(tests): staff upload, publish flags, session codes`

### Task 6: Taking a test, submitting and reviewing

**Files:**
- Create: `functions/api/tests/index.js` (GET available tests), `functions/api/tests/[id]/attempts.js` (POST start), `functions/api/tests/attempts/[id].js` (GET attempt / review), `functions/api/tests/attempts/[id]/answers.js` (PUT autosave), `functions/api/tests/attempts/[id]/submit.js` (POST), `functions/api/tests/_lib/attempts.js` (`loadAttemptForViewer(db, attemptId, viewer)`, `isReviewLocked(db, attempt)`, `studySuggestions(db, event, missedTopics)`)
- Test: `tests/api/tests-attempts.test.js`

**Interfaces:**
- Consumes: `readBearer`, `findParentByKey`, `gradeAuto`, `gradeWritten`.
- Viewer = kid (bearer) or parent (`X-Parent-Key`, read-only, only their kids' attempts).
- `GET /api/tests` (kid) → `[{ id, title, event, format, timeLimitMin, questionCount, bestScore, attempts }]`: tests with `published = 1 AND session_only = 0 AND school = kid.school`.
- `POST /api/tests/:id/attempts` (kid) body `{ code? }` → 201 `{ attemptId }`. Without code: test must be in the kid's available list. With code: session must exist for this test, not ended, not expired → attempt gets `session_id`. If the kid has an unsubmitted attempt for this test, return that one (200) instead of a new one. `deadline_at = started_at + time_limit_min` when set.
- `GET /api/tests/attempts/:id`:
  - in progress → `{ status: 'in_progress', test: {title, event, timeLimitMin}, deadlineAt, questions: [{ id, position, type, prompt, choices }], responses: { [questionId]: response } }` — **no** answer/explanation.
  - submitted and review locked (session not ended and not expired) → `{ status: 'waiting_for_session', score: null }`.
  - submitted and unlocked → `{ status: 'reviewed', score, maxScore, questions: [{ …, topic, response, answer, explanation, points, maxPoints, status, gradedBy, feedback }], progress: [{ submittedAt, percent }] (first attempts of this kid at this event, oldest first), studyNext: [{ topic, links: [{ title, url }] }] }`.
- `PUT /api/tests/attempts/:id/answers` `{ questionId, response }` → 204; 409 `{ error: 'Time is up' }` after `deadline_at + 60 s`; 409 if already submitted.
- `POST /api/tests/attempts/:id/submit` → 200 `{ status, score, maxScore }`. Grades every question (blank = wrong), Written answers via `gradeWritten(env.AI, …)`; `needs_volunteer` answers count 0 until graded. Sets `is_first = 1` if the kid has no earlier submitted attempt on this test. Accepted any time (late answers were already refused at save).
- `studySuggestions`: topics with status `wrong|partial`, each with up to 3 links matching `event` + `topic`, falling back to event-wide links (`topic IS NULL`).

- [ ] **Step 1: Write failing tests** (with `env.AI` replaced by a fake `{ run: async () => ({ response: '{"points":2,"feedback":"ok"}' }) }`) — kid sees the published test, not a `session_only` one; in-progress GET has no `answer` key anywhere in the JSON; autosave then GET returns the saved response (Review Focus 1); same kid starting again returns the same attempt; save after deadline+60s → 409 (set `deadline_at` in the past directly in D1) (Review Focus 4); submit scores MC/pick-all/number/short/written correctly and sets `is_first = 1`, second attempt `is_first = 0`; session attempt → GET `waiting_for_session` until the session is ended, then `reviewed`; `studyNext` lists the missed topic with seeded links; parent key reads their kid's review, another parent → 404; kid B can't read kid A's attempt → 404; wrong code → 400 `{ error: 'That code isn’t valid' }`.
- [ ] **Step 2: Run** `npx vitest run tests/api/tests-attempts.test.js` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(tests): take, autosave, submit and review tests`

### Task 7: Staff results and overrides

**Files:**
- Create: `functions/api/admin/tests/[id]/results.js` (GET), `functions/api/admin/attempt-answers/[id].js` (PUT override), `functions/api/admin/kids.js` (GET kids with per-event averages)
- Test: `tests/api/admin-results.test.js`

**Interfaces:**
- `GET /api/admin/tests/:id/results` → `{ test, attempts: [{ attemptId, kid: {id, displayName}, isFirst, submittedAt, score, maxScore, answers: [{ answerId, questionId, response, points, status, gradedBy, feedback }] }], questionStats: [{ questionId, position, percentCorrect }], needsVolunteer: number }`.
- `PUT /api/admin/attempt-answers/:id` `{ points, note? }` → 200; points must be within `[0, question.points]` else 400; sets `graded_by = 'override'`, status recomputed, attempt `score` recomputed.
- `GET /api/admin/kids?school=QVMS` → `[{ id, displayName, grade, username, parentId, events: [{ event, firstAttemptAvgPercent, tests }] }]` (first attempts only).

- [ ] **Step 1: Write failing tests** — 401 without cookie; results include a `needs_volunteer` answer and `needsVolunteer: 1`; override to 3 of 3 → status `correct`, attempt score updated, kid's review shows new points and `gradedBy: 'override'`; override 4 on a 3-pt question → 400; kids endpoint averages only first attempts.
- [ ] **Step 2: Run** `npx vitest run tests/api/admin-results.test.js` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(tests): staff results and score overrides`

### Task 8: Kids and parents page (`tests.html`, `js/tests.js`, `tests-terms.html`)

**Files:**
- Create: `tests.html`, `js/tests.js`, `tests-terms.html`, `css/` additions in the existing stylesheet
- Modify: nav in every `*.html` (add `<li><a href="tests.html">Tests</a></li>` after Number Sense)
- Test: `tests/frontend/tests.test.js`

**Interfaces:**
- Consumes: all kid/parent endpoints from Tasks 4 and 6.
- Views (one page, switched by state; ids are the test contract):
  - `#tests-signin` — username + PIN, optional test code; link "Parents: register your child".
  - `#tests-register` — parent name, email, school select, kid rows (first name, last initial, grade, PIN), consent checkbox linking `tests-terms.html`; on success shows `#parent-link-box` with the full link `https://torch-scioly.github.io/tests.html#parent=<key>`, a Copy button and a "Save as PDF" button (`window.print()` on a print stylesheet showing only the box), plus each kid's username.
  - `#tests-parent` — when `location.hash` has `parent=`: kids, usernames, reset-PIN form per kid, add-kid form, "make a new parent link", each kid's results (links open the review view).
  - `#tests-list` — kid's available tests.
  - `#tests-take` — all questions on one scrolling page; timer when `deadlineAt`; every answer change calls the autosave PUT (debounced 800 ms); at deadline auto-submits; Submit button with confirm.
  - `#tests-review` — the mockup: score, per-question ✅/❌/🟡, response vs answer, explanation, "graded by AI"/"changed by a volunteer" label, progress line, "📚 What to study next".
- Exposed globals for tests (classic script, like `js/sbe.js`): `renderReview(container, review)`, `renderTake(container, attempt, opts)`, `parentKeyFromHash(hash): string|null`, `formatRemaining(ms): string` (`'12:05'`).
- `tests-terms.html`: plain-language terms v1 — what TORCH stores (kid display name, grade, school, answers, scores; parent name and email), who sees it (the kid, the parent, TORCH volunteers and head coach for that school), written answers sent to Cloudflare Workers AI for grading without names, how to ask for deletion (contact via the email on the site footer), and that the parent consents for their child.

- [ ] **Step 1: Write failing tests** — `parentKeyFromHash('#parent=abc')` → `'abc'`, `'#x'` → null; `formatRemaining(725000)` → `'12:05'`; `renderReview` with a review fixture shows the score `4.5 / 6`, a ❌ row containing both the kid's answer and the correct answer, the "graded by AI" label, and a study link `<a href="https://…">`; user text containing `<img onerror>` is rendered as text; `renderTake` calls fetch PUT after an answer change (fake timers) and auto-submits when the deadline passes.
- [ ] **Step 2: Run** `npx vitest run --project frontend tests/frontend/tests.test.js` — FAIL.
- [ ] **Step 3: Implement** the page, terms page and nav links.
- [ ] **Step 4: Run** `npm test` — PASS; open `npm run dev` → `http://localhost:8788/tests.html`, register a parent, sign in as the kid, take and submit a test, see the review.
- [ ] **Step 5: Commit** `feat(tests): Tests page for kids and parents, terms page`

### Task 9: Staff page (`tests-admin.html`, `js/tests-admin.js`)

**Files:**
- Create: `tests-admin.html`, `js/tests-admin.js`
- Test: `tests/frontend/tests-admin.test.js`

**Interfaces:**
- Consumes: `POST /api/admin/login` (existing), Task 5 and Task 7 endpoints, Task 4 reissue endpoint.
- Loads SheetJS: `<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>`.
- Exposed global: `workbookToPayload(workbook): { info, questions }` — reads the `Test info` tab (column A field → column B value, rows 4+) and the `Questions` tab (`XLSX.utils.sheet_to_json` with header row 1), the exact payload shape of Task 2.
- Views: admin password sign-in (reuse existing login endpoint; `credentials: 'include'`); **Upload** (file input → preview table of questions with the server's `errors` listed above it; Save disabled until there are no errors; a dry run uses the same POST with `?dryRun=1` — add `dryRun` support to Task 5's POST returning `{ errors, questionCount }` without storing); **Tests** list with Published / Session-only toggles, Start session (shows the code large), End session; **Results** per test (score table, per-question % correct, `needs_volunteer` answers with a grade box → override PUT); **Kids** (per-event averages, "New parent link" button → shows the link to pass to the parent).

- [ ] **Step 1: Write failing tests** — `workbookToPayload` on a workbook built with `XLSX.utils.aoa_to_sheet` mirroring `TORCH-test-template.xlsx` returns `info.Title` and 5 questions with `Answer` values intact; a sheet with trailing empty rows yields the same 5.
- [ ] **Step 2: Run** `npx vitest run --project frontend tests/frontend/tests-admin.test.js` — FAIL (load SheetJS in the test from `node_modules` after `npm i -D xlsx@0.18.5`).
- [ ] **Step 3: Implement** (and the `dryRun` flag with a test in `tests/api/admin-tests.test.js`).
- [ ] **Step 4: Run** `npm test` — PASS; locally upload all four files from `docs/superpowers/specs/sample-tests/` and confirm each previews with no errors.
- [ ] **Step 5: Commit** `feat(tests): staff page with xlsx upload, sessions, results, overrides`

### Task 10: Ship the pilot

**Files:** none new.

- [ ] **Step 1:** `npm test` — all PASS (ignoring `.claude/worktrees/`).
- [ ] **Step 2:** Apply migration remotely: `npx wrangler d1 execute torch-signups --remote --file migrations/0008_practice_tests.sql`.
- [ ] **Step 3:** Push to `main` (needs the `sireeshamaddali` gh account active) and deploy Cloudflare Pages from a clean `git archive` export (see project memory), then confirm the GitHub Pages build for the new commit is `built`.
- [ ] **Step 4:** Enable Workers AI for the Pages project if the `[ai]` binding isn't picked up from `wrangler.toml` (Dashboard → Pages → torch-signups → Settings → Bindings → Workers AI, name `AI`); verify by submitting a written answer and seeing `gradedBy: 'ai'`.
- [ ] **Step 5:** On the live site: upload the four sample tests via `tests-admin.html`, register one test parent + kid, take Heredity end to end, check the review and the staff results; then delete the test kid's data with a remote SQL statement and report the result.
- [ ] **Step 6:** Release `v1.3.0` notes (hand the user the `gh release create` command).
