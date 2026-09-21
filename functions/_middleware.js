const ALLOWED_ORIGINS = [
  'https://torch-scioly.github.io',
  'https://torch-signups.pages.dev',
  'http://localhost:8788',
];

export async function onRequest({ request, next }) {
  const origin = request.headers.get('Origin');
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : null;

  if (request.method === 'OPTIONS') {
    if (!allowOrigin) return new Response(null, { status: 403 });
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
        Vary: 'Origin',
      },
    });
  }

  const response = await next();
  if (!allowOrigin) return response;

  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', allowOrigin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Vary', 'Origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
