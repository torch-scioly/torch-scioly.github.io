import { parentFromRequest, issueParentKey } from '../_lib/parents.js';

// A parent makes a new parent link; the old one stops working.
export async function onRequestPost({ request, env }) {
  const parent = await parentFromRequest(request, env.DB);
  if (!parent) return Response.json({ error: 'This parent link is not valid' }, { status: 401 });
  return Response.json({ parentKey: await issueParentKey(env.DB, parent.id) });
}
