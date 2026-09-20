import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';

describe('D1 binding', () => {
  it('is bound and migrated', async () => {
    const result = await env.DB.prepare('SELECT COUNT(*) as count FROM classes').first();
    expect(result.count).toBe(0);
  });
});
