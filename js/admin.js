document.addEventListener('DOMContentLoaded', function () {
  var loginForm = document.getElementById('admin-login-form');
  var loginError = document.getElementById('login-error');
  var dashboard = document.getElementById('admin-dashboard');

  if (loginForm) {
    loginForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var formData = new FormData(loginForm);

      fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: formData.get('password') }),
        credentials: 'same-origin',
      }).then(function (res) {
        if (!res.ok) {
          loginError.hidden = false;
          return;
        }
        loginError.hidden = true;
        loginForm.hidden = true;
        dashboard.hidden = false;
        loadAuditLog();
      });
    });
  }
});

function loadAuditLog() {
  fetch('/api/admin/audit-log', { credentials: 'same-origin' })
    .then(function (res) { return res.json(); })
    .then(renderAuditLog);
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
      fetch(btn.getAttribute('data-endpoint'), { method: 'DELETE', credentials: 'same-origin' })
        .then(function () { loadAuditLog(); });
    });
  });
}

function auditEntryDeleteEndpoint(entry) {
  if (entry.action === 'removed') return null;
  if (entry.entity_type === 'class') return '/api/admin/classes/' + entry.class_id;
  if (entry.entity_type === 'volunteer_signup') return '/api/admin/volunteer-signups/' + entry.snapshot.id;
  if (entry.entity_type === 'student_signup') return '/api/admin/student-signups/' + entry.snapshot.id;
  return null;
}

function escapeHtmlAdmin(value) {
  var div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}
