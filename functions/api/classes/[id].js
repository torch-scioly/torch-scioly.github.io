import { getClassById, updateClass, listVolunteerSignups, listStudentSignups } from '../_lib/db.js';
import { writeAuditLog } from '../_lib/audit.js';

const EDITABLE_FIELDS = {
  title: 'title',
  description: 'description',
  date: 'date',
  startTime: 'start_time',
  endTime: 'end_time',
  zoom_link: 'zoom_link',
  zoom_notes: 'zoom_notes',
};

export async function onRequestGet({ env, params }) {
  const classId = Number(params.id);
  const record = await getClassById(env.DB, classId);
  if (!record) {
    return Response.json({ error: 'Class not found' }, { status: 404 });
  }

  const volunteers = await listVolunteerSignups(env.DB, classId);
  const students = await listStudentSignups(env.DB, classId);
  return Response.json({ ...record, volunteers, students });
}

export async function onRequestPut({ request, env, params }) {
  const classId = Number(params.id);
  const existing = await getClassById(env.DB, classId);
  if (!existing) {
    return Response.json({ error: 'Class not found' }, { status: 404 });
  }

  const body = await request.json();
  const fields = {};
  for (const [bodyKey, column] of Object.entries(EDITABLE_FIELDS)) {
    if (bodyKey in body) fields[column] = body[bodyKey];
  }

  if (Object.keys(fields).length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 });
  }

  const updated = await updateClass(env.DB, classId, fields);

  await writeAuditLog(env.DB, { classId, entityType: 'class', action: 'edited', snapshot: updated });

  return Response.json(updated);
}

export async function onRequestDelete({ env, params }) {
  const classId = Number(params.id);
  const existing = await getClassById(env.DB, classId);
  if (!existing) {
    return Response.json({ error: 'Class not found' }, { status: 404 });
  }

  const cancelled = await updateClass(env.DB, classId, { status: 'cancelled' });

  await writeAuditLog(env.DB, { classId, entityType: 'class', action: 'edited', snapshot: cancelled });

  return Response.json(cancelled);
}
