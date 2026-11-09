export function isQuarterHourTime(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const minutes = Number(value.slice(3, 5));
  return minutes % 15 === 0;
}

export function addOneHour(startTime) {
  const [hours, minutes] = startTime.split(':').map(Number);
  const totalMinutes = (hours * 60 + minutes + 60) % (24 * 60);
  const endHours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const endMinutes = String(totalMinutes % 60).padStart(2, '0');
  return `${endHours}:${endMinutes}`;
}

// SQLite datetime('now') strings ("2026-11-08 15:04:05", UTC) as ISO 8601 for the browser.
export function sqliteToIso(value) {
  return value ? `${value.replace(' ', 'T')}Z` : null;
}
