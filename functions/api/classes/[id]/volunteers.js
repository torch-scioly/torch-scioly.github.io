import { getClassById, addVolunteerSignup } from '../../_lib/db.js';
import { writeAuditLog } from '../../_lib/audit.js';

export async function onRequestPost({ request, env, params }) {
  const classId = Number(params.id);
  const existing = await getClassById(env.DB, classId);
  if (!existing) {
    return Response.json({ error: 'Class not found' }, { status: 404 });
  }

  const body = await request.json();
  if (!body.name || !body.email) {
    return Response.json({ error: 'name and email are required' }, { status: 400 });
  }

  const signup = await addVolunteerSignup(env.DB, classId, {
    name: body.name,
    email: body.email,
    roleNote: body.roleNote,
  });

  await writeAuditLog(env.DB, { classId, entityType: 'volunteer_signup', action: 'created', snapshot: signup });

  return Response.json(signup, { status: 201 });
}
