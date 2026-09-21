import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as createClassRequest } from '../../functions/api/classes.js';
import { onRequestPost as addStudent } from '../../functions/api/classes/[id]/students.js';
import { onRequestDelete as removeStudent } from '../../functions/api/classes/[id]/students/[signupId].js';
import { listStudentSignups } from '../../functions/api/_lib/db.js';
import { listAuditLog } from '../../functions/api/_lib/audit.js';

async function createFixtureClass() {
  const response = await createClassRequest({
    request: new Request('https://example.com/api/classes', {
      method: 'POST',
      body: JSON.stringify({ title: 'Code Busters', date: '2026-10-06', startTime: '11:00' }),
    }),
    env,
  });
  return response.json();
}

describe('POST /api/classes/:id/students', () => {
  it('adds a student signup', async () => {
    const cls = await createFixtureClass();

    const response = await addStudent({
      request: new Request('https://example.com', {
        method: 'POST',
        body: JSON.stringify({ studentName: 'Jamie', grade: '5', parentName: 'Lee', parentEmail: 'lee@example.com' }),
      }),
      env,
      params: { id: String(cls.id) },
    });

    expect(response.status).toBe(201);
    expect(await listStudentSignups(env.DB, cls.id)).toHaveLength(1);
  });

  it('rejects a signup missing required fields', async () => {
    const cls = await createFixtureClass();

    const response = await addStudent({
      request: new Request('https://example.com', {
        method: 'POST',
        body: JSON.stringify({ studentName: 'Jamie' }),
      }),
      env,
      params: { id: String(cls.id) },
    });

    expect(response.status).toBe(400);
  });

  it('returns 404 for a missing class', async () => {
    const response = await addStudent({
      request: new Request('https://example.com', {
        method: 'POST',
        body: JSON.stringify({ studentName: 'Jamie', parentName: 'Lee', parentEmail: 'lee@example.com' }),
      }),
      env,
      params: { id: '999999' },
    });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/classes/:id/students/:signupId', () => {
  it('removes the signup and logs it', async () => {
    const cls = await createFixtureClass();
    const created = await (
      await addStudent({
        request: new Request('https://example.com', {
          method: 'POST',
          body: JSON.stringify({ studentName: 'Jamie', parentName: 'Lee', parentEmail: 'lee@example.com' }),
        }),
        env,
        params: { id: String(cls.id) },
      })
    ).json();

    const response = await removeStudent({ env, params: { id: String(cls.id), signupId: String(created.id) } });

    expect(response.status).toBe(204);
    expect(await listStudentSignups(env.DB, cls.id)).toHaveLength(0);

    const log = await listAuditLog(env.DB);
    expect(log.some((entry) => entry.entity_type === 'student_signup' && entry.action === 'removed')).toBe(true);
  });

  it('returns 404 for a signup that does not belong to the class', async () => {
    const clsA = await createFixtureClass();
    const clsB = await createFixtureClass();
    const created = await (
      await addStudent({
        request: new Request('https://example.com', {
          method: 'POST',
          body: JSON.stringify({ studentName: 'Jamie', parentName: 'Lee', parentEmail: 'lee@example.com' }),
        }),
        env,
        params: { id: String(clsA.id) },
      })
    ).json();

    const response = await removeStudent({ env, params: { id: String(clsB.id), signupId: String(created.id) } });
    expect(response.status).toBe(404);
  });
});
