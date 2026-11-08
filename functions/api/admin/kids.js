import { isValidAdminSession } from '../_lib/auth.js';

// Kids at a school with their average score per event, counting first attempts only.
export async function onRequestGet({ request, env }) {
  if (!(await isValidAdminSession(request, env))) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const school = new URL(request.url).searchParams.get('school') || 'QVMS';

  const { results: kids } = await env.DB
    .prepare('SELECT id, display_name, grade, username, parent_id FROM kids WHERE school = ? ORDER BY display_name')
    .bind(school)
    .all();
  const { results: rows } = await env.DB
    .prepare(
      `SELECT a.kid_id, t.event, AVG(a.score * 100.0 / a.max_score) AS avg_percent, COUNT(*) AS tests
         FROM attempts a JOIN tests t ON t.id = a.test_id JOIN kids k ON k.id = a.kid_id
        WHERE k.school = ? AND a.is_first = 1 AND a.submitted_at IS NOT NULL AND a.max_score > 0
        GROUP BY a.kid_id, t.event ORDER BY t.event`
    )
    .bind(school)
    .all();

  return Response.json(
    kids.map((k) => ({
      id: k.id, displayName: k.display_name, grade: k.grade, username: k.username, parentId: k.parent_id,
      events: rows
        .filter((r) => r.kid_id === k.id)
        .map((r) => ({ event: r.event, firstAttemptAvgPercent: Math.round(r.avg_percent), tests: r.tests })),
    }))
  );
}
