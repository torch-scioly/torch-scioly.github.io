import { describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JS_PATH = path.resolve(__dirname, '../../js/tests.js');
const SOURCE = fs.readFileSync(JS_PATH, 'utf-8');
const API = 'https://torch-signups.pages.dev';

function setup(fetchImpl) {
  const window = new Window({ url: 'https://torch-scioly.github.io/tests.html' });
  window.document.body.innerHTML = '<div id="app"></div>';
  window.alert = vi.fn();
  window.confirm = vi.fn(() => true);
  window.fetch = fetchImpl || vi.fn(() => Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) }));
  const context = vm.createContext(window);
  vm.runInContext(SOURCE, context, { filename: JS_PATH });
  return window;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const REVIEW = {
  status: 'reviewed', attemptId: 9, score: 4.5, maxScore: 6,
  test: { title: 'Meteorology Quiz 3', event: 'Meteorology', writtenBy: 'Jairam S' },
  submittedAt: '2026-11-07T18:00:00Z',
  questions: [
    { id: 1, position: 1, topic: 'Fronts', type: 'Multiple choice', prompt: 'Which front?', choices: ['Cold', 'Warm'], response: 'B', answer: 'B', explanation: 'Warm air rises', points: 1, maxPoints: 1, status: 'correct', gradedBy: 'auto', feedback: null },
    { id: 2, position: 2, topic: 'Clouds', type: 'Number', prompt: 'Cloud base?', choices: null, response: '700', answer: '875', explanation: '125 m per °C', points: 0, maxPoints: 2, status: 'wrong', gradedBy: 'auto', feedback: null },
    { id: 3, position: 3, topic: 'Maps', type: 'Written answer', prompt: '<img src=x onerror=alert(1)>', choices: null, response: 'cold front', answer: 'Cold front: triangles', explanation: null, points: 2.5, maxPoints: 3, status: 'partial', gradedBy: 'ai', feedback: 'Missing wind shift.' },
  ],
  progress: [{ submittedAt: '2026-10-01T00:00:00Z', percent: 50 }, { submittedAt: '2026-11-07T18:00:00Z', percent: 75 }],
  studyNext: [{ topic: 'Clouds', links: [{ title: 'Scioly.org wiki: Meteorology', url: 'https://scioly.org/wiki/index.php/Meteorology' }] }],
};

describe('helpers', () => {
  it('reads the parent key from the URL hash', () => {
    const window = setup();
    expect(window.parentKeyFromHash('#parent=abc_-123')).toBe('abc_-123');
    expect(window.parentKeyFromHash('#x')).toBeNull();
    expect(window.parentKeyFromHash('')).toBeNull();
  });

  it('formats time remaining as minutes and seconds', () => {
    const window = setup();
    expect(window.formatRemaining(725000)).toBe('12:05');
    expect(window.formatRemaining(-5)).toBe('0:00');
  });
});

describe('renderReview', () => {
  it('shows the score, each answer next to the key, AI labels and study links', () => {
    const window = setup();
    const el = window.document.getElementById('app');
    window.renderReview(el, REVIEW);
    expect(el.querySelector('.review-score').textContent).toBe('4.5 / 6');
    const wrong = el.querySelector('.review-q.wrong');
    expect(wrong.textContent).toContain('700');
    expect(wrong.textContent).toContain('875');
    expect(el.querySelector('.review-q.partial').textContent).toContain('graded by AI');
    expect(el.querySelector('.review-q.partial').textContent).toContain('Missing wind shift.');
    const link = el.querySelector('.study-next a');
    expect(link.getAttribute('href')).toBe('https://scioly.org/wiki/index.php/Meteorology');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(el.textContent).toContain('50%');
    expect(el.textContent).toContain('75%');
  });

  it('renders question text as text, not HTML', () => {
    const window = setup();
    const el = window.document.getElementById('app');
    window.renderReview(el, REVIEW);
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('labels a score changed by a volunteer and one still waiting', () => {
    const window = setup();
    const el = window.document.getElementById('app');
    const review = structuredClone(REVIEW);
    review.questions[2] = { ...review.questions[2], gradedBy: 'override' };
    review.questions[1] = { ...review.questions[1], status: 'needs_volunteer', points: null, gradedBy: null };
    window.renderReview(el, review);
    expect(el.textContent).toContain('changed by a volunteer');
    expect(el.textContent).toContain('waiting for a volunteer');
  });
});

describe('renderTake', () => {
  const ATTEMPT = {
    status: 'in_progress', attemptId: 5, test: { title: 'Quiz', event: 'Heredity', timeLimitMin: 20 }, deadlineAt: null,
    questions: [
      { id: 11, position: 1, type: 'Multiple choice', prompt: 'Pick one', choices: ['Yes', 'No'], maxPoints: 1 },
      { id: 12, position: 2, type: 'Pick all that apply', prompt: 'Pick some', choices: ['A1', 'B1', 'C1'], maxPoints: 2 },
      { id: 13, position: 3, type: 'Short answer', prompt: 'Name it', choices: null, maxPoints: 1 },
    ],
    responses: { 13: 'Mendel' },
  };

  it('restores saved answers and autosaves changes', async () => {
    const window = setup();
    window.sessionStorage.setItem('torch_kid_token', 'tok');
    const el = window.document.getElementById('app');
    window.renderTake(el, ATTEMPT, { debounceMs: 0 });
    expect(el.querySelector('input[data-q="13"]').value).toBe('Mendel');

    el.querySelector('input[name="q-11"][value="B"]').click();
    const boxes = el.querySelectorAll('input[name="q-12"]');
    boxes[0].click();
    boxes[2].click();
    await wait(30);

    const puts = window.fetch.mock.calls.filter(([, init]) => init && init.method === 'PUT');
    const bodies = puts.map(([, init]) => JSON.parse(init.body));
    expect(puts[0][0]).toBe(API + '/api/tests/attempts/5/answers');
    expect(puts[0][1].headers.Authorization).toBe('Bearer tok');
    expect(bodies).toContainEqual({ questionId: 11, response: 'B' });
    expect(bodies[bodies.length - 1]).toEqual({ questionId: 12, response: 'A,C' });
  });

  it('submits on its own when the time runs out', async () => {
    const window = setup();
    const el = window.document.getElementById('app');
    const onSubmitted = vi.fn();
    const deadlineAt = new Date(Date.now() + 40).toISOString();
    window.renderTake(el, { ...ATTEMPT, deadlineAt }, { debounceMs: 0, tickMs: 10, onSubmitted });
    expect(el.querySelector('.take-timer')).not.toBeNull();
    await wait(200);
    const submits = window.fetch.mock.calls.filter(([url]) => url === API + '/api/tests/attempts/5/submit');
    expect(submits).toHaveLength(1);
    expect(onSubmitted).toHaveBeenCalled();
  });
});
