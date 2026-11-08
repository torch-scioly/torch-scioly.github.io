import { SCHOOLS } from '../_lib/schools.js';
import { TERMS_VERSION, createKid, issueParentKey, kidError } from './_lib/parents.js';

// A parent registers one or more kids and consents to the Tests terms.
export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const parentName = String(body.parentName || '').trim();
  const parentEmail = String(body.parentEmail || '').trim();
  const kids = Array.isArray(body.kids) ? body.kids : [];

  if (body.consent !== true) return Response.json({ error: 'Parent consent is required' }, { status: 400 });
  if (!parentName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(parentEmail)) {
    return Response.json({ error: 'Parent name and a valid email are required' }, { status: 400 });
  }
  if (!SCHOOLS.includes(body.school)) {
    return Response.json({ error: `school must be one of: ${SCHOOLS.join(', ')}` }, { status: 400 });
  }
  if (kids.length === 0) return Response.json({ error: 'Add at least one child' }, { status: 400 });
  const problem = kids.map(kidError).find(Boolean);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const parent = await env.DB
    .prepare(
      `INSERT INTO parents (name, email, school, consent_terms_version, consent_at, link_hash)
       VALUES (?, ?, ?, ?, datetime('now'), ?) RETURNING id`
    )
    .bind(parentName, parentEmail, body.school, TERMS_VERSION, `pending-${crypto.randomUUID()}`)
    .first();
  const parentKey = await issueParentKey(env.DB, parent.id);

  const created = [];
  for (const kid of kids) created.push(await createKid(env.DB, parent.id, body.school, kid));

  return Response.json({ parentKey, kids: created }, { status: 201 });
}
