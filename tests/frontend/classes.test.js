import { describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLASSES_JS_PATH = path.resolve(__dirname, '../../js/classes.js');
const CLASSES_JS_SOURCE = fs.readFileSync(CLASSES_JS_PATH, 'utf-8');

// classes.html's relevant markup (the elements js/classes.js reads by id/name).
// Kept in sync with classes.html's #create-class-form, #creator-volunteer-fields,
// #upcoming-classes and #past-classes.
const CLASSES_HTML_FIXTURE = `
  <button id="show-create-form" class="btn btn-primary">+ Create a Class</button>
  <form id="create-class-form" class="signup-form" hidden>
    <input type="text" name="title" required>
    <textarea name="description"></textarea>
    <input type="date" name="date" required>
    <input type="time" name="startTime" required>
    <input type="time" name="endTime">
    <label class="checkbox-label">
      <input type="checkbox" name="signUpAsVolunteer" checked>
    </label>
    <div id="creator-volunteer-fields">
      <input type="text" name="volunteerName">
      <input type="email" name="volunteerEmail">
    </div>
    <button type="submit" class="btn btn-primary">Create Class</button>
    <button type="button" id="cancel-create-form" class="btn btn-secondary">Cancel</button>
  </form>
  <div id="upcoming-classes" class="class-list"></div>
  <div id="past-classes" class="class-list"></div>
`;

/**
 * js/classes.js is loaded via a plain, non-module <script src="js/classes.js">
 * tag in classes.html, not an ES module — its top-level `function` declarations
 * (loadClasses, renderClassList, escapeHtml) become properties of the browser's
 * global `window` object. To exercise the real file unmodified, we build a
 * happy-dom window/document with the DOM classes.js expects, then evaluate the
 * file's source with Node's `vm` module contextified against that window —
 * the same mechanism (global-object-as-context) a classic script uses, so the
 * functions end up reachable as `window.loadClasses` etc., exactly as they
 * would in the real page.
 */
function setupClassesPage({ fetchImpl } = {}) {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = CLASSES_HTML_FIXTURE;

  window.alert = vi.fn();
  window.fetch = fetchImpl || vi.fn();

  const context = vm.createContext(window);
  vm.runInContext(CLASSES_JS_SOURCE, context, { filename: CLASSES_JS_PATH });

  return { window, document };
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('js/classes.js DOM behavior', () => {
  it('escapeHtml neutralizes HTML/script content so it cannot execute as markup', () => {
    const { window } = setupClassesPage();
    const malicious = '<script>alert(1)</script>';

    const escaped = window.escapeHtml(malicious);

    expect(escaped).not.toContain('<script>');
    expect(escaped).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('renderClassList renders escaped class cards, or an empty-state message when given no classes', () => {
    const { window, document } = setupClassesPage();
    const container = document.getElementById('upcoming-classes');

    window.renderClassList(container, [
      {
        id: 1,
        title: '<img src=x onerror=alert(1)>Robotics 101',
        date: '2026-12-25',
        start_time: '09:30',
        status: 'scheduled',
      },
    ]);

    expect(container.innerHTML).not.toContain('<img src=x');
    expect(container.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;Robotics 101');
    expect(container.innerHTML).toContain('2026-12-25 at 09:30');
    expect(container.querySelectorAll('.class-card').length).toBe(1);

    window.renderClassList(container, []);
    expect(container.innerHTML).toContain('No classes here yet.');
  });

  it('loadClasses fetches /api/classes and splits results into #upcoming-classes vs #past-classes by date', async () => {
    const classes = [
      { id: 1, title: 'Future Class', date: '2099-01-01', start_time: '10:00', status: 'scheduled' },
      { id: 2, title: 'Old Class', date: '2000-01-01', start_time: '11:00', status: 'scheduled' },
      { id: 3, title: 'Called Off', date: '2099-01-01', start_time: '12:00', status: 'cancelled' },
    ];
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(classes),
    });
    const { window, document } = setupClassesPage({ fetchImpl });

    window.loadClasses();
    await flushMicrotasks();

    expect(fetchImpl).toHaveBeenCalledWith('/api/classes');

    const upcoming = document.getElementById('upcoming-classes').innerHTML;
    const past = document.getElementById('past-classes').innerHTML;

    expect(upcoming).toContain('Future Class');
    expect(upcoming).not.toContain('Old Class');
    expect(upcoming).not.toContain('Called Off');

    expect(past).toContain('Old Class');
    expect(past).toContain('Called Off');
    expect(past).not.toContain('Future Class');
  });

  it('show/cancel buttons and the volunteer checkbox toggle form visibility as expected', () => {
    const { window, document } = setupClassesPage();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const showBtn = document.getElementById('show-create-form');
    const form = document.getElementById('create-class-form');
    const cancelBtn = document.getElementById('cancel-create-form');
    const checkbox = form.querySelector('[name="signUpAsVolunteer"]');
    const creatorFields = document.getElementById('creator-volunteer-fields');

    expect(form.hidden).toBe(true);

    showBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(form.hidden).toBe(false);
    expect(showBtn.hidden).toBe(true);

    cancelBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(form.hidden).toBe(true);
    expect(showBtn.hidden).toBe(false);

    checkbox.checked = false;
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(creatorFields.hidden).toBe(true);

    checkbox.checked = true;
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(creatorFields.hidden).toBe(false);
  });

  it('submitting the create-class form POSTs the right payload to /api/classes and refreshes the list on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    const { window, document } = setupClassesPage({ fetchImpl });
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushMicrotasks(); // let the initial loadClasses() call settle
    fetchImpl.mockClear();

    const showBtn = document.getElementById('show-create-form');
    const form = document.getElementById('create-class-form');
    showBtn.dispatchEvent(new window.Event('click', { bubbles: true }));

    form.querySelector('[name="title"]').value = 'Intro to Robotics';
    form.querySelector('[name="description"]').value = 'Beginner friendly';
    form.querySelector('[name="date"]').value = '2026-12-25';
    form.querySelector('[name="startTime"]').value = '09:30';
    form.querySelector('[name="volunteerName"]').value = 'Alice';
    form.querySelector('[name="volunteerEmail"]').value = 'alice@example.com';

    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    expect(fetchImpl).toHaveBeenCalledTimes(2); // the POST, then loadClasses()'s GET
    const [postUrl, postOpts] = fetchImpl.mock.calls[0];
    expect(postUrl).toBe('/api/classes');
    expect(postOpts.method).toBe('POST');
    expect(postOpts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(postOpts.body);
    expect(body).toMatchObject({
      title: 'Intro to Robotics',
      description: 'Beginner friendly',
      date: '2026-12-25',
      startTime: '09:30',
      signUpAsVolunteer: true,
      volunteerName: 'Alice',
      volunteerEmail: 'alice@example.com',
    });

    const [getUrl] = fetchImpl.mock.calls[1];
    expect(getUrl).toBe('/api/classes');

    // Form closes and the "+ Create a Class" button reappears after a
    // successful submit.
    expect(form.hidden).toBe(true);
    expect(showBtn.hidden).toBe(false);
  });
});
