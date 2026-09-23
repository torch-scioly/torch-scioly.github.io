import { createClass, listClasses, addVolunteerSignup } from './_lib/db.js';
import { writeAuditLog } from './_lib/audit.js';
import { isQuarterHourTime, addOneHour } from './_lib/time.js';

export async function onRequestGet({ env }) {
  const classes = await listClasses(env.DB);
  return Response.json(classes);
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();

  if (!body.title || !body.date || !body.startTime) {
    return Response.json({ error: 'title, date, and startTime are required' }, { status: 400 });
  }

  if (!isQuarterHourTime(body.startTime)) {
    return Response.json(
      { error: 'startTime must be on the hour or a 15-minute mark (e.g. 09:00, 09:15, 09:30, 09:45)' },
      { status: 400 }
    );
  }

  const newClass = await createClass(env.DB, {
    title: body.title,
    description: body.description,
    date: body.date,
    startTime: body.startTime,
    endTime: addOneHour(body.startTime),
  });

  await writeAuditLog(env.DB, {
    classId: newClass.id,
    entityType: 'class',
    action: 'created',
    snapshot: newClass,
  });

  if (body.signUpAsVolunteer && body.volunteerName && body.volunteerEmail) {
    const signup = await addVolunteerSignup(env.DB, newClass.id, {
      name: body.volunteerName,
      email: body.volunteerEmail,
      roleNote: body.volunteerRoleNote,
    });

    await writeAuditLog(env.DB, {
      classId: newClass.id,
      entityType: 'volunteer_signup',
      action: 'created',
      snapshot: signup,
    });
  }

  return Response.json(newClass, { status: 201 });
}
