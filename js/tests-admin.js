var API_BASE = 'https://torch-signups.pages.dev';

// Staff page for Practice Tests: upload a filled-in TORCH-test-template.xlsx, publish or
// mark tests session-only, run session codes, see results, grade answers waiting for a
// volunteer, and reissue lost parent links. Uses the existing admin password login.
var TA_FIELD_ROW = 3; // "Test info" field/value rows start on spreadsheet row 4 (index 3).

document.addEventListener('DOMContentLoaded', function () {
  if (document.getElementById('ta-app')) taCheckSession();
});

function taEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Turns the template workbook into the payload POST /api/admin/tests expects. Blank rows
// are kept (blankrows) so the server's "Row N" errors match the spreadsheet.
function workbookToPayload(workbook) {
  var infoSheet = workbook.Sheets['Test info'];
  var questionSheet = workbook.Sheets.Questions;
  if (!infoSheet) throw new Error('This file has no "Test info" tab. Use the TORCH test template.');
  if (!questionSheet) throw new Error('This file has no "Questions" tab. Use the TORCH test template.');

  var info = {};
  XLSX.utils.sheet_to_json(infoSheet, { header: 1, defval: '', blankrows: true }).slice(TA_FIELD_ROW).forEach(function (row) {
    var field = String(row[0] || '').trim();
    if (field) info[field] = row[1];
  });
  var questions = XLSX.utils.sheet_to_json(questionSheet, { defval: '', blankrows: true });
  return { info: info, questions: questions };
}

function taApi(path, options) {
  options = options || {};
  return fetch(API_BASE + path, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'include',
  }).then(function (res) {
    if (res.status === 204) return null;
    return res.json().then(function (data) {
      if (res.status === 401) {
        taShowLogin();
        throw new Error('Please sign in again.');
      }
      if (!res.ok) {
        var err = new Error((data && (data.error || (data.errors || []).join('\n'))) || 'Something went wrong');
        err.data = data;
        throw err;
      }
      return data;
    });
  });
}

function taFail(err) {
  alert(err && err.message ? err.message : 'Something went wrong');
}

function taApp() {
  return document.getElementById('ta-app');
}

function taCheckSession() {
  fetch(API_BASE + '/api/admin/tests', { credentials: 'include' })
    .then(function (res) { res.ok ? taShowDashboard() : taShowLogin(); })
    .catch(taShowLogin);
}

function taShowLogin() {
  taApp().innerHTML =
    '<div class="tests-card"><h2>Volunteer sign-in</h2>' +
      '<form id="ta-login" class="signup-form"><label>Admin password<input type="password" name="password" required></label>' +
      '<button type="submit" class="btn btn-primary">Sign in</button></form></div>';
  document.getElementById('ta-login').addEventListener('submit', function (e) {
    e.preventDefault();
    fetch(API_BASE + '/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: e.target.password.value }), credentials: 'include',
    })
      .then(function (res) { res.ok ? taShowDashboard() : alert('Wrong password'); })
      .catch(taFail);
  });
}

function taShowDashboard() {
  taApp().innerHTML =
    '<div class="tests-card tests-toolbar">' +
      '<button type="button" class="btn btn-primary" data-tab="upload">Upload a test</button>' +
      '<button type="button" class="btn btn-secondary" data-tab="tests">Tests &amp; results</button>' +
      '<button type="button" class="btn btn-secondary" data-tab="kids">Kids</button>' +
    '</div><div id="ta-view"></div>';
  taApp().querySelectorAll('[data-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () { taShowTab(btn.getAttribute('data-tab')); });
  });
  taShowTab('tests');
}

function taShowTab(tab) {
  if (tab === 'upload') taShowUpload();
  else if (tab === 'kids') taShowKids();
  else taShowTests();
}

function taView() {
  return document.getElementById('ta-view');
}

// ---- Upload --------------------------------------------------------------------------

function taShowUpload() {
  taView().innerHTML =
    '<div class="tests-card"><h2>Upload a test</h2>' +
      '<p class="tests-note">Fill in the <a href="TORCH-test-template.xlsx" download>TORCH test template</a>, then choose the file. ' +
      'You’ll see a preview and any problems before anything is saved.</p>' +
      '<input type="file" id="ta-file" accept=".xlsx">' +
      '<div id="ta-preview"></div></div>';
  document.getElementById('ta-file').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    file.arrayBuffer().then(function (buffer) {
      var payload;
      try {
        payload = workbookToPayload(XLSX.read(buffer, { type: 'array' }));
      } catch (err) {
        return taFail(err);
      }
      taApi('/api/admin/tests?dryRun=1', { method: 'POST', body: payload })
        .then(function (check) { taRenderPreview(payload, check); })
        .catch(taFail);
    });
  });
}

function taRenderPreview(payload, check) {
  var rows = payload.questions.filter(function (q) { return String(q.Question || '').trim() || String(q.Type || '').trim(); });
  var preview = document.getElementById('ta-preview');
  preview.innerHTML =
    (check.errors.length
      ? '<div class="ta-errors"><h3>Fix these in the spreadsheet, then choose the file again</h3><ul>' +
          check.errors.map(function (e) { return '<li>' + taEscape(e) + '</li>'; }).join('') + '</ul></div>'
      : '<p class="ta-ok">✅ Looks good: ' + check.questionCount + ' questions.</p>') +
    '<h3>' + taEscape(payload.info.Title) + '</h3>' +
    '<p class="class-meta">' + taEscape(payload.info.Event) + ' · ' + taEscape(payload.info.Format) + ' · ' + taEscape(payload.info.School) +
      (payload.info['Time limit (min)'] ? ' · ' + taEscape(payload.info['Time limit (min)']) + ' min' : '') + '</p>' +
    '<div class="ta-table-wrap"><table class="ta-table"><tr><th>#</th><th>Topic</th><th>Type</th><th>Question</th><th>Answer</th><th>Pts</th></tr>' +
      rows.map(function (q, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + taEscape(q.Topic) + '</td><td>' + taEscape(q.Type) + '</td><td>' + taEscape(q.Question) +
          '</td><td>' + taEscape(q.Answer) + '</td><td>' + taEscape(q.Points) + '</td></tr>';
      }).join('') + '</table></div>' +
    '<button type="button" class="btn btn-primary" id="ta-save"' + (check.errors.length ? ' disabled' : '') + '>Save test</button>';
  document.getElementById('ta-save').addEventListener('click', function () {
    taApi('/api/admin/tests', { method: 'POST', body: payload })
      .then(function (saved) {
        alert('Saved: ' + saved.questionCount + ' questions. It’s live for kids now (unless you mark it session-only).');
        taShowTests();
      })
      .catch(taFail);
  });
}

// ---- Tests, sessions, results --------------------------------------------------------

function taShowTests() {
  taView().innerHTML = '<p>Loading…</p>';
  taApi('/api/admin/tests')
    .then(function (tests) {
      taView().innerHTML = tests.length
        ? tests.map(function (t) {
            return '<div class="tests-card" data-test="' + t.id + '">' +
              '<span class="badge badge-blue">' + taEscape(t.event) + '</span> <span class="badge badge-orange">' + taEscape(t.school) + '</span>' +
              '<h3>' + taEscape(t.title) + '</h3>' +
              '<p class="class-meta">' + t.questionCount + ' questions · ' + t.attemptCount + ' submitted</p>' +
              '<label class="ta-toggle"><input type="checkbox" data-flag="published"' + (t.published ? ' checked' : '') + '> Published</label> ' +
              '<label class="ta-toggle"><input type="checkbox" data-flag="sessionOnly"' + (t.sessionOnly ? ' checked' : '') + '> Session only (needs a code)</label>' +
              '<div class="ta-actions">' +
                '<button type="button" class="btn btn-primary" data-action="session">Start session</button> ' +
                '<button type="button" class="btn btn-secondary" data-action="results">Results</button>' +
              '</div><div class="ta-session"></div></div>';
          }).join('')
        : '<p>No tests yet. Upload one!</p>';

      taView().querySelectorAll('[data-test]').forEach(function (card) {
        var id = card.getAttribute('data-test');
        card.querySelectorAll('[data-flag]').forEach(function (box) {
          box.addEventListener('change', function () {
            var body = {};
            body[box.getAttribute('data-flag')] = box.checked;
            taApi('/api/admin/tests/' + id, { method: 'PUT', body: body }).catch(taFail);
          });
        });
        card.querySelector('[data-action="session"]').addEventListener('click', function () {
          taApi('/api/admin/tests/' + id + '/sessions', { method: 'POST', body: {} })
            .then(function (s) {
              var box = card.querySelector('.ta-session');
              box.innerHTML = '<p>Kids sign in on the Tests page and enter this code:</p><p class="ta-code">' + taEscape(s.code) + '</p>' +
                '<button type="button" class="btn btn-secondary">End session (unlocks reviews)</button>';
              box.querySelector('button').addEventListener('click', function () {
                taApi('/api/admin/test-sessions/' + s.code + '/end', { method: 'POST', body: {} })
                  .then(function () { box.innerHTML = '<p>Session ended. Kids can now see their reviews.</p>'; })
                  .catch(taFail);
              });
            })
            .catch(taFail);
        });
        card.querySelector('[data-action="results"]').addEventListener('click', function () { taShowResults(id); });
      });
    })
    .catch(taFail);
}

function taShowResults(testId) {
  taView().innerHTML = '<p>Loading…</p>';
  taApi('/api/admin/tests/' + testId + '/results')
    .then(function (r) {
      var byId = {};
      r.questions.forEach(function (q) { byId[q.id] = q; });
      taView().innerHTML =
        '<div class="tests-card"><h2>' + taEscape(r.test.title) + '</h2>' +
          (r.needsVolunteer ? '<p class="ta-errors">⏳ ' + r.needsVolunteer + ' written answer(s) need a volunteer to grade.</p>' : '') +
          '<h3>Question stats</h3><ul>' + r.questionStats.map(function (s) {
            return '<li>Q' + s.position + ': ' + (s.percentCorrect === null ? '–' : s.percentCorrect + '% correct') + '</li>';
          }).join('') + '</ul></div>' +
        r.attempts.map(function (a) {
          return '<div class="tests-card"><h3>' + taEscape(a.kid.displayName) + ' · ' + taEscape(formatTaScore(a.score)) + ' / ' + taEscape(formatTaScore(a.maxScore)) +
            (a.isFirst ? '' : ' <span class="class-meta">(practice retake)</span>') + '</h3>' +
            a.answers.map(function (x) {
              var q = byId[x.questionId] || {};
              return '<div class="ta-answer ' + taEscape(x.status) + '">' +
                '<p><strong>Q' + x.position + '</strong> ' + taEscape(q.prompt) + '</p>' +
                '<p>Answer: ' + taEscape(x.response || '(blank)') + ' · ' + (x.points === null ? 'not graded' : taEscape(formatTaScore(x.points)) + '/' + q.maxPoints) +
                  (x.gradedBy ? ' · ' + taEscape(x.gradedBy) : '') + '</p>' +
                (x.feedback ? '<p class="tests-note">AI: ' + taEscape(x.feedback) + '</p>' : '') +
                (q.type === 'Written answer' || x.status === 'needs_volunteer'
                  ? '<form class="ta-grade" data-answer="' + x.answerId + '"><input type="number" step="0.5" min="0" max="' + q.maxPoints + '" name="points" required placeholder="points">' +
                      '<input type="text" name="note" placeholder="note (optional)"><button type="submit" class="btn btn-secondary">Set score</button></form>'
                  : '') +
              '</div>';
            }).join('') + '</div>';
        }).join('') +
        '<button type="button" class="btn btn-secondary" id="ta-back">Back to tests</button>';
      taView().querySelectorAll('.ta-grade').forEach(function (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          taApi('/api/admin/attempt-answers/' + form.getAttribute('data-answer'), {
            method: 'PUT', body: { points: Number(form.points.value), note: form.note.value },
          })
            .then(function () { taShowResults(testId); })
            .catch(taFail);
        });
      });
      document.getElementById('ta-back').addEventListener('click', taShowTests);
    })
    .catch(taFail);
}

function formatTaScore(n) {
  return n === null || n === undefined ? '–' : String(Math.round(n * 100) / 100);
}

// ---- Kids ----------------------------------------------------------------------------

function taShowKids() {
  taView().innerHTML =
    '<div class="tests-card"><label>School <select id="ta-school"><option>QVMS</option><option>SBE</option></select></label></div><div id="ta-kids"></div>';
  var load = function () {
    var school = document.getElementById('ta-school').value;
    taApi('/api/admin/kids?school=' + encodeURIComponent(school))
      .then(function (kids) {
        var el = document.getElementById('ta-kids');
        el.innerHTML = kids.length
          ? kids.map(function (k) {
              return '<div class="tests-card"><h3>' + taEscape(k.displayName) + (k.grade ? ' · Grade ' + taEscape(k.grade) : '') + '</h3>' +
                '<p class="class-meta">' + taEscape(k.username) + '</p>' +
                (k.events.length
                  ? '<ul>' + k.events.map(function (e) {
                      return '<li>' + taEscape(e.event) + ': ' + e.firstAttemptAvgPercent + '% avg over ' + e.tests + ' test(s)</li>';
                    }).join('') + '</ul>'
                  : '<p class="tests-note">No tests yet.</p>') +
                '<button type="button" class="btn btn-secondary" data-parent="' + k.parentId + '">New parent link</button>' +
                '<p class="tests-link" hidden></p></div>';
            }).join('')
          : '<p>No kids registered yet.</p>';
        el.querySelectorAll('[data-parent]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            if (!confirm('Make a new parent link? The parent’s current link will stop working.')) return;
            taApi('/api/admin/tests/parents/' + btn.getAttribute('data-parent') + '/link', { method: 'POST', body: {} })
              .then(function (data) {
                var out = btn.nextElementSibling;
                out.hidden = false;
                out.textContent = 'https://torch-scioly.github.io/tests.html#parent=' + data.parentKey + '  (send this to the parent privately)';
              })
              .catch(taFail);
          });
        });
      })
      .catch(taFail);
  };
  document.getElementById('ta-school').addEventListener('change', load);
  load();
}
