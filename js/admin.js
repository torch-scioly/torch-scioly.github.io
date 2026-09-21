var API_BASE = 'https://torch-signups.pages.dev';

document.addEventListener('DOMContentLoaded', function () {
  var loginForm = document.getElementById('admin-login-form');
  var loginError = document.getElementById('login-error');
  var dashboard = document.getElementById('admin-dashboard');

  if (loginForm) {
    loginForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var formData = new FormData(loginForm);

      fetch(API_BASE + '/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: formData.get('password') }),
        credentials: 'include',
      })
        .then(function (res) {
          if (!res.ok) {
            loginError.hidden = false;
            return;
          }
          loginError.hidden = true;
          loginForm.hidden = true;
          dashboard.hidden = false;
          loadAuditLog();
        })
        .catch(function () {
          alert('Failed to log in — check your connection');
        });
    });
  }
});

function loadAuditLog() {
  fetch(API_BASE + '/api/admin/audit-log', { credentials: 'include' })
    .then(function (res) {
      if (res.status === 401) {
        var loginForm = document.getElementById('admin-login-form');
        var dashboard = document.getElementById('admin-dashboard');
        if (dashboard) dashboard.hidden = true;
        if (loginForm) loginForm.hidden = false;
        return null;
      }
      if (!res.ok) throw new Error('Failed to load audit log');
      return res.json();
    })
    .then(function (entries) {
      if (entries) renderAuditLog(entries);
    })
    .catch(function (err) {
      alert(err.message);
    });
}

function renderAuditLog(entries) {
  var tbody = document.getElementById('audit-log-body');
  if (!tbody) return;

  tbody.innerHTML = entries.map(function (entry) {
    var endpoint = auditEntryDeleteEndpoint(entry);
    var deleteHtml = endpoint
      ? '<button class="btn btn-danger remove-btn" data-endpoint="' + endpoint + '">Hard delete</button>'
      : '';

    return (
      '<tr>' +
        '<td>' + escapeHtmlAdmin(entry.created_at) + '</td>' +
        '<td>' + entry.class_id + '</td>' +
        '<td>' + escapeHtmlAdmin(entry.entity_type) + '</td>' +
        '<td>' + escapeHtmlAdmin(entry.action) + '</td>' +
        '<td>' + escapeHtmlAdmin(JSON.stringify(entry.snapshot)) + '</td>' +
        '<td>' + deleteHtml + '</td>' +
      '</tr>'
    );
  }).join('');

  tbody.querySelectorAll('.remove-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!confirm('Permanently delete this?')) return;
      fetch(btn.getAttribute('data-endpoint'), { method: 'DELETE', credentials: 'include' })
        .then(function (res) {
          if (!res.ok) throw new Error('Failed to delete');
          loadAuditLog();
        })
        .catch(function (err) {
          alert(err.message);
        });
    });
  });
}

function auditEntryDeleteEndpoint(entry) {
  if (entry.action === 'removed') return null;
  if (entry.entity_type === 'class') return API_BASE + '/api/admin/classes/' + entry.class_id;
  if (entry.entity_type === 'volunteer_signup') return API_BASE + '/api/admin/volunteer-signups/' + entry.snapshot.id;
  if (entry.entity_type === 'student_signup') return API_BASE + '/api/admin/student-signups/' + entry.snapshot.id;
  return null;
}

function escapeHtmlAdmin(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
