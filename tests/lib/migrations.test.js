import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';

describe('practice tests schema', () => {
  it('seeds free study resources', async () => {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM study_resources').first();
    expect(row.n).toBeGreaterThanOrEqual(5);
  });

  it('keeps kid usernames unique', async () => {
    const parent = await env.DB.prepare(
      `INSERT INTO parents (name, email, school, consent_terms_version, consent_at, link_hash)
       VALUES ('P', 'p@example.com', 'QVMS', 'v1', datetime('now'), 'h1') RETURNING id`
    ).first();
    const insertKid = () =>
      env.DB.prepare(
        `INSERT INTO kids (parent_id, school, display_name, username, pin_hash, pin_salt)
         VALUES (?, 'QVMS', 'Aarav K', 'aarav-k-qvms', 'x', 'y')`
      ).bind(parent.id).run();
    await insertKid();
    await expect(insertKid()).rejects.toThrow();
  });
});
