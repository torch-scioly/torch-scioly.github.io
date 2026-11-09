import { verifyPin, signToken } from '../_lib/secrets.js';

const MAX_TRIES = 5;
const WRONG = { error: 'Wrong username or PIN' };
const LOCKED = { error: 'Too many tries. Try again in 15 minutes.' };

// Kid sign-in with username + PIN. 5 wrong PINs lock the username for 15 minutes.
export async function onRequestPost({ request, env }) {
  const { username, pin } = await request.json().catch(() => ({}));
  const kid = await env.DB
    .prepare(
      `SELECT *, (locked_until IS NOT NULL AND locked_until > datetime('now')) AS is_locked
         FROM kids WHERE username = ?`
    )
    .bind(String(username || '').trim().toLowerCase())
    .first();
  if (!kid) return Response.json(WRONG, { status: 401 });
  if (kid.is_locked) return Response.json(LOCKED, { status: 423 });

  const failed = kid.locked_until ? 0 : kid.failed_pins;
  if (!(await verifyPin(String(pin || ''), kid.pin_hash, kid.pin_salt))) {
    const tries = failed + 1;
    await env.DB
      .prepare(
        `UPDATE kids SET failed_pins = ?,
                locked_until = CASE WHEN ? >= ? THEN datetime('now', '+15 minutes') ELSE NULL END
          WHERE id = ?`
      )
      .bind(tries >= MAX_TRIES ? 0 : tries, tries, MAX_TRIES, kid.id)
      .run();
    return Response.json(WRONG, { status: 401 });
  }

  await env.DB.prepare('UPDATE kids SET failed_pins = 0, locked_until = NULL WHERE id = ?').bind(kid.id).run();
  return Response.json({
    token: await signToken(env, { kind: 'kid', id: kid.id }),
    kid: { id: kid.id, displayName: kid.display_name, school: kid.school },
  });
}
