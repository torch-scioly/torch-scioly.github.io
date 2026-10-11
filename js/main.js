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

  // Floating banner dismiss + upcoming classes
  initBanner();
  fetchBannerClasses(todayIso());

  // Fetch and display GoatCounter stats
  fetchVisitorStats();

  // Kids reached + volunteer tier badges
  fetchSiteStats();

  // Keep course/volunteer counts in sync with their pages
  countCardsInPage('courses.html', 'class="course-details"', 'courses-count');
  countCardsInPage('volunteers.html', 'class="volunteer-card"', 'volunteers-count');

  // Count-up animation for stats
  animateStats();
});

var BANNER_MAX_CLASSES = 6;
var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function todayIso() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// "Rocks & Minerals — Sun, Oct 12 · 10:00 AM" for each upcoming, non-cancelled class, soonest first.
function upcomingClassItems(classes, today) {
  return classes
    .filter(function (c) { return c.status !== 'cancelled' && c.date >= today; })
    .sort(function (a, b) { return (a.date + a.start_time).localeCompare(b.date + b.start_time); })
    .slice(0, BANNER_MAX_CLASSES)
    .map(function (c) {
      var parts = c.date.split('-').map(Number);
      var day = new Date(parts[0], parts[1] - 1, parts[2]);
      var time = c.start_time.split(':').map(Number);
      var hour12 = time[0] % 12 || 12;
      var when = DAY_NAMES[day.getDay()] + ', ' + MONTH_NAMES[day.getMonth()] + ' ' + day.getDate() +
        ' \u00B7 ' + hour12 + ':' + String(time[1]).padStart(2, '0') + (time[0] < 12 ? ' AM' : ' PM');
      return (c.school === 'SBE' ? 'SBE \u00B7 ' : '') + c.title + ' \u2014 ' + when;
    });
}

// Fill the scrolling banner on every page with upcoming classes. Each .banner-text copy
// gets the same content (two copies make the marquee loop seamless). Built with DOM
// nodes so class titles are always rendered as text.
function fetchBannerClasses(today) {
  var copies = document.querySelectorAll('#tryout-banner .banner-text');
  if (!copies.length) return;

  fetch(API_BASE + '/api/classes')
    .then(function (res) {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    })
    .then(function (classes) {
      var items = upcomingClassItems(classes, today);
      copies.forEach(function (copy) {
        copy.textContent = '';
        var heading = document.createElement('strong');
        heading.textContent = '\u{1F4DA} UPCOMING CLASSES';
        copy.appendChild(heading);
        var text = items.length
          ? items.join(' \u00A0\u2022\u00A0 ')
          : 'New classes coming soon';
        copy.appendChild(document.createTextNode(' \u00A0\u2022\u00A0 ' + text + ' \u00A0\u2022\u00A0 '));
        var link = document.createElement('a');
        link.href = 'classes.html';
        link.textContent = items.length ? 'Sign up' : 'See the schedule';
        copy.appendChild(link);
        copy.appendChild(document.createTextNode(' \u00A0\u2022\u00A0 '));
      });
    })
    .catch(function () {});
}

// Floating announcement banner
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

var API_BASE = 'https://torch-signups.pages.dev';

// Public pages tracked by GoatCounter. '/' and '/index.html' are both the homepage.
// Add new pages here so they count toward the visitor stats.
var GC_PAGE_GROUPS = [
  ['/', '/index.html'],
  ['/courses.html'],
  ['/classes.html'],
  ['/sbe.html'],
  ['/volunteers.html'],
  ['/events.html'],
  ['/results.html']
];

// Volunteer tiers by hours taught (1 held class = 1 hour), highest first.
var TIERS = [
  { min: 30, name: 'Torchbearer', icon: '\u{1F3C6}', cls: 'tier-torchbearer' },
  { min: 15, name: 'Blaze', icon: '\u2604\uFE0F', cls: 'tier-blaze' },
  { min: 5, name: 'Flame', icon: '\u{1F525}', cls: 'tier-flame' },
  { min: 0, name: 'Spark', icon: '\u{1F538}', cls: 'tier-spark' }
];

// GoatCounter formats numbers with locale separators ("1 147", "2,503").
function parseGcCount(value) {
  return parseInt(String(value).replace(/\D/g, ''), 10);
}

function monthStart(date) {
  var month = String(date.getMonth() + 1).padStart(2, '0');
  return date.getFullYear() + '-' + month + '-01';
}

function tierFor(hours) {
  for (var i = 0; i < TIERS.length; i++) {
    if (hours >= TIERS[i].min) return TIERS[i];
  }
  return TIERS[TIERS.length - 1];
}

function hideStat(el) {
  var statItem = el.closest('.stat-item');
  if (statItem) statItem.style.display = 'none';
}

// Fetch GoatCounter visitor stats. GoatCounter only counts unique visitors per page,
// so summing pages double-counts anyone who browses; the busiest page is a
// duplicate-free lower bound on unique site visitors.
function fetchVisitorStats() {
  var totalEl = document.getElementById('gc-total');
  var monthlyEl = document.getElementById('gc-monthly');
  if (totalEl) showBusiestPage(totalEl, '');
  if (monthlyEl) showBusiestPage(monthlyEl, '?start=' + monthStart(new Date()));
}

function showBusiestPage(el, query) {
  var base = 'https://scienceolympiadqvms.goatcounter.com/counter/';

  var groups = GC_PAGE_GROUPS.map(function (paths) {
    return Promise.all(paths.map(function (p) {
      return fetch(base + encodeURIComponent(p) + '.json' + query)
        .then(function (res) {
          if (!res.ok) throw new Error(res.status);
          return res.json();
        })
        .then(function (data) {
          var count = parseGcCount(data.count_unique);
          return isNaN(count) ? null : count;
        })
        .catch(function () { return null; });
    })).then(function (counts) {
      var ok = counts.filter(function (c) { return c !== null; });
      if (!ok.length) return null;
      return ok.reduce(function (a, b) { return a + b; }, 0);
    });
  });

  Promise.all(groups).then(function (totals) {
    var ok = totals.filter(function (t) { return t !== null; });
    if (!ok.length) {
      hideStat(el);
      return;
    }
    animateNumber(el, 0, Math.max.apply(null, ok), 1200);
  });
}

// Kids reached (homepage) and volunteer tier badges (volunteers page) from /api/stats.
function fetchSiteStats() {
  var kidsEl = document.getElementById('kids-reached');
  var cards = document.querySelectorAll('.volunteer-card[id]');
  if (!kidsEl && !cards.length) return;

  fetch(API_BASE + '/api/stats')
    .then(function (res) {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    })
    .then(function (stats) {
      if (kidsEl) animateNumber(kidsEl, 0, stats.kidsReached, 1200);
      cards.forEach(function (card) {
        var hours = stats.volunteerHours[card.id];
        if (typeof hours === 'number') addTierBadge(card, hours);
      });
    })
    .catch(function () {
      if (kidsEl) hideStat(kidsEl);
    });
}

function addTierBadge(card, hours) {
  var tier = tierFor(hours);
  var badge = document.createElement('div');
  badge.className = 'tier-badge ' + tier.cls;
  badge.textContent = tier.icon + ' ' + tier.name + ' \u00B7 ' + hours + (hours === 1 ? ' hr' : ' hrs');
  var heading = card.querySelector('h3');
  if (heading) heading.insertAdjacentElement('afterend', badge);
  else card.appendChild(badge);
}

// Replace a static stat with the live number of cards on another page, so the
// homepage can't drift from the catalog. Keeps the static number on failure.
function countCardsInPage(url, marker, elId) {
  var el = document.getElementById(elId);
  if (!el) return;

  fetch(url)
    .then(function (res) {
      if (!res.ok) throw new Error(res.status);
      return res.text();
    })
    .then(function (html) {
      var count = html.split(marker).length - 1;
      if (count > 0) animateNumber(el, 0, count, 1200);
    })
    .catch(function () {});
}

// Animate a number from start to end. A newer animation on the same element
// supersedes an older one, so a live value can't be overwritten by a stale count-up.
function animateNumber(el, start, end, duration) {
  var startTime = null;
  var token = {};
  el._countUp = token;

  function step(timestamp) {
    if (el._countUp !== token) return;
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
