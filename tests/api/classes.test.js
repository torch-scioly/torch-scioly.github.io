import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet, onRequestPost } from '../../functions/api/classes.js';
import { listVolunteerSignups } from '../../functions/api/_lib/db.js';
import { listAuditLog } from '../../functions/api/_lib/audit.js';

function jsonRequest(body) {
  return new Request('https://example.com/api/classes', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('GET /api/classes', () => {
  it('returns an empty list when there are no classes', async () => {
    const response = await onRequestGet({ env });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});

describe('POST /api/classes', () => {
  it('creates a class and logs it in the audit log', async () => {
    const response = await onRequestPost({
      request: jsonRequest({
        title: 'Genetics',
        description: 'Intro to heredity',
        date: '2026-10-01',
        startTime: '16:00',
        endTime: '17:00',
      }),
      env,
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.title).toBe('Genetics');
    expect(body.status).toBe('upcoming');

    const list = await (await onRequestGet({ env })).json();
    expect(list).toHaveLength(1);

    const log = await listAuditLog(env.DB);
    expect(log).toHaveLength(1);
    expect(log[0].entity_type).toBe('class');
    expect(log[0].action).toBe('created');
  });

  it('rejects a class missing required fields', async () => {
    const response = await onRequestPost({ request: jsonRequest({ title: 'Missing date' }), env });
    expect(response.status).toBe(400);
  });

  it('rejects a startTime that is not on a 15-minute mark', async () => {
    const response = await onRequestPost({
      request: jsonRequest({ title: 'Off-grid', date: '2026-10-01', startTime: '16:07' }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('always sets a one-hour window, ignoring any client-supplied endTime', async () => {
    const response = await onRequestPost({
      request: jsonRequest({ title: 'Genetics', date: '2026-10-01', startTime: '16:00', endTime: '23:59' }),
      env,
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.end_time).toBe('17:00');
  });

  it('includes volunteer names for each class in the list response', async () => {
    await onRequestPost({
      request: jsonRequest({
        title: 'Astronomy',
        date: '2026-10-09',
        startTime: '15:00',
        signUpAsVolunteer: true,
        volunteerName: 'Priya',
        volunteerEmail: 'priya@example.com',
      }),
      env,
    });

    const list = await (await onRequestGet({ env })).json();
    const found = list.find((c) => c.title === 'Astronomy');
    expect(found.volunteers).toEqual([{ id: expect.any(Number), name: 'Priya' }]);
  });

  it('signs the creator up as a volunteer when requested', async () => {
    const response = await onRequestPost({
      request: jsonRequest({
        title: 'Astronomy',
        date: '2026-10-02',
        startTime: '15:00',
        signUpAsVolunteer: true,
        volunteerName: 'Priya',
        volunteerEmail: 'priya@example.com',
      }),
      env,
    });

    const created = await response.json();
    const volunteers = await listVolunteerSignups(env.DB, created.id);
    expect(volunteers).toHaveLength(1);
    expect(volunteers[0].name).toBe('Priya');

    const log = await listAuditLog(env.DB);
    expect(log.some((entry) => entry.entity_type === 'volunteer_signup')).toBe(true);
  });
});
