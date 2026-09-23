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
    <input type="time" name="startTime" step="900" required>
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
function setupClassesPage({ fetchImpl, dateImpl } = {}) {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = CLASSES_HTML_FIXTURE;

  window.alert = vi.fn();
  window.confirm = vi.fn(() => true);
  window.fetch = fetchImpl || vi.fn();
  if (dateImpl) window.Date = dateImpl;

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

  it('escapeHtml also escapes quote characters, so it is safe to interpolate inside a double-quoted HTML attribute', () => {
    const { window } = setupClassesPage();
    const attributeBreakout = 'x" onfocus="alert(1)" autofocus="';

    const escaped = window.escapeHtml(attributeBreakout);

    expect(escaped).not.toContain('"');
    expect(escaped).toBe('x&quot; onfocus=&quot;alert(1)&quot; autofocus=&quot;');
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

    expect(fetchImpl).toHaveBeenCalledWith('https://torch-signups.pages.dev/api/classes');

    const upcoming = document.getElementById('upcoming-classes').innerHTML;
    const past = document.getElementById('past-classes').innerHTML;

    expect(upcoming).toContain('Future Class');
    expect(upcoming).not.toContain('Old Class');
    expect(upcoming).not.toContain('Called Off');

    expect(past).toContain('Old Class');
    expect(past).toContain('Called Off');
    expect(past).not.toContain('Future Class');
  });

  it('loadClasses uses the LOCAL date (not the UTC date) to decide what counts as "today", so a class dated today-in-local-time still lands in Upcoming even when the UTC date has already rolled over to tomorrow', async () => {
    // Simulate a moment where the UTC date and the local (wall-clock) date
    // diverge, e.g. ~7pm US Central: UTC has already ticked into the next
    // calendar day, but locally it is still "today". A UTC-based `today`
    // computation (the old `new Date().toISOString().slice(0, 10)` bug)
    // would incorrectly treat a class dated for local-today as being in the
    // past. We simulate this by overriding the classes.js execution
    // context's `Date` so its UTC-derived and local-derived date components
    // disagree, independent of the host machine's actual timezone.
    class FakeDate extends Date {
      toISOString() {
        return '2099-06-02T00:00:00.000Z'; // UTC date: June 2nd
      }
      getFullYear() {
        return 2099;
      }
      getMonth() {
        return 5; // June (0-indexed)
      }
      getDate() {
        return 1; // local date: June 1st
      }
    }

    var classes = [
      { id: 1, title: "Today's Class (local)", date: '2099-06-01', start_time: '10:00', status: 'scheduled' },
    ];
    var fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(classes) });
    var { window, document } = setupClassesPage({ fetchImpl, dateImpl: FakeDate });

    window.loadClasses();
    await flushMicrotasks();

    var upcoming = document.getElementById('upcoming-classes').innerHTML;
    var past = document.getElementById('past-classes').innerHTML;

    expect(upcoming).toContain("Today's Class (local)");
    expect(past).not.toContain("Today's Class (local)");
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
    expect(postUrl).toBe('https://torch-signups.pages.dev/api/classes');
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
    expect(getUrl).toBe('https://torch-signups.pages.dev/api/classes');

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
// `shouldFail(url, method)`, if given, forces a matching call to resolve
// with `ok: false` instead, to exercise the error-handling path.
function makeFetchRouter(classDetail, shouldFail) {
  return vi.fn(function (url, opts) {
    var method = (opts && opts.method) || 'GET';
    if (shouldFail && shouldFail(url, method)) {
      return Promise.resolve({ ok: false, json: function () { return Promise.resolve({ error: 'nope' }); } });
    }
    if (url === 'https://torch-signups.pages.dev/api/classes' && method === 'GET') {
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve([]); } });
    }
    if (/^https:\/\/torch-signups\.pages\.dev\/api\/classes\/\d+$/.test(url) && method === 'GET') {
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

    expect(fetchImpl).toHaveBeenCalledWith('https://torch-signups.pages.dev/api/classes/42');
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

  it('volunteer and student signup forms are collapsed behind "+ Sign up" buttons by default', async () => {
    var detail = makeClassDetail();
    var fetchImpl = makeFetchRouter(detail);
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();

    expect(document.getElementById('add-volunteer-form').hidden).toBe(true);
    expect(document.getElementById('add-student-form').hidden).toBe(true);
    expect(document.getElementById('show-volunteer-form').hidden).toBe(false);
    expect(document.getElementById('show-student-form').hidden).toBe(false);
  });

  it('clicking "+ Sign up as a volunteer" reveals the volunteer form and hides its own button, independent of the student form', async () => {
    var detail = makeClassDetail();
    var fetchImpl = makeFetchRouter(detail);
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();

    document.getElementById('show-volunteer-form').dispatchEvent(new window.Event('click', { bubbles: true }));

    expect(document.getElementById('add-volunteer-form').hidden).toBe(false);
    expect(document.getElementById('show-volunteer-form').hidden).toBe(true);
    expect(document.getElementById('add-student-form').hidden).toBe(true);
    expect(document.getElementById('show-student-form').hidden).toBe(false);
  });

  it('clicking Cancel inside the volunteer form hides it, restores the "+ Sign up" button, and resets its fields', async () => {
    var detail = makeClassDetail();
    var fetchImpl = makeFetchRouter(detail);
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();
    document.getElementById('show-volunteer-form').dispatchEvent(new window.Event('click', { bubbles: true }));
    document.getElementById('add-volunteer-form').querySelector('[name="name"]').value = 'Charlie';

    document.getElementById('cancel-volunteer-form').dispatchEvent(new window.Event('click', { bubbles: true }));

    expect(document.getElementById('add-volunteer-form').hidden).toBe(true);
    expect(document.getElementById('show-volunteer-form').hidden).toBe(false);
    expect(document.getElementById('add-volunteer-form').querySelector('[name="name"]').value).toBe('');
  });

  it('clicking "+ Sign up as a student" reveals the student form and hides its own button, independent of the volunteer form', async () => {
    var detail = makeClassDetail();
    var fetchImpl = makeFetchRouter(detail);
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();

    document.getElementById('show-student-form').dispatchEvent(new window.Event('click', { bubbles: true }));

    expect(document.getElementById('add-student-form').hidden).toBe(false);
    expect(document.getElementById('show-student-form').hidden).toBe(true);
    expect(document.getElementById('add-volunteer-form').hidden).toBe(true);
    expect(document.getElementById('show-volunteer-form').hidden).toBe(false);
  });

  it('clicking Cancel inside the student form hides it, restores the "+ Sign up" button, and resets its fields', async () => {
    var detail = makeClassDetail();
    var fetchImpl = makeFetchRouter(detail);
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();
    document.getElementById('show-student-form').dispatchEvent(new window.Event('click', { bubbles: true }));
    document.getElementById('add-student-form').querySelector('[name="studentName"]').value = 'Dana';

    document.getElementById('cancel-student-form').dispatchEvent(new window.Event('click', { bubbles: true }));

    expect(document.getElementById('add-student-form').hidden).toBe(true);
    expect(document.getElementById('show-student-form').hidden).toBe(false);
    expect(document.getElementById('add-student-form').querySelector('[name="studentName"]').value).toBe('');
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
    expect(deleteCall[0]).toBe('https://torch-signups.pages.dev/api/classes/42/volunteers/1');

    // wireClassDetailEvents' remove handler re-opens the detail view and
    // refreshes the card list on success.
    var getDetailCalls = fetchImpl.mock.calls.filter(function (c) { return c[0] === 'https://torch-signups.pages.dev/api/classes/42'; });
    var getListCalls = fetchImpl.mock.calls.filter(function (c) { return c[0] === 'https://torch-signups.pages.dev/api/classes'; });
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

    var postCall = fetchImpl.mock.calls.find(function (c) { return c[0] === 'https://torch-signups.pages.dev/api/classes/42/volunteers'; });
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

    var postCall = fetchImpl.mock.calls.find(function (c) { return c[0] === 'https://torch-signups.pages.dev/api/classes/42/students'; });
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
    expect(form.querySelector('[name="endTime"]')).toBeNull();
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

    var putCall = fetchImpl.mock.calls.find(function (c) { return c[0] === 'https://torch-signups.pages.dev/api/classes/42' && c[1] && c[1].method === 'PUT'; });
    expect(putCall).toBeTruthy();
    var body = JSON.parse(putCall[1].body);
    expect(body.zoom_link).toBe('https://zoom.us/j/555');
    expect(body.zoom_notes).toBe('Password: abc');
    expect(body.title).toBe('Robotics 101');

    // Success handler re-opens the detail view and refreshes the class list.
    var getDetailCalls = fetchImpl.mock.calls.filter(function (c) { return c[0] === 'https://torch-signups.pages.dev/api/classes/42' && (!c[1] || !c[1].method); });
    var getListCalls = fetchImpl.mock.calls.filter(function (c) { return c[0] === 'https://torch-signups.pages.dev/api/classes'; });
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
    var deleteCall = fetchImpl.mock.calls.find(function (c) { return c[0] === 'https://torch-signups.pages.dev/api/classes/42' && c[1] && c[1].method === 'DELETE'; });
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

describe('js/classes.js attribute-injection XSS (Fix 1)', () => {
  it('renderEditClassSection: a title/zoom_link/zoom_notes value that attempts an attribute breakout does not create real onfocus/autofocus attributes on the rendered inputs', async () => {
    var breakout = 'x" onfocus="alert(1)" autofocus="';
    var detail = makeClassDetail({
      title: breakout,
      zoom_link: 'https://zoom.us/j/1' + breakout,
      zoom_notes: breakout,
    });
    var fetchImpl = makeFetchRouter(detail);
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();

    var form = document.getElementById('edit-class-form');
    var titleInput = form.querySelector('[name="title"]');
    var zoomLinkInput = form.querySelector('[name="zoom_link"]');
    var zoomNotesInput = form.querySelector('[name="zoom_notes"]');

    [titleInput, zoomLinkInput, zoomNotesInput].forEach(function (el) {
      expect(el.hasAttribute('onfocus')).toBe(false);
      expect(el.hasAttribute('autofocus')).toBe(false);
    });

    // The raw value round-trips into the `value` attribute/property (as text,
    // not as parsed markup), it just no longer breaks out of the attribute.
    expect(titleInput.value).toBe(breakout);
  });

  it('renderClassDetailHtml: a zoom_link value that attempts an attribute breakout does not create real onfocus/autofocus attributes on the rendered <a> element', () => {
    var { window, document } = setupClassesPage();
    var breakout = '" onfocus="alert(1)" autofocus="';
    var cls = makeClassDetail({
      zoom_link: 'https://zoom.us/j/123' + breakout,
      zoom_notes: null,
      volunteers: [],
      students: [],
    });

    var body = document.getElementById('class-detail-body');
    body.innerHTML = window.renderClassDetailHtml(cls);

    var link = body.querySelector('.zoom-box a');
    expect(link).not.toBeNull();
    expect(link.hasAttribute('onfocus')).toBe(false);
    expect(link.hasAttribute('autofocus')).toBe(false);
  });

  it('renderClassDetailHtml does NOT render a clickable <a> for a javascript: zoom_link, falling back to the placeholder text instead', () => {
    var { window, document } = setupClassesPage();
    var cls = makeClassDetail({
      zoom_link: 'javascript:alert(1)',
      zoom_notes: null,
      volunteers: [],
      students: [],
    });

    var body = document.getElementById('class-detail-body');
    body.innerHTML = window.renderClassDetailHtml(cls);

    expect(body.querySelector('.zoom-box a')).toBeNull();
    expect(body.textContent).toContain('Zoom link will be posted by the volunteer before class.');
  });
});

describe('js/classes.js class detail modal error handling', () => {
  it('loadClasses alerts when GET /api/classes fails', async () => {
    var fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'nope' }) });
    var { window } = setupClassesPage({ fetchImpl });

    window.loadClasses();
    await flushMicrotasks();

    expect(window.alert).toHaveBeenCalledWith('Failed to load classes');
  });

  it('openClassDetail alerts and leaves the modal hidden when the fetch fails', async () => {
    var fetchImpl = makeFetchRouter(makeClassDetail(), function (url, method) {
      return url === 'https://torch-signups.pages.dev/api/classes/42' && method === 'GET';
    });
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();

    expect(window.alert).toHaveBeenCalledWith('Failed to load class');
    expect(document.getElementById('class-detail-modal').hidden).toBe(true);
  });

  it('remove-btn click alerts when the DELETE fails', async () => {
    var detail = makeClassDetail();
    var fetchImpl = makeFetchRouter(detail, function (url, method) {
      return method === 'DELETE' && url === 'https://torch-signups.pages.dev/api/classes/42/volunteers/1';
    });
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();
    window.alert.mockClear();

    document
      .querySelector('.remove-btn[data-type="volunteers"][data-id="1"]')
      .dispatchEvent(new window.Event('click', { bubbles: true }));
    await flushMicrotasks();

    expect(window.alert).toHaveBeenCalledWith('Failed to remove signup');
  });

  it('add-volunteer-form submit alerts when the POST fails (e.g. backend validation 400)', async () => {
    var detail = makeClassDetail();
    var fetchImpl = makeFetchRouter(detail, function (url, method) {
      return method === 'POST' && url === 'https://torch-signups.pages.dev/api/classes/42/volunteers';
    });
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();
    window.alert.mockClear();

    var form = document.getElementById('add-volunteer-form');
    form.querySelector('[name="name"]').value = 'Charlie';
    form.querySelector('[name="email"]').value = 'charlie@example.com';
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    expect(window.alert).toHaveBeenCalledWith('Failed to add volunteer');
  });

  it('add-student-form submit alerts when the POST fails (e.g. missing parentEmail, which the backend 400s on)', async () => {
    var detail = makeClassDetail();
    var fetchImpl = makeFetchRouter(detail, function (url, method) {
      return method === 'POST' && url === 'https://torch-signups.pages.dev/api/classes/42/students';
    });
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();
    window.alert.mockClear();

    var form = document.getElementById('add-student-form');
    form.querySelector('[name="studentName"]').value = 'Dana';
    form.querySelector('[name="parentName"]').value = 'Erin';
    form.querySelector('[name="parentEmail"]').value = '';
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    expect(window.alert).toHaveBeenCalledWith('Failed to add student');
  });

  it('edit-class-form submit alerts when the PUT fails', async () => {
    var detail = makeClassDetail();
    var fetchImpl = makeFetchRouter(detail, function (url, method) {
      return method === 'PUT' && url === 'https://torch-signups.pages.dev/api/classes/42';
    });
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();
    window.alert.mockClear();

    document
      .getElementById('edit-class-form')
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    expect(window.alert).toHaveBeenCalledWith('Failed to update class');
  });

  it('cancel-class-btn click alerts when the DELETE fails', async () => {
    var detail = makeClassDetail({ status: 'scheduled' });
    var fetchImpl = makeFetchRouter(detail, function (url, method) {
      return method === 'DELETE' && url === 'https://torch-signups.pages.dev/api/classes/42';
    });
    var { window, document } = setupClassesPage({ fetchImpl });

    window.openClassDetail(42);
    await flushMicrotasks();
    window.alert.mockClear();

    document.getElementById('cancel-class-btn').dispatchEvent(new window.Event('click', { bubbles: true }));
    await flushMicrotasks();

    expect(window.alert).toHaveBeenCalledWith('Failed to cancel class');
  });
});
