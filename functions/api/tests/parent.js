import { parentFromRequest } from './_lib/parents.js';

// What a parent sees through their parent link: their kids and each kid's submitted tests.
export async function onRequestGet({ request, env }) {
  const parent = await parentFromRequest(request, env.DB);
  if (!parent) return Response.json({ error: 'This parent link is not valid' }, { status: 401 });

  const { results: kids } = await env.DB
    .prepare('SELECT id, display_name, username, grade FROM kids WHERE parent_id = ? ORDER BY id')
    .bind(parent.id)
    .all();
  const { results: attempts } = await env.DB
    .prepare(
      `SELECT a.id, a.kid_id, t.title, t.event, a.submitted_at, a.score, a.max_score
         FROM attempts a JOIN tests t ON t.id = a.test_id JOIN kids k ON k.id = a.kid_id
        WHERE k.parent_id = ? AND a.submitted_at IS NOT NULL
        ORDER BY a.submitted_at DESC`
    )
    .bind(parent.id)
    .all();

  return Response.json({
    parent: { name: parent.name, school: parent.school },
    kids: kids.map((k) => ({
      id: k.id,
      displayName: k.display_name,
      username: k.username,
      grade: k.grade,
      attempts: attempts
        .filter((a) => a.kid_id === k.id)
        .map((a) => ({ id: a.id, testTitle: a.title, event: a.event, submittedAt: a.submitted_at, score: a.score, maxScore: a.max_score })),
    })),
  });
}
