export const SESSION_COOKIE_NAME = 'torch_admin_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createSessionCookie(env) {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const signature = await hmac(env.SESSION_SECRET, String(expiresAt));
  const value = `${expiresAt}.${signature}`;
  return `${SESSION_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`;
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  const match = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

export async function isValidAdminSession(request, env) {
  const value = readCookie(request, SESSION_COOKIE_NAME);
  if (!value) return false;

  const [expiresAtStr, signature] = value.split('.');
  if (!expiresAtStr || !signature) return false;

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expectedSignature = await hmac(env.SESSION_SECRET, expiresAtStr);
  return signature === expectedSignature;
}
