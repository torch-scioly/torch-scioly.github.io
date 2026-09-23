import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as createClassRequest } from '../../functions/api/classes.js';
import { onRequestGet, onRequestPut, onRequestDelete } from '../../functions/api/classes/[id].js';
import { listAuditLog } from '../../functions/api/_lib/audit.js';

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
