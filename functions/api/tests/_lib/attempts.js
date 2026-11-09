// Shared logic for kids taking tests and for kids/parents viewing attempts.
import { readBearer } from '../../_lib/secrets.js';
import { sqliteToIso } from '../../_lib/time.js';
import { findParentByKey } from './parents.js';

// Who's asking: a signed-in kid (bearer token) or a parent (parent link key).
export async function viewerFromRequest(request, env) {
  const bearer = await readBearer(request, env);
  if (bearer?.kind === 'kid') {
    const kid = await env.DB.prepare('SELECT * FROM kids WHERE id = ?').bind(bearer.id).first();
    if (kid) return { kind: 'kid', id: kid.id, kid };
  }
  const parent = await findParentByKey(env.DB, request.headers.get('X-Parent-Key'));
  return parent ? { kind: 'parent', id: parent.id, parent } : null;
}

export async function kidFromRequest(request, env) {
  const viewer = await viewerFromRequest(request, env);
  return viewer?.kind === 'kid' ? viewer.kid : null;
}

export async function loadAttemptForViewer(db, attemptId, viewer) {
  const attempt = await db
    .prepare('SELECT a.*, k.parent_id FROM attempts a JOIN kids k ON k.id = a.kid_id WHERE a.id = ?')
    .bind(Number(attemptId))
    .first();
  if (!attempt || !viewer) return null;
  if (viewer.kind === 'kid' && attempt.kid_id !== viewer.id) return null;
  if (viewer.kind === 'parent' && attempt.parent_id !== viewer.id) return null;
  return attempt;
}

// While any session for a test is running, reviews of every attempt at that test stay
// locked (session or home), so answer keys don't spread around the room.
export async function isReviewLocked(db, attempt) {
  const row = await db
    .prepare(`SELECT 1 AS open FROM test_sessions WHERE test_id = ? AND ended_at IS NULL AND expires_at > datetime('now')`)
    .bind(attempt.test_id)
    .first();
  return Boolean(row?.open);
}

// Starts an attempt, or returns the kid's unfinished one for this test.
export async function startAttempt(db, kid, test, sessionId = null) {
  const open = await db
    .prepare('SELECT id FROM attempts WHERE kid_id = ? AND test_id = ? AND submitted_at IS NULL ORDER BY id DESC')
    .bind(kid.id, test.id)
    .first();
  if (open) return Response.json({ attemptId: open.id }, { status: 200 });

  const row = await db
    .prepare(
      `INSERT INTO attempts (test_id, kid_id, session_id, started_at, deadline_at)
       VALUES (?, ?, ?, datetime('now'), CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', '+' || ? || ' minutes') END)
       RETURNING id`
    )
    .bind(test.id, kid.id, sessionId, test.time_limit_min, test.time_limit_min)
    .first();
  return Response.json({ attemptId: row.id }, { status: 201 });
}

function parseChoices(json) {
  return json ? JSON.parse(json) : null;
}

export async function studySuggestions(db, event, missedTopics) {
  const { results } = await db.prepare('SELECT topic, title, url FROM study_resources WHERE event = ? ORDER BY id').bind(event).all();
  return missedTopics.map((topic) => {
    const exact = results.filter((r) => r.topic && topic && r.topic.toLowerCase() === topic.toLowerCase());
    const general = results.filter((r) => !r.topic);
    const seen = new Set();
    const links = [...exact, ...general]
      .filter((r) => !seen.has(r.url) && seen.add(r.url))
      .slice(0, 3)
      .map((r) => ({ title: r.title, url: r.url }));
    return { topic, links };
  });
}

export async function inProgressView(db, attempt) {
  const test = await db.prepare('SELECT * FROM tests WHERE id = ?').bind(attempt.test_id).first();
  const { results: questions } = await db
    .prepare('SELECT id, position, type, prompt, choices_json, points FROM test_questions WHERE test_id = ? ORDER BY position')
    .bind(test.id)
    .all();
  const { results: saved } = await db
    .prepare('SELECT question_id, response FROM attempt_answers WHERE attempt_id = ?')
    .bind(attempt.id)
    .all();
  return {
    status: 'in_progress',
    attemptId: attempt.id,
    test: { title: test.title, event: test.event, timeLimitMin: test.time_limit_min },
    deadlineAt: sqliteToIso(attempt.deadline_at),
    questions: questions.map((q) => ({ id: q.id, position: q.position, type: q.type, prompt: q.prompt, choices: parseChoices(q.choices_json), maxPoints: q.points })),
    responses: Object.fromEntries(saved.map((s) => [s.question_id, s.response])),
  };
}

export async function reviewView(db, attempt) {
  const test = await db.prepare('SELECT * FROM tests WHERE id = ?').bind(attempt.test_id).first();
  const { results: rows } = await db
    .prepare(
      `SELECT q.*, aa.response, aa.points AS awarded, aa.status, aa.graded_by, aa.feedback
         FROM test_questions q LEFT JOIN attempt_answers aa ON aa.question_id = q.id AND aa.attempt_id = ?
        WHERE q.test_id = ? ORDER BY q.position`
    )
    .bind(attempt.id, test.id)
    .all();
  const { results: history } = await db
    .prepare(
      `SELECT a.submitted_at, a.score, a.max_score FROM attempts a JOIN tests t ON t.id = a.test_id
        WHERE a.kid_id = ? AND t.event = ? AND a.is_first = 1 AND a.submitted_at IS NOT NULL
        ORDER BY a.submitted_at, a.id`
    )
    .bind(attempt.kid_id, test.event)
    .all();

  const missed = [];
  for (const r of rows) {
    if (['wrong', 'partial'].includes(r.status) && r.topic && !missed.includes(r.topic)) missed.push(r.topic);
  }

  return {
    status: 'reviewed',
    attemptId: attempt.id,
    test: { title: test.title, event: test.event, writtenBy: test.written_by },
    submittedAt: sqliteToIso(attempt.submitted_at),
    score: attempt.score,
    maxScore: attempt.max_score,
    questions: rows.map((r) => ({
      id: r.id, position: r.position, topic: r.topic, type: r.type, prompt: r.prompt, choices: parseChoices(r.choices_json),
      response: r.response ?? null, answer: r.answer, explanation: r.explanation,
      points: r.awarded ?? null, maxPoints: r.points, status: r.status, gradedBy: r.graded_by, feedback: r.feedback,
    })),
    progress: history.map((h) => ({
      submittedAt: sqliteToIso(h.submitted_at),
      percent: h.max_score ? Math.round((h.score / h.max_score) * 100) : 0,
    })),
    studyNext: await studySuggestions(db, test.event, missed),
  };
}
