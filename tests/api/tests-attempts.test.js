import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { jsonRequest, register, loginKid, adminCookie, uploadTest } from './helpers-tests.js';
import { onRequestGet as listTests } from '../../functions/api/tests/index.js';
import { onRequestPost as startAttempt } from '../../functions/api/tests/[id]/attempts.js';
import { onRequestPost as joinWithCode } from '../../functions/api/tests/join.js';
import { onRequestGet as getAttempt } from '../../functions/api/tests/attempts/[id].js';
import { onRequestPut as saveAnswer } from '../../functions/api/tests/attempts/[id]/answers.js';
import { onRequestPost as submit } from '../../functions/api/tests/attempts/[id]/submit.js';
import { onRequestPut as updateTest } from '../../functions/api/admin/tests/[id].js';
import { onRequestPost as startSession } from '../../functions/api/admin/tests/[id]/sessions.js';
import { onRequestPost as endSession } from '../../functions/api/admin/test-sessions/[code]/end.js';

const aiEnv = (response = '{"points": 2, "feedback": "Good start, add an example."}') => ({
  ...env,
  AI: { run: async () => ({ response }) },
});

async function setup() {
  const cookie = await adminCookie();
  const test = (await uploadTest(cookie)).data;
  const reg = await register();
  const login = await loginKid('aarav-k-qvms');
  return { cookie, testId: test.id, token: login.data.token, kidId: login.data.kid.id, parentKey: reg.data.parentKey };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function start(token, testId) {
  const response = await startAttempt({ request: jsonRequest('POST', {}, auth(token)), env, params: { id: String(testId) } });
  return { response, data: await response.json() };
}

async function view(headers, attemptId) {
  const response = await getAttempt({ request: jsonRequest('GET', undefined, headers), env, params: { id: String(attemptId) } });
  return { response, data: response.status === 200 ? await response.json() : null };
}

async function answerAll(token, attemptId) {
  const { data } = await view(auth(token), attemptId);
  const byPosition = Object.fromEntries(data.questions.map((q) => [q.position, q.id]));
  const answers = { 1: 'B', 2: 'A,B', 3: '300', 4: 'gregor mendel', 5: 'Genotype is the alleles, phenotype is the trait.' };
  for (const [position, response] of Object.entries(answers)) {
    const r = await saveAnswer({ request: jsonRequest('PUT', { questionId: byPosition[position], response }, auth(token)), env, params: { id: String(attemptId) } });
    expect(r.status).toBe(204);
  }
  return byPosition;
}

async function submitAttempt(token, attemptId, e = aiEnv()) {
  const response = await submit({ request: jsonRequest('POST', {}, auth(token)), env: e, params: { id: String(attemptId) } });
  return { response, data: await response.json() };
}

describe('GET /api/tests', () => {
  it('needs a signed-in kid', async () => {
    expect((await listTests({ request: jsonRequest('GET'), env })).status).toBe(401);
  });

  it('lists published tests for the kid’s school but not session-only ones', async () => {
    const { cookie, testId, token } = await setup();
    const second = (await uploadTest(cookie, { Title: 'Tournament' })).data;
    await updateTest({ request: jsonRequest('PUT', { sessionOnly: true }, { Cookie: cookie }), env, params: { id: String(second.id) } });
    await uploadTest(cookie, { Title: 'SBE quiz', School: 'SBE' });
    const response = await listTests({ request: jsonRequest('GET', undefined, auth(token)), env });
    const list = await response.json();
    expect(list.map((t) => t.id)).toEqual([testId]);
    expect(list[0]).toMatchObject({ title: 'Heredity Quiz 1', event: 'Heredity', format: 'Quiz', timeLimitMin: 20, questionCount: 5, attempts: 0 });
  });
});

describe('taking a test', () => {
  it('hides answer keys while in progress', async () => {
    const { testId, token } = await setup();
    const { response, data } = await start(token, testId);
    expect(response.status).toBe(201);
    const { data: attempt } = await view(auth(token), data.attemptId);
    expect(attempt.status).toBe('in_progress');
    expect(attempt.questions).toHaveLength(5);
    expect(attempt.deadlineAt).toMatch(/Z$/);
    const json = JSON.stringify(attempt);
    expect(json).not.toContain('"answer"');
    expect(json).not.toContain('"explanation"');
    expect(json).not.toContain('Gregor Mendel');
  });

  it('gives back saved answers after a reload', async () => {
    const { testId, token } = await setup();
    const { data } = await start(token, testId);
    const byPosition = await answerAll(token, data.attemptId);
    const { data: again } = await view(auth(token), data.attemptId);
    expect(again.responses[byPosition[1]]).toBe('B');
    expect(again.responses[byPosition[4]]).toBe('gregor mendel');
  });

  it('returns the same unfinished attempt when the kid starts again', async () => {
    const { testId, token } = await setup();
    const first = await start(token, testId);
    const second = await start(token, testId);
    expect(second.response.status).toBe(200);
    expect(second.data.attemptId).toBe(first.data.attemptId);
  });

  it('refuses answers saved after the deadline plus 60 seconds', async () => {
    const { testId, token } = await setup();
    const { data } = await start(token, testId);
    const { data: attempt } = await view(auth(token), data.attemptId);
    await env.DB.prepare("UPDATE attempts SET deadline_at = datetime('now', '-2 minutes') WHERE id = ?").bind(data.attemptId).run();
    const r = await saveAnswer({ request: jsonRequest('PUT', { questionId: attempt.questions[0].id, response: 'B' }, auth(token)), env, params: { id: String(data.attemptId) } });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('Time is up');
  });

  it('accepts answers within the 60 second grace', async () => {
    const { testId, token } = await setup();
    const { data } = await start(token, testId);
    const { data: attempt } = await view(auth(token), data.attemptId);
    await env.DB.prepare("UPDATE attempts SET deadline_at = datetime('now', '-30 seconds') WHERE id = ?").bind(data.attemptId).run();
    const r = await saveAnswer({ request: jsonRequest('PUT', { questionId: attempt.questions[0].id, response: 'B' }, auth(token)), env, params: { id: String(data.attemptId) } });
    expect(r.status).toBe(204);
  });

  it('won’t start a session-only test without a code', async () => {
    const { cookie, testId, token } = await setup();
    await updateTest({ request: jsonRequest('PUT', { sessionOnly: true }, { Cookie: cookie }), env, params: { id: String(testId) } });
    expect((await start(token, testId)).response.status).toBe(404);
  });
});

describe('submitting and reviewing', () => {
  it('grades every question type and marks the first attempt', async () => {
    const { testId, token } = await setup();
    const { data } = await start(token, testId);
    await answerAll(token, data.attemptId);
    const { response, data: result } = await submitAttempt(token, data.attemptId);
    expect(response.status).toBe(200);
    // 1 (MC) + 1 of 2 (pick A,B of A,B,D: 2 right of 3) ≈ 1.33 + 1 (number) + 1 (short) + 2 (AI) = 6.33 of 8
    expect(result.status).toBe('reviewed');
    expect(result.score).toBeCloseTo(6.33, 1);
    expect(result.maxScore).toBe(8);
    const row = await env.DB.prepare('SELECT is_first FROM attempts WHERE id = ?').bind(data.attemptId).first();
    expect(row.is_first).toBe(1);
  });

  it('marks a later attempt as not first', async () => {
    const { testId, token } = await setup();
    const a = (await start(token, testId)).data.attemptId;
    await submitAttempt(token, a);
    const b = (await start(token, testId)).data.attemptId;
    expect(b).not.toBe(a);
    await submitAttempt(token, b);
    expect((await env.DB.prepare('SELECT is_first FROM attempts WHERE id = ?').bind(b).first()).is_first).toBe(0);
  });

  it('shows the full review with keys, feedback and study links', async () => {
    const { testId, token } = await setup();
    const { data } = await start(token, testId);
    await answerAll(token, data.attemptId);
    await submitAttempt(token, data.attemptId);
    const { data: review } = await view(auth(token), data.attemptId);
    expect(review.status).toBe('reviewed');
    const pick = review.questions.find((q) => q.position === 2);
    expect(pick).toMatchObject({ response: 'A,B', answer: 'A,B,D', status: 'partial', maxPoints: 2, topic: 'Meiosis', gradedBy: 'auto' });
    const written = review.questions.find((q) => q.position === 5);
    expect(written).toMatchObject({ gradedBy: 'ai', feedback: 'Good start, add an example.', status: 'partial' });
    expect(review.questions.find((q) => q.position === 1).explanation).toBe('tt only');
    expect(review.progress).toEqual([{ submittedAt: expect.stringMatching(/Z$/), percent: expect.any(Number) }]);
    const topics = review.studyNext.map((s) => s.topic);
    expect(topics).toEqual(expect.arrayContaining(['Meiosis', 'Vocabulary']));
    expect(topics).not.toContain('History of genetics');
    expect(review.studyNext[0].links[0]).toEqual({ title: expect.any(String), url: expect.stringMatching(/^https:\/\//) });
  });

  it('leaves a written answer for a volunteer when the AI reply is unusable', async () => {
    const { testId, token } = await setup();
    const { data } = await start(token, testId);
    await answerAll(token, data.attemptId);
    await submitAttempt(token, data.attemptId, aiEnv('Looks fine to me'));
    const { data: review } = await view(auth(token), data.attemptId);
    expect(review.questions.find((q) => q.position === 5)).toMatchObject({ status: 'needs_volunteer', points: null });
  });

  it('won’t submit twice', async () => {
    const { testId, token } = await setup();
    const { data } = await start(token, testId);
    await submitAttempt(token, data.attemptId);
    expect((await submitAttempt(token, data.attemptId)).response.status).toBe(409);
  });
});

describe('who can see an attempt', () => {
  it('lets the parent read their kid’s review but not other parents', async () => {
    const { testId, token, parentKey } = await setup();
    const { data } = await start(token, testId);
    await submitAttempt(token, data.attemptId);
    expect((await view({ 'X-Parent-Key': parentKey }, data.attemptId)).data.status).toBe('reviewed');
    const other = await register({ parentEmail: 'other@example.com' });
    expect((await view({ 'X-Parent-Key': other.data.parentKey }, data.attemptId)).response.status).toBe(404);
  });

  it('hides one kid’s attempt from another kid', async () => {
    const { testId, token } = await setup();
    const { data } = await start(token, testId);
    await register({ parentEmail: 'b@example.com', kids: [{ firstName: 'Diya', lastInitial: 'S', grade: '6', pin: '1111' }] });
    const other = await loginKid('diya-s-qvms', '1111');
    expect((await view(auth(other.data.token), data.attemptId)).response.status).toBe(404);
  });
});

describe('in-session tests', () => {
  it('joins with a code and keeps the review locked until the session ends', async () => {
    const { cookie, testId, token } = await setup();
    await updateTest({ request: jsonRequest('PUT', { sessionOnly: true }, { Cookie: cookie }), env, params: { id: String(testId) } });
    const session = await (await startSession({ request: jsonRequest('POST', {}, { Cookie: cookie }), env, params: { id: String(testId) } })).json();
    const joined = await joinWithCode({ request: jsonRequest('POST', { code: session.code.toLowerCase() }, auth(token)), env });
    expect(joined.status).toBe(201);
    const { attemptId } = await joined.json();
    await submitAttempt(token, attemptId);

    const locked = await view(auth(token), attemptId);
    expect(locked.data).toEqual({ status: 'waiting_for_session', score: null });

    await endSession({ request: jsonRequest('POST', {}, { Cookie: cookie }), env, params: { code: session.code } });
    expect((await view(auth(token), attemptId)).data.status).toBe('reviewed');
  });

  it('rejects a wrong or ended code', async () => {
    const { cookie, testId, token } = await setup();
    const bad = await joinWithCode({ request: jsonRequest('POST', { code: 'ZZZZZZ' }, auth(token)), env });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('That code isn’t valid');
    const session = await (await startSession({ request: jsonRequest('POST', {}, { Cookie: cookie }), env, params: { id: String(testId) } })).json();
    await endSession({ request: jsonRequest('POST', {}, { Cookie: cookie }), env, params: { code: session.code } });
    expect((await joinWithCode({ request: jsonRequest('POST', { code: session.code }, auth(token)), env })).status).toBe(400);
  });
});
