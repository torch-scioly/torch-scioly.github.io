import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { hashPin, verifyPin, randomSecret, sha256Hex, signToken, readBearer, PIN_ITERATIONS } from '../../functions/api/_lib/secrets.js';

function bearerRequest(token) {
  return new Request('https://example.com', { headers: { Authorization: `Bearer ${token}` } });
}

describe('PIN hashing', () => {
  it('verifies the right PIN and rejects a wrong one', async () => {
    const { hash, salt } = await hashPin('4821');
    expect(await verifyPin('4821', hash, salt)).toBe(true);
    expect(await verifyPin('4822', hash, salt)).toBe(false);
  });

  it('uses a fresh salt each time', async () => {
    const a = await hashPin('4821');
    const b = await hashPin('4821');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('secrets', () => {
  it('makes long url-safe random secrets', () => {
    const s = randomSecret();
    expect(s).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(randomSecret()).not.toBe(s);
  });

  it('hashes text to sha-256 hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('bearer tokens', () => {
  it('reads back a fresh token', async () => {
    const token = await signToken(env, { kind: 'kid', id: 7 });
    expect(await readBearer(bearerRequest(token), env)).toEqual({ kind: 'kid', id: 7 });
  });

  it('rejects a tampered token', async () => {
    const token = await signToken(env, { kind: 'kid', id: 7 });
    const tampered = token.replace(/^kid\.7\./, 'kid.8.');
    expect(await readBearer(bearerRequest(tampered), env)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signToken(env, { kind: 'kid', id: 7 }, -1);
    expect(await readBearer(bearerRequest(token), env)).toBeNull();
  });

  it('returns null with no Authorization header', async () => {
    expect(await readBearer(new Request('https://example.com'), env)).toBeNull();
  });
});

describe('PIN hashing cost', () => {
  // Free-plan Workers get ~10 ms of CPU per request; registration hashes one PIN per kid.
  // A 4-6 digit PIN has at most 1,000,000 values, so the 15-minute lockout, not the
  // iteration count, is what stops guessing.
  it('stays cheap enough for the Workers CPU limit', () => {
    expect(PIN_ITERATIONS).toBeLessThanOrEqual(10000);
    expect(PIN_ITERATIONS).toBeGreaterThanOrEqual(1000);
  });
});
