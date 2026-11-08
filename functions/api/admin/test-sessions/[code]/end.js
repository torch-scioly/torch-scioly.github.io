import { isValidAdminSession } from '../../../_lib/auth.js';

// End an in-session test. Kids' reviews for this session unlock now.
export async function onRequestPost({ request, env, params }) {
  if (!(await isValidAdminSession(request, env))) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await env.DB
    .prepare(`UPDATE test_sessions SET ended_at = COALESCE(ended_at, datetime('now')) WHERE code = ?`)
    .bind(String(params.code || '').toUpperCase())
    .run();
  if (!result.meta.changes) return Response.json({ error: 'Session not found' }, { status: 404 });
  return Response.json({ ended: true });
}
