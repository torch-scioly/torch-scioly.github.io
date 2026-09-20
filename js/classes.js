document.addEventListener('DOMContentLoaded', function () {
  var showFormBtn = document.getElementById('show-create-form');
  var createForm = document.getElementById('create-class-form');
  var cancelFormBtn = document.getElementById('cancel-create-form');
  var volunteerCheckbox = createForm ? createForm.querySelector('[name="signUpAsVolunteer"]') : null;
  var creatorFields = document.getElementById('creator-volunteer-fields');

  if (showFormBtn && createForm) {
    showFormBtn.addEventListener('click', function () {
      createForm.hidden = false;
      showFormBtn.hidden = true;
    });
  }

  if (cancelFormBtn && createForm) {
    cancelFormBtn.addEventListener('click', function () {
      createForm.hidden = true;
      showFormBtn.hidden = false;
      createForm.reset();
    });
  }

  if (volunteerCheckbox && creatorFields) {
    var toggleCreatorFields = function () {
      creatorFields.hidden = !volunteerCheckbox.checked;
    };
    volunteerCheckbox.addEventListener('change', toggleCreatorFields);
    toggleCreatorFields();
  }

  if (createForm) {
    createForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var formData = new FormData(createForm);
      var payload = {
        title: formData.get('title'),
        description: formData.get('description'),
        date: formData.get('date'),
        startTime: formData.get('startTime'),
        endTime: formData.get('endTime') || undefined,
        signUpAsVolunteer: formData.get('signUpAsVolunteer') === 'on',
        volunteerName: formData.get('volunteerName'),
        volunteerEmail: formData.get('volunteerEmail'),
      };

      fetch('/api/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          if (!res.ok) throw new Error('Failed to create class');
          return res.json();
        })
        .then(function () {
          createForm.reset();
          createForm.hidden = true;
          showFormBtn.hidden = false;
          loadClasses();
        })
        .catch(function (err) {
          alert(err.message);
        });
    });
  }

  loadClasses();
});

function loadClasses() {
  var upcomingEl = document.getElementById('upcoming-classes');
  var pastEl = document.getElementById('past-classes');
  if (!upcomingEl || !pastEl) return;

  fetch('/api/classes')
    .then(function (res) { return res.json(); })
    .then(function (classes) {
      var today = new Date().toISOString().slice(0, 10);
      var upcoming = classes.filter(function (c) { return c.status !== 'cancelled' && c.date >= today; });
      var past = classes.filter(function (c) { return c.status === 'cancelled' || c.date < today; });

      renderClassList(upcomingEl, upcoming);
      renderClassList(pastEl, past);
    });
}

function renderClassList(container, classes) {
  container.innerHTML = '';
  if (classes.length === 0) {
    container.innerHTML = '<p>No classes here yet.</p>';
    return;
  }

  classes.forEach(function (cls) {
    var card = document.createElement('div');
    card.className = 'class-card' + (cls.status === 'cancelled' ? ' cancelled' : '');
    card.innerHTML =
      '<h3>' + escapeHtml(cls.title) + '</h3>' +
      '<p class="class-meta">' + escapeHtml(cls.date) + ' at ' + escapeHtml(cls.start_time) + '</p>' +
      (cls.status === 'cancelled' ? '<p class="class-meta">Cancelled</p>' : '');
    card.addEventListener('click', function () {
      openClassDetail(cls.id);
    });
    container.appendChild(card);
  });
}

function escapeHtml(value) {
  var div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}
