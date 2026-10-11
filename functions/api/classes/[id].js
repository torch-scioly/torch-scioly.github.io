import { getClassById, updateClass, listVolunteerSignups, listStudentSignups, copyClassSession } from '../_lib/db.js';
import { writeAuditLog } from '../_lib/audit.js';
import { isQuarterHourTime, addOneHour } from '../_lib/time.js';

// How a date change is recorded: 'reschedule' moves the session (it never happened);
// 'next_session' means the current session was held, so it is kept as a past class.
const DATE_CHANGE_MODES = ['reschedule', 'next_session'];

const EDITABLE_FIELDS = {
  title: 'title',
  description: 'description',
  date: 'date',
  startTime: 'start_time',
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

  if ('start_time' in fields) {
    if (!isQuarterHourTime(fields.start_time)) {
      return Response.json(
        { error: 'startTime must be on the hour or a 15-minute mark (e.g. 09:00, 09:15, 09:30, 09:45)' },
        { status: 400 }
      );
    }
    fields.end_time = addOneHour(fields.start_time);
  }

  const dateChanged = 'date' in fields && fields.date !== existing.date;
  if (dateChanged) {
    if (!DATE_CHANGE_MODES.includes(body.dateChange)) {
      return Response.json(
        { error: "Changing the date requires dateChange: 'reschedule' or 'next_session'" },
        { status: 400 }
      );
    }
    const today = new Date().toISOString().slice(0, 10);
    if (body.dateChange === 'next_session') {
      if (existing.date > today) {
        return Response.json(
          { error: 'This session has not happened yet — reschedule it instead' },
          { status: 400 }
        );
      }
      const held = await copyClassSession(env.DB, existing);
      await writeAuditLog(env.DB, { classId: held.id, entityType: 'class', action: 'created', snapshot: held });
    }
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
