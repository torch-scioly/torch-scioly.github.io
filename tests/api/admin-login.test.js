import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as login } from '../../functions/api/admin/login.js';
import { isValidAdminSession, createSessionCookie, SESSION_COOKIE_NAME } from '../../functions/api/_lib/auth.js';

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function loginRequest(password) {
  return new Request('https://example.com/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

describe('POST /api/admin/login', () => {
  it('rejects an incorrect password', async () => {
    const response = await login({ request: loginRequest('wrong-password'), env });
    expect(response.status).toBe(401);
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  it('accepts the correct password and issues a valid session cookie', async () => {
    const response = await login({ request: loginRequest(env.ADMIN_PASSWORD), env });
    expect(response.status).toBe(200);

    const setCookie = response.headers.get('Set-Cookie');
    expect(setCookie).toContain(SESSION_COOKIE_NAME);

    const cookieValue = setCookie.split(';')[0];
    const authedRequest = new Request('https://example.com', { headers: { Cookie: cookieValue } });
    expect(await isValidAdminSession(authedRequest, env)).toBe(true);
  });

  it('rejects a request with no cookie', async () => {
    const request = new Request('https://example.com');
    expect(await isValidAdminSession(request, env)).toBe(false);
  });

  it('rejects a tampered cookie', async () => {
    const response = await login({ request: loginRequest(env.ADMIN_PASSWORD), env });
    const cookieValue = response.headers.get('Set-Cookie').split(';')[0];
    const tampered = cookieValue.slice(0, -1) + (cookieValue.endsWith('0') ? '1' : '0');

    const request = new Request('https://example.com', { headers: { Cookie: tampered } });
    expect(await isValidAdminSession(request, env)).toBe(false);
  });

  it('rejects an already-expired session cookie', async () => {
    const expiresAt = Date.now() - 1000; // one second in the past
    const signature = await hmacHex(env.SESSION_SECRET, String(expiresAt));
    const cookieValue = `${SESSION_COOKIE_NAME}=${expiresAt}.${signature}`;

    const request = new Request('https://example.com', { headers: { Cookie: cookieValue } });
    expect(await isValidAdminSession(request, env)).toBe(false);
  });

  it('fails closed: rejects an otherwise well-formed cookie when SESSION_SECRET is unset', async () => {
    // Mint a valid cookie with the real secret first...
    const response = await login({ request: loginRequest(env.ADMIN_PASSWORD), env });
    const cookieValue = response.headers.get('Set-Cookie').split(';')[0];
    const request = new Request('https://example.com', { headers: { Cookie: cookieValue } });

    // ...then verify it against an env where SESSION_SECRET is falsy. An
    // attacker who can guess/construct the "undefined" HMAC key must not be
    // able to forge a session this way.
    expect(await isValidAdminSession(request, { ...env, SESSION_SECRET: '' })).toBe(false);
    expect(await isValidAdminSession(request, { ...env, SESSION_SECRET: undefined })).toBe(false);
  });

  it('createSessionCookie fails closed: throws instead of minting a cookie when SESSION_SECRET is unset', async () => {
    await expect(createSessionCookie({ ...env, SESSION_SECRET: '' })).rejects.toThrow();
    await expect(createSessionCookie({ ...env, SESSION_SECRET: undefined })).rejects.toThrow();
  });
});
