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
function setupAdminPage({ fetchImpl } = {}) {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = ADMIN_HTML_FIXTURE;

  window.fetch = fetchImpl || vi.fn();

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

  it('hides the login form and reveals the dashboard on a successful login, then throws calling the not-yet-defined loadAuditLog (expected until Task 15)', async () => {
    // Mirrors the real response observed from a live `wrangler pages dev .`
    // server for the correct password: HTTP 200 {"ok":true} with a
    // Set-Cookie session header.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
    });
    const { window, document } = setupAdminPage({ fetchImpl });

    const rejections = [];
    const onUnhandledRejection = (reason) => rejections.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      submitLoginForm(window, document, 'local-test-password-123');
      await flushMicrotasks();
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/admin/login');
    expect(opts.credentials).toBe('same-origin');
    expect(JSON.parse(opts.body)).toEqual({ password: 'local-test-password-123' });

    const loginError = document.getElementById('login-error');
    const loginForm = document.getElementById('admin-login-form');
    const dashboard = document.getElementById('admin-dashboard');
    // DOM transitions run (in source order) before the loadAuditLog() call
    // throws, so they take effect even though the call after them fails.
    expect(loginError.hidden).toBe(true);
    expect(loginForm.hidden).toBe(true);
    expect(dashboard.hidden).toBe(false);

    // The brief documents that loadAuditLog (Task 15) is undefined at this
    // checkpoint and that logging in successfully throws a console error.
    // We assert that real, observed failure here instead of predicting it.
    // rejections[0] is a ReferenceError from the vm context's own realm
    // (a separate global from this test file's), so it isn't `instanceof`
    // this file's Error constructor — we assert on its name/message instead.
    expect(rejections.length).toBe(1);
    expect(rejections[0].name).toBe('ReferenceError');
    expect(rejections[0].message).toMatch(/loadAuditLog is not defined/);
  });
});
