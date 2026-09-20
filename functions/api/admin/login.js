import { createSessionCookie, timingSafeEqual } from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  const body = await request.json();

  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return Response.json({ error: 'Admin auth is not configured' }, { status: 500 });
  }

  if (!timingSafeEqual(body.password ?? '', env.ADMIN_PASSWORD ?? '')) {
    return Response.json({ error: 'Invalid password' }, { status: 401 });
  }

  const cookie = await createSessionCookie(env);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie },
  });
}
