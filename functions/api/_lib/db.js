export async function createClass(db, { title, description, date, startTime, endTime, school, program, inPerson }) {
  return db
    .prepare(
      `INSERT INTO classes (title, description, date, start_time, end_time, school, program, in_person)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      title, description ?? null, date, startTime, endTime ?? null,
      school ?? 'QVMS', program ?? 'Science Olympiad', inPerson ? 1 : 0
    )
    .first();
}

export async function listClasses(db) {
  const { results } = await db
    .prepare(
      `SELECT c.*,
              (SELECT json_group_array(json_object('id', v.id, 'name', v.name, 'role_note', v.role_note))
                 FROM volunteer_signups v WHERE v.class_id = c.id) AS volunteers_json
       FROM classes c
       ORDER BY c.date ASC, c.start_time ASC`
    )
    .all();

  return results.map(({ volunteers_json, ...cls }) => ({
    ...cls,
    volunteers: JSON.parse(volunteers_json),
  }));
}

export async function getClassById(db, id) {
  return db.prepare(`SELECT * FROM classes WHERE id = ?`).bind(id).first();
}

export async function updateClass(db, id, fields) {
  const columns = Object.keys(fields);
  const values = Object.values(fields);
  const setClause = columns.map((column) => `${column} = ?`).join(', ');

  return db
    .prepare(`UPDATE classes SET ${setClause} WHERE id = ? RETURNING *`)
    .bind(...values, id)
    .first();
}

export async function hardDeleteClass(db, id) {
  await db.prepare(`DELETE FROM volunteer_signups WHERE class_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM student_signups WHERE class_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM classes WHERE id = ?`).bind(id).run();
}

export async function addVolunteerSignup(db, classId, { name, email, roleNote }) {
  return db
    .prepare(
      `INSERT INTO volunteer_signups (class_id, name, email, role_note)
       VALUES (?, ?, ?, ?)
       RETURNING *`
    )
    .bind(classId, name, email, roleNote ?? null)
    .first();
}

export async function listVolunteerSignups(db, classId) {
  const { results } = await db
    .prepare(`SELECT * FROM volunteer_signups WHERE class_id = ? ORDER BY created_at ASC`)
    .bind(classId)
    .all();
  return results;
}

export async function getVolunteerSignup(db, id) {
  return db.prepare(`SELECT * FROM volunteer_signups WHERE id = ?`).bind(id).first();
}

export async function removeVolunteerSignup(db, id) {
  await db.prepare(`DELETE FROM volunteer_signups WHERE id = ?`).bind(id).run();
}

export async function addStudentSignup(db, classId, { studentName, grade, parentName, parentEmail }) {
  return db
    .prepare(
      `INSERT INTO student_signups (class_id, student_name, grade, parent_name, parent_email)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(classId, studentName, grade ?? null, parentName, parentEmail)
    .first();
}

export async function listStudentSignups(db, classId) {
  const { results } = await db
    .prepare(`SELECT * FROM student_signups WHERE class_id = ? ORDER BY created_at ASC`)
    .bind(classId)
    .all();
  return results;
}

export async function getStudentSignup(db, id) {
  return db.prepare(`SELECT * FROM student_signups WHERE id = ?`).bind(id).first();
}

export async function removeStudentSignup(db, id) {
  await db.prepare(`DELETE FROM student_signups WHERE id = ?`).bind(id).run();
}

// Saves a class's current session as its own (past) class row with copies of its
// volunteer and student rosters. Used when a recurring class moves on to its next session.
export async function copyClassSession(db, cls) {
  const copy = await db
    .prepare(
      `INSERT INTO classes (title, description, date, start_time, end_time, zoom_link, zoom_notes, status, school, program, in_person)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      cls.title, cls.description, cls.date, cls.start_time, cls.end_time,
      cls.zoom_link, cls.zoom_notes, cls.status, cls.school, cls.program, cls.in_person
    )
    .first();

  await db
    .prepare(
      `INSERT INTO volunteer_signups (class_id, name, email, role_note, created_at)
       SELECT ?, name, email, role_note, created_at FROM volunteer_signups WHERE class_id = ?`
    )
    .bind(copy.id, cls.id)
    .run();
  await db
    .prepare(
      `INSERT INTO student_signups (class_id, student_name, grade, parent_name, parent_email, created_at)
       SELECT ?, student_name, grade, parent_name, parent_email, created_at FROM student_signups WHERE class_id = ?`
    )
    .bind(copy.id, cls.id)
    .run();

  return copy;
}
