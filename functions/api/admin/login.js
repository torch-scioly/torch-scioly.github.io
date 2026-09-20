import { createSessionCookie } from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  const body = await request.json();

  if (body.password !== env.ADMIN_PASSWORD) {
    return Response.json({ error: 'Invalid password' }, { status: 401 });
  }

  const cookie = await createSessionCookie(env);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie },
  });
}
