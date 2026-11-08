import { viewerFromRequest, loadAttemptForViewer, isReviewLocked, inProgressView, reviewView } from '../_lib/attempts.js';

// An attempt: questions while in progress (no keys), or the review once submitted.
export async function onRequestGet({ request, env, params }) {
  const viewer = await viewerFromRequest(request, env);
  if (!viewer) return Response.json({ error: 'Please sign in' }, { status: 401 });
  const attempt = await loadAttemptForViewer(env.DB, params.id, viewer);
  if (!attempt) return Response.json({ error: 'Not found' }, { status: 404 });

  if (!attempt.submitted_at) {
    if (viewer.kind !== 'kid') return Response.json({ error: 'Not finished yet' }, { status: 404 });
    return Response.json(await inProgressView(env.DB, attempt));
  }
  if (await isReviewLocked(env.DB, attempt)) return Response.json({ status: 'waiting_for_session', score: null });
  return Response.json(await reviewView(env.DB, attempt));
}
