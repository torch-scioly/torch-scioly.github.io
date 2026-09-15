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

// Fetch GoatCounter visitor stats via JSONP to avoid CORS issues
function fetchVisitorStats() {
  var totalEl = document.getElementById('gc-total');
  var monthlyEl = document.getElementById('gc-monthly');
  if (!totalEl && !monthlyEl) return;

  var gcSite = 'scienceolympiadqvms';
  var base = 'https://' + gcSite + '.goatcounter.com/counter/';
  var path = encodeURIComponent('/') + '.json';

  function loadViaScript(url, callback) {
    var cbName = '_gc_cb_' + Math.random().toString(36).substr(2, 8);
    window[cbName] = function (data) {
      callback(data);
      delete window[cbName];
      document.head.removeChild(script);
    };
    // GoatCounter .json endpoint supports JSONP via ?callback=
    var script = document.createElement('script');
    script.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'callback=' + cbName;
    script.onerror = function () {
      delete window[cbName];
      document.head.removeChild(script);
    };
    document.head.appendChild(script);
  }

  // Fetch total visitors (all time)
  if (totalEl) {
    loadViaScript(base + path, function (data) {
      var count = parseInt(String(data.count).replace(/,/g, ''), 10);
      if (!isNaN(count)) {
        animateNumber(totalEl, 0, count, 1200);
      }
    });
  }

  // Fetch monthly visitors
  if (monthlyEl) {
    loadViaScript(base + path + '?period=month', function (data) {
      var count = parseInt(String(data.count).replace(/,/g, ''), 10);
      if (!isNaN(count)) {
        animateNumber(monthlyEl, 0, count, 1200);
      }
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
