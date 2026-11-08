# Practice Tests — design

Date: 2026-11-07 · Status: approved 2026-11-07 · pilot target Sun Nov 8 – Mon Nov 9

## Intent
TORCH volunteers want to test kids more often, using full tournament-format tests and short
quizzes. Today testing is a mix of Google Forms and paper tests graded by hand, so results are
scattered and nobody can see how a kid is doing over time. This feature moves testing onto TORCH
so that:

- **coaches and volunteers** can see each kid's performance, and
- **each kid** can review their own answers, see what they missed, and know what to study next.

TORCH stays the front door: kids take tests on TORCH and TORCH keeps every result, so the site
gets the visits and keeps the history even if an outside question source changes later.

## Goals
- Volunteers write tests in one **common spreadsheet template**, upload it, and the test is
  ready. No hand grading.
- Kids take tests **at home** (sign in) or **in a session** (volunteer shows a test code).
- **Everything is graded automatically**, written answers included (AI grades them against
  the volunteer's answer key, and a volunteer can change any score).
- Kids see a **review screen**: score, each question right/wrong/partial, their answer next to
  the key, explanations, AI feedback on written answers, progress in that event, and a
  **"What to study next"** list that links missed topics to free resources.
- Results are visible to the **kid** (their own), the **volunteer** (tests they gave), and the
  **head coach / admin** (everything for their school).
- **Multi-school from day one:** tests, kids and results are tagged by school (QVMS, SBE, and
  more later).
- **Sign-in is needed only on the Tests page.** Every other TORCH page stays public with no login.

## Non-goals (this phase)
- **scio.ly question bank.** Waiting on scio.ly's reply to our API-key request (emailed
  2026-11-07). The design leaves room for it (see "Later phases") but builds nothing for it now.
- **Team picker** (top 15 kids, Team A / Team B, event assignment across the 28 Texas events).
  Deferred by the user; the results stored here are its future input.
- **Build-event practice-run logs** (Boomilever, Roller Coaster, Scrambler, …). Deferred along
  with the team picker.
- In-browser test editor. Tests come only from the spreadsheet template.

## Anti-goals (would make this a failure even if it works)
- **Admin chores for forgotten PINs.** Parents must be able to fix PIN problems themselves.
- **Collecting more about kids than needed.** No kid email, birthday, address or photo.
- **Login spreading to the rest of the site.**
- **Leaking answer keys** to kids before they've submitted.

## Constraints
- Existing stack: static frontend on GitHub Pages (`torch-scioly.github.io`), backend as
  Cloudflare Pages Functions + D1 at `torch-signups.pages.dev` (see `wrangler.toml`). The frontend
  calls the backend cross-site through `API_BASE`.
- Most kids are under 13 (COPPA). Keep what's collected about a kid minimal and record parent
  consent. A checkbox is the lightest form of consent; the user should check with someone who
  knows COPPA before this goes beyond TORCH's own schools. This document is not legal advice.
- No email service. All links are generated and shown on TORCH.
- Build on what's there: the `school` column groundwork, the shared-password admin login
  (`functions/api/admin/login.js`), the audit log, and the vanilla-JS page style of
  `js/classes.js` / `js/sbe.js`.

## Decided by the user
1. **Host tests on TORCH**, not as links to Google Forms or uploaded PDFs, because results have to
   be stored question by question.
2. **Volunteers upload a common spreadsheet template** (xlsx) that follows one fixed format.
3. **Written answers are graded automatically** (by TORCH using Cloudflare Workers AI; by scio.ly for its own
   questions later).
4. **Parent registers the kid** and ticks a terms-and-conditions consent checkbox.
5. **Kids get a username + PIN.** No kid email.
6. **No email.** A parent gets a private **parent link** generated on TORCH, which lets them
   see their kids and reset PINs themselves.
7. **Head coach / admins see all results** (for their school). The head coach can override any
   suggestion (relevant to the later team picker).
8. **Both ways of taking a test:** at home, or in a session with a test code.
9. **Sign-in only on the Tests page.**
10. **Study suggestions link to free resources**, not to scio.ly.
11. **Other schools are in scope** via school tagging.

## How it works

### Accounts and sign-in
- **Parent registration** (on `tests.html`): parent name, parent email (typed, not verified),
  school, then one or more kids (first name + last initial, grade). Required checkbox: "I am this
  child's parent or guardian and agree to the TORCH Practice Tests terms." Store the consent with
  the parent email, a timestamp and the terms version.
- TORCH creates each kid a **username** (e.g. `aarav-k-qvms`, made unique) and the parent picks a
  **4–6 digit PIN**. PINs are stored hashed (PBKDF2 via Web Crypto), never in plain text.
- After registering, TORCH shows the **parent link** (a long random secret in the URL), with
  **Copy** and **Save as PDF** buttons and a clear "bookmark this, it's the only way back" note.
  Only a hash of the secret is stored.
- **Parent link page:** list of the parent's kids, usernames, reset PIN, add another kid,
  "make a new parent link" (cancels the old one), and each kid's results.
- **Lost parent link:** a coach can generate a new one from the coach page. This is the only
  admin action in the PIN story, and it happens only when a link is lost.
- **Kid sign-in:** username + PIN. After 5 wrong PINs, that username locks for 15 minutes and
  then unlocks automatically.
- **In-session:** the volunteer starts a session for a test and gets a short **test code** to
  show the room. A kid enters code + username + PIN and goes straight into that test.

### Volunteers, coaches, admins
- **Coach / volunteer sign-in (my call):** reuse the parent-link pattern. An admin (existing
  shared admin password) creates a **staff link** for each volunteer or head coach, with a role
  (`volunteer` or `head_coach`) and a school. The link is their sign-in, and an admin can reissue
  it. This avoids passwords and email and keeps the existing admin login as the root.
- **Volunteer:** upload tests, start in-session codes, see results and change grades for tests
  they uploaded.
- **Head coach:** everything a volunteer can do, for all tests and kids in their school, plus
  reissuing lost parent links.
- **Admin:** everything, all schools; manages staff links.

### The spreadsheet template
One xlsx file, `TORCH-test-template.xlsx`, downloadable from the Tests page. The sample tests in
`docs/superpowers/specs/sample-tests/` are filled-in examples.

**Tab "Test info"** (field / value rows): Title · Event (dropdown of official 2027 event names
plus Texas optional events) · Division (B / C) · Format (Quiz / Tournament) · Time limit (min) ·
School · Written by.

**Tab "Questions"** (one row per question):

| Column | Meaning |
|---|---|
| # | Question number |
| Topic | Topic within the event; drives "What to study next" |
| Type | `Multiple choice`, `Pick all that apply`, `Number`, `Short answer`, `Written answer` |
| Question | Question text |
| A–F | Choices (choice types only) |
| Answer | Letter(s) for choice types (`B`, or `A,C` for pick-all); number for `Number`; accepted answers separated by `\|` for `Short answer`; model answer / rubric for `Written answer` |
| Tolerance | `Number` only: ± allowed |
| Points | Points for the question |
| Image | Optional image file name, uploaded with the spreadsheet |
| Explanation | Shown to the kid after grading |

**Upload:** the volunteer picks the xlsx plus any images. TORCH checks every row (known type,
answer matches type, choices present, images found) and shows a preview with any errors
**before** saving, so a broken test never goes live. Parsing happens in the browser (SheetJS from
cdnjs); the backend re-validates the parsed JSON.

### Taking a test
- Questions shown one page at a time or as a scrolling page (builder's call), with a timer when
  the test has a time limit. When time runs out, the answers so far are submitted automatically.
- Answers save as the kid goes, so a dropped connection doesn't lose work.
- Answer keys are **never sent to the browser** until the kid has submitted.

### Grading
- **Multiple choice / pick all that apply:** exact match. Pick-all gets partial credit:
  (right picks − wrong picks) / correct count, floored at 0.
- **Number:** correct if within ± tolerance.
- **Short answer:** case- and spacing-insensitive match against any accepted answer.
- **Written answer:** graded by **Cloudflare Workers AI** (the user can't create an Anthropic API
  key). Use an open instruction model available on Workers AI (e.g. a Llama 3.x instruct model;
  builder picks the best available) through an `AI` binding on the Pages project. No extra
  account or key, free daily allowance. The prompt gets the question, model answer/rubric, points
  and the kid's answer, and returns points awarded plus one or two sentences of feedback as JSON.
  Results are marked "graded by AI". The kid's name is never sent, only the answer text.
- **If AI grading fails** (allowance used up, bad output): the answer is marked "waiting for a
  volunteer" and shows on the volunteer's results page to grade by hand. The rest of the test is
  still scored immediately.
- **Overrides:** a volunteer or head coach can change any question's score, with an optional note.
  The kid sees the new score.

### Kid's review screen
As in the approved mockup (`.superpowers/brainstorm/…/template-and-review-v2.html`):
- score, each question ✅/❌/🟡 with the kid's answer, the correct answer, explanation, and AI
  feedback on written answers;
- a progress line for that event across tests over time;
- **📚 What to study next:** each topic the kid missed or got partly right, with 2–3 free links.

### Study resources
- A `study_resources` table: event, topic (optional), title, URL, added by.
- Seeded with free sources per event (e.g. Scioly.org wiki pages, Khan Academy, NOAA JetStream,
  CK-12, OpenStax) and links to matching TORCH courses on `courses.html`.
- Matching: exact event + topic first, then event-wide links. Volunteers can add links from the
  coach page.

### Results views
- **Kid:** their tests and review screens.
- **Parent link:** same as kid, for each of their kids.
- **Volunteer:** per test — each kid's score, per-question breakdown (which questions most kids
  missed), change a score.
- **Head coach:** per kid across all events and tests over time; per event, a ranking of kids by
  recent average. This view is what the later team picker will build on.

## Data (sketch, builder refines)
New D1 tables, one migration: `parents` (with consent fields and parent-link hash), `kids`
(school, username, PIN hash, lockout fields, parent id), `staff` (role, school, link hash),
`tests` + `test_questions` (keys stored server-side only), `test_sessions` (test code, expiry),
`attempts` + `attempt_answers` (points, graded_by `auto`/`ai`/`override`, feedback),
`study_resources`. Every row that belongs to a school carries `school`.

## Sign-in tokens across sites
The frontend (github.io) and the API (pages.dev) are different sites, and Safari blocks
cross-site cookies, so kid, parent and staff sessions should use a **bearer token** kept in
`sessionStorage` and sent in an `Authorization` header, not a cookie. Kid tokens last a few hours.
This applies only to the Tests page. The existing admin cookie login is left as is.

## Later phases (designed for, not built)
- **scio.ly questions:** a second question source. TORCH would call `/api/questions` from the
  backend with the key (never in the browser), grade through `/api/questions/grade`, store
  results in the same `attempts` tables, use scio.ly's subtopic tags as topics, credit and link
  back to Scio.ly on every page that shows their questions, and pass question error reports back
  to them. Built only after written permission.
- **Team picker + build-event run logs:** top 15, Team A / Team B, 23 of 28 Texas events,
  conflict blocks, coach overrides and locks.

## Pilot (first release)
A small pilot with a few QVMS students, using the four sample tests. QVMS Science Olympiad only;
SBE Number Sense (TMSCA-style scoring) is out of scope for now.

**In the pilot:** parent registration + consent + parent link + PIN reset; kid sign-in; taking a
test at home and with a session code; auto-grading of all five question types (written answers
by Claude); kid review screen with "What to study next" (resources seeded in a migration, no
editing screen yet); xlsx upload with preview/validation; volunteer/head-coach results and
score overrides. **For the pilot, staff use the existing shared admin password** instead of staff
links, since a handful of trusted volunteers run it.

**Not in the pilot:** staff links, question images (needs R2 storage; samples have none — the
uploader rejects image rows for now), a resource-editing screen, other schools beyond tagging.

## Builder decisions (my calls, from the design review)
- **Which tests a kid sees:** every published test for their school, unless a volunteer marks it
  **"session only"** (e.g. a tournament test saved for a meeting); session-only tests are taken only
  with a code.
- **Retakes:** allowed at home. The **first attempt** is the one that counts for coach rankings and
  progress; later attempts show to the kid as practice.
- **In-session answer keys:** reviews for a session's test unlock when the volunteer ends the session
  (or the code expires), so keys don't spread around the room while others are still working.
- **Template layout:** "Test info" uses field/value rows, as in the sample files (the mockup's
  single row was illustrative).
- **Terms:** a short plain-language terms page, version `v1`, drafted by the builder for the user's
  approval. It must say answers to written questions are sent to an AI service (Cloudflare Workers AI) for
  grading, with no names attached.

## Left to the builder
Page layout and styling (match existing pages), how questions are paged, username format,
exact rate-limit numbers, AI prompt wording, seed resource list, test-code length and expiry.

## Sample tests
Filled-in templates for Adhya's events are in `docs/superpowers/specs/sample-tests/` (git-ignored,
because the repo is served publicly and the files contain answer keys): Heredity, Crime Busters,
Circuit Lab, History of Science, plus the blank `TORCH-test-template.xlsx`. History of Science is
not an official 2027 event, so its Event is "Other" with the name in Notes. Questions were written
by Claude and should be reviewed by Adhya before the pilot.
