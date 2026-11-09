// Shared request helpers for the practice-tests API tests.
import { env } from 'cloudflare:test';
import { onRequestPost as registerParent } from '../../functions/api/tests/parents.js';
import { onRequestPost as kidLogin } from '../../functions/api/tests/login.js';
import { onRequestPost as adminLogin } from '../../functions/api/admin/login.js';

export function jsonRequest(method, body, headers = {}) {
  return new Request('https://example.com', {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function register(overrides = {}) {
  const body = {
    parentName: 'Priya K', parentEmail: 'priya@example.com', school: 'QVMS', consent: true,
    kids: [{ firstName: 'Aarav', lastInitial: 'K', grade: '7', pin: '4821' }],
    ...overrides,
  };
  const response = await registerParent({ request: jsonRequest('POST', body), env });
  return { response, data: response.status === 201 ? await response.json() : await response.json() };
}

export async function loginKid(username, pin = '4821') {
  const response = await kidLogin({ request: jsonRequest('POST', { username, pin }), env });
  return { response, data: await response.json() };
}

export async function adminCookie() {
  const response = await adminLogin({ request: jsonRequest('POST', { password: env.ADMIN_PASSWORD }), env });
  return response.headers.get('Set-Cookie').split(';')[0];
}

export const SAMPLE_INFO = {
  Title: 'Heredity Quiz 1', Event: 'Heredity', Division: 'B', Format: 'Quiz',
  'Time limit (min)': 20, School: 'QVMS', 'Written by': 'Adhya',
};

export const SAMPLE_QUESTIONS = [
  { Topic: 'Monohybrid crosses', Type: 'Multiple choice', Question: 'Fraction short?', A: '0', B: '1/4', C: '1/2', D: '3/4', Answer: 'B', Points: 1, Explanation: 'tt only' },
  { Topic: 'Meiosis', Type: 'Pick all that apply', Question: 'True of meiosis?', A: '4 cells', B: 'haploid', C: 'identical', D: 'crossing over', Answer: 'A,B,D', Points: 2 },
  { Topic: 'Monohybrid crosses', Type: 'Number', Question: 'How many tall of 400?', Answer: 300, Points: 1 },
  { Topic: 'History of genetics', Type: 'Short answer', Question: 'Father of genetics?', Answer: 'Mendel|Gregor Mendel', Points: 1 },
  { Topic: 'Vocabulary', Type: 'Written answer', Question: 'Genotype vs phenotype?', Answer: 'Genotype = alleles; phenotype = trait', Points: 3 },
];

export async function uploadTest(cookie, info = {}, query = '') {
  const { onRequestPost } = await import('../../functions/api/admin/tests.js');
  const request = new Request(`https://example.com/api/admin/tests${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ info: { ...SAMPLE_INFO, ...info }, questions: SAMPLE_QUESTIONS }),
  });
  const response = await onRequestPost({ request, env });
  return { response, data: await response.json() };
}
