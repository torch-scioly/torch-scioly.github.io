import { describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SBE_JS_PATH = path.resolve(__dirname, '../../js/sbe.js');
const SBE_JS_SOURCE = fs.readFileSync(SBE_JS_PATH, 'utf-8');

// Kept in sync with sbe.html's #sbe-upcoming and #sbe-past.
const SBE_HTML = `
  <div id="sbe-upcoming"></div>
  <div id="sbe-past"></div>
`;

const API = 'https://torch-signups.pages.dev';

const CLASSES = [
  {
    id: 1, title: 'Number Sense: ×11, ×101, ×111, ×1001', description: 'Multiplying by 11, 101, 111 and 1001',
    date: '2026-10-05', start_time: '15:45', end_time: '16:45', status: 'upcoming', school: 'SBE',
    volunteers: [{ id: 10, name: 'Jairam Susarla', role_note: 'Teach: ×11' }],
  },
  {
    id: 2, title: 'Number Sense: squares ending in 5', description: '35², 65², 85²',
    date: '2026-10-26', start_time: '15:45', end_time: '16:45', status: 'upcoming', school: 'SBE',
    volunteers: [],
  },
  {
    id: 3, title: 'Number Sense: ×11 with bigger numbers', description: '3- and 4-digit numbers',
    date: '2026-10-19', start_time: '15:45', end_time: '16:45', status: 'upcoming', school: 'SBE',
    volunteers: [{ id: 11, name: 'Aditya Jetti', role_note: 'PowerPoint' }],
  },
  {
    id: 4, title: 'Number Sense: holiday', description: '', date: '2026-11-02', start_time: '15:45',
    end_time: '16:45', status: 'cancelled', school: 'SBE', volunteers: [],
  },
  { id: 5, title: 'Botany', date: '2026-10-20', start_time: '18:00', status: 'upcoming', school: 'QVMS', volunteers: [] },
];

function setupSbePage(fetchImpl) {
  const window = new Window();
  window.document.body.innerHTML = SBE_HTML;
  window.alert = vi.fn();
  window.fetch = fetchImpl || vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(CLASSES) }));
  const context = vm.createContext(window);
  vm.runInContext(SBE_JS_SOURCE, context, { filename: SBE_JS_PATH });
  return window;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('sbeRoleNote', () => {
  it('builds the job label stored on the signup', () => {
    const window = setupSbePage();
    expect(window.sbeRoleNote('Teach', '×25')).toBe('Teach: ×25');
    expect(window.sbeRoleNote('Teach', '  ')).toBe('Teach');
    expect(window.sbeRoleNote('PowerPoint', 'ignored')).toBe('PowerPoint');
    expect(window.sbeRoleNote('Test prep', '')).toBe('Test prep');
  });
});

describe('loadSbeSessions', () => {
  it('shows only SBE sessions, upcoming soonest first and past most recent first', async () => {
    const window = setupSbePage();

    window.loadSbeSessions('2026-10-11');
    await flush();

    const upcoming = window.document.querySelectorAll('#sbe-upcoming .sbe-session h3');
    expect(Array.from(upcoming).map((h) => h.textContent)).toEqual([
      '×11 with bigger numbers',
      'squares ending in 5',
      'holiday',
    ]);
    const past = window.document.querySelectorAll('#sbe-past .sbe-session h3');
    expect(Array.from(past).map((h) => h.textContent)).toEqual(['×11, ×101, ×111, ×1001']);
    expect(window.document.body.textContent).not.toContain('Botany');
  });

  it('shows the date, curriculum, and volunteers with their jobs', async () => {
    const window = setupSbePage();

    window.loadSbeSessions('2026-10-11');
    await flush();

    const card = window.document.querySelector('#sbe-upcoming .sbe-session');
    expect(card.textContent).toContain('Mon, Oct 19 · 3:45 PM');
    expect(card.textContent).toContain('3- and 4-digit numbers');
    expect(card.textContent).toContain('Aditya Jetti');
    expect(card.textContent).toContain('PowerPoint');
  });

  it('offers sign-up on upcoming sessions only, and marks cancelled Mondays as no session', async () => {
    const window = setupSbePage();

    window.loadSbeSessions('2026-10-11');
    await flush();

    const [first, , holiday] = window.document.querySelectorAll('#sbe-upcoming .sbe-session');
    expect(first.querySelector('.sbe-signup-btn')).not.toBeNull();
    expect(holiday.querySelector('.sbe-signup-btn')).toBeNull();
    expect(holiday.textContent).toMatch(/no session/i);
    expect(window.document.querySelector('#sbe-past .sbe-signup-btn')).toBeNull();
  });

  it('escapes class text', async () => {
    const window = setupSbePage(vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve([{ ...CLASSES[1], description: '<img src=x onerror=alert(1)>' }]),
    })));

    window.loadSbeSessions('2026-10-11');
    await flush();

    expect(window.document.querySelector('.sbe-session img')).toBeNull();
  });
});

describe('SBE volunteer sign-up', () => {
  it('posts name, email, and job to the session and reloads', async () => {
    const fetchImpl = vi.fn((url, opts) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(opts && opts.method === 'POST' ? {} : CLASSES) })
    );
    const window = setupSbePage(fetchImpl);
    window.loadSbeSessions('2026-10-11');
    await flush();

    const card = window.document.querySelector('#sbe-upcoming .sbe-session');
    card.querySelector('.sbe-signup-btn').dispatchEvent(new window.Event('click', { bubbles: true }));
    const form = card.querySelector('form');
    expect(form.hidden).toBe(false);
    form.querySelector('[name="name"]').value = 'Veda Khande';
    form.querySelector('[name="email"]').value = 'veda@example.com';
    form.querySelector('[name="job"]').value = 'Teach';
    form.querySelector('[name="trick"]').value = 'Squares ending in 5';
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    const post = fetchImpl.mock.calls.find((c) => c[1] && c[1].method === 'POST');
    expect(post[0]).toBe(API + '/api/classes/3/volunteers');
    expect(JSON.parse(post[1].body)).toEqual({
      name: 'Veda Khande',
      email: 'veda@example.com',
      roleNote: 'Teach: Squares ending in 5',
    });
    const reloads = fetchImpl.mock.calls.filter((c) => c[0] === API + '/api/classes' && !(c[1] && c[1].method));
    expect(reloads.length).toBe(2);
  });

  it('alerts when the sign-up fails', async () => {
    const fetchImpl = vi.fn((url, opts) =>
      opts && opts.method === 'POST'
        ? Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve(CLASSES) })
    );
    const window = setupSbePage(fetchImpl);
    window.loadSbeSessions('2026-10-11');
    await flush();

    const card = window.document.querySelector('#sbe-upcoming .sbe-session');
    const form = card.querySelector('form');
    form.querySelector('[name="name"]').value = 'X';
    form.querySelector('[name="email"]').value = 'x@example.com';
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    expect(window.alert).toHaveBeenCalledWith('Sign-up failed — please try again.');
  });
});
