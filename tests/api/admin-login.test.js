import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as login } from '../../functions/api/admin/login.js';
import { isValidAdminSession, SESSION_COOKIE_NAME } from '../../functions/api/_lib/auth.js';

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
});
