import { kidFromRequest, loadAttemptForViewer } from '../../_lib/attempts.js';

// Autosave one answer. Refused once the attempt is submitted or 60 s past the deadline.
export async function onRequestPut({ request, env, params }) {
  const kid = await kidFromRequest(request, env);
  if (!kid) return Response.json({ error: 'Please sign in' }, { status: 401 });
  const attempt = await loadAttemptForViewer(env.DB, params.id, { kind: 'kid', id: kid.id });
  if (!attempt) return Response.json({ error: 'Not found' }, { status: 404 });
  if (attempt.submitted_at) return Response.json({ error: 'Already submitted' }, { status: 409 });

  const late = await env.DB
    .prepare(`SELECT ? IS NOT NULL AND datetime('now') > datetime(?, '+60 seconds') AS late`)
    .bind(attempt.deadline_at, attempt.deadline_at)
    .first();
  if (late.late) return Response.json({ error: 'Time is up' }, { status: 409 });

  const { questionId, response } = await request.json().catch(() => ({}));
  const question = await env.DB
    .prepare('SELECT id FROM test_questions WHERE id = ? AND test_id = ?')
    .bind(Number(questionId), attempt.test_id)
    .first();
  if (!question) return Response.json({ error: 'Unknown question' }, { status: 400 });

  await env.DB
    .prepare(
      `INSERT INTO attempt_answers (attempt_id, question_id, response) VALUES (?, ?, ?)
       ON CONFLICT (attempt_id, question_id) DO UPDATE SET response = excluded.response`
    )
    .bind(attempt.id, question.id, response === undefined || response === null ? null : String(response).slice(0, 5000))
    .run();
  return new Response(null, { status: 204 });
}
