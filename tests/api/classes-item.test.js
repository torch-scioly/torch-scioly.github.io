import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as createClassRequest } from '../../functions/api/classes.js';
import { onRequestGet, onRequestPut, onRequestDelete } from '../../functions/api/classes/[id].js';
import { listAuditLog } from '../../functions/api/_lib/audit.js';
import {
  addVolunteerSignup,
  addStudentSignup,
  listVolunteerSignups,
  listStudentSignups,
} from '../../functions/api/_lib/db.js';

async function createFixtureClass(overrides = {}) {
  const response = await createClassRequest({
    request: new Request('https://example.com/api/classes', {
      method: 'POST',
      body: JSON.stringify({ title: 'Genetics', date: '2026-10-01', startTime: '16:00', ...overrides }),
    }),
    env,
  });
  return response.json();
}

describe('GET /api/classes/:id', () => {
  it('returns 404 for a missing class', async () => {
    const response = await onRequestGet({ env, params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('returns the class with empty rosters', async () => {
    const cls = await createFixtureClass();
    const response = await onRequestGet({ env, params: { id: String(cls.id) } });
    const body = await response.json();

    expect(body.title).toBe('Genetics');
    expect(body.volunteers).toEqual([]);
    expect(body.students).toEqual([]);
  });
});

describe('PUT /api/classes/:id', () => {
  it('updates the given fields and logs an edit', async () => {
    const cls = await createFixtureClass();

    const response = await onRequestPut({
      request: new Request('https://example.com', {
        method: 'PUT',
        body: JSON.stringify({ zoom_link: 'https://zoom.us/j/123', zoom_notes: 'Passcode: 4242' }),
      }),
      env,
      params: { id: String(cls.id) },
    });

    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated.zoom_link).toBe('https://zoom.us/j/123');

    const log = await listAuditLog(env.DB);
    expect(log.some((entry) => entry.action === 'edited')).toBe(true);
  });

  it('returns 404 for a missing class', async () => {
    const response = await onRequestPut({
      request: new Request('https://example.com', { method: 'PUT', body: JSON.stringify({ title: 'x' }) }),
      env,
      params: { id: '999999' },
    });
    expect(response.status).toBe(404);
  });

  it('re-derives end_time as one hour after a changed startTime', async () => {
    const cls = await createFixtureClass();

    const response = await onRequestPut({
      request: new Request('https://example.com', { method: 'PUT', body: JSON.stringify({ startTime: '18:30' }) }),
      env,
      params: { id: String(cls.id) },
    });

    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated.start_time).toBe('18:30');
    expect(updated.end_time).toBe('19:30');
  });

  it('rejects a startTime that is not on a 15-minute mark', async () => {
    const cls = await createFixtureClass();

    const response = await onRequestPut({
      request: new Request('https://example.com', { method: 'PUT', body: JSON.stringify({ startTime: '18:07' }) }),
      env,
      params: { id: String(cls.id) },
    });

    expect(response.status).toBe(400);
  });
});

describe('PUT /api/classes/:id — date changes', () => {
  function put(cls, body) {
    return onRequestPut({
      request: new Request('https://example.com', { method: 'PUT', body: JSON.stringify(body) }),
      env,
      params: { id: String(cls.id) },
    });
  }

  async function classesTitled(title) {
    const { results } = await env.DB.prepare('SELECT * FROM classes WHERE title = ? ORDER BY date').bind(title).all();
    return results;
  }

  it('requires dateChange when the date changes', async () => {
    const cls = await createFixtureClass({ title: 'Needs Choice', date: '2020-03-01' });

    const response = await put(cls, { date: '2999-03-08' });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/dateChange/);
  });

  it('rejects an unknown dateChange value', async () => {
    const cls = await createFixtureClass({ title: 'Bad Choice', date: '2020-03-01' });

    const response = await put(cls, { date: '2999-03-08', dateChange: 'maybe' });

    expect(response.status).toBe(400);
  });

  it('does not require dateChange when the date is sent unchanged', async () => {
    const cls = await createFixtureClass({ title: 'Same Date', date: '2020-03-01' });

    const response = await put(cls, { date: '2020-03-01', title: 'Same Date' });

    expect(response.status).toBe(200);
  });

  it('reschedule moves the class without keeping the old date', async () => {
    const cls = await createFixtureClass({ title: 'Moved', date: '2020-03-01' });

    const response = await put(cls, { date: '2999-03-08', dateChange: 'reschedule' });

    expect(response.status).toBe(200);
    const rows = await classesTitled('Moved');
    expect(rows.map((r) => r.date)).toEqual(['2999-03-08']);
  });

  it('next_session keeps the held session as a past class with its rosters, then moves the class', async () => {
    const cls = await createFixtureClass({ title: 'Weekly Rocks', date: '2020-03-01', startTime: '10:00' });
    await addVolunteerSignup(env.DB, cls.id, { name: 'Vibha', email: 'vibha@example.com' });
    await addStudentSignup(env.DB, cls.id, { studentName: 'Kid', parentName: 'P', parentEmail: 'p@example.com' });

    const response = await put(cls, { date: '2999-03-08', dateChange: 'next_session' });

    expect(response.status).toBe(200);
    expect((await response.json()).date).toBe('2999-03-08');

    const rows = await classesTitled('Weekly Rocks');
    expect(rows.map((r) => r.date)).toEqual(['2020-03-01', '2999-03-08']);
    const held = rows[0];
    expect(held.id).not.toBe(cls.id);
    expect(held.start_time).toBe('10:00');
    expect(held.status).not.toBe('cancelled');
    expect((await listVolunteerSignups(env.DB, held.id)).map((v) => v.email)).toEqual(['vibha@example.com']);
    expect(await listStudentSignups(env.DB, held.id)).toHaveLength(1);
    // The moving class keeps its own rosters.
    expect(await listVolunteerSignups(env.DB, cls.id)).toHaveLength(1);

    const log = await listAuditLog(env.DB);
    expect(log.some((e) => e.class_id === held.id && e.action === 'created')).toBe(true);
  });

  it('next_session is rejected when the current session has not happened yet', async () => {
    const cls = await createFixtureClass({ title: 'Future One', date: '2999-01-01' });

    const response = await put(cls, { date: '2999-01-08', dateChange: 'next_session' });

    expect(response.status).toBe(400);
    expect(await classesTitled('Future One')).toHaveLength(1);
  });
});

describe('DELETE /api/classes/:id', () => {
  it('soft-cancels the class', async () => {
    const cls = await createFixtureClass();

    const response = await onRequestDelete({ env, params: { id: String(cls.id) } });
    expect(response.status).toBe(200);
    const cancelled = await response.json();
    expect(cancelled.status).toBe('cancelled');

    const stillThere = await onRequestGet({ env, params: { id: String(cls.id) } });
    expect(stillThere.status).toBe(200);
  });
});

describe('PUT /api/classes/:id — in person', () => {
  it('switches a class between in person and online', async () => {
    const cls = await createFixtureClass({ title: 'Toggle' });
    const put = (body) => onRequestPut({
      request: new Request('https://example.com', { method: 'PUT', body: JSON.stringify(body) }),
      env,
      params: { id: String(cls.id) },
    });

    expect((await (await put({ in_person: true })).json()).in_person).toBe(1);
    expect((await (await put({ in_person: false })).json()).in_person).toBe(0);
  });
});
