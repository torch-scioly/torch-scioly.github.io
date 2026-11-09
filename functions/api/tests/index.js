import { kidFromRequest } from './_lib/attempts.js';

// Tests a signed-in kid can take at home (published, for their school, not session-only),
// plus any test they started and haven't submitted, so a closed tab can always resume.
export async function onRequestGet({ request, env }) {
  const kid = await kidFromRequest(request, env);
  if (!kid) return Response.json({ error: 'Please sign in' }, { status: 401 });

  const { results } = await env.DB
    .prepare(
      `SELECT t.id, t.title, t.event, t.format, t.time_limit_min,
              (SELECT COUNT(*) FROM test_questions q WHERE q.test_id = t.id) AS question_count,
              (SELECT COUNT(*) FROM attempts a WHERE a.test_id = t.id AND a.kid_id = ?1 AND a.submitted_at IS NOT NULL) AS attempts,
              (SELECT MAX(a.score * 100.0 / a.max_score) FROM attempts a
                WHERE a.test_id = t.id AND a.kid_id = ?1 AND a.submitted_at IS NOT NULL AND a.max_score > 0) AS best_percent,
              (SELECT a.id FROM attempts a WHERE a.test_id = t.id AND a.kid_id = ?1 AND a.submitted_at IS NULL) AS open_attempt_id
         FROM tests t
        WHERE t.school = ?2
          AND ((t.published = 1 AND t.session_only = 0)
               OR EXISTS (SELECT 1 FROM attempts a WHERE a.test_id = t.id AND a.kid_id = ?1 AND a.submitted_at IS NULL))
        ORDER BY t.event, t.title`
    )
    .bind(kid.id, kid.school)
    .all();

  return Response.json(
    results.map((t) => ({
      id: t.id, title: t.title, event: t.event, format: t.format, timeLimitMin: t.time_limit_min,
      questionCount: t.question_count, attempts: t.attempts,
      bestPercent: t.best_percent === null ? null : Math.round(t.best_percent),
      openAttemptId: t.open_attempt_id,
    }))
  );
}
