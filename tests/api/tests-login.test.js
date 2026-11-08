import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { register, loginKid } from './helpers-tests.js';
import { readBearer } from '../../functions/api/_lib/secrets.js';

describe('POST /api/tests/login', () => {
  it('signs a kid in with a bearer token', async () => {
    await register();
    const { response, data } = await loginKid('aarav-k-qvms');
    expect(response.status).toBe(200);
    expect(data.kid).toEqual({ id: expect.any(Number), displayName: 'Aarav K', school: 'QVMS' });
    const request = new Request('https://example.com', { headers: { Authorization: `Bearer ${data.token}` } });
    expect(await readBearer(request, env)).toEqual({ kind: 'kid', id: data.kid.id });
  });

  it('rejects a wrong PIN and an unknown username the same way', async () => {
    await register();
    const wrong = await loginKid('aarav-k-qvms', '0000');
    const unknown = await loginKid('nobody', '4821');
    expect(wrong.response.status).toBe(401);
    expect(wrong.data.error).toBe('Wrong username or PIN');
    expect(unknown.response.status).toBe(401);
  });

  it('accepts the username in any case', async () => {
    await register();
    expect((await loginKid('Aarav-K-QVMS')).response.status).toBe(200);
  });

  it('locks after 5 wrong PINs, even for the right PIN', async () => {
    await register();
    for (let i = 0; i < 5; i++) await loginKid('aarav-k-qvms', '0000');
    const { response, data } = await loginKid('aarav-k-qvms');
    expect(response.status).toBe(423);
    expect(data.error).toBe('Too many tries. Try again in 15 minutes.');
  });

  it('unlocks on its own after the lock time passes', async () => {
    await register();
    for (let i = 0; i < 5; i++) await loginKid('aarav-k-qvms', '0000');
    await env.DB.prepare("UPDATE kids SET locked_until = datetime('now', '-1 minute')").run();
    expect((await loginKid('aarav-k-qvms')).response.status).toBe(200);
    const kid = await env.DB.prepare('SELECT failed_pins, locked_until FROM kids').first();
    expect(kid).toEqual({ failed_pins: 0, locked_until: null });
  });
});
