// Shared request helpers for the practice-tests API tests.
import { env } from 'cloudflare:test';
import { onRequestPost as registerParent } from '../../functions/api/tests/parents.js';
import { onRequestPost as kidLogin } from '../../functions/api/tests/login.js';
import { onRequestPost as adminLogin } from '../../functions/api/admin/login.js';

export function jsonRequest(method, body, headers = {}) {
  return new Request('https://example.com', {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function register(overrides = {}) {
  const body = {
    parentName: 'Priya K', parentEmail: 'priya@example.com', school: 'QVMS', consent: true,
    kids: [{ firstName: 'Aarav', lastInitial: 'K', grade: '7', pin: '4821' }],
    ...overrides,
  };
  const response = await registerParent({ request: jsonRequest('POST', body), env });
  return { response, data: response.status === 201 ? await response.json() : await response.json() };
}

export async function loginKid(username, pin = '4821') {
  const response = await kidLogin({ request: jsonRequest('POST', { username, pin }), env });
  return { response, data: await response.json() };
}

export async function adminCookie() {
  const response = await adminLogin({ request: jsonRequest('POST', { password: env.ADMIN_PASSWORD }), env });
  return response.headers.get('Set-Cookie').split(';')[0];
}
