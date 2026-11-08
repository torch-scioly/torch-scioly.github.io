// Grades answers to practice-test questions. Everything but written answers is graded
// by rule; written answers go to Workers AI, and anything the AI can't grade cleanly is
// left for a volunteer.

export const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function statusFor(points, max) {
  if (points >= max) return 'correct';
  if (points <= 0) return 'wrong';
  return 'partial';
}

function letters(value) {
  return [...new Set(String(value).toUpperCase().split(',').map((l) => l.trim()).filter(Boolean))];
}

function normalizeShort(value) {
  return String(value).toLowerCase().trim().replace(/\s+/g, ' ').replace(/\.$/, '').trim();
}

function isBlank(response) {
  return response === null || response === undefined || String(response).trim() === '';
}

export function gradeAuto(question, response) {
  const max = question.points;
  if (isBlank(response)) return { points: 0, status: 'wrong' };

  let points = 0;
  if (question.type === 'Multiple choice') {
    points = String(response).trim().toUpperCase() === question.answer ? max : 0;
  } else if (question.type === 'Pick all that apply') {
    const key = letters(question.answer);
    const picked = letters(response);
    const right = picked.filter((l) => key.includes(l)).length;
    const wrong = picked.length - right;
    points = Math.max(0, (right - wrong) / key.length) * max;
  } else if (question.type === 'Number') {
    const given = Number(String(response).trim());
    const tolerance = question.tolerance ?? 0;
    points = Number.isFinite(given) && Math.abs(given - Number(question.answer)) <= tolerance + 1e-9 ? max : 0;
  } else if (question.type === 'Short answer') {
    const accepted = question.answer.split('|').map(normalizeShort);
    points = accepted.includes(normalizeShort(response)) ? max : 0;
  }
  return { points, status: statusFor(points, max) };
}

const NEEDS_VOLUNTEER = { points: null, status: 'needs_volunteer', feedback: null, gradedBy: null };

export async function gradeWritten(ai, question, response) {
  const max = question.points;
  if (isBlank(response)) return { points: 0, status: 'wrong', feedback: 'No answer given.', gradedBy: 'auto' };
  if (!ai) return NEEDS_VOLUNTEER;

  const messages = [
    {
      role: 'system',
      content:
        'You grade middle school Science Olympiad practice answers. Compare the student answer to the ' +
        'model answer and rubric, give points from 0 to the maximum (half points allowed), and write one or ' +
        'two encouraging sentences to the student saying what was right and what was missing. ' +
        'Reply with JSON only: {"points": <number>, "feedback": "<text>"}',
    },
    {
      role: 'user',
      content:
        `Question: ${question.prompt}\nModel answer and rubric: ${question.answer}\n` +
        `Maximum points: ${max}\nStudent answer: ${String(response).trim()}`,
    },
  ];

  try {
    const result = await ai.run(AI_MODEL, { messages });
    const raw = typeof result?.response === 'string' ? result.response : JSON.stringify(result?.response ?? '');
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) return NEEDS_VOLUNTEER;
    const parsed = JSON.parse(match[0]);
    const awarded = Number(parsed.points);
    if (!Number.isFinite(awarded)) return NEEDS_VOLUNTEER;
    const points = Math.min(max, Math.max(0, Math.round(awarded * 2) / 2));
    const feedback = typeof parsed.feedback === 'string' && parsed.feedback.trim() ? parsed.feedback.trim() : null;
    return { points, status: statusFor(points, max), feedback, gradedBy: 'ai' };
  } catch {
    return NEEDS_VOLUNTEER;
  }
}
