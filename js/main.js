// Mobile navigation toggle
document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.querySelector('.nav-toggle');
  var navLinks = document.querySelector('.nav-links');

  if (toggle && navLinks) {
    toggle.addEventListener('click', function () {
      navLinks.classList.toggle('open');
    });

    // Close menu when a link is clicked (mobile)
    navLinks.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        navLinks.classList.remove('open');
      });
    });
  }

  // Visitor counter using localStorage + unique session tracking
  initVisitorCounter();

  // Count-up animation for stats
  animateStats();
});

// Visitor counter
function initVisitorCounter() {
  var counterEl = document.getElementById('visitor-count');
  if (!counterEl) return;

  var STORAGE_KEY = 'torch_visitor_count';
  var SESSION_KEY = 'torch_session_counted';

  // Get current count
  var count = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);

  // Only increment if this is a new session
  if (!sessionStorage.getItem(SESSION_KEY)) {
    count++;
    localStorage.setItem(STORAGE_KEY, count.toString());
    sessionStorage.setItem(SESSION_KEY, 'true');
  }

  // Animate the counter number
  animateNumber(counterEl, 0, count, 1200);
}

// Animate a number from start to end
function animateNumber(el, start, end, duration) {
  var startTime = null;

  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    var progress = Math.min((timestamp - startTime) / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    var current = Math.floor(start + (end - start) * eased);
    el.textContent = current.toLocaleString();
    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

// Count-up animation for stat numbers when they scroll into view
function animateStats() {
  var stats = document.querySelectorAll('.stat-number');
  if (!stats.length) return;

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting && !entry.target.dataset.animated) {
        entry.target.dataset.animated = 'true';
        var text = entry.target.textContent.trim();
        var num = parseInt(text, 10);

        // Only animate pure numbers, skip "5th", "8th" etc.
        if (!isNaN(num) && text === num.toString()) {
          var suffix = '';
          animateNumber(entry.target, 0, num, 1500);
        }
      }
    });
  }, { threshold: 0.5 });

  stats.forEach(function (stat) {
    observer.observe(stat);
  });
}
