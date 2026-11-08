import { parentFromRequest, createKid, kidError } from '../_lib/parents.js';

// A parent adds another child from their parent link page.
export async function onRequestPost({ request, env }) {
  const parent = await parentFromRequest(request, env.DB);
  if (!parent) return Response.json({ error: 'This parent link is not valid' }, { status: 401 });

  const kid = await request.json().catch(() => ({}));
  const problem = kidError(kid);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  return Response.json(await createKid(env.DB, parent.id, parent.school, kid), { status: 201 });
}
