import { isValidAdminSession } from '../_lib/auth.js';
import { listAuditLog } from '../_lib/audit.js';

export async function onRequestGet({ request, env }) {
  if (!(await isValidAdminSession(request, env))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const log = await listAuditLog(env.DB);
  return Response.json(log);
}
