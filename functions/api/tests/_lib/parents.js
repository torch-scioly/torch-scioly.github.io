// Parents, kids and the parent link for the Tests page.
import { randomSecret, sha256Hex, hashPin } from '../../_lib/secrets.js';

export const TERMS_VERSION = 'v1';
export const PIN_PATTERN = /^\d{4,6}$/;

export async function findParentByKey(db, key) {
  if (!key) return null;
  return db.prepare('SELECT * FROM parents WHERE link_hash = ?').bind(await sha256Hex(key)).first();
}

export async function parentFromRequest(request, db) {
  return findParentByKey(db, request.headers.get('X-Parent-Key'));
}

// Issues a new parent link secret and stores only its hash; the old link stops working.
export async function issueParentKey(db, parentId) {
  const key = randomSecret();
  await db.prepare('UPDATE parents SET link_hash = ? WHERE id = ?').bind(await sha256Hex(key), parentId).run();
  return key;
}

function slug(value) {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function makeUsername(db, displayName, school) {
  const base = slug(`${displayName} ${school}`);
  let candidate = base;
  for (let n = 2; await db.prepare('SELECT 1 FROM kids WHERE username = ?').bind(candidate).first(); n++) {
    candidate = `${base}-${n}`;
  }
  return candidate;
}

// Returns an error message for a kid entry, or null if it's valid.
export function kidError(kid) {
  if (!kid || !String(kid.firstName || '').trim()) return 'Each child needs a first name';
  if (!/^[A-Za-z]$/.test(String(kid.lastInitial || '').trim())) return 'Each child needs a last initial (one letter)';
  if (!PIN_PATTERN.test(String(kid.pin || ''))) return 'PINs must be 4 to 6 digits';
  return null;
}

export async function createKid(db, parentId, school, kid) {
  const displayName = `${String(kid.firstName).trim()} ${String(kid.lastInitial).trim().toUpperCase()}`;
  const username = await makeUsername(db, displayName, school);
  const { hash, salt } = await hashPin(String(kid.pin));
  const row = await db
    .prepare(
      `INSERT INTO kids (parent_id, school, display_name, grade, username, pin_hash, pin_salt)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .bind(parentId, school, displayName, String(kid.grade || '').trim() || null, username, hash, salt)
    .first();
  return { id: row.id, displayName, username };
}
