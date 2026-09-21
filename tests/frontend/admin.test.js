import { describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_JS_PATH = path.resolve(__dirname, '../../js/admin.js');
const ADMIN_JS_SOURCE = fs.readFileSync(ADMIN_JS_PATH, 'utf-8');

// admin.html's relevant markup (the elements js/admin.js reads by id).
// Kept in sync with admin.html's #admin-login-form, #login-error and
// #admin-dashboard.
const ADMIN_HTML_FIXTURE = `
  <form id="admin-login-form" class="signup-form">
    <label>Admin Password
      <input type="password" name="password" required>
    </label>
    <button type="submit" class="btn btn-primary">Log In</button>
    <p id="login-error" class="class-meta" hidden>Incorrect password.</p>
  </form>

  <div id="admin-dashboard" hidden>
    <h2 class="section-title">Audit Log</h2>
    <table class="audit-log-table">
      <thead>
        <tr><th>When</th><th>Class</th><th>Entity</th><th>Action</th><th>Details</th><th></th></tr>
      </thead>
      <tbody id="audit-log-body"></tbody>
    </table>
  </div>
`;

/**
 * js/admin.js is loaded via a plain, non-module <script src="js/admin.js">
 * tag in admin.html, not an ES module. To exercise the real file unmodified,
 * we build a happy-dom window/document with the DOM admin.js expects, then
 * evaluate the file's source with Node's `vm` module contextified against
 * that window, the same mechanism (global-object-as-context) a classic
 * script uses.
 */
function setupAdminPage({ fetchImpl, confirmImpl } = {}) {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = ADMIN_HTML_FIXTURE;

  window.fetch = fetchImpl || vi.fn();
  window.confirm = confirmImpl || vi.fn(() => true);
  window.alert = vi.fn();

  const context = vm.createContext(window);
  vm.runInContext(ADMIN_JS_SOURCE, context, { filename: ADMIN_JS_PATH });

  return { window, document };
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function submitLoginForm(window, document, password) {
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  const form = document.getElementById('admin-login-form');
  form.querySelector('[name="password"]').value = password;
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

describe('js/admin.js login flow', () => {
  it('shows "Incorrect password." and keeps the form visible when the login POST fails (e.g. real 401 from /api/admin/login)', async () => {
    // Mirrors the real response observed from a live `wrangler pages dev .`
    // server for a wrong password: HTTP 401 {"error":"Invalid password"}.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Invalid password' }),
    });
    const { window, document } = setupAdminPage({ fetchImpl });

    submitLoginForm(window, document, 'wrong-password');
    await flushMicrotasks();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/admin/login');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.credentials).toBe('same-origin');
    expect(JSON.parse(opts.body)).toEqual({ password: 'wrong-password' });

    const loginError = document.getElementById('login-error');
    const loginForm = document.getElementById('admin-login-form');
    const dashboard = document.getElementById('admin-dashboard');
    expect(loginError.hidden).toBe(false);
    expect(loginForm.hidden).toBe(false);
    expect(dashboard.hidden).toBe(true);
  });

  it('hides the login form, reveals the dashboard, and loads the audit log on a successful login (Task 15: loadAuditLog now defined)', async () => {
    // Mirrors the real responses observed from a live `wrangler pages dev .`
    // server: HTTP 200 {"ok":true} with a Set-Cookie session header for
    // /api/admin/login, followed by the JSON array /api/admin/audit-log
    // returns once loadAuditLog() fires.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve([
            {
              id: 7,
              class_id: 2,
              entity_type: 'class',
              action: 'created',
              snapshot: { id: 2, title: 'Verify Task15 Class' },
              created_at: '2026-09-21 00:51:22',
            },
          ]),
      });
    const { window, document } = setupAdminPage({ fetchImpl });

    submitLoginForm(window, document, 'local-test-password-123');
    await flushMicrotasks();

    const [loginUrl, loginOpts] = fetchImpl.mock.calls[0];
    expect(loginUrl).toBe('/api/admin/login');
    expect(loginOpts.credentials).toBe('same-origin');
    expect(JSON.parse(loginOpts.body)).toEqual({ password: 'local-test-password-123' });

    const loginError = document.getElementById('login-error');
    const loginForm = document.getElementById('admin-login-form');
    const dashboard = document.getElementById('admin-dashboard');
    expect(loginError.hidden).toBe(true);
    expect(loginForm.hidden).toBe(true);
    expect(dashboard.hidden).toBe(false);

    // loadAuditLog() fired a second real fetch and rendered the result.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [auditUrl, auditOpts] = fetchImpl.mock.calls[1];
    expect(auditUrl).toBe('/api/admin/audit-log');
    expect(auditOpts.credentials).toBe('same-origin');

    const rows = document.querySelectorAll('#audit-log-body tr');
    expect(rows.length).toBe(1);
    expect(rows[0].querySelector('.remove-btn').getAttribute('data-endpoint')).toBe('/api/admin/classes/2');
  });

  it('alerts on a network-level login failure (fetch rejects) instead of leaving the form inert', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { window, document } = setupAdminPage({ fetchImpl });
    window.alert = vi.fn();

    submitLoginForm(window, document, 'whatever');
    await flushMicrotasks();

    expect(window.alert).toHaveBeenCalledWith('Failed to log in — check your connection');
  });
});

// Sample entries mirroring the real shape observed from a live
// `wrangler pages dev .` server's GET /api/admin/audit-log (see the Task 15
// verification report): { id, class_id, entity_type, action, snapshot,
// created_at }, where entity_type is 'class' | 'volunteer_signup' |
// 'student_signup' and action is 'created' | 'edited' | 'removed'.
const CLASS_CREATED_ENTRY = {
  id: 7,
  class_id: 2,
  entity_type: 'class',
  action: 'created',
  snapshot: { id: 2, title: 'Verify Task15 Class', status: 'upcoming' },
  created_at: '2026-09-21 00:51:22',
};
const VOLUNTEER_CREATED_ENTRY = {
  id: 8,
  class_id: 2,
  entity_type: 'volunteer_signup',
  action: 'created',
  snapshot: { id: 41, class_id: 2, name: 'Vera Volunteer', email: 'vera@example.com' },
  created_at: '2026-09-21 00:51:22',
};
const STUDENT_CREATED_ENTRY = {
  id: 9,
  class_id: 2,
  entity_type: 'student_signup',
  action: 'created',
  snapshot: { id: 52, class_id: 2, student_name: 'Sammy Student', parent_name: 'Pat Parent' },
  created_at: '2026-09-21 00:51:22',
};
const VOLUNTEER_REMOVED_ENTRY = {
  id: 2,
  class_id: 1,
  entity_type: 'volunteer_signup',
  action: 'removed',
  snapshot: { id: 1, class_id: 1, name: 'Alice Volunteer', email: 'alice@example.com' },
  created_at: '2026-09-21 00:32:01',
};

describe('js/admin.js auditEntryDeleteEndpoint', () => {
  it('builds the classes hard-delete endpoint from class_id for a class entry', () => {
    const { window } = setupAdminPage();
    expect(window.auditEntryDeleteEndpoint(CLASS_CREATED_ENTRY)).toBe('/api/admin/classes/2');
  });

  it('builds the volunteer-signups hard-delete endpoint from snapshot.id for a volunteer_signup entry', () => {
    const { window } = setupAdminPage();
    expect(window.auditEntryDeleteEndpoint(VOLUNTEER_CREATED_ENTRY)).toBe('/api/admin/volunteer-signups/41');
  });

  it('builds the student-signups hard-delete endpoint from snapshot.id for a student_signup entry', () => {
    const { window } = setupAdminPage();
    expect(window.auditEntryDeleteEndpoint(STUDENT_CREATED_ENTRY)).toBe('/api/admin/student-signups/52');
  });

  it('returns null (no delete endpoint) for an entry whose action is already "removed"', () => {
    const { window } = setupAdminPage();
    expect(window.auditEntryDeleteEndpoint(VOLUNTEER_REMOVED_ENTRY)).toBe(null);
  });
});

describe('js/admin.js escapeHtmlAdmin', () => {
  it('escapes HTML-significant characters instead of letting them parse as markup', () => {
    const { window } = setupAdminPage();
    expect(window.escapeHtmlAdmin('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('returns an empty string for null/undefined and stringifies other values', () => {
    const { window } = setupAdminPage();
    expect(window.escapeHtmlAdmin(null)).toBe('');
    expect(window.escapeHtmlAdmin(undefined)).toBe('');
    expect(window.escapeHtmlAdmin(2)).toBe('2');
  });
});

describe('js/admin.js renderAuditLog', () => {
  it('renders one row per entry with a Hard delete button for non-removed entries', () => {
    const { window, document } = setupAdminPage();
    window.renderAuditLog([CLASS_CREATED_ENTRY, VOLUNTEER_CREATED_ENTRY, STUDENT_CREATED_ENTRY]);

    const rows = document.querySelectorAll('#audit-log-body tr');
    expect(rows.length).toBe(3);

    const classRow = rows[0];
    expect(classRow.children[0].textContent).toBe('2026-09-21 00:51:22');
    expect(classRow.children[1].textContent).toBe('2');
    expect(classRow.children[2].textContent).toBe('class');
    expect(classRow.children[3].textContent).toBe('created');
    const classBtn = classRow.querySelector('.remove-btn');
    expect(classBtn).not.toBeNull();
    expect(classBtn.getAttribute('data-endpoint')).toBe('/api/admin/classes/2');
    expect(classBtn.textContent).toBe('Hard delete');

    const volunteerBtn = rows[1].querySelector('.remove-btn');
    expect(volunteerBtn.getAttribute('data-endpoint')).toBe('/api/admin/volunteer-signups/41');

    const studentBtn = rows[2].querySelector('.remove-btn');
    expect(studentBtn.getAttribute('data-endpoint')).toBe('/api/admin/student-signups/52');
  });

  it('omits the Hard delete button for entries whose action is "removed"', () => {
    const { window, document } = setupAdminPage();
    window.renderAuditLog([VOLUNTEER_REMOVED_ENTRY]);

    const row = document.querySelector('#audit-log-body tr');
    expect(row.querySelector('.remove-btn')).toBeNull();
    // The trailing action/button cell is still present but empty.
    expect(row.children[3].textContent).toBe('removed');
    expect(row.children[5].textContent).toBe('');
  });

  it('escapes a <script>-bearing snapshot value instead of injecting a live script element', () => {
    const { window, document } = setupAdminPage();
    const maliciousEntry = {
      ...CLASS_CREATED_ENTRY,
      snapshot: { title: '<script>window.__xss = true;</script>' },
    };
    window.renderAuditLog([maliciousEntry]);

    const tbody = document.getElementById('audit-log-body');
    // No real <script> element was parsed into the DOM...
    expect(tbody.querySelector('script')).toBeNull();
    expect(window.__xss).toBeUndefined();
    // ...but the escaped text is still visible in the details cell.
    const detailsCell = tbody.querySelector('tr').children[4];
    expect(detailsCell.textContent).toContain('<script>window.__xss = true;</script>');
    expect(detailsCell.innerHTML).toContain('&lt;script&gt;');
  });

  it('does nothing (no throw) when #audit-log-body is missing from the page', () => {
    const { window, document } = setupAdminPage();
    document.getElementById('audit-log-body').remove();
    expect(() => window.renderAuditLog([CLASS_CREATED_ENTRY])).not.toThrow();
  });
});

describe('js/admin.js loadAuditLog', () => {
  it('GETs /api/admin/audit-log with same-origin credentials and renders the returned entries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([CLASS_CREATED_ENTRY]),
    });
    const { window, document } = setupAdminPage({ fetchImpl });

    window.loadAuditLog();
    await flushMicrotasks();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/admin/audit-log');
    expect(opts.credentials).toBe('same-origin');

    const rows = document.querySelectorAll('#audit-log-body tr');
    expect(rows.length).toBe(1);
    expect(rows[0].querySelector('.remove-btn').getAttribute('data-endpoint')).toBe('/api/admin/classes/2');
  });

  it('on a 401 response, re-shows the login form and hides the dashboard instead of silently rendering an empty table', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Unauthorized' }),
    });
    const { window, document } = setupAdminPage({ fetchImpl });
    // Simulate an already-logged-in state (as if the session just expired).
    document.getElementById('admin-login-form').hidden = true;
    document.getElementById('admin-dashboard').hidden = false;

    window.loadAuditLog();
    await flushMicrotasks();

    expect(document.getElementById('admin-dashboard').hidden).toBe(true);
    expect(document.getElementById('admin-login-form').hidden).toBe(false);
    // No generic alert for the expected/handled 401 case.
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('alerts on a non-401 failure status instead of silently failing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'boom' }),
    });
    const { window } = setupAdminPage({ fetchImpl });

    window.loadAuditLog();
    await flushMicrotasks();

    expect(window.alert).toHaveBeenCalledWith('Failed to load audit log');
  });
});

describe('js/admin.js Hard delete button click handling', () => {
  it('does NOT call DELETE when confirm() is declined', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([CLASS_CREATED_ENTRY]),
    });
    const confirmImpl = vi.fn(() => false);
    const { window, document } = setupAdminPage({ fetchImpl, confirmImpl });

    window.renderAuditLog([CLASS_CREATED_ENTRY]);
    document.querySelector('.remove-btn').dispatchEvent(new window.Event('click', { bubbles: true }));
    await flushMicrotasks();

    expect(confirmImpl).toHaveBeenCalledWith('Permanently delete this?');
    // renderAuditLog itself doesn't fetch, so confirm-declined means zero fetches total.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('DELETEs the entry endpoint and reloads the audit log when confirm() is accepted', async () => {
    const deleteResponse = { ok: true, status: 204, json: () => Promise.resolve(null) };
    const reloadedListResponse = { ok: true, json: () => Promise.resolve([]) };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(deleteResponse)
      .mockResolvedValueOnce(reloadedListResponse);
    const confirmImpl = vi.fn(() => true);
    const { window, document } = setupAdminPage({ fetchImpl, confirmImpl });

    window.renderAuditLog([CLASS_CREATED_ENTRY]);
    document.querySelector('.remove-btn').dispatchEvent(new window.Event('click', { bubbles: true }));
    await flushMicrotasks();

    expect(confirmImpl).toHaveBeenCalledWith('Permanently delete this?');
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const [deleteUrl, deleteOpts] = fetchImpl.mock.calls[0];
    expect(deleteUrl).toBe('/api/admin/classes/2');
    expect(deleteOpts.method).toBe('DELETE');
    expect(deleteOpts.credentials).toBe('same-origin');

    // The click handler's .then() calls loadAuditLog(), which re-fetches the list.
    const [reloadUrl] = fetchImpl.mock.calls[1];
    expect(reloadUrl).toBe('/api/admin/audit-log');

    // The reload rendered an empty table (the mocked reload response is []).
    expect(document.querySelectorAll('#audit-log-body tr').length).toBe(0);
  });

  it('alerts when the hard-delete DELETE fails (e.g. 401/500) instead of silently appearing to succeed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({ error: 'boom' }) });
    const confirmImpl = vi.fn(() => true);
    const { window, document } = setupAdminPage({ fetchImpl, confirmImpl });

    window.renderAuditLog([CLASS_CREATED_ENTRY]);
    document.querySelector('.remove-btn').dispatchEvent(new window.Event('click', { bubbles: true }));
    await flushMicrotasks();

    expect(fetchImpl).toHaveBeenCalledTimes(1); // no follow-up loadAuditLog() call
    expect(window.alert).toHaveBeenCalledWith('Failed to delete');
  });
});
