import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestPost as login } from '../../functions/api/admin/login.js';
import { onRequestPost as createClassRequest } from '../../functions/api/classes.js';
import { onRequestPost as addVolunteer } from '../../functions/api/classes/[id]/volunteers.js';
import { onRequestPost as addStudent } from '../../functions/api/classes/[id]/students.js';
import { onRequestDelete as hardDeleteClass } from '../../functions/api/admin/classes/[id].js';
import { onRequestDelete as hardDeleteVolunteer } from '../../functions/api/admin/volunteer-signups/[id].js';
import { onRequestDelete as hardDeleteStudent } from '../../functions/api/admin/student-signups/[id].js';
import { getClassById, getVolunteerSignup, getStudentSignup } from '../../functions/api/_lib/db.js';

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

async function createFixtureClass() {
  const response = await createClassRequest({
    request: new Request('https://example.com/api/classes', {
      method: 'POST',
      body: JSON.stringify({ title: 'Scrambler', date: '2026-10-07', startTime: '09:00' }),
    }),
    env,
  });
  return response.json();
}

describe('DELETE /api/admin/classes/:id', () => {
  it('rejects an unauthenticated request', async () => {
    const cls = await createFixtureClass();
    const response = await hardDeleteClass({
      request: new Request('https://example.com'),
      env,
      params: { id: String(cls.id) },
    });
    expect(response.status).toBe(401);
  });

  it('permanently deletes the class', async () => {
    const cls = await createFixtureClass();
    const cookie = await adminCookie();

    const response = await hardDeleteClass({
      request: new Request('https://example.com', { headers: { Cookie: cookie } }),
      env,
      params: { id: String(cls.id) },
    });

    expect(response.status).toBe(204);
    expect(await getClassById(env.DB, cls.id)).toBeNull();
  });
});

describe('DELETE /api/admin/volunteer-signups/:id', () => {
  it('permanently deletes a volunteer signup', async () => {
    const cls = await createFixtureClass();
    const signup = await (
      await addVolunteer({
        request: new Request('https://example.com', {
          method: 'POST',
          body: JSON.stringify({ name: 'Priya', email: 'priya@example.com' }),
        }),
        env,
        params: { id: String(cls.id) },
      })
    ).json();
    const cookie = await adminCookie();

    const response = await hardDeleteVolunteer({
      request: new Request('https://example.com', { headers: { Cookie: cookie } }),
      env,
      params: { id: String(signup.id) },
    });

    expect(response.status).toBe(204);
    expect(await getVolunteerSignup(env.DB, signup.id)).toBeNull();
  });
});

describe('DELETE /api/admin/student-signups/:id', () => {
  it('permanently deletes a student signup', async () => {
    const cls = await createFixtureClass();
    const signup = await (
      await addStudent({
        request: new Request('https://example.com', {
          method: 'POST',
          body: JSON.stringify({ studentName: 'Jamie', parentName: 'Lee', parentEmail: 'lee@example.com' }),
        }),
        env,
        params: { id: String(cls.id) },
      })
    ).json();
    const cookie = await adminCookie();

    const response = await hardDeleteStudent({
      request: new Request('https://example.com', { headers: { Cookie: cookie } }),
      env,
      params: { id: String(signup.id) },
    });

    expect(response.status).toBe(204);
    expect(await getStudentSignup(env.DB, signup.id)).toBeNull();
  });
});
