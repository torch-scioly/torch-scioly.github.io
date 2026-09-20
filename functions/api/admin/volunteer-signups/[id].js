import { isValidAdminSession } from '../../_lib/auth.js';
import { getVolunteerSignup, removeVolunteerSignup } from '../../_lib/db.js';
import { writeAuditLog } from '../../_lib/audit.js';

export async function onRequestDelete({ request, env, params }) {
  if (!(await isValidAdminSession(request, env))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const signupId = Number(params.id);
  const existing = await getVolunteerSignup(env.DB, signupId);
  if (!existing) {
    return Response.json({ error: 'Signup not found' }, { status: 404 });
  }

  await writeAuditLog(env.DB, {
    classId: existing.class_id,
    entityType: 'volunteer_signup',
    action: 'removed',
    snapshot: existing,
  });
  await removeVolunteerSignup(env.DB, signupId);

  return new Response(null, { status: 204 });
}
