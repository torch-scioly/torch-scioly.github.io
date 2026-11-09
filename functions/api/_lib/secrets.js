// Secrets for the Tests page: PIN hashing, random link secrets, and signed bearer tokens.
// Kid sessions use bearer tokens (not cookies) because the frontend and API are on
// different sites and Safari blocks cross-site cookies.

// Kept low for the Workers CPU limit; the login lockout is the real defense for short PINs.
export const PIN_ITERATIONS = 10000;
const DEFAULT_TOKEN_TTL_MS = 4 * 3600 * 1000;

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  return new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
}

export function randomSecret(bytes = 32) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export async function hashPin(pin, saltHex) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PIN_ITERATIONS },
    key,
    256
  );
  return { hash: toHex(bits), salt: toHex(salt) };
}

export async function verifyPin(pin, hash, salt) {
  const attempt = await hashPin(pin, salt);
  return constantTimeEqual(attempt.hash, hash);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

// Token format: kind.id.expiresAt.hmac
export async function signToken(env, { kind, id }, ttlMs = DEFAULT_TOKEN_TTL_MS) {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not configured');
  const body = `${kind}.${id}.${Date.now() + ttlMs}`;
  return `${body}.${await hmacHex(env.SESSION_SECRET, body)}`;
}

export async function readBearer(request, env) {
  if (!env.SESSION_SECRET) return null;
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  const parts = header.slice(7).trim().split('.');
  if (parts.length !== 4) return null;
  const [kind, idStr, expStr, signature] = parts;
  const expected = await hmacHex(env.SESSION_SECRET, `${kind}.${idStr}.${expStr}`);
  if (!constantTimeEqual(signature, expected)) return null;
  if (!(Number(expStr) > Date.now())) return null;
  const id = Number(idStr);
  return Number.isInteger(id) ? { kind, id } : null;
}
