import { describe, expect, it } from 'vitest';
import { sqliteToIso } from '../../functions/api/_lib/time.js';

describe('sqliteToIso', () => {
  it('turns a SQLite UTC datetime into ISO', () => {
    expect(sqliteToIso('2026-11-08 15:04:05')).toBe('2026-11-08T15:04:05Z');
    expect(sqliteToIso(null)).toBeNull();
  });
});
