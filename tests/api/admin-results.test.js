import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { jsonRequest, register, loginKid, adminCookie, uploadTest } from './helpers-tests.js';
import { onRequestPost as startAttempt } from '../../functions/api/tests/[id]/attempts.js';
import { onRequestPost as submit } from '../../functions/api/tests/attempts/[id]/submit.js';
import { onRequestPut as saveAnswer } from '../../functions/api/tests/attempts/[id]/answers.js';
import { onRequestGet as getAttempt } from '../../functions/api/tests/attempts/[id].js';
import { onRequestGet as getResults } from '../../functions/api/admin/tests/[id]/results.js';
import { onRequestPut as override } from '../../functions/api/admin/attempt-answers/[id].js';
import { onRequestGet as listKids } from '../../functions/api/admin/kids.js';

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const badAi = { ...env, AI: { run: async () => ({ response: 'no json here' }) } };

async function takeTest(cookie, testId, token, answers = {}) {
  const attemptId = (await (await startAttempt({ request: jsonRequest('POST', {}, auth(token)), env, params: { id: String(testId) } })).json()).attemptId;
  const view = await (await getAttempt({ request: jsonRequest('GET', undefined, auth(token)), env, params: { id: String(attemptId) } })).json();
  for (const q of view.questions) {
    if (answers[q.position] !== undefined) {
      await saveAnswer({ request: jsonRequest('PUT', { questionId: q.id, response: answers[q.position] }, auth(token)), env, params: { id: String(attemptId) } });
    }
  }
  await submit({ request: jsonRequest('POST', {}, auth(token)), env: badAi, params: { id: String(attemptId) } });
  return attemptId;
}

async function setup() {
  const cookie = await adminCookie();
  const testId = (await uploadTest(cookie)).data.id;
  await register();
  const token = (await loginKid('aarav-k-qvms')).data.token;
  return { cookie, testId, token };
}

async function results(cookie, testId) {
  return (await getResults({ request: jsonRequest('GET', undefined, { Cookie: cookie }), env, params: { id: String(testId) } })).json();
}

describe('staff results', () => {
  it('require the admin cookie', async () => {
    expect((await getResults({ request: jsonRequest('GET'), env, params: { id: '1' } })).status).toBe(401);
    expect((await override({ request: jsonRequest('PUT', { points: 1 }), env, params: { id: '1' } })).status).toBe(401);
    expect((await listKids({ request: new Request('https://example.com/api/admin/kids?school=QVMS'), env })).status).toBe(401);
  });

  it('show each attempt, question stats and answers waiting for a volunteer', async () => {
    const { cookie, testId, token } = await setup();
    await takeTest(cookie, testId, token, { 1: 'B', 5: 'Genotype is alleles' });
    const data = await results(cookie, testId);
    expect(data.test).toMatchObject({ id: testId, title: 'Heredity Quiz 1' });
    expect(data.needsVolunteer).toBe(1);
    expect(data.attempts).toHaveLength(1);
    expect(data.attempts[0]).toMatchObject({ kid: { id: expect.any(Number), displayName: 'Aarav K' }, isFirst: 1, score: 1, maxScore: 8 });
    expect(data.attempts[0].answers.find((a) => a.status === 'needs_volunteer')).toMatchObject({ response: 'Genotype is alleles', points: null });
    expect(data.questionStats.find((s) => s.position === 1).percentCorrect).toBe(100);
    expect(data.questionStats.find((s) => s.position === 2).percentCorrect).toBe(0);
  });
});

describe('PUT /api/admin/attempt-answers/:id', () => {
  it('overrides a score, recomputes the total and shows on the kid’s review', async () => {
    const { cookie, testId, token } = await setup();
    const attemptId = await takeTest(cookie, testId, token, { 1: 'B', 5: 'Genotype is alleles' });
    const pending = (await results(cookie, testId)).attempts[0].answers.find((a) => a.status === 'needs_volunteer');

    const response = await override({ request: jsonRequest('PUT', { points: 3, note: 'Nice' }, { Cookie: cookie }), env, params: { id: String(pending.answerId) } });
    expect(response.status).toBe(200);

    const after = await results(cookie, testId);
    expect(after.needsVolunteer).toBe(0);
    expect(after.attempts[0].score).toBe(4);
    const review = await (await getAttempt({ request: jsonRequest('GET', undefined, auth(token)), env, params: { id: String(attemptId) } })).json();
    expect(review.questions.find((q) => q.position === 5)).toMatchObject({ points: 3, status: 'correct', gradedBy: 'override' });
    expect(review.score).toBe(4);
  });

  it('rejects points above the question’s maximum or below zero', async () => {
    const { cookie, testId, token } = await setup();
    await takeTest(cookie, testId, token, { 5: 'x' });
    const pending = (await results(cookie, testId)).attempts[0].answers.find((a) => a.status === 'needs_volunteer');
    for (const points of [4, -1, 'abc']) {
      const r = await override({ request: jsonRequest('PUT', { points }, { Cookie: cookie }), env, params: { id: String(pending.answerId) } });
      expect(r.status).toBe(400);
    }
  });
});

describe('GET /api/admin/kids', () => {
  it('averages first attempts only, per event', async () => {
    const { cookie, testId, token } = await setup();
    await takeTest(cookie, testId, token, { 1: 'B' }); // 1 of 8 = 12.5%
    await takeTest(cookie, testId, token, { 1: 'B', 3: '300', 4: 'Mendel' }); // retake, ignored
    const kids = await (await listKids({ request: new Request('https://example.com/api/admin/kids?school=QVMS', { headers: { Cookie: cookie } }), env })).json();
    expect(kids).toHaveLength(1);
    expect(kids[0]).toMatchObject({ displayName: 'Aarav K', grade: '7', username: 'aarav-k-qvms', parentId: expect.any(Number) });
    expect(kids[0].events).toEqual([{ event: 'Heredity', firstAttemptAvgPercent: 13, tests: 1 }]);
  });
});
