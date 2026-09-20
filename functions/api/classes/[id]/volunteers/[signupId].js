import { getVolunteerSignup, removeVolunteerSignup } from '../../../_lib/db.js';
import { writeAuditLog } from '../../../_lib/audit.js';

export async function onRequestDelete({ env, params }) {
  const signupId = Number(params.signupId);
  const existing = await getVolunteerSignup(env.DB, signupId);
  if (!existing || existing.class_id !== Number(params.id)) {
    return Response.json({ error: 'Signup not found' }, { status: 404 });
  }

  await removeVolunteerSignup(env.DB, signupId);

  await writeAuditLog(env.DB, {
    classId: existing.class_id,
    entityType: 'volunteer_signup',
    action: 'removed',
    snapshot: existing,
  });

  return new Response(null, { status: 204 });
}
