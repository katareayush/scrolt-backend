import { describe, it, expect } from 'vitest';
import { formatDuration } from '../src/utils/formatDuration';

describe('formatDuration', () => {
  it('keeps seconds while the total is short', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(90)).toBe('1m 30s');
  });

  it('drops units that are zero rather than padding them', () => {
    expect(formatDuration(3_600)).toBe('1h');
    expect(formatDuration(7_260)).toBe('2h 1m');
    expect(formatDuration(86_400)).toBe('1d');
  });

  it('drops seconds once the total runs to days, where they are noise', () => {
    expect(formatDuration(90_061)).toBe('1d 1h 1m');
  });

  it('floors fractional seconds from process.uptime()', () => {
    expect(formatDuration(59.998)).toBe('59s');
  });

  it('treats a negative duration as zero instead of emitting junk', () => {
    expect(formatDuration(-5)).toBe('0s');
  });
});
