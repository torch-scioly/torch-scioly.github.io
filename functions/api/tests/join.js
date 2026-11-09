import { kidFromRequest, startAttempt } from './_lib/attempts.js';

// A kid joins an in-session test with the code the volunteer shows.
export async function onRequestPost({ request, env }) {
  const kid = await kidFromRequest(request, env);
  if (!kid) return Response.json({ error: 'Please sign in' }, { status: 401 });

  const { code } = await request.json().catch(() => ({}));
  const session = await env.DB
    .prepare(
      `SELECT s.id AS session_id, t.* FROM test_sessions s JOIN tests t ON t.id = s.test_id
        WHERE s.code = ? AND s.ended_at IS NULL AND s.expires_at > datetime('now') AND t.school = ?`
    )
    .bind(String(code || '').trim().toUpperCase(), kid.school)
    .first();
  if (!session) return Response.json({ error: 'That code isn’t valid' }, { status: 400 });
  return startAttempt(env.DB, kid, session, session.session_id);
}
