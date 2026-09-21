export async function createClass(db, { title, description, date, startTime, endTime }) {
  return db
    .prepare(
      `INSERT INTO classes (title, description, date, start_time, end_time)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(title, description ?? null, date, startTime, endTime ?? null)
    .first();
}

export async function listClasses(db) {
  const { results } = await db.prepare(`SELECT * FROM classes ORDER BY date ASC, start_time ASC`).all();
  return results;
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
