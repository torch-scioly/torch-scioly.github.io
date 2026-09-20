import { getClassById, addStudentSignup } from '../../_lib/db.js';
import { writeAuditLog } from '../../_lib/audit.js';

export async function onRequestPost({ request, env, params }) {
  const classId = Number(params.id);
  const existing = await getClassById(env.DB, classId);
  if (!existing) {
    return Response.json({ error: 'Class not found' }, { status: 404 });
  }

  const body = await request.json();
  if (!body.studentName || !body.parentName || !body.parentEmail) {
    return Response.json({ error: 'studentName, parentName, and parentEmail are required' }, { status: 400 });
  }

  const signup = await addStudentSignup(env.DB, classId, {
    studentName: body.studentName,
    grade: body.grade,
    parentName: body.parentName,
    parentEmail: body.parentEmail,
  });

  await writeAuditLog(env.DB, { classId, entityType: 'student_signup', action: 'created', snapshot: signup });

  return Response.json(signup, { status: 201 });
}
