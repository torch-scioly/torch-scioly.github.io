import { getStudentSignup, removeStudentSignup } from '../../../_lib/db.js';
import { writeAuditLog } from '../../../_lib/audit.js';

export async function onRequestDelete({ env, params }) {
  const signupId = Number(params.signupId);
  const existing = await getStudentSignup(env.DB, signupId);
  if (!existing || existing.class_id !== Number(params.id)) {
    return Response.json({ error: 'Signup not found' }, { status: 404 });
  }

  await removeStudentSignup(env.DB, signupId);

  await writeAuditLog(env.DB, {
    classId: existing.class_id,
    entityType: 'student_signup',
    action: 'removed',
    snapshot: existing,
  });

  return new Response(null, { status: 204 });
}
