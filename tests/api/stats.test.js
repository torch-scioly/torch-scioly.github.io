import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { onRequestGet as getStats } from '../../functions/api/stats.js';
import { createClass, updateClass, addVolunteerSignup, addStudentSignup } from '../../functions/api/_lib/db.js';

// Held classes count from 2026-10-03 (COUNTING_START in functions/api/stats.js).
const PAST = '2026-10-05';
const BEFORE_COUNTING_START = '2026-10-02';
const FUTURE = '2999-01-15';

async function fixtureClass(date, startTime = '10:00') {
  return createClass(env.DB, { title: 'Fixture', date, startTime, endTime: '11:00' });
}

async function fetchStats() {
  const response = await getStats({ request: new Request('https://example.com/api/stats'), env });
  expect(response.status).toBe(200);
  return response.json();
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM volunteer_profiles').run();
  await env.DB.prepare('DELETE FROM volunteer_signups').run();
  await env.DB.prepare('DELETE FROM student_signups').run();
  await env.DB.prepare('DELETE FROM classes').run();
});

describe('GET /api/stats — kidsReached', () => {
  it('counts a student once across classes, ignoring case and surrounding spaces', async () => {
    const a = await fixtureClass(PAST);
    const b = await fixtureClass(FUTURE);
    await addStudentSignup(env.DB, a.id, { studentName: 'Maya Rao', parentName: 'P', parentEmail: 'rao@example.com' });
    await addStudentSignup(env.DB, b.id, { studentName: '  maya rao ', parentName: 'P', parentEmail: 'RAO@example.com ' });
    await addStudentSignup(env.DB, b.id, { studentName: 'Arjun Rao', parentName: 'P', parentEmail: 'rao@example.com' });

    const stats = await fetchStats();

    expect(stats.kidsReached).toBe(2);
  });

  it('is zero with no signups', async () => {
    expect((await fetchStats()).kidsReached).toBe(0);
  });
});

describe('GET /api/stats — volunteerHours', () => {
  beforeEach(async () => {
    await env.DB.prepare('INSERT INTO volunteer_profiles (slug, email) VALUES (?, ?), (?, ?)')
      .bind('adhya-kidiyoor', 'adhya@example.com', 'veda-khande', 'veda@example.com')
      .run();
  });

  it('counts one hour per past, non-cancelled class, matching email case-insensitively', async () => {
    const held1 = await fixtureClass(PAST, '10:00');
    const held2 = await fixtureClass(PAST, '12:00');
    const cancelled = await fixtureClass(PAST, '14:00');
    await updateClass(env.DB, cancelled.id, { status: 'cancelled' });
    const upcoming = await fixtureClass(FUTURE);

    await addVolunteerSignup(env.DB, held1.id, { name: 'Adhya', email: 'adhya@example.com' });
    await addVolunteerSignup(env.DB, held2.id, { name: 'Adhya', email: ' ADHYA@example.com' });
    await addVolunteerSignup(env.DB, cancelled.id, { name: 'Adhya', email: 'adhya@example.com' });
    await addVolunteerSignup(env.DB, upcoming.id, { name: 'Adhya', email: 'adhya@example.com' });

    const stats = await fetchStats();

    expect(stats.volunteerHours['adhya-kidiyoor']).toBe(2);
  });

  it('counts a class once even if the volunteer signed up twice for it', async () => {
    const held = await fixtureClass(PAST);
    await addVolunteerSignup(env.DB, held.id, { name: 'Veda', email: 'veda@example.com' });
    await addVolunteerSignup(env.DB, held.id, { name: 'Veda', email: 'veda@example.com' });

    expect((await fetchStats()).volunteerHours['veda-khande']).toBe(1);
  });

  it('adds up hours across every email linked to the same volunteer', async () => {
    await env.DB.prepare('INSERT INTO volunteer_profiles (slug, email) VALUES (?, ?)')
      .bind('adhya-kidiyoor', 'adhya.alt@example.com')
      .run();
    const a = await fixtureClass(PAST, '10:00');
    const b = await fixtureClass(PAST, '12:00');
    await addVolunteerSignup(env.DB, a.id, { name: 'Adhya', email: 'adhya@example.com' });
    await addVolunteerSignup(env.DB, b.id, { name: 'Adhya', email: 'adhya.alt@example.com' });
    await addVolunteerSignup(env.DB, b.id, { name: 'Adhya', email: 'adhya@example.com' });

    expect((await fetchStats()).volunteerHours['adhya-kidiyoor']).toBe(2);
  });

  it('ignores classes held before the counting start date', async () => {
    const early = await fixtureClass(BEFORE_COUNTING_START);
    await addVolunteerSignup(env.DB, early.id, { name: 'Veda', email: 'veda@example.com' });

    expect((await fetchStats()).volunteerHours['veda-khande']).toBe(0);
  });

  it('credits the course instructor for a held class with no volunteers', async () => {
    await createClass(env.DB, { title: 'Anatomy and Physiology', date: PAST, startTime: '14:00', endTime: '15:00' });

    expect((await fetchStats()).volunteerHours['anvitha-gottipati']).toBe(1);
  });

  it('does not credit the course instructor when the class has a volunteer', async () => {
    const cls = await createClass(env.DB, { title: 'Water Quality', date: PAST, startTime: '14:00', endTime: '15:00' });
    await addVolunteerSignup(env.DB, cls.id, { name: 'Adhya', email: 'adhya@example.com' });

    const stats = await fetchStats();

    expect(stats.volunteerHours['veda-khande']).toBe(0);
    expect(stats.volunteerHours['adhya-kidiyoor']).toBe(1);
  });

  it('reports zero hours for a profiled volunteer with no classes', async () => {
    expect((await fetchStats()).volunteerHours['veda-khande']).toBe(0);
  });

  it('exposes no emails or names', async () => {
    const held = await fixtureClass(PAST);
    await addVolunteerSignup(env.DB, held.id, { name: 'Adhya', email: 'adhya@example.com' });
    await addStudentSignup(env.DB, held.id, { studentName: 'Maya', parentName: 'Parent', parentEmail: 'p@example.com' });

    const body = JSON.stringify(await fetchStats());

    expect(body).not.toContain('@');
    expect(body).not.toContain('Maya');
    expect(body).not.toContain('Adhya');
  });
});
