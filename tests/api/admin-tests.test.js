import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { jsonRequest, adminCookie, uploadTest, register, SAMPLE_INFO } from './helpers-tests.js';
import { onRequestGet as listTests, onRequestPost as createTest } from '../../functions/api/admin/tests.js';
import { onRequestPut as updateTest, onRequestDelete as deleteTest } from '../../functions/api/admin/tests/[id].js';
import { onRequestPost as startSession } from '../../functions/api/admin/tests/[id]/sessions.js';
import { onRequestPost as endSession } from '../../functions/api/admin/test-sessions/[code]/end.js';

describe('staff test endpoints require the admin cookie', () => {
  it('rejects every endpoint without it', async () => {
    const req = () => jsonRequest('POST', {});
    expect((await listTests({ request: jsonRequest('GET'), env })).status).toBe(401);
    expect((await createTest({ request: req(), env })).status).toBe(401);
    expect((await updateTest({ request: jsonRequest('PUT', {}), env, params: { id: '1' } })).status).toBe(401);
    expect((await deleteTest({ request: jsonRequest('DELETE'), env, params: { id: '1' } })).status).toBe(401);
    expect((await startSession({ request: req(), env, params: { id: '1' } })).status).toBe(401);
    expect((await endSession({ request: req(), env, params: { code: 'ABCDEF' } })).status).toBe(401);
  });
});

describe('POST /api/admin/tests', () => {
  it('stores a valid test with its questions in order', async () => {
    const { response, data } = await uploadTest(await adminCookie());
    expect(response.status).toBe(201);
    expect(data).toEqual({ id: expect.any(Number), questionCount: 5 });
    const { results } = await env.DB.prepare('SELECT position, type, answer FROM test_questions WHERE test_id = ? ORDER BY position').bind(data.id).all();
    expect(results.map((q) => q.type)).toEqual(['Multiple choice', 'Pick all that apply', 'Number', 'Short answer', 'Written answer']);
    expect(results[1].answer).toBe('A,B,D');
  });

  it('returns the errors and stores nothing for an invalid test', async () => {
    const { response, data } = await uploadTest(await adminCookie(), { Title: '' });
    expect(response.status).toBe(400);
    expect(data.errors).toContain('Test info: Title is required');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM tests').first()).n).toBe(0);
  });

  it('checks without storing on a dry run', async () => {
    const { response, data } = await uploadTest(await adminCookie(), {}, '?dryRun=1');
    expect(response.status).toBe(200);
    expect(data).toEqual({ errors: [], questionCount: 5 });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM tests').first()).n).toBe(0);
  });
});

describe('managing tests', () => {
  it('lists tests with counts', async () => {
    const cookie = await adminCookie();
    await uploadTest(cookie);
    const response = await listTests({ request: jsonRequest('GET', undefined, { Cookie: cookie }), env });
    expect(await response.json()).toEqual([
      expect.objectContaining({ title: SAMPLE_INFO.Title, event: 'Heredity', school: 'QVMS', format: 'Quiz', published: 1, sessionOnly: 0, questionCount: 5, attemptCount: 0 }),
    ]);
  });

  it('updates published and session-only flags', async () => {
    const cookie = await adminCookie();
    const { data } = await uploadTest(cookie);
    const response = await updateTest({ request: jsonRequest('PUT', { sessionOnly: true, published: false }, { Cookie: cookie }), env, params: { id: String(data.id) } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ published: 0, session_only: 1 });
  });

  it('deletes a test with no attempts, but not one with attempts', async () => {
    const cookie = await adminCookie();
    const a = await uploadTest(cookie);
    expect((await deleteTest({ request: jsonRequest('DELETE', undefined, { Cookie: cookie }), env, params: { id: String(a.data.id) } })).status).toBe(204);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM test_questions').first()).n).toBe(0);

    const b = await uploadTest(cookie);
    const kidId = (await register()).data.kids[0].id;
    await env.DB.prepare("INSERT INTO attempts (test_id, kid_id, started_at) VALUES (?, ?, datetime('now'))").bind(b.data.id, kidId).run();
    expect((await deleteTest({ request: jsonRequest('DELETE', undefined, { Cookie: cookie }), env, params: { id: String(b.data.id) } })).status).toBe(409);
  });
});

describe('session codes', () => {
  it('starts a session with a 6-character code and ends it', async () => {
    const cookie = await adminCookie();
    const { data } = await uploadTest(cookie);
    const response = await startSession({ request: jsonRequest('POST', {}, { Cookie: cookie }), env, params: { id: String(data.id) } });
    expect(response.status).toBe(201);
    const session = await response.json();
    expect(session.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now() + 2.9 * 3600_000);

    const ended = await endSession({ request: jsonRequest('POST', {}, { Cookie: cookie }), env, params: { code: session.code } });
    expect(ended.status).toBe(200);
    const row = await env.DB.prepare('SELECT ended_at FROM test_sessions WHERE code = ?').bind(session.code).first();
    expect(row.ended_at).toBeTruthy();
  });

  it('404s for an unknown test or code', async () => {
    const cookie = await adminCookie();
    expect((await startSession({ request: jsonRequest('POST', {}, { Cookie: cookie }), env, params: { id: '999' } })).status).toBe(404);
    expect((await endSession({ request: jsonRequest('POST', {}, { Cookie: cookie }), env, params: { code: 'ZZZZZZ' } })).status).toBe(404);
  });
});
