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
  <div id="class-detail-modal" class="modal" hidden>
    <div class="modal-content">
      <button id="close-detail-modal" class="modal-close" aria-label="Close">&times;</button>
      <div id="class-detail-body"></div>
    </div>
  </div>
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
  window.confirm = vi.fn(() => true);
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

// Sample class-detail payload shape, matching what GET /api/classes/:id
// returns per functions/api/classes/[id].js (the class record spread with
// `volunteers` and `students` arrays).
function makeClassDetail(overrides) {
  return Object.assign(
    {
      id: 42,
      title: 'Robotics 101',
      description: 'Learn robots',
      date: '2026-12-25',
      start_time: '09:30',
      end_time: '10:30',
      zoom_link: null,
      zoom_notes: null,
      status: 'scheduled',
      volunteers: [{ id: 1, name: 'Alice', role_note: 'Lead teacher' }],
      students: [{ id: 1, student_name: 'Bob', grade: '5' }],
    },
    overrides
  );
}

// Routes a mocked fetch by URL/method so multi-step flows (e.g. remove ->
// re-fetch detail -> re-fetch list) all resolve sensibly within one test.
function makeFetchRouter(classDetail) {
  return vi.fn(function (url, opts) {
    var method = (opts && opts.method) || 'GET';
    if (url === '/api/classes' && method === 'GET') {
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve([]); } });
    }
    if (/^\/api\/classes\/\d+$/.test(url) && method === 'GET') {
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve(classDetail); } });
    }
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } });
  });
}

describe('js/classes.js class detail modal', () => {
  it('openClassDetail fetches the class, renders rosters + zoom placeholder, and unhides the modal', async () => {
    var detail = makeClassDetail({ zoom_link: null, zoom_notes: null });
    var fetchImpl = makeFetchRouter(detail);
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();

    expect(fetchImpl).toHaveBeenCalledWith('/api/classes/42');
    var modal = document.getElementById('class-detail-modal');
    expect(modal.hidden).toBe(false);

    var body = document.getElementById('class-detail-body').innerHTML;
    expect(body).toContain('Robotics 101');
    expect(body).toContain('Learn robots');
    expect(body).toContain('Zoom link will be posted by the volunteer before class.');
    expect(body).toContain('Alice');
    expect(body).toContain('Lead teacher');
    expect(body).toContain('Bob');
    expect(body).toContain('Grade 5');
    expect(document.querySelectorAll('.remove-btn').length).toBe(2);
    expect(document.getElementById('add-volunteer-form')).not.toBeNull();
    expect(document.getElementById('add-student-form')).not.toBeNull();
    expect(document.getElementById('edit-class-form')).not.toBeNull();
  });

  it('renderClassDetailHtml shows the zoom box with link + notes when zoom_link is set, and escapes roster/zoom content', () => {
    var { window } = setupClassesPage();
    var cls = makeClassDetail({
      zoom_link: 'https://zoom.us/j/123',
      zoom_notes: '<b>Password</b>: hunter2',
      volunteers: [{ id: 5, name: '<script>alert(1)</script>', role_note: null }],
      students: [],
    });

    var html = window.renderClassDetailHtml(cls);

    expect(html).toContain('Join here:');
    expect(html).toContain('href="https://zoom.us/j/123"');
    expect(html).not.toContain('<b>Password</b>');
    expect(html).toContain('&lt;b&gt;Password&lt;/b&gt;: hunter2');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('remove-btn click DELETEs the right roster endpoint and refreshes the detail view and class list', async () => {
    var detail = makeClassDetail();
    var fetchImpl = makeFetchRouter(detail);
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();
    fetchImpl.mockClear();

    var removeVolunteerBtn = document.querySelector('.remove-btn[data-type="volunteers"][data-id="1"]');
    expect(removeVolunteerBtn).not.toBeNull();
    removeVolunteerBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    await flushMicrotasks();

    var deleteCall = fetchImpl.mock.calls.find(function (c) { return c[1] && c[1].method === 'DELETE'; });
    expect(deleteCall[0]).toBe('/api/classes/42/volunteers/1');

    // wireClassDetailEvents' remove handler re-opens the detail view and
    // refreshes the card list on success.
    var getDetailCalls = fetchImpl.mock.calls.filter(function (c) { return c[0] === '/api/classes/42'; });
    var getListCalls = fetchImpl.mock.calls.filter(function (c) { return c[0] === '/api/classes'; });
    expect(getDetailCalls.length).toBe(1);
    expect(getListCalls.length).toBe(1);
  });

  it('add-volunteer-form submit POSTs the form fields to /api/classes/:id/volunteers', async () => {
    var detail = makeClassDetail();
    var fetchImpl = makeFetchRouter(detail);
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();
    fetchImpl.mockClear();

    var form = document.getElementById('add-volunteer-form');
    form.querySelector('[name="name"]').value = 'Charlie';
    form.querySelector('[name="email"]').value = 'charlie@example.com';
    form.querySelector('[name="roleNote"]').value = 'Assistant';
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    var postCall = fetchImpl.mock.calls.find(function (c) { return c[0] === '/api/classes/42/volunteers'; });
    expect(postCall[1].method).toBe('POST');
    expect(postCall[1].headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(postCall[1].body)).toEqual({
      name: 'Charlie',
      email: 'charlie@example.com',
      roleNote: 'Assistant',
    });
  });

  it('add-student-form submit POSTs the form fields to /api/classes/:id/students', async () => {
    var detail = makeClassDetail();
    var fetchImpl = makeFetchRouter(detail);
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();
    fetchImpl.mockClear();

    var form = document.getElementById('add-student-form');
    form.querySelector('[name="studentName"]').value = 'Dana';
    form.querySelector('[name="grade"]').value = '3';
    form.querySelector('[name="parentName"]').value = 'Erin';
    form.querySelector('[name="parentEmail"]').value = 'erin@example.com';
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    var postCall = fetchImpl.mock.calls.find(function (c) { return c[0] === '/api/classes/42/students'; });
    expect(postCall[1].method).toBe('POST');
    expect(JSON.parse(postCall[1].body)).toEqual({
      studentName: 'Dana',
      grade: '3',
      parentName: 'Erin',
      parentEmail: 'erin@example.com',
    });
  });

  it('renderEditClassSection pre-fills the edit form with the class values', async () => {
    var detail = makeClassDetail({
      title: 'Robotics 101',
      description: 'Learn robots',
      date: '2026-12-25',
      start_time: '09:30',
      end_time: '10:30',
      zoom_link: 'https://zoom.us/j/999',
      zoom_notes: 'Bring a laptop',
    });
    var fetchImpl = makeFetchRouter(detail);
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();

    var form = document.getElementById('edit-class-form');
    expect(form.querySelector('[name="title"]').value).toBe('Robotics 101');
    expect(form.querySelector('[name="description"]').value).toBe('Learn robots');
    expect(form.querySelector('[name="date"]').value).toBe('2026-12-25');
    expect(form.querySelector('[name="startTime"]').value).toBe('09:30');
    expect(form.querySelector('[name="endTime"]').value).toBe('10:30');
    expect(form.querySelector('[name="zoom_link"]').value).toBe('https://zoom.us/j/999');
    expect(form.querySelector('[name="zoom_notes"]').value).toBe('Bring a laptop');
    expect(document.getElementById('cancel-class-btn')).not.toBeNull();
  });

  it('edit-class-form submit PUTs the updated fields to /api/classes/:id and refreshes', async () => {
    var detail = makeClassDetail();
    var fetchImpl = makeFetchRouter(detail);
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();
    fetchImpl.mockClear();

    var form = document.getElementById('edit-class-form');
    form.querySelector('[name="zoom_link"]').value = 'https://zoom.us/j/555';
    form.querySelector('[name="zoom_notes"]').value = 'Password: abc';
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    var putCall = fetchImpl.mock.calls.find(function (c) { return c[0] === '/api/classes/42' && c[1] && c[1].method === 'PUT'; });
    expect(putCall).toBeTruthy();
    var body = JSON.parse(putCall[1].body);
    expect(body.zoom_link).toBe('https://zoom.us/j/555');
    expect(body.zoom_notes).toBe('Password: abc');
    expect(body.title).toBe('Robotics 101');

    // Success handler re-opens the detail view and refreshes the class list.
    var getDetailCalls = fetchImpl.mock.calls.filter(function (c) { return c[0] === '/api/classes/42' && (!c[1] || !c[1].method); });
    var getListCalls = fetchImpl.mock.calls.filter(function (c) { return c[0] === '/api/classes'; });
    expect(getDetailCalls.length).toBe(1);
    expect(getListCalls.length).toBe(1);
  });

  it('cancel-class-btn click confirms, then DELETEs the class and refreshes', async () => {
    var detail = makeClassDetail({ status: 'scheduled' });
    var fetchImpl = makeFetchRouter(detail);
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();
    fetchImpl.mockClear();

    var cancelBtn = document.getElementById('cancel-class-btn');
    expect(cancelBtn).not.toBeNull();
    cancelBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    await flushMicrotasks();

    expect(window.confirm).toHaveBeenCalled();
    var deleteCall = fetchImpl.mock.calls.find(function (c) { return c[0] === '/api/classes/42' && c[1] && c[1].method === 'DELETE'; });
    expect(deleteCall).toBeTruthy();
  });

  it('cancel-class-btn click does nothing when confirm() is declined', async () => {
    var detail = makeClassDetail({ status: 'scheduled' });
    var fetchImpl = makeFetchRouter(detail);
    var { window, document } = setupClassesPage({ fetchImpl });
    window.confirm = vi.fn(function () { return false; });

    window.openClassDetail(42);
    await flushMicrotasks();
    fetchImpl.mockClear();

    document.getElementById('cancel-class-btn').dispatchEvent(new window.Event('click', { bubbles: true }));
    await flushMicrotasks();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('renders "This class is cancelled" with no cancel button when status is cancelled', async () => {
    var detail = makeClassDetail({ status: 'cancelled' });
    var fetchImpl = makeFetchRouter(detail);
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();

    expect(document.getElementById('class-detail-body').innerHTML).toContain('This class is cancelled.');
    expect(document.getElementById('cancel-class-btn')).toBeNull();
  });

  it('close-detail-modal button hides the modal', () => {
    var { window, document } = setupClassesPage();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    var modal = document.getElementById('class-detail-modal');
    modal.hidden = false;

    document.getElementById('close-detail-modal').dispatchEvent(new window.Event('click', { bubbles: true }));

    expect(modal.hidden).toBe(true);
  });
});
