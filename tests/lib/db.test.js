import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import {
  createClass,
  listClasses,
  getClassById,
  updateClass,
  hardDeleteClass,
  addVolunteerSignup,
  listVolunteerSignups,
  getVolunteerSignup,
  removeVolunteerSignup,
  addStudentSignup,
  listStudentSignups,
  getStudentSignup,
  removeStudentSignup,
} from '../../functions/api/_lib/db.js';

describe('classes', () => {
  it('creates and lists a class with a default upcoming status', async () => {
    const created = await createClass(env.DB, {
      title: 'Genetics',
      description: 'Intro to heredity',
      date: '2026-10-01',
      startTime: '16:00',
      endTime: '17:00',
    });

    expect(created.title).toBe('Genetics');
    expect(created.status).toBe('upcoming');

    const all = await listClasses(env.DB);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(created.id);
  });

  it('includes each class\'s volunteer signups in the list', async () => {
    const cls = await createClass(env.DB, { title: 'Botany', date: '2026-10-07', startTime: '09:00' });
    const signup = await addVolunteerSignup(env.DB, cls.id, { name: 'Jairam', email: 'jairam@example.com' });

    const all = await listClasses(env.DB);
    const found = all.find((c) => c.id === cls.id);

    expect(found.volunteers).toEqual([{ id: signup.id, name: 'Jairam' }]);
  });

  it('returns an empty volunteers array for a class with no signups', async () => {
    const cls = await createClass(env.DB, { title: 'No Volunteers Yet', date: '2026-10-08', startTime: '09:00' });

    const all = await listClasses(env.DB);

    expect(all.find((c) => c.id === cls.id).volunteers).toEqual([]);
  });

  it('gets a class by id, returning null when missing', async () => {
    const created = await createClass(env.DB, {
      title: 'Astronomy',
      date: '2026-10-02',
      startTime: '15:00',
    });

    expect((await getClassById(env.DB, created.id)).title).toBe('Astronomy');
    expect(await getClassById(env.DB, 999999)).toBeNull();
  });

  it('updates only the given fields', async () => {
    const created = await createClass(env.DB, {
      title: 'Chemistry',
      date: '2026-10-03',
      startTime: '14:00',
    });

    const updated = await updateClass(env.DB, created.id, {
      zoom_link: 'https://zoom.us/j/123',
      status: 'cancelled',
    });

    expect(updated.zoom_link).toBe('https://zoom.us/j/123');
    expect(updated.status).toBe('cancelled');
    expect(updated.title).toBe('Chemistry');
  });

  it('hard deletes a class and cascades its signups', async () => {
    const created = await createClass(env.DB, {
      title: 'Water Quality',
      date: '2026-10-04',
      startTime: '13:00',
    });
    await addVolunteerSignup(env.DB, created.id, { name: 'Ana', email: 'ana@example.com' });
    await addStudentSignup(env.DB, created.id, {
      studentName: 'Sam',
      parentName: 'Pat',
      parentEmail: 'pat@example.com',
    });

    await hardDeleteClass(env.DB, created.id);

    expect(await getClassById(env.DB, created.id)).toBeNull();
    expect(await listVolunteerSignups(env.DB, created.id)).toHaveLength(0);
    expect(await listStudentSignups(env.DB, created.id)).toHaveLength(0);
  });
});

describe('volunteer signups', () => {
  it('adds, lists, gets, and removes a volunteer signup', async () => {
    const cls = await createClass(env.DB, { title: 'CAD Design', date: '2026-10-05', startTime: '10:00' });

    const signup = await addVolunteerSignup(env.DB, cls.id, {
      name: 'Priya',
      email: 'priya@example.com',
      roleNote: 'leading',
    });

    expect(signup.class_id).toBe(cls.id);
    expect(await listVolunteerSignups(env.DB, cls.id)).toHaveLength(1);
    expect((await getVolunteerSignup(env.DB, signup.id)).name).toBe('Priya');

    await removeVolunteerSignup(env.DB, signup.id);

    expect(await listVolunteerSignups(env.DB, cls.id)).toHaveLength(0);
    expect(await getVolunteerSignup(env.DB, signup.id)).toBeNull();
  });
});

describe('student signups', () => {
  it('adds, lists, gets, and removes a student signup', async () => {
    const cls = await createClass(env.DB, { title: 'Code Busters', date: '2026-10-06', startTime: '11:00' });

    const signup = await addStudentSignup(env.DB, cls.id, {
      studentName: 'Jamie',
      grade: '5',
      parentName: 'Lee',
      parentEmail: 'lee@example.com',
    });

    expect(signup.class_id).toBe(cls.id);
    expect(await listStudentSignups(env.DB, cls.id)).toHaveLength(1);
    expect((await getStudentSignup(env.DB, signup.id)).student_name).toBe('Jamie');

    await removeStudentSignup(env.DB, signup.id);

    expect(await listStudentSignups(env.DB, cls.id)).toHaveLength(0);
    expect(await getStudentSignup(env.DB, signup.id)).toBeNull();
  });
});
