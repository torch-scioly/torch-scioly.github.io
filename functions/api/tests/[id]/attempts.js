import { kidFromRequest, startAttempt } from '../_lib/attempts.js';

// A kid starts a test at home.
export async function onRequestPost({ request, env, params }) {
  const kid = await kidFromRequest(request, env);
  if (!kid) return Response.json({ error: 'Please sign in' }, { status: 401 });

  const test = await env.DB
    .prepare('SELECT * FROM tests WHERE id = ? AND published = 1 AND session_only = 0 AND school = ?')
    .bind(Number(params.id), kid.school)
    .first();
  if (!test) return Response.json({ error: 'Test not found' }, { status: 404 });
  return startAttempt(env.DB, kid, test);
}
