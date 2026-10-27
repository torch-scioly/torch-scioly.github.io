// Public aggregate stats for the homepage and volunteer tier badges.
// Returns counts only — never names or emails.

// Volunteer hours count held classes from this date on.
const COUNTING_START = '2026-10-03';

export async function onRequestGet({ env }) {
  const kids = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT DISTINCT lower(trim(student_name)), lower(trim(parent_email)) FROM student_signups
     )`
  ).first();

  // Each held class credits its sign-up's hours (1 for a regular class slot; volunteer-only
  // sessions can credit more). Credit goes to the volunteers signed up; a class with nobody
  // signed up credits its course instructor 1 hour instead.
  const { results } = await env.DB.prepare(
    `WITH held AS (
       SELECT id, lower(title) AS title FROM classes
        WHERE status != 'cancelled' AND date >= ?1 AND date < date('now')
     ),
     credits AS (
       SELECT p.slug, h.id AS class_id, MAX(v.hours) AS hours
         FROM held h
         JOIN volunteer_signups v ON v.class_id = h.id
         JOIN volunteer_profiles p ON lower(trim(p.email)) = lower(trim(v.email))
        GROUP BY p.slug, h.id
       UNION
       SELECT ci.slug, h.id, 1
         FROM held h
         JOIN course_instructors ci ON h.title LIKE '%' || ci.keyword || '%'
        WHERE NOT EXISTS (SELECT 1 FROM volunteer_signups v WHERE v.class_id = h.id)
     ),
     slugs AS (
       SELECT slug FROM volunteer_profiles UNION SELECT slug FROM course_instructors
     )
     SELECT s.slug, COALESCE(SUM(c.hours), 0) AS hours
       FROM slugs s
       LEFT JOIN (SELECT slug, class_id, MAX(hours) AS hours FROM credits GROUP BY slug, class_id) c
         ON c.slug = s.slug
      GROUP BY s.slug`
  )
    .bind(COUNTING_START)
    .all();

  const volunteerHours = {};
  for (const row of results) volunteerHours[row.slug] = row.hours;

  return Response.json({ kidsReached: kids.n, volunteerHours });
}
