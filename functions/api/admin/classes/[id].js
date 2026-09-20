import { isValidAdminSession } from '../../_lib/auth.js';
import { getClassById, hardDeleteClass } from '../../_lib/db.js';
import { writeAuditLog } from '../../_lib/audit.js';

export async function onRequestDelete({ request, env, params }) {
  if (!(await isValidAdminSession(request, env))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const classId = Number(params.id);
  const existing = await getClassById(env.DB, classId);
  if (!existing) {
    return Response.json({ error: 'Class not found' }, { status: 404 });
  }

  await writeAuditLog(env.DB, { classId, entityType: 'class', action: 'removed', snapshot: existing });
  await hardDeleteClass(env.DB, classId);

  return new Response(null, { status: 204 });
}
