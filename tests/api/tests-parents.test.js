import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { jsonRequest, register, loginKid, adminCookie } from './helpers-tests.js';
import { onRequestGet as getParent } from '../../functions/api/tests/parent.js';
import { onRequestPost as addKid } from '../../functions/api/tests/parent/kids.js';
import { onRequestPost as resetPin } from '../../functions/api/tests/parent/kids/[id]/pin.js';
import { onRequestPost as rotateLink } from '../../functions/api/tests/parent/link.js';
import { onRequestPost as reissueLink } from '../../functions/api/admin/tests/parents/[id]/link.js';

const withKey = (key) => ({ 'X-Parent-Key': key });

describe('POST /api/tests/parents', () => {
  it('registers a parent and kid with consent', async () => {
    const { response, data } = await register();
    expect(response.status).toBe(201);
    expect(data.parentKey).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(data.kids).toEqual([{ id: expect.any(Number), displayName: 'Aarav K', username: 'aarav-k-qvms' }]);
    const parent = await env.DB.prepare('SELECT * FROM parents WHERE email = ?').bind('priya@example.com').first();
    expect(parent.consent_terms_version).toBe('v1');
    expect(parent.consent_at).toBeTruthy();
    expect(parent.link_hash).not.toBe(data.parentKey);
  });

  it('gives a second kid with the same name a different username', async () => {
    await register();
    const { data } = await register({ parentEmail: 'other@example.com' });
    expect(data.kids[0].username).toBe('aarav-k-qvms-2');
  });

  it('requires consent', async () => {
    const { response, data } = await register({ consent: false });
    expect(response.status).toBe(400);
    expect(data.error).toBe('Parent consent is required');
  });

  it('rejects a PIN that is not 4-6 digits', async () => {
    const { response } = await register({ kids: [{ firstName: 'A', lastInitial: 'B', grade: '6', pin: '12a4' }] });
    expect(response.status).toBe(400);
  });

  it('rejects an unknown school and an empty kid list', async () => {
    expect((await register({ school: 'XYZ' })).response.status).toBe(400);
    expect((await register({ kids: [] })).response.status).toBe(400);
  });
});

describe('parent link', () => {
  it('shows the parent their kids', async () => {
    const { data } = await register();
    const response = await getParent({ request: jsonRequest('GET', undefined, withKey(data.parentKey)), env });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.parent).toEqual({ name: 'Priya K', school: 'QVMS' });
    expect(body.kids[0]).toMatchObject({ displayName: 'Aarav K', username: 'aarav-k-qvms', grade: '7', attempts: [] });
  });

  it('rejects a wrong key', async () => {
    const response = await getParent({ request: jsonRequest('GET', undefined, withKey('nope')), env });
    expect(response.status).toBe(401);
  });

  it('adds another kid', async () => {
    const { data } = await register();
    const response = await addKid({
      request: jsonRequest('POST', { firstName: 'Diya', lastInitial: 'K', grade: '6', pin: '1234' }, withKey(data.parentKey)),
      env,
    });
    expect(response.status).toBe(201);
    expect((await response.json()).username).toBe('diya-k-qvms');
  });

  it('rotating the link cancels the old one', async () => {
    const { data } = await register();
    const rotated = await rotateLink({ request: jsonRequest('POST', {}, withKey(data.parentKey)), env });
    const { parentKey } = await rotated.json();
    expect((await getParent({ request: jsonRequest('GET', undefined, withKey(data.parentKey)), env })).status).toBe(401);
    expect((await getParent({ request: jsonRequest('GET', undefined, withKey(parentKey)), env })).status).toBe(200);
  });

  it('resets a PIN so the kid can sign in with the new one', async () => {
    const { data } = await register();
    const kidId = data.kids[0].id;
    const response = await resetPin({
      request: jsonRequest('POST', { pin: '9999' }, withKey(data.parentKey)), env, params: { id: String(kidId) },
    });
    expect(response.status).toBe(204);
    expect((await loginKid('aarav-k-qvms', '9999')).response.status).toBe(200);
  });

  it("won't reset another parent's kid", async () => {
    const first = await register();
    const second = await register({ parentEmail: 'other@example.com' });
    const response = await resetPin({
      request: jsonRequest('POST', { pin: '9999' }, withKey(second.data.parentKey)),
      env,
      params: { id: String(first.data.kids[0].id) },
    });
    expect(response.status).toBe(404);
  });
});

describe('POST /api/admin/tests/parents/:id/link', () => {
  it('requires the admin cookie', async () => {
    const response = await reissueLink({ request: jsonRequest('POST', {}), env, params: { id: '1' } });
    expect(response.status).toBe(401);
  });

  it('issues a new parent link', async () => {
    const { data } = await register();
    const parent = await env.DB.prepare('SELECT id FROM parents').first();
    const response = await reissueLink({ request: jsonRequest('POST', {}, { Cookie: await adminCookie() }), env, params: { id: String(parent.id) } });
    const { parentKey } = await response.json();
    expect((await getParent({ request: jsonRequest('GET', undefined, withKey(data.parentKey)), env })).status).toBe(401);
    expect((await getParent({ request: jsonRequest('GET', undefined, withKey(parentKey)), env })).status).toBe(200);
  });
});
