export async function writeAuditLog(db, { classId, entityType, action, snapshot }) {
  await db
    .prepare(
      `INSERT INTO signup_audit_log (class_id, entity_type, action, snapshot)
       VALUES (?, ?, ?, ?)`
    )
    .bind(classId, entityType, action, JSON.stringify(snapshot))
    .run();
}

export async function listAuditLog(db) {
  const { results } = await db.prepare(`SELECT * FROM signup_audit_log ORDER BY created_at DESC, id DESC`).all();
  return results.map((row) => ({ ...row, snapshot: JSON.parse(row.snapshot) }));
}
