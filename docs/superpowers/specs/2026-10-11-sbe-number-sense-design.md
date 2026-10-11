# SBE Number Sense — design

Date: 2026-10-11 · Status: approved in chat

## Goal
TORCH volunteers teach Number Sense (TMSCA prep) at Sonal Bhuchar Elementary (SBE)
every Monday 3:45–4:45 PM, excluding school holidays. Replace the Google Sheet with
weekly volunteer sign-up and a published weekly curriculum, built on the existing
class system so SBE hours count toward tiers and sessions show in the banner.

## Decisions
- **Schema:** `classes.school` (`QVMS` default | `SBE`) and `classes.program`
  (`Science Olympiad` default | `Number Sense`). Groundwork for more schools.
- **No student sign-up** for SBE classes (elementary kids). Hidden on the SBE page
  and in the class detail modal when `school = 'SBE'`.
- **Volunteer jobs** are stored in the existing `role_note`: `Teach: <trick>`,
  `PowerPoint`, or `Test prep`. Every session may end with a short practice test;
  there are no separate mock-test weeks.
- **Curriculum** is each Monday's class `description`, pre-filled from an
  elementary-level sequence drawn from the Number Sense tricks book and TMSCA
  elementary topics; editable like any class.
- **New page** `sbe.html` ("Number Sense" in the nav): Monday list with topic,
  volunteers + jobs, Sign up (name, email, job, optional trick).
- **Classes page:** SBE badge on SBE classes. **Banner:** SBE sessions prefixed `SBE ·`.
- **Seed:** Mondays Oct 19 2026 → May 24 2027, skipping Oct 12, Nov 23, Dec 21,
  Dec 28, Jan 4, Jan 18, Feb 15, Mar 15, May 31. Backfill Sep 28 and Oct 5 from the
  sheet (Veda on Oct 5 only; ×1001 unattributed).
- **Branding (same release):** new TORCH logo in the navbar + favicon; footer adds
  Discord (https://discord.gg/wsP3QBPkr) and Instagram (@torch_qvms_sbe).

## Out of scope
Online tests with student answers and grading (later; `program` leaves room for it).
