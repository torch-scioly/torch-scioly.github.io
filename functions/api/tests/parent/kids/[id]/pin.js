import { parentFromRequest, PIN_PATTERN } from '../../../_lib/parents.js';
import { hashPin } from '../../../../_lib/secrets.js';

// A parent sets a new PIN for one of their kids. This also clears any lockout.
export async function onRequestPost({ request, env, params }) {
  const parent = await parentFromRequest(request, env.DB);
  if (!parent) return Response.json({ error: 'This parent link is not valid' }, { status: 401 });

  const { pin } = await request.json().catch(() => ({}));
  if (!PIN_PATTERN.test(String(pin || ''))) return Response.json({ error: 'PINs must be 4 to 6 digits' }, { status: 400 });

  const kid = await env.DB.prepare('SELECT id FROM kids WHERE id = ? AND parent_id = ?').bind(Number(params.id), parent.id).first();
  if (!kid) return Response.json({ error: 'Child not found' }, { status: 404 });

  const { hash, salt } = await hashPin(String(pin));
  await env.DB
    .prepare('UPDATE kids SET pin_hash = ?, pin_salt = ?, failed_pins = 0, locked_until = NULL WHERE id = ?')
    .bind(hash, salt, kid.id)
    .run();
  return new Response(null, { status: 204 });
}
