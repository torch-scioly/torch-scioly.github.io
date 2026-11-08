import { isValidAdminSession } from '../../../_lib/auth.js';
import { sqliteToIso } from '../../../_lib/time.js';

// Every submitted attempt at one test, per-question stats, and how many written
// answers are still waiting for a volunteer to grade.
export async function onRequestGet({ request, env, params }) {
  if (!(await isValidAdminSession(request, env))) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const test = await env.DB.prepare('SELECT * FROM tests WHERE id = ?').bind(Number(params.id)).first();
  if (!test) return Response.json({ error: 'Test not found' }, { status: 404 });

  const { results: attempts } = await env.DB
    .prepare(
      `SELECT a.*, k.display_name FROM attempts a JOIN kids k ON k.id = a.kid_id
        WHERE a.test_id = ? AND a.submitted_at IS NOT NULL ORDER BY a.submitted_at DESC, a.id DESC`
    )
    .bind(test.id)
    .all();
  const { results: answers } = await env.DB
    .prepare(
      `SELECT aa.*, q.position FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
         JOIN test_questions q ON q.id = aa.question_id
        WHERE a.test_id = ? AND a.submitted_at IS NOT NULL`
    )
    .bind(test.id)
    .all();
  const { results: questions } = await env.DB
    .prepare('SELECT id, position, prompt, type, points FROM test_questions WHERE test_id = ? ORDER BY position')
    .bind(test.id)
    .all();

  return Response.json({
    test: { id: test.id, title: test.title, event: test.event, school: test.school },
    questions: questions.map((q) => ({ id: q.id, position: q.position, prompt: q.prompt, type: q.type, maxPoints: q.points })),
    attempts: attempts.map((a) => ({
      attemptId: a.id,
      kid: { id: a.kid_id, displayName: a.display_name },
      isFirst: a.is_first,
      submittedAt: sqliteToIso(a.submitted_at),
      score: a.score,
      maxScore: a.max_score,
      answers: answers
        .filter((x) => x.attempt_id === a.id)
        .sort((x, y) => x.position - y.position)
        .map((x) => ({
          answerId: x.id, questionId: x.question_id, position: x.position, response: x.response,
          points: x.points, status: x.status, gradedBy: x.graded_by, feedback: x.feedback, overrideNote: x.override_note,
        })),
    })),
    questionStats: questions.map((q) => {
      const forQ = answers.filter((x) => x.question_id === q.id);
      const correct = forQ.filter((x) => x.status === 'correct').length;
      return { questionId: q.id, position: q.position, percentCorrect: forQ.length ? Math.round((correct / forQ.length) * 100) : null };
    }),
    needsVolunteer: answers.filter((x) => x.status === 'needs_volunteer').length,
  });
}
