import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as login } from '../../functions/api/admin/login.js';
import { onRequestGet as getAuditLog } from '../../functions/api/admin/audit-log.js';
import { onRequestPost as createClassRequest } from '../../functions/api/classes.js';

async function adminCookie() {
  const response = await login({
    request: new Request('https://example.com', {
      method: 'POST',
      body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
    }),
    env,
  });
  return response.headers.get('Set-Cookie').split(';')[0];
}

describe('GET /api/admin/audit-log', () => {
  it('rejects a request with no session', async () => {
    const response = await getAuditLog({ request: new Request('https://example.com'), env });
    expect(response.status).toBe(401);
  });

  it('returns the audit log for an authenticated admin', async () => {
    await createClassRequest({
      request: new Request('https://example.com/api/classes', {
        method: 'POST',
        body: JSON.stringify({ title: 'Genetics', date: '2026-10-01', startTime: '16:00' }),
      }),
      env,
    });

    const cookie = await adminCookie();
    const response = await getAuditLog({
      request: new Request('https://example.com', { headers: { Cookie: cookie } }),
      env,
    });

    expect(response.status).toBe(200);
    const log = await response.json();
    expect(log).toHaveLength(1);
    expect(log[0].entity_type).toBe('class');
  });
});
