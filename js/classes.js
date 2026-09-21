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

  var closeModalBtn = document.getElementById('close-detail-modal');
  var detailModal = document.getElementById('class-detail-modal');
  if (closeModalBtn && detailModal) {
    closeModalBtn.addEventListener('click', function () {
      detailModal.hidden = true;
    });
  }

  loadClasses();
});

function localToday() {
  var d = new Date();
  var month = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + month + '-' + day;
}

function loadClasses() {
  var upcomingEl = document.getElementById('upcoming-classes');
  var pastEl = document.getElementById('past-classes');
  if (!upcomingEl || !pastEl) return;

  fetch('/api/classes')
    .then(function (res) {
      if (!res.ok) throw new Error('Failed to load classes');
      return res.json();
    })
    .then(function (classes) {
      var today = localToday();
      var upcoming = classes.filter(function (c) { return c.status !== 'cancelled' && c.date >= today; });
      var past = classes.filter(function (c) { return c.status === 'cancelled' || c.date < today; });

      renderClassList(upcomingEl, upcoming);
      renderClassList(pastEl, past);
    })
    .catch(function (err) {
      alert(err.message);
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
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function openClassDetail(classId) {
  var modal = document.getElementById('class-detail-modal');
  var body = document.getElementById('class-detail-body');
  if (!modal || !body) return;

  fetch('/api/classes/' + classId)
    .then(function (res) {
      if (!res.ok) throw new Error('Failed to load class');
      return res.json();
    })
    .then(function (cls) {
      body.innerHTML = renderClassDetailHtml(cls);
      wireClassDetailEvents(cls);
      modal.hidden = false;
    })
    .catch(function (err) {
      alert(err.message);
    });
}

function isSafeHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function renderClassDetailHtml(cls) {
  var zoomHtml = isSafeHttpUrl(cls.zoom_link)
    ? '<div class="zoom-box"><strong>Join here:</strong> ' +
      '<a href="' + escapeHtml(cls.zoom_link) + '" target="_blank" rel="noopener">' + escapeHtml(cls.zoom_link) + '</a>' +
      (cls.zoom_notes ? '<p>' + escapeHtml(cls.zoom_notes) + '</p>' : '') +
      '</div>'
    : '<div class="zoom-box">Zoom link will be posted by the volunteer before class.</div>';

  var volunteersHtml = cls.volunteers.map(function (v) {
    return '<li>' + escapeHtml(v.name) + (v.role_note ? ' (' + escapeHtml(v.role_note) + ')' : '') +
      ' <button class="remove-btn" data-type="volunteers" data-id="' + v.id + '">Remove</button></li>';
  }).join('');

  var studentsHtml = cls.students.map(function (s) {
    return '<li>' + escapeHtml(s.student_name) + (s.grade ? ' (Grade ' + escapeHtml(s.grade) + ')' : '') +
      ' <button class="remove-btn" data-type="students" data-id="' + s.id + '">Remove</button></li>';
  }).join('');

  return (
    '<h2>' + escapeHtml(cls.title) + '</h2>' +
    '<p class="class-meta">' + escapeHtml(cls.date) + ' at ' + escapeHtml(cls.start_time) + '</p>' +
    '<p>' + escapeHtml(cls.description || '') + '</p>' +
    zoomHtml +
    '<h3>Volunteers</h3>' +
    '<ul class="roster-list" id="volunteer-roster">' + volunteersHtml + '</ul>' +
    '<form id="add-volunteer-form" class="signup-form">' +
      '<label>Name<input type="text" name="name" required></label>' +
      '<label>Email<input type="email" name="email" required></label>' +
      '<label>Role note<input type="text" name="roleNote"></label>' +
      '<button type="submit" class="btn btn-primary">Add yourself</button>' +
    '</form>' +
    '<h3>Students</h3>' +
    '<ul class="roster-list" id="student-roster">' + studentsHtml + '</ul>' +
    '<form id="add-student-form" class="signup-form">' +
      '<label>Student name<input type="text" name="studentName" required></label>' +
      '<label>Grade<input type="text" name="grade"></label>' +
      '<label>Parent name<input type="text" name="parentName" required></label>' +
      '<label>Parent email<input type="email" name="parentEmail" required></label>' +
      '<button type="submit" class="btn btn-primary">Add student</button>' +
    '</form>' +
    '<div id="edit-class-section"></div>'
  );
}

function wireClassDetailEvents(cls) {
  var body = document.getElementById('class-detail-body');

  body.querySelectorAll('.remove-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var type = btn.getAttribute('data-type');
      var id = btn.getAttribute('data-id');
      fetch('/api/classes/' + cls.id + '/' + type + '/' + id, { method: 'DELETE' })
        .then(function (res) {
          if (!res.ok) throw new Error('Failed to remove signup');
          openClassDetail(cls.id);
          loadClasses();
        })
        .catch(function (err) {
          alert(err.message);
        });
    });
  });

  var addVolunteerForm = document.getElementById('add-volunteer-form');
  if (addVolunteerForm) {
    addVolunteerForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var formData = new FormData(addVolunteerForm);
      fetch('/api/classes/' + cls.id + '/volunteers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.get('name'),
          email: formData.get('email'),
          roleNote: formData.get('roleNote'),
        }),
      })
        .then(function (res) {
          if (!res.ok) throw new Error('Failed to add volunteer');
          openClassDetail(cls.id);
        })
        .catch(function (err) {
          alert(err.message);
        });
    });
  }

  var addStudentForm = document.getElementById('add-student-form');
  if (addStudentForm) {
    addStudentForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var formData = new FormData(addStudentForm);
      fetch('/api/classes/' + cls.id + '/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName: formData.get('studentName'),
          grade: formData.get('grade'),
          parentName: formData.get('parentName'),
          parentEmail: formData.get('parentEmail'),
        }),
      })
        .then(function (res) {
          if (!res.ok) throw new Error('Failed to add student');
          openClassDetail(cls.id);
        })
        .catch(function (err) {
          alert(err.message);
        });
    });
  }

  renderEditClassSection(cls);
}

function renderEditClassSection(cls) {
  var container = document.getElementById('edit-class-section');
  if (!container) return;

  container.innerHTML =
    '<h3>Edit Class</h3>' +
    '<form id="edit-class-form" class="signup-form">' +
      '<label>Title<input type="text" name="title" value="' + escapeHtml(cls.title) + '" required></label>' +
      '<label>Description<textarea name="description">' + escapeHtml(cls.description || '') + '</textarea></label>' +
      '<label>Date<input type="date" name="date" value="' + escapeHtml(cls.date) + '" required></label>' +
      '<label>Start Time<input type="time" name="startTime" value="' + escapeHtml(cls.start_time) + '" required></label>' +
      '<label>End Time<input type="time" name="endTime" value="' + escapeHtml(cls.end_time || '') + '"></label>' +
      '<label>Zoom Link<input type="url" name="zoom_link" value="' + escapeHtml(cls.zoom_link || '') + '"></label>' +
      '<label>Zoom Notes<input type="text" name="zoom_notes" value="' + escapeHtml(cls.zoom_notes || '') + '"></label>' +
      '<button type="submit" class="btn btn-primary">Save Changes</button>' +
    '</form>' +
    (cls.status === 'cancelled'
      ? '<p class="class-meta">This class is cancelled.</p>'
      : '<button id="cancel-class-btn" class="btn btn-danger">Cancel This Class</button>');

  var editForm = document.getElementById('edit-class-form');
  editForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var formData = new FormData(editForm);
    fetch('/api/classes/' + cls.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: formData.get('title'),
        description: formData.get('description'),
        date: formData.get('date'),
        startTime: formData.get('startTime'),
        endTime: formData.get('endTime') || null,
        zoom_link: formData.get('zoom_link') || null,
        zoom_notes: formData.get('zoom_notes') || null,
      }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to update class');
        openClassDetail(cls.id);
        loadClasses();
      })
      .catch(function (err) {
        alert(err.message);
      });
  });

  var cancelBtn = document.getElementById('cancel-class-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      if (!confirm('Cancel this class?')) return;
      fetch('/api/classes/' + cls.id, { method: 'DELETE' })
        .then(function (res) {
          if (!res.ok) throw new Error('Failed to cancel class');
          openClassDetail(cls.id);
          loadClasses();
        })
        .catch(function (err) {
          alert(err.message);
        });
    });
  }
}
