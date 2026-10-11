var API_BASE = 'https://torch-signups.pages.dev';

// SBE Number Sense page: Monday sessions at Sonal Bhuchar Elementary, built on the
// shared class system (classes with school = 'SBE'). Volunteers sign up for a job;
// students don't sign up online.
var SBE_TITLE_PREFIX = 'Number Sense: ';
var SBE_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var SBE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

document.addEventListener('DOMContentLoaded', function () {
  if (document.getElementById('sbe-upcoming')) loadSbeSessions(sbeToday());
});

function sbeToday() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// The job stored as the signup's role note: "Teach: <trick>", "PowerPoint", or "Test prep".
function sbeRoleNote(job, trick) {
  var t = (trick || '').trim();
  if (job === 'Teach') return t ? 'Teach: ' + t : 'Teach';
  return job;
}

function sbeEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sbeWhen(cls) {
  var p = cls.date.split('-').map(Number);
  var day = new Date(p[0], p[1] - 1, p[2]);
  var t = cls.start_time.split(':').map(Number);
  return SBE_DAYS[day.getDay()] + ', ' + SBE_MONTHS[day.getMonth()] + ' ' + day.getDate() + ' · ' +
    (t[0] % 12 || 12) + ':' + String(t[1]).padStart(2, '0') + (t[0] < 12 ? ' AM' : ' PM');
}

function loadSbeSessions(today) {
  fetch(API_BASE + '/api/classes')
    .then(function (res) {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    })
    .then(function (classes) {
      var sbe = classes.filter(function (c) { return c.school === 'SBE'; });
      var byDate = function (a, b) { return (a.date + a.start_time).localeCompare(b.date + b.start_time); };
      var upcoming = sbe.filter(function (c) { return c.date >= today; }).sort(byDate);
      var past = sbe.filter(function (c) { return c.date < today && c.status !== 'cancelled'; }).sort(byDate).reverse();
      renderSbeList(document.getElementById('sbe-upcoming'), upcoming, true);
      renderSbeList(document.getElementById('sbe-past'), past, false);
    })
    .catch(function () {
      var el = document.getElementById('sbe-upcoming');
      if (el) el.innerHTML = '<p>Couldn’t load the schedule. Please refresh the page.</p>';
    });
}

function renderSbeList(container, sessions, isUpcoming) {
  if (!container) return;
  container.innerHTML = sessions.length ? '' : '<p>Nothing here yet.</p>';
  sessions.forEach(function (cls) {
    var card = document.createElement('div');
    card.className = 'sbe-session' + (cls.status === 'cancelled' ? ' cancelled' : '');
    card.innerHTML = sbeSessionHtml(cls, isUpcoming);
    container.appendChild(card);
    if (isUpcoming && cls.status !== 'cancelled') wireSbeSignup(card, cls);
  });
}

function sbeSessionHtml(cls, isUpcoming) {
  var topic = cls.title.indexOf(SBE_TITLE_PREFIX) === 0 ? cls.title.slice(SBE_TITLE_PREFIX.length) : cls.title;
  var head =
    '<p class="sbe-when">' + sbeEscape(sbeWhen(cls)) + '</p>' +
    '<h3>' + sbeEscape(topic) + '</h3>' +
    (cls.description ? '<p class="sbe-curriculum">' + sbeEscape(cls.description) + '</p>' : '');

  if (cls.status === 'cancelled') return head + '<p class="class-meta">No session this Monday.</p>';

  var volunteers = cls.volunteers || [];
  var roster = volunteers.length
    ? '<ul class="sbe-roster">' + volunteers.map(function (v) {
        return '<li><strong>' + sbeEscape(v.name) + '</strong>' +
          (v.role_note ? ' &mdash; ' + sbeEscape(v.role_note) : '') + '</li>';
      }).join('') + '</ul>'
    : '<p class="class-meta">' + (isUpcoming ? 'No volunteers yet.' : 'No volunteers recorded.') + '</p>';

  if (!isUpcoming) return head + roster;

  return head + roster +
    '<button type="button" class="btn btn-secondary sbe-signup-btn">+ Volunteer for this Monday</button>' +
    '<form class="signup-form" hidden>' +
      '<label>Name<input type="text" name="name" required></label>' +
      '<label>Email<input type="email" name="email" required></label>' +
      '<label>Job<select name="job">' +
        '<option value="Teach">Teach a trick</option>' +
        '<option value="PowerPoint">PowerPoint</option>' +
        '<option value="Test prep">Test prep</option>' +
      '</select></label>' +
      '<label>Trick you’ll teach (optional)<input type="text" name="trick"></label>' +
      '<button type="submit" class="btn btn-primary">Sign up</button>' +
    '</form>';
}

function wireSbeSignup(card, cls) {
  var btn = card.querySelector('.sbe-signup-btn');
  var form = card.querySelector('form');
  btn.addEventListener('click', function () {
    form.hidden = false;
    btn.hidden = true;
  });
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    fetch(API_BASE + '/api/classes/' + cls.id + '/volunteers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.querySelector('[name="name"]').value,
        email: form.querySelector('[name="email"]').value,
        roleNote: sbeRoleNote(form.querySelector('[name="job"]').value, form.querySelector('[name="trick"]').value),
      }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error('signup failed');
        loadSbeSessions(sbeToday());
      })
      .catch(function () {
        alert('Sign-up failed — please try again.');
      });
  });
}
