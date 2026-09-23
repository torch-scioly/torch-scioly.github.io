import { describe, expect, it } from 'vitest';
import { isQuarterHourTime, addOneHour } from '../../functions/api/_lib/time.js';

describe('isQuarterHourTime', () => {
  it('accepts times on the hour or a 15-minute mark', () => {
    expect(isQuarterHourTime('09:00')).toBe(true);
    expect(isQuarterHourTime('09:15')).toBe(true);
    expect(isQuarterHourTime('09:30')).toBe(true);
    expect(isQuarterHourTime('09:45')).toBe(true);
  });

  it('rejects times off the 15-minute grid', () => {
    expect(isQuarterHourTime('09:05')).toBe(false);
    expect(isQuarterHourTime('09:37')).toBe(false);
  });
});

describe('addOneHour', () => {
  it('adds one hour to a start time', () => {
    expect(addOneHour('09:00')).toBe('10:00');
    expect(addOneHour('09:30')).toBe('10:30');
  });

  it('wraps past midnight', () => {
    expect(addOneHour('23:30')).toBe('00:30');
  });
});
