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
