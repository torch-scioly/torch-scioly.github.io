import { isValidAdminSession } from '../../_lib/auth.js';

// A volunteer sets a question's score (grading a waiting answer or correcting the AI).
export async function onRequestPut({ request, env, params }) {
  if (!(await isValidAdminSession(request, env))) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const row = await env.DB
    .prepare('SELECT aa.*, q.points AS max FROM attempt_answers aa JOIN test_questions q ON q.id = aa.question_id WHERE aa.id = ?')
    .bind(Number(params.id))
    .first();
  if (!row) return Response.json({ error: 'Answer not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const points = typeof body.points === 'number' ? body.points : Number.NaN;
  if (!Number.isFinite(points) || points < 0 || points > row.max) {
    return Response.json({ error: `Points must be between 0 and ${row.max}` }, { status: 400 });
  }
  const status = points >= row.max ? 'correct' : points <= 0 ? 'wrong' : 'partial';
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

  await env.DB.batch([
    env.DB
      .prepare(`UPDATE attempt_answers SET points = ?, status = ?, graded_by = 'override', override_note = ? WHERE id = ?`)
      .bind(points, status, note, row.id),
    env.DB
      .prepare('UPDATE attempts SET score = (SELECT COALESCE(SUM(points), 0) FROM attempt_answers WHERE attempt_id = ?) WHERE id = ?')
      .bind(row.attempt_id, row.attempt_id),
  ]);
  return Response.json({ answerId: row.id, points, status, gradedBy: 'override' });
}
