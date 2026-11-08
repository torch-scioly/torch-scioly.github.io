import { kidFromRequest, loadAttemptForViewer, isReviewLocked } from '../../_lib/attempts.js';
import { gradeAuto, gradeWritten } from '../../../_lib/grading.js';

// Submit and grade every question. Blank answers are wrong; written answers go to
// Workers AI, and ones it can't grade wait for a volunteer (counted as 0 until then).
export async function onRequestPost({ request, env, params }) {
  const kid = await kidFromRequest(request, env);
  if (!kid) return Response.json({ error: 'Please sign in' }, { status: 401 });
  const attempt = await loadAttemptForViewer(env.DB, params.id, { kind: 'kid', id: kid.id });
  if (!attempt) return Response.json({ error: 'Not found' }, { status: 404 });
  if (attempt.submitted_at) return Response.json({ error: 'Already submitted' }, { status: 409 });

  const { results: questions } = await env.DB
    .prepare(
      `SELECT q.*, aa.response FROM test_questions q
         LEFT JOIN attempt_answers aa ON aa.question_id = q.id AND aa.attempt_id = ?
        WHERE q.test_id = ? ORDER BY q.position`
    )
    .bind(attempt.id, attempt.test_id)
    .all();

  let score = 0;
  let maxScore = 0;
  const writes = [];
  for (const q of questions) {
    maxScore += q.points;
    const graded =
      q.type === 'Written answer'
        ? await gradeWritten(env.AI, q, q.response)
        : { ...gradeAuto(q, q.response), feedback: null, gradedBy: 'auto' };
    score += graded.points ?? 0;
    writes.push(
      env.DB
        .prepare(
          `INSERT INTO attempt_answers (attempt_id, question_id, response, points, status, graded_by, feedback)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (attempt_id, question_id) DO UPDATE SET
             points = excluded.points, status = excluded.status, graded_by = excluded.graded_by, feedback = excluded.feedback`
        )
        .bind(attempt.id, q.id, q.response ?? null, graded.points, graded.status, graded.gradedBy, graded.feedback)
    );
  }

  const earlier = await env.DB
    .prepare('SELECT 1 FROM attempts WHERE kid_id = ? AND test_id = ? AND submitted_at IS NOT NULL AND id != ?')
    .bind(kid.id, attempt.test_id, attempt.id)
    .first();
  writes.push(
    env.DB
      .prepare(`UPDATE attempts SET submitted_at = datetime('now'), score = ?, max_score = ?, is_first = ? WHERE id = ?`)
      .bind(score, maxScore, earlier ? 0 : 1, attempt.id)
  );
  await env.DB.batch(writes);

  const locked = await isReviewLocked(env.DB, attempt);
  return Response.json(locked ? { status: 'waiting_for_session', score: null, maxScore: null } : { status: 'reviewed', score, maxScore });
}
