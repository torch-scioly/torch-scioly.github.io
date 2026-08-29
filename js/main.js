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

// Visitor counter using api.visitorbadge.io
function initVisitorCounter() {
  var counterEl = document.getElementById('visitor-count');
  if (!counterEl) return;

  // The hidden badge img in HTML increments the count on each page load.
  // Fetch the SVG badge and parse the visitor number from it.
  fetch('https://api.visitorbadge.io/api/visitors?path=https%3A%2F%2Ftorch-scioly.github.io&countColor=%231a5276')
    .then(function (res) { return res.text(); })
    .then(function (svg) {
      // The SVG contains the count as text, extract the number
      var match = svg.match(/>(\d[\d,]*)<\/text>\s*<\/g>\s*<\/svg>/);
      if (!match) {
        // Try alternate pattern
        match = svg.match(/textLength[^>]*>(\d[\d,]*)</);
      }
      if (match) {
        var count = parseInt(match[1].replace(/,/g, ''), 10);
        animateNumber(counterEl, 0, count, 1200);
      } else {
        counterEl.textContent = '...';
      }
    })
    .catch(function () {
      // Fallback to localStorage count
      var stored = parseInt(localStorage.getItem('torch_visitors') || '0', 10);
      if (!sessionStorage.getItem('torch_counted')) {
        stored++;
        localStorage.setItem('torch_visitors', stored.toString());
        sessionStorage.setItem('torch_counted', 'true');
      }
      animateNumber(counterEl, 0, stored, 1200);
    });
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
