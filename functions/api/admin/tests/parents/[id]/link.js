import { isValidAdminSession } from '../../../../_lib/auth.js';
import { issueParentKey } from '../../../../tests/_lib/parents.js';

// Staff reissue a parent link when a parent has lost theirs.
export async function onRequestPost({ request, env, params }) {
  if (!(await isValidAdminSession(request, env))) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const parent = await env.DB.prepare('SELECT id FROM parents WHERE id = ?').bind(Number(params.id)).first();
  if (!parent) return Response.json({ error: 'Parent not found' }, { status: 404 });
  return Response.json({ parentKey: await issueParentKey(env.DB, parent.id) });
}
