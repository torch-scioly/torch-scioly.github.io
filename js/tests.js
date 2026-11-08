var API_BASE = 'https://torch-signups.pages.dev';

// Tests page: parents register kids and manage them through a private parent link;
// kids sign in with username + PIN, take auto-graded practice tests, and review their
// answers. Sign-in lives only on this page. Kid sessions use a bearer token kept in
// sessionStorage (not a cookie: the API is on a different site).
var TESTS_TOKEN_KEY = 'torch_kid_token';
var TESTS_KID_KEY = 'torch_kid';
var TESTS_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
var TESTS_SITE = 'https://torch-scioly.github.io/tests.html';

document.addEventListener('DOMContentLoaded', function () {
  if (document.getElementById('tests-app')) testsRoute();
});

window.addEventListener('hashchange', function () {
  if (document.getElementById('tests-app')) testsRoute();
});

function testsEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parentKeyFromHash(hash) {
  var match = /(?:^#|&)parent=([A-Za-z0-9_-]+)/.exec(hash || '');
  return match ? match[1] : null;
}

function formatRemaining(ms) {
  var total = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

function testsStore(key, value) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch (e) { /* storage blocked: the kid just signs in again */ }
}

function testsRead(key) {
  try { return window.sessionStorage.getItem(key); } catch (e) { return null; }
}

// fetch wrapper: adds the kid token or parent key, parses JSON, rejects with the API's error.
function testsApi(path, options) {
  options = options || {};
  var headers = { 'Content-Type': 'application/json' };
  var token = testsRead(TESTS_TOKEN_KEY);
  if (options.parentKey) headers['X-Parent-Key'] = options.parentKey;
  else if (token) headers.Authorization = 'Bearer ' + token;
  return window.fetch(API_BASE + path, {
    method: options.method || 'GET',
    headers: headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }).then(function (res) {
    if (res.status === 204) return null;
    return res.json().then(function (data) {
      if (!res.ok) {
        var err = new Error((data && (data.error || (data.errors || []).join('\n'))) || 'Something went wrong');
        err.status = res.status;
        throw err;
      }
      return data;
    });
  });
}

function testsApp() {
  return document.getElementById('tests-app');
}

function testsRoute() {
  var key = parentKeyFromHash(window.location.hash);
  if (key) return showParent(key);
  if (testsRead(TESTS_TOKEN_KEY)) return showTestList();
  showSignin();
}

function testsSignOut() {
  testsStore(TESTS_TOKEN_KEY, null);
  testsStore(TESTS_KID_KEY, null);
  showSignin();
}

// Shown for any API failure. An expired kid token sends the kid back to sign-in.
function testsFail(err) {
  if (err && err.status === 401 && testsRead(TESTS_TOKEN_KEY)) {
    testsSignOut();
    return;
  }
  window.alert(err && err.message ? err.message : 'Something went wrong. Please try again.');
}

// ---- Sign-in -------------------------------------------------------------------------

function showSignin() {
  var app = testsApp();
  app.innerHTML =
    '<div class="tests-card">' +
      '<h2>Student sign-in</h2>' +
      '<form id="tests-signin" class="signup-form">' +
        '<label>Username<input type="text" name="username" autocomplete="username" autocapitalize="none" required></label>' +
        '<label>PIN<input type="password" name="pin" inputmode="numeric" pattern="[0-9]{4,6}" autocomplete="current-password" required></label>' +
        '<label>Test code from your volunteer (optional)<input type="text" name="code" autocapitalize="characters" maxlength="6"></label>' +
        '<button type="submit" class="btn btn-primary">Sign in</button>' +
      '</form>' +
      '<p class="tests-note">Parents: <a href="#" id="tests-show-register">register your child</a> to get a username and PIN.</p>' +
    '</div>';
  document.getElementById('tests-show-register').addEventListener('click', function (e) {
    e.preventDefault();
    showRegister();
  });
  document.getElementById('tests-signin').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    var code = form.code.value.trim();
    testsApi('/api/tests/login', { method: 'POST', body: { username: form.username.value, pin: form.pin.value } })
      .then(function (data) {
        testsStore(TESTS_TOKEN_KEY, data.token);
        testsStore(TESTS_KID_KEY, JSON.stringify(data.kid));
        if (code) return joinWithCode(code);
        showTestList();
      })
      .catch(testsFail);
  });
}

// ---- Parent registration -------------------------------------------------------------

function kidRowHtml() {
  return '<fieldset class="tests-kid-row">' +
    '<label>Child’s first name<input type="text" name="firstName" required></label>' +
    '<label>Last initial<input type="text" name="lastInitial" maxlength="1" required></label>' +
    '<label>Grade<input type="text" name="grade" inputmode="numeric" maxlength="2"></label>' +
    '<label>Pick a 4–6 digit PIN<input type="text" name="pin" inputmode="numeric" pattern="[0-9]{4,6}" required></label>' +
  '</fieldset>';
}

function showRegister() {
  var app = testsApp();
  app.innerHTML =
    '<div class="tests-card">' +
      '<h2>Register your child</h2>' +
      '<p class="tests-note">We only store your child’s first name, last initial, grade and school, plus their test answers. No child email is needed.</p>' +
      '<form id="tests-register" class="signup-form">' +
        '<label>Your name<input type="text" name="parentName" required></label>' +
        '<label>Your email<input type="email" name="parentEmail" required></label>' +
        '<label>School<select name="school"><option value="QVMS">Quail Valley Middle School</option><option value="SBE">Sonal Bhuchar Elementary</option></select></label>' +
        '<div id="tests-kid-rows">' + kidRowHtml() + '</div>' +
        '<button type="button" class="btn btn-secondary" id="tests-add-kid-row">+ Add another child</button>' +
        '<label class="tests-consent"><input type="checkbox" name="consent" required> I am this child’s parent or guardian and agree to the <a href="tests-terms.html" target="_blank" rel="noopener">TORCH Practice Tests terms</a>.</label>' +
        '<button type="submit" class="btn btn-primary">Register</button>' +
        '<button type="button" class="btn btn-secondary" id="tests-register-cancel">Back to sign-in</button>' +
      '</form>' +
    '</div>';
  document.getElementById('tests-add-kid-row').addEventListener('click', function () {
    document.getElementById('tests-kid-rows').insertAdjacentHTML('beforeend', kidRowHtml());
  });
  document.getElementById('tests-register-cancel').addEventListener('click', showSignin);
  document.getElementById('tests-register').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    var kids = Array.prototype.map.call(form.querySelectorAll('.tests-kid-row'), function (row) {
      return {
        firstName: row.querySelector('[name="firstName"]').value,
        lastInitial: row.querySelector('[name="lastInitial"]').value,
        grade: row.querySelector('[name="grade"]').value,
        pin: row.querySelector('[name="pin"]').value,
      };
    });
    testsApi('/api/tests/parents', {
      method: 'POST',
      body: {
        parentName: form.parentName.value, parentEmail: form.parentEmail.value, school: form.school.value,
        consent: form.consent.checked, kids: kids,
      },
    })
      .then(function (data) { showParentLinkBox(data.parentKey, data.kids); })
      .catch(testsFail);
  });
}

function parentLinkHtml(key, kids) {
  var link = TESTS_SITE + '#parent=' + key;
  return '<div id="parent-link-box" class="tests-card tests-link-box">' +
    '<h2>Save your parent link</h2>' +
    '<p><strong>Bookmark this link or save it as a PDF. It’s the only way back to your child’s account.</strong> ' +
      'Use it to see results, reset a PIN, or add another child. Don’t share it.</p>' +
    '<p class="tests-link"><a href="' + testsEscape(link) + '">' + testsEscape(link) + '</a></p>' +
    '<button type="button" class="btn btn-primary" id="tests-copy-link">Copy link</button> ' +
    '<button type="button" class="btn btn-secondary" id="tests-print-link">Save as PDF</button>' +
    (kids && kids.length
      ? '<h3>Sign-in for your child</h3><ul>' + kids.map(function (k) {
          return '<li>' + testsEscape(k.displayName) + ': username <strong>' + testsEscape(k.username) + '</strong> and the PIN you picked</li>';
        }).join('') + '</ul>'
      : '') +
    '<p><a href="' + testsEscape(link) + '" id="tests-open-parent">Go to your parent page →</a></p>' +
  '</div>';
}

function wireParentLinkBox(key) {
  var link = TESTS_SITE + '#parent=' + key;
  document.getElementById('tests-copy-link').addEventListener('click', function () {
    var done = function () { window.alert('Link copied.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function () { window.prompt('Copy this link:', link); });
    else window.prompt('Copy this link:', link);
  });
  document.getElementById('tests-print-link').addEventListener('click', function () {
    document.body.classList.add('print-parent-link');
    window.print();
    document.body.classList.remove('print-parent-link');
  });
}

function showParentLinkBox(key, kids) {
  testsApp().innerHTML = parentLinkHtml(key, kids);
  wireParentLinkBox(key);
}

// ---- Parent page ---------------------------------------------------------------------

function showParent(key) {
  testsStore(TESTS_TOKEN_KEY, null);
  var app = testsApp();
  app.innerHTML = '<p>Loading…</p>';
  testsApi('/api/tests/parent', { parentKey: key })
    .then(function (data) {
      app.innerHTML =
        '<div class="tests-card"><h2>Hi ' + testsEscape(data.parent.name) + '</h2>' +
          '<p class="tests-note">This page is private to you. Keep the link safe.</p></div>' +
        data.kids.map(function (k) {
          return '<div class="tests-card" data-kid="' + k.id + '">' +
            '<h3>' + testsEscape(k.displayName) + (k.grade ? ' · Grade ' + testsEscape(k.grade) : '') + '</h3>' +
            '<p>Username: <strong>' + testsEscape(k.username) + '</strong></p>' +
            '<form class="signup-form tests-pin-form"><label>New PIN (4–6 digits)<input type="text" name="pin" inputmode="numeric" pattern="[0-9]{4,6}" required></label>' +
              '<button type="submit" class="btn btn-secondary">Reset PIN</button></form>' +
            (k.attempts.length
              ? '<h4>Results</h4><ul class="tests-results">' + k.attempts.map(function (a) {
                  return '<li><a href="#" data-attempt="' + a.id + '">' + testsEscape(a.testTitle) + '</a> · ' +
                    testsEscape(formatScore(a.score)) + ' / ' + testsEscape(formatScore(a.maxScore)) + '</li>';
                }).join('') + '</ul>'
              : '<p class="tests-note">No tests taken yet.</p>') +
          '</div>';
        }).join('') +
        '<div class="tests-card"><h3>Add another child</h3><form class="signup-form" id="tests-parent-add">' + kidRowHtml() +
          '<button type="submit" class="btn btn-secondary">Add child</button></form></div>' +
        '<div class="tests-card"><h3>Lost track of who has this link?</h3>' +
          '<button type="button" class="btn btn-secondary" id="tests-new-link">Make a new parent link</button>' +
          '<p class="tests-note">The current link will stop working.</p></div>';

      app.querySelectorAll('.tests-pin-form').forEach(function (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var kidId = form.closest('[data-kid]').getAttribute('data-kid');
          testsApi('/api/tests/parent/kids/' + kidId + '/pin', { method: 'POST', parentKey: key, body: { pin: form.pin.value } })
            .then(function () { form.reset(); window.alert('PIN updated.'); })
            .catch(testsFail);
        });
      });
      app.querySelectorAll('[data-attempt]').forEach(function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          showAttempt(a.getAttribute('data-attempt'), key);
        });
      });
      document.getElementById('tests-parent-add').addEventListener('submit', function (e) {
        e.preventDefault();
        var row = e.target;
        testsApi('/api/tests/parent/kids', {
          method: 'POST', parentKey: key,
          body: {
            firstName: row.querySelector('[name="firstName"]').value, lastInitial: row.querySelector('[name="lastInitial"]').value,
            grade: row.querySelector('[name="grade"]').value, pin: row.querySelector('[name="pin"]').value,
          },
        })
          .then(function () { showParent(key); })
          .catch(testsFail);
      });
      document.getElementById('tests-new-link').addEventListener('click', function () {
        if (!window.confirm('Make a new link? The current one will stop working.')) return;
        testsApi('/api/tests/parent/link', { method: 'POST', parentKey: key, body: {} })
          .then(function (data) {
            history.replaceState(null, '', '#parent=' + data.parentKey);
            showParentLinkBox(data.parentKey, []);
          })
          .catch(testsFail);
      });
    })
    .catch(function (err) {
      app.innerHTML = '<div class="tests-card"><h2>This parent link isn’t valid</h2>' +
        '<p>It may have been replaced by a newer link. Ask your TORCH coach for a new one.</p></div>';
      if (err.status !== 401) testsFail(err);
    });
}

// ---- Kid: test list ------------------------------------------------------------------

function testsKid() {
  try { return JSON.parse(testsRead(TESTS_KID_KEY) || 'null'); } catch (e) { return null; }
}

function showTestList() {
  var app = testsApp();
  var kid = testsKid();
  app.innerHTML = '<p>Loading…</p>';
  testsApi('/api/tests')
    .then(function (tests) {
      app.innerHTML =
        '<div class="tests-card tests-toolbar">' +
          '<span>Signed in as <strong>' + testsEscape(kid ? kid.displayName : '') + '</strong></span> ' +
          '<button type="button" class="btn btn-secondary" id="tests-signout">Sign out</button>' +
          '<form id="tests-code-form" class="tests-code-form"><label>Have a test code?<input type="text" name="code" maxlength="6" autocapitalize="characters" required></label>' +
          '<button type="submit" class="btn btn-primary">Join</button></form>' +
        '</div>' +
        (tests.length
          ? tests.map(function (t) {
              return '<div class="tests-card class-card">' +
                '<span class="badge badge-blue">' + testsEscape(t.event) + '</span> ' +
                '<span class="badge badge-orange">' + testsEscape(t.format) + '</span>' +
                '<h3>' + testsEscape(t.title) + '</h3>' +
                '<p class="class-meta">' + t.questionCount + ' questions' + (t.timeLimitMin ? ' · ' + t.timeLimitMin + ' min' : '') +
                  (t.attempts ? ' · taken ' + t.attempts + '× · best ' + t.bestPercent + '%' : '') + '</p>' +
                '<button type="button" class="btn btn-primary" data-start="' + t.id + '">' +
                  (t.openAttemptId ? 'Resume' : t.attempts ? 'Practice again' : 'Start') + '</button>' +
              '</div>';
            }).join('')
          : '<p>No tests yet. Check back soon!</p>');
      document.getElementById('tests-signout').addEventListener('click', testsSignOut);
      document.getElementById('tests-code-form').addEventListener('submit', function (e) {
        e.preventDefault();
        joinWithCode(e.target.code.value);
      });
      app.querySelectorAll('[data-start]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          testsApi('/api/tests/' + btn.getAttribute('data-start') + '/attempts', { method: 'POST', body: {} })
            .then(function (data) { showAttempt(data.attemptId); })
            .catch(testsFail);
        });
      });
    })
    .catch(testsFail);
}

function joinWithCode(code) {
  return testsApi('/api/tests/join', { method: 'POST', body: { code: code } })
    .then(function (data) { showAttempt(data.attemptId); })
    .catch(function (err) {
      testsFail(err);
      if (testsRead(TESTS_TOKEN_KEY)) showTestList();
    });
}

// Loads an attempt and shows the test, the waiting screen, or the review.
function showAttempt(attemptId, parentKey) {
  var app = testsApp();
  testsApi('/api/tests/attempts/' + attemptId, { parentKey: parentKey })
    .then(function (attempt) {
      if (attempt.status === 'in_progress') {
        renderTake(app, attempt, { onSubmitted: function () { showAttempt(attemptId); } });
      } else if (attempt.status === 'waiting_for_session') {
        app.innerHTML = '<div class="tests-card"><h2>Your answers are in! 🎉</h2>' +
          '<p>Your score and review open when your volunteer ends the session.</p>' +
          '<button type="button" class="btn btn-primary" id="tests-check-again">Check again</button> ' +
          '<button type="button" class="btn btn-secondary" id="tests-back">Back to my tests</button></div>';
        document.getElementById('tests-check-again').addEventListener('click', function () { showAttempt(attemptId); });
        document.getElementById('tests-back').addEventListener('click', showTestList);
      } else {
        renderReview(app, attempt);
        var back = document.createElement('button');
        back.className = 'btn btn-secondary';
        back.textContent = parentKey ? 'Back to parent page' : 'Back to my tests';
        back.addEventListener('click', function () { parentKey ? showParent(parentKey) : showTestList(); });
        app.appendChild(back);
      }
      window.scrollTo(0, 0);
    })
    .catch(testsFail);
}

// ---- Kid: taking a test --------------------------------------------------------------

function questionInputHtml(q, saved) {
  var name = 'q-' + q.id;
  if (q.type === 'Multiple choice' || q.type === 'Pick all that apply') {
    var kind = q.type === 'Multiple choice' ? 'radio' : 'checkbox';
    var picked = String(saved || '').split(',');
    return '<div class="take-choices">' + (q.choices || []).map(function (choice, i) {
      var letter = TESTS_LETTERS[i];
      return '<label class="take-choice"><input type="' + kind + '" name="' + name + '" value="' + letter + '" data-q="' + q.id + '"' +
        (picked.indexOf(letter) !== -1 ? ' checked' : '') + '> <strong>' + letter + '.</strong> ' + testsEscape(choice) + '</label>';
    }).join('') + '</div>';
  }
  if (q.type === 'Written answer') {
    return '<textarea data-q="' + q.id + '" rows="4">' + testsEscape(saved || '') + '</textarea>';
  }
  return '<input type="text" data-q="' + q.id + '"' + (q.type === 'Number' ? ' inputmode="decimal"' : '') +
    ' value="' + testsEscape(saved || '') + '">';
}

function readResponse(container, q) {
  if (q.type === 'Multiple choice' || q.type === 'Pick all that apply') {
    var checked = container.querySelectorAll('input[name="q-' + q.id + '"]:checked');
    return Array.prototype.map.call(checked, function (input) { return input.value; }).sort().join(',');
  }
  return container.querySelector('[data-q="' + q.id + '"]').value;
}

function renderTake(container, attempt, opts) {
  opts = opts || {};
  var debounceMs = opts.debounceMs === undefined ? 800 : opts.debounceMs;
  var tickMs = opts.tickMs || 1000;
  var onSubmitted = opts.onSubmitted || function () {};
  var timers = {};
  var pending = [];
  var submitted = false;
  var deadline = attempt.deadlineAt ? new Date(attempt.deadlineAt).getTime() : null;
  var interval = null;

  container.innerHTML =
    '<div class="tests-card take-header"><h2>' + testsEscape(attempt.test.title) + '</h2>' +
      (deadline ? '<p class="take-timer">⏱ <span></span> left</p>' : '') +
      '<p class="tests-note">Your answers save as you go.</p></div>' +
    attempt.questions.map(function (q) {
      return '<div class="tests-card take-q" data-question="' + q.id + '">' +
        '<p class="take-prompt"><strong>' + q.position + '.</strong> ' + testsEscape(q.prompt) +
          ' <span class="class-meta">(' + q.maxPoints + (q.maxPoints === 1 ? ' pt' : ' pts') + ')</span></p>' +
        questionInputHtml(q, attempt.responses[q.id]) +
      '</div>';
    }).join('') +
    '<button type="button" class="btn btn-primary" id="take-submit">Submit test</button>';

  function save(q) {
    var request = testsApi('/api/tests/attempts/' + attempt.attemptId + '/answers', {
      method: 'PUT', body: { questionId: q.id, response: readResponse(container, q) },
    }).catch(function (err) {
      if (err.status === 409) return;
      testsFail(err);
    });
    pending.push(request);
    return request;
  }

  attempt.questions.forEach(function (q) {
    var schedule = function () {
      clearTimeout(timers[q.id]);
      timers[q.id] = setTimeout(function () { delete timers[q.id]; save(q); }, debounceMs);
    };
    container.querySelectorAll('[data-q="' + q.id + '"]').forEach(function (input) {
      input.addEventListener('input', schedule);
      input.addEventListener('change', schedule);
    });
  });

  function submit() {
    if (submitted) return;
    submitted = true;
    if (interval) clearInterval(interval);
    var flush = attempt.questions.filter(function (q) { return timers[q.id]; }).map(function (q) {
      clearTimeout(timers[q.id]);
      delete timers[q.id];
      return save(q);
    });
    Promise.all(pending.concat(flush))
      .then(function () { return testsApi('/api/tests/attempts/' + attempt.attemptId + '/submit', { method: 'POST', body: {} }); })
      .then(onSubmitted)
      .catch(function (err) {
        if (err.status === 409) return onSubmitted();
        submitted = false;
        testsFail(err);
      });
  }

  container.querySelector('#take-submit').addEventListener('click', function () {
    if (window.confirm('Submit your test? You can’t change answers after this.')) submit();
  });

  if (deadline) {
    var label = container.querySelector('.take-timer span');
    var tick = function () {
      var left = deadline - Date.now();
      label.textContent = formatRemaining(left);
      if (left <= 0) submit();
    };
    tick();
    interval = setInterval(tick, tickMs);
  }
}

// ---- Review --------------------------------------------------------------------------

function formatScore(n) {
  if (n === null || n === undefined) return '–';
  return String(Math.round(n * 100) / 100);
}

function responseText(q, value) {
  if (value === null || value === undefined || value === '') return '(no answer)';
  if ((q.type === 'Multiple choice' || q.type === 'Pick all that apply') && q.choices) {
    return String(value).split(',').map(function (letter) {
      var choice = q.choices[TESTS_LETTERS.indexOf(letter)];
      return choice ? letter + '. ' + choice : letter;
    }).join(', ');
  }
  return String(value);
}

var REVIEW_ICONS = { correct: '✅', wrong: '❌', partial: '🟡', needs_volunteer: '⏳' };

function renderReview(container, review) {
  var questionsHtml = review.questions.map(function (q) {
    var status = q.status || 'wrong';
    var label = q.gradedBy === 'override' ? ' · <em>changed by a volunteer</em>'
      : q.gradedBy === 'ai' ? ' · <em>graded by AI</em>'
      : status === 'needs_volunteer' ? ' · <em>waiting for a volunteer to grade</em>' : '';
    var showKey = status !== 'correct';
    return '<div class="tests-card review-q ' + testsEscape(status) + '">' +
      '<p>' + (REVIEW_ICONS[status] || '') + ' <strong>Q' + q.position + '</strong> ' + testsEscape(q.prompt) + '</p>' +
      '<p class="review-line">You: <strong>' + testsEscape(responseText(q, q.response)) + '</strong>' +
        (showKey ? ' · Correct: <strong>' + testsEscape(responseText(q, q.type === 'Short answer' ? q.answer.split('|')[0] : q.answer)) + '</strong>' : '') +
        ' · ' + testsEscape(formatScore(q.points)) + '/' + testsEscape(formatScore(q.maxPoints)) + label + '</p>' +
      (q.feedback ? '<p class="review-feedback">' + testsEscape(q.feedback) + '</p>' : '') +
      (q.explanation ? '<p class="review-explanation">' + testsEscape(q.explanation) + '</p>' : '') +
    '</div>';
  }).join('');

  var progressHtml = review.progress && review.progress.length > 1
    ? '<p class="class-meta">Your progress in ' + testsEscape(review.test.event) + ': ' +
        review.progress.map(function (p) { return p.percent + '%'; }).join(' → ') + '</p>'
    : '';

  var studyHtml = review.studyNext && review.studyNext.length
    ? '<div class="tests-card study-next"><h3>📚 What to study next</h3><ul>' +
        review.studyNext.map(function (s) {
          return '<li><strong>' + testsEscape(s.topic) + '</strong>' +
            (s.links.length ? ': ' + s.links.map(function (l) {
              return '<a href="' + testsEscape(l.url) + '" target="_blank" rel="noopener">' + testsEscape(l.title) + '</a>';
            }).join(' · ') : '') + '</li>';
        }).join('') + '</ul></div>'
    : '';

  container.innerHTML =
    '<div class="tests-card review-header">' +
      '<div><h2>' + testsEscape(review.test.title) + '</h2>' +
        (review.test.writtenBy ? '<p class="class-meta">by ' + testsEscape(review.test.writtenBy) + '</p>' : '') + '</div>' +
      '<div class="review-score">' + testsEscape(formatScore(review.score)) + ' / ' + testsEscape(formatScore(review.maxScore)) + '</div>' +
    '</div>' +
    progressHtml + studyHtml + questionsHtml;
}
