import { isValidAdminSession } from '../../_lib/auth.js';

const UNAUTHORIZED = () => Response.json({ error: 'Unauthorized' }, { status: 401 });

// Toggle whether a test is published and whether it's only taken with a session code.
export async function onRequestPut({ request, env, params }) {
  if (!(await isValidAdminSession(request, env))) return UNAUTHORIZED();
  const body = await request.json().catch(() => ({}));
  const id = Number(params.id);
  if (!(await env.DB.prepare('SELECT id FROM tests WHERE id = ?').bind(id).first())) {
    return Response.json({ error: 'Test not found' }, { status: 404 });
  }
  if (body.published !== undefined) await env.DB.prepare('UPDATE tests SET published = ? WHERE id = ?').bind(body.published ? 1 : 0, id).run();
  if (body.sessionOnly !== undefined) await env.DB.prepare('UPDATE tests SET session_only = ? WHERE id = ?').bind(body.sessionOnly ? 1 : 0, id).run();
  return Response.json(await env.DB.prepare('SELECT * FROM tests WHERE id = ?').bind(id).first());
}

// Delete a test nobody has taken yet.
export async function onRequestDelete({ request, env, params }) {
  if (!(await isValidAdminSession(request, env))) return UNAUTHORIZED();
  const id = Number(params.id);
  if (await env.DB.prepare('SELECT 1 FROM attempts WHERE test_id = ?').bind(id).first()) {
    return Response.json({ error: 'Kids have taken this test, so it can’t be deleted. Unpublish it instead.' }, { status: 409 });
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM test_sessions WHERE test_id = ?').bind(id),
    env.DB.prepare('DELETE FROM test_questions WHERE test_id = ?').bind(id),
    env.DB.prepare('DELETE FROM tests WHERE id = ?').bind(id),
  ]);
  return new Response(null, { status: 204 });
}
