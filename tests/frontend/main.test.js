import { describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIN_JS_PATH = path.resolve(__dirname, '../../js/main.js');
const MAIN_JS_SOURCE = fs.readFileSync(MAIN_JS_PATH, 'utf-8');

// js/main.js is a classic <script>; evaluate it against a happy-dom window so its
// top-level functions become window globals (same approach as classes.test.js).
function setupPage(html, fetchImpl) {
  const window = new Window();
  window.document.body.innerHTML = html;
  window.fetch = fetchImpl || vi.fn(() => Promise.reject(new Error('no fetch')));
  // Advance the animation clock 10s per frame so count-ups finish in two frames.
  let now = 0;
  window.requestAnimationFrame = (cb) => setTimeout(() => cb((now += 10000)), 0);
  const context = vm.createContext(window);
  vm.runInContext(MAIN_JS_SOURCE, context, { filename: MAIN_JS_PATH });
  return window;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 200));
}

function jsonResponse(body) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

function textResponse(body) {
  return Promise.resolve({ ok: true, text: () => Promise.resolve(body) });
}

const STATS_HTML = `
  <div class="stat-item"><div class="stat-number" id="courses-count">15</div></div>
  <div class="stat-item"><div class="stat-number" id="volunteers-count">8</div></div>
  <div class="stat-item"><div class="stat-number" id="kids-reached">—</div></div>
  <div class="stat-item"><div class="stat-number" id="gc-monthly">—</div></div>
  <div class="stat-item"><div class="stat-number" id="gc-total">—</div></div>
`;

describe('parseGcCount', () => {
  it('reads GoatCounter numbers formatted with spaces or commas', () => {
    const window = setupPage('');
    expect(window.parseGcCount('1 147')).toBe(1147);
    expect(window.parseGcCount('1 147')).toBe(1147);
    expect(window.parseGcCount('2,503')).toBe(2503);
    expect(window.parseGcCount('97')).toBe(97);
  });
});

describe('monthStart', () => {
  it('returns the first day of the given month as YYYY-MM-DD', () => {
    const window = setupPage('');
    expect(window.monthStart(new window.Date(2026, 9, 11))).toBe('2026-10-01');
    expect(window.monthStart(new window.Date(2026, 0, 31))).toBe('2026-01-01');
  });
});

describe('tierFor', () => {
  it('maps hours to the fire-themed tiers at their boundaries', () => {
    const window = setupPage('');
    expect(window.tierFor(0).name).toBe('Spark');
    expect(window.tierFor(4).name).toBe('Spark');
    expect(window.tierFor(5).name).toBe('Flame');
    expect(window.tierFor(14).name).toBe('Flame');
    expect(window.tierFor(15).name).toBe('Blaze');
    expect(window.tierFor(29).name).toBe('Blaze');
    expect(window.tierFor(30).name).toBe('Torchbearer');
  });
});

describe('fetchVisitorStats', () => {
  const counts = {
    '%2F': 97,
    '%2Findex.html': 271,
    '%2Fcourses.html': 152,
    '%2Fclasses.html': 230,
    '%2Fvolunteers.html': 178,
    '%2Fevents.html': 104,
    '%2Fresults.html': 111,
  };

  it('shows the busiest page (home = / + /index.html) for all-time and month', async () => {
    const fetchImpl = vi.fn((url) => {
      const key = url.split('/counter/')[1].split('.json')[0];
      const monthly = url.includes('?start=');
      // Monthly: classes is the busiest page; home only has 100 + 50.
      const value = monthly ? { '%2F': 100, '%2Findex.html': 50, '%2Fclasses.html': 300 }[key] ?? 10 : counts[key];
      return jsonResponse({ count_unique: String(value) });
    });
    const window = setupPage(STATS_HTML, fetchImpl);

    window.fetchVisitorStats();
    await flush();

    expect(window.document.getElementById('gc-total').textContent).toBe('368');
    expect(window.document.getElementById('gc-monthly').textContent).toBe('300');
    const monthlyCall = fetchImpl.mock.calls.map((c) => c[0]).find((u) => u.includes('?start='));
    expect(monthlyCall).toMatch(/\?start=\d{4}-\d{2}-01$/);
  });

  it('uses the pages that succeeded when some requests fail', async () => {
    const fetchImpl = vi.fn((url) =>
      url.includes('classes.html') ? jsonResponse({ count_unique: '230' }) : Promise.reject(new Error('blocked'))
    );
    const window = setupPage(STATS_HTML, fetchImpl);

    window.fetchVisitorStats();
    await flush();

    expect(window.document.getElementById('gc-total').textContent).toBe('230');
  });

  it('hides the stats when every request fails', async () => {
    const window = setupPage(STATS_HTML);

    window.fetchVisitorStats();
    await flush();

    expect(window.document.getElementById('gc-total').closest('.stat-item').style.display).toBe('none');
    expect(window.document.getElementById('gc-monthly').closest('.stat-item').style.display).toBe('none');
  });
});

describe('fetchSiteStats', () => {
  it('fills kids reached from /api/stats', async () => {
    const fetchImpl = vi.fn((url) =>
      url.endsWith('/api/stats') ? jsonResponse({ kidsReached: 42, volunteerHours: {} }) : Promise.reject(new Error())
    );
    const window = setupPage(STATS_HTML, fetchImpl);

    window.fetchSiteStats();
    await flush();

    expect(window.document.getElementById('kids-reached').textContent).toBe('42');
  });

  it('adds a tier badge with hours to each matching volunteer card', async () => {
    const fetchImpl = vi.fn(() => jsonResponse({ kidsReached: 0, volunteerHours: { 'veda-khande': 17, 'adhya-kidiyoor': 1 } }));
    const window = setupPage(
      `<div class="volunteer-card" id="veda-khande"><h3>Veda</h3><div class="card-meta"></div></div>
       <div class="volunteer-card" id="adhya-kidiyoor"><h3>Adhya</h3><div class="card-meta"></div></div>
       <div class="volunteer-card" id="no-profile"><h3>X</h3><div class="card-meta"></div></div>`,
      fetchImpl
    );

    window.fetchSiteStats();
    await flush();

    const veda = window.document.querySelector('#veda-khande .tier-badge');
    expect(veda.textContent).toContain('Blaze');
    expect(veda.textContent).toContain('17 hrs');
    expect(veda.classList.contains('tier-blaze')).toBe(true);
    expect(window.document.querySelector('#adhya-kidiyoor .tier-badge').textContent).toContain('1 hr');
    expect(window.document.querySelector('#adhya-kidiyoor .tier-badge').textContent).not.toContain('hrs');
    expect(window.document.querySelector('#no-profile .tier-badge')).toBeNull();
  });

  it('hides kids reached when the API fails', async () => {
    const window = setupPage(STATS_HTML);

    window.fetchSiteStats();
    await flush();

    expect(window.document.getElementById('kids-reached').closest('.stat-item').style.display).toBe('none');
  });
});

describe('countCardsInPage', () => {
  it('replaces the stat with the number of cards found on the source page', async () => {
    const fetchImpl = vi.fn(() =>
      textResponse('<div class="course-details"></div>'.repeat(16))
    );
    const window = setupPage(STATS_HTML, fetchImpl);

    window.countCardsInPage('courses.html', 'class="course-details"', 'courses-count');
    await flush();

    expect(fetchImpl).toHaveBeenCalledWith('courses.html');
    expect(window.document.getElementById('courses-count').textContent).toBe('16');
  });

  it('wins over a count-up animation already running on the same stat', async () => {
    const fetchImpl = vi.fn(() => textResponse('<div class="course-details"></div>'.repeat(18)));
    const window = setupPage(STATS_HTML, fetchImpl);
    const el = window.document.getElementById('courses-count');

    window.animateNumber(el, 0, 15, 1500); // the on-scroll count-up of the static number
    window.countCardsInPage('courses.html', 'class="course-details"', 'courses-count');
    await flush();

    expect(el.textContent).toBe('18');
  });

  it('keeps the static number if the page cannot be fetched', async () => {
    const window = setupPage(STATS_HTML);

    window.countCardsInPage('courses.html', 'class="course-details"', 'courses-count');
    await flush();

    expect(window.document.getElementById('courses-count').textContent).toBe('15');
  });
});

describe('upcoming classes banner', () => {
  const BANNER_HTML = `
    <div class="floating-banner" id="tryout-banner">
      <div class="banner-scroll">
        <span class="banner-text">fallback</span>
        <span class="banner-text">fallback</span>
      </div>
    </div>`;

  const CLASSES = [
    { id: 1, title: 'Old Class', date: '2026-10-01', start_time: '10:00', status: 'upcoming' },
    { id: 2, title: 'Solar System', date: '2026-10-12', start_time: '11:00', status: 'upcoming' },
    { id: 3, title: 'Rocks & Minerals', date: '2026-10-12', start_time: '10:00', status: 'upcoming' },
    { id: 4, title: 'Cancelled One', date: '2026-10-13', start_time: '10:00', status: 'cancelled' },
    { id: 5, title: 'Meteorology', date: '2026-10-18', start_time: '18:30', status: 'upcoming' },
  ];

  it('lists upcoming, non-cancelled classes soonest first with day and 12-hour time', () => {
    const window = setupPage('');

    const items = window.upcomingClassItems(CLASSES, '2026-10-11');

    expect(Array.from(items)).toEqual([
      'Rocks & Minerals — Mon, Oct 12 · 10:00 AM',
      'Solar System — Mon, Oct 12 · 11:00 AM',
      'Meteorology — Sun, Oct 18 · 6:30 PM',
    ]);
  });

  it('prefixes SBE sessions so they are distinguishable', () => {
    const window = setupPage('');

    const items = window.upcomingClassItems(
      [{ id: 9, title: 'Number Sense: squares ending in 5', date: '2026-10-26', start_time: '15:45', status: 'upcoming', school: 'SBE' }],
      '2026-10-11'
    );

    expect(items[0]).toBe('SBE \u00b7 Number Sense: squares ending in 5 \u2014 Mon, Oct 26 \u00b7 3:45 PM');
  });

  it('caps the banner at six classes', () => {
    const window = setupPage('');
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: i, title: 'C' + i, date: '2026-10-2' + i, start_time: '10:00', status: 'upcoming',
    }));

    expect(window.upcomingClassItems(many, '2026-10-11')).toHaveLength(6);
  });

  it('fills every banner copy with the classes and a sign-up link', async () => {
    const fetchImpl = vi.fn(() => jsonResponse(CLASSES));
    const window = setupPage(BANNER_HTML, fetchImpl);

    window.fetchBannerClasses('2026-10-11');
    await flush();

    expect(fetchImpl).toHaveBeenCalledWith('https://torch-signups.pages.dev/api/classes');
    const copies = window.document.querySelectorAll('.banner-text');
    expect(copies).toHaveLength(2);
    copies.forEach((copy) => {
      expect(copy.textContent).toContain('UPCOMING CLASSES');
      expect(copy.textContent).toContain('Rocks & Minerals');
      expect(copy.textContent).not.toContain('Cancelled One');
      expect(copy.querySelector('a').getAttribute('href')).toBe('classes.html');
    });
  });

  it('renders class titles as text, not HTML', async () => {
    const fetchImpl = vi.fn(() =>
      jsonResponse([{ id: 1, title: '<img src=x onerror=alert(1)>', date: '2026-10-12', start_time: '10:00', status: 'upcoming' }])
    );
    const window = setupPage(BANNER_HTML, fetchImpl);

    window.fetchBannerClasses('2026-10-11');
    await flush();

    expect(window.document.querySelector('.banner-text img')).toBeNull();
    expect(window.document.querySelector('.banner-text').textContent).toContain('<img');
  });

  it('says new classes are coming soon when nothing is scheduled', async () => {
    const window = setupPage(BANNER_HTML, vi.fn(() => jsonResponse([])));

    window.fetchBannerClasses('2026-10-11');
    await flush();

    expect(window.document.querySelector('.banner-text').textContent).toMatch(/coming soon/i);
  });

  it('keeps the static banner when classes cannot be loaded', async () => {
    const window = setupPage(BANNER_HTML);

    window.fetchBannerClasses('2026-10-11');
    await flush();

    expect(window.document.querySelector('.banner-text').textContent).toBe('fallback');
  });
});
