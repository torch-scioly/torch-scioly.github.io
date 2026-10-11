// Public aggregate stats for the homepage and volunteer tier badges.
// Returns counts only — never names or emails.
export async function onRequestGet({ env }) {
  const kids = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT DISTINCT lower(trim(student_name)), lower(trim(parent_email)) FROM student_signups
     )`
  ).first();

  // Classes are fixed 1-hour slots, so each held class a volunteer signed up for = 1 hour.
  const { results } = await env.DB.prepare(
    `SELECT p.slug,
            COUNT(DISTINCT CASE WHEN c.status != 'cancelled' AND c.date < date('now') THEN c.id END) AS hours
       FROM volunteer_profiles p
       LEFT JOIN volunteer_signups v ON lower(trim(v.email)) = lower(trim(p.email))
       LEFT JOIN classes c ON c.id = v.class_id
      GROUP BY p.slug`
  ).all();

  const volunteerHours = {};
  for (const row of results) volunteerHours[row.slug] = row.hours;

  return Response.json({ kidsReached: kids.n, volunteerHours });
}
