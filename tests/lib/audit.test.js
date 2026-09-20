import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { writeAuditLog, listAuditLog } from '../../functions/api/_lib/audit.js';

describe('audit log', () => {
  it('writes and lists entries with the snapshot parsed back to an object', async () => {
    await writeAuditLog(env.DB, {
      classId: 42,
      entityType: 'class',
      action: 'created',
      snapshot: { id: 42, title: 'Genetics' },
    });

    const entries = await listAuditLog(env.DB);

    expect(entries).toHaveLength(1);
    expect(entries[0].class_id).toBe(42);
    expect(entries[0].entity_type).toBe('class');
    expect(entries[0].action).toBe('created');
    expect(entries[0].snapshot).toEqual({ id: 42, title: 'Genetics' });
  });

  it('lists most recent entries first', async () => {
    await writeAuditLog(env.DB, { classId: 1, entityType: 'class', action: 'created', snapshot: { id: 1 } });
    await writeAuditLog(env.DB, { classId: 1, entityType: 'class', action: 'edited', snapshot: { id: 1 } });

    const entries = await listAuditLog(env.DB);

    expect(entries[0].action).toBe('edited');
    expect(entries[1].action).toBe('created');
  });
});
