import { isValidAdminSession } from '../_lib/auth.js';
import { validateTest } from '../_lib/test-format.js';

const UNAUTHORIZED = () => Response.json({ error: 'Unauthorized' }, { status: 401 });

export async function onRequestGet({ request, env }) {
  if (!(await isValidAdminSession(request, env))) return UNAUTHORIZED();
  const { results } = await env.DB
    .prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM test_questions q WHERE q.test_id = t.id) AS question_count,
              (SELECT COUNT(*) FROM attempts a WHERE a.test_id = t.id AND a.submitted_at IS NOT NULL) AS attempt_count
         FROM tests t ORDER BY t.created_at DESC, t.id DESC`
    )
    .all();
  return Response.json(
    results.map((t) => ({
      id: t.id, title: t.title, event: t.event, school: t.school, format: t.format, division: t.division,
      timeLimitMin: t.time_limit_min, published: t.published, sessionOnly: t.session_only,
      questionCount: t.question_count, attemptCount: t.attempt_count,
    }))
  );
}

// Upload a test parsed from the spreadsheet template. ?dryRun=1 only validates.
export async function onRequestPost({ request, env }) {
  if (!(await isValidAdminSession(request, env))) return UNAUTHORIZED();
  const { errors, test } = validateTest(await request.json().catch(() => ({})));
  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';

  if (dryRun) return Response.json({ errors, questionCount: test ? test.questions.length : 0 });
  if (!test) return Response.json({ errors }, { status: 400 });

  const row = await env.DB
    .prepare(
      `INSERT INTO tests (school, title, event, division, format, time_limit_min, written_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .bind(test.school, test.title, test.event, test.division, test.format, test.timeLimitMin, test.writtenBy || null, test.notes || null)
    .first();
  const insert = env.DB.prepare(
    `INSERT INTO test_questions (test_id, position, topic, type, prompt, choices_json, answer, tolerance, points, explanation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await env.DB.batch(
    test.questions.map((q) =>
      insert.bind(row.id, q.position, q.topic, q.type, q.prompt, q.choices ? JSON.stringify(q.choices) : null, q.answer, q.tolerance, q.points, q.explanation)
    )
  );
  return Response.json({ id: row.id, questionCount: test.questions.length }, { status: 201 });
}
