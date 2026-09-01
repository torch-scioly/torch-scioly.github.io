// Mobile navigation toggle
document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.querySelector('.nav-toggle');
  var navLinks = document.querySelector('.nav-links');

  if (toggle && navLinks) {
    toggle.addEventListener('click', function () {
      navLinks.classList.toggle('open');
    });

    navLinks.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        navLinks.classList.remove('open');
      });
    });
  }

  // Floating banner dismiss
  initBanner();

  // Fetch and display GoatCounter stats
  fetchVisitorStats();

  // Count-up animation for stats
  animateStats();
});

// Floating tryout banner
function initBanner() {
  var banner = document.getElementById('tryout-banner');
  var closeBtn = document.getElementById('banner-close');
  if (!banner || !closeBtn) return;

  if (sessionStorage.getItem('torch_banner_dismissed')) {
    banner.classList.add('hidden');
    return;
  }

  closeBtn.addEventListener('click', function () {
    banner.classList.add('hidden');
    sessionStorage.setItem('torch_banner_dismissed', 'true');
  });
}

// Fetch GoatCounter visitor stats
function fetchVisitorStats() {
  var totalEl = document.getElementById('gc-total');
  var monthlyEl = document.getElementById('gc-monthly');
  if (!totalEl && !monthlyEl) return;

  // GoatCounter public API - fetch total unique visitors
  var gcSite = 'scienceolympiadqvms';

  // Get current month date range
  var now = new Date();
  var monthStart = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
  var today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

  // Fetch total visitors (all time)
  if (totalEl) {
    fetch('https://' + gcSite + '.goatcounter.com/counter/' + encodeURIComponent('/') + '.json')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var count = parseInt(data.count.replace(/,/g, ''), 10);
        if (!isNaN(count)) {
          animateNumber(totalEl, 0, count, 1200);
        }
      })
      .catch(function () {
        totalEl.textContent = '—';
      });
  }

  // Fetch monthly visitors
  if (monthlyEl) {
    fetch('https://' + gcSite + '.goatcounter.com/counter/' + encodeURIComponent('/') + '.json?period=month')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var count = parseInt(data.count.replace(/,/g, ''), 10);
        if (!isNaN(count)) {
          animateNumber(monthlyEl, 0, count, 1200);
        }
      })
      .catch(function () {
        monthlyEl.textContent = '—';
      });
  }
}

// Animate a number from start to end
function animateNumber(el, start, end, duration) {
  var startTime = null;

  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    var progress = Math.min((timestamp - startTime) / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3);
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

        if (!isNaN(num) && text === num.toString()) {
          animateNumber(entry.target, 0, num, 1500);
        }
      }
    });
  }, { threshold: 0.5 });

  stats.forEach(function (stat) {
    observer.observe(stat);
  });
}
