import { isValidAdminSession } from '../../../_lib/auth.js';
import { sqliteToIso } from '../../../_lib/time.js';

// No 0/O or 1/I/L, so codes read clearly off a projector.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

// Start an in-session test: kids join with the code for the next 3 hours.
export async function onRequestPost({ request, env, params }) {
  if (!(await isValidAdminSession(request, env))) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const test = await env.DB.prepare('SELECT id FROM tests WHERE id = ?').bind(Number(params.id)).first();
  if (!test) return Response.json({ error: 'Test not found' }, { status: 404 });

  for (let tries = 0; tries < 5; tries++) {
    const code = makeCode();
    if (await env.DB.prepare('SELECT 1 FROM test_sessions WHERE code = ?').bind(code).first()) continue;
    const row = await env.DB
      .prepare(`INSERT INTO test_sessions (test_id, code, expires_at) VALUES (?, ?, datetime('now', '+3 hours')) RETURNING expires_at`)
      .bind(test.id, code)
      .first();
    return Response.json({ code, expiresAt: sqliteToIso(row.expires_at) }, { status: 201 });
  }
  return Response.json({ error: 'Could not make a code, try again' }, { status: 500 });
}
