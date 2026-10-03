import { describe, it, expect } from 'vitest';
import {
	hhmmToMinutes,
	minutesToHhmm,
	etHourToUtcSlot,
	gridOriginMinutes,
	slotStartOffset,
	slotEndOffset,
	slotDateOffset,
	slotInstant,
} from '@when2play/shared';

describe('gaming-day helpers', () => {
	it('converts between HH:MM and minutes', () => {
		expect(hhmmToMinutes('00:00')).toBe(0);
		expect(hhmmToMinutes('23:45')).toBe(1425);
		expect(minutesToHhmm(1425)).toBe('23:45');
		expect(minutesToHhmm(1440)).toBe('00:00');
		expect(minutesToHhmm(1440 + 75)).toBe('01:15');
	});

	it('maps 17 ET to 21:00 UTC in summer and 22:00 UTC in winter', () => {
		expect(etHourToUtcSlot(17, '2026-07-15')).toBe('21:00');
		expect(etHourToUtcSlot(17, '2026-01-15')).toBe('22:00');
		expect(gridOriginMinutes('2026-07-15', 17, 3)).toBe(21 * 60);
		expect(gridOriginMinutes('2026-01-15', 17, 3)).toBe(22 * 60);
	});

	it('uses a 00:00 UTC origin when the grid range is not fully configured', () => {
		expect(gridOriginMinutes('2026-07-15')).toBe(0);
		expect(gridOriginMinutes('2026-07-15', 17, undefined)).toBe(0);
		expect(gridOriginMinutes('2026-07-15', null, 3)).toBe(0);
	});

	it('orders slots by offset from the origin across UTC midnight (summer)', () => {
		const origin = gridOriginMinutes('2026-07-15', 17, 3);
		expect(slotStartOffset('21:00', origin)).toBe(0);
		expect(slotStartOffset('23:45', origin)).toBe(165);
		expect(slotStartOffset('00:00', origin)).toBe(180);
		expect(slotStartOffset('01:45', origin)).toBe(285);
		// 23:45 -> 00:00 ends exactly where 00:00 starts
		expect(slotEndOffset('00:00', origin)).toBe(slotStartOffset('00:00', origin));
		// An end equal to the origin is the end of the gaming day
		expect(slotEndOffset('21:00', origin)).toBe(1440);
		expect(slotDateOffset('23:45', origin)).toBe(0);
		expect(slotDateOffset('00:00', origin)).toBe(1);
	});

	it('orders slots by offset from the origin in winter', () => {
		const origin = gridOriginMinutes('2026-01-15', 17, 3);
		expect(slotStartOffset('22:00', origin)).toBe(0);
		expect(slotStartOffset('21:45', origin)).toBe(1425);
		expect(slotStartOffset('02:45', origin)).toBe(285);
		expect(slotDateOffset('21:45', origin)).toBe(1);
	});

	it('resolves the real UTC instant of a stored slot', () => {
		const summer = gridOriginMinutes('2026-07-15', 17, 3);
		expect(slotInstant('2026-07-15', '21:00', summer).toISOString()).toBe('2026-07-15T21:00:00.000Z');
		expect(slotInstant('2026-07-15', '01:30', summer).toISOString()).toBe('2026-07-16T01:30:00.000Z');

		const winter = gridOriginMinutes('2026-01-15', 17, 3);
		expect(slotInstant('2026-01-15', '22:15', winter).toISOString()).toBe('2026-01-15T22:15:00.000Z');
		expect(slotInstant('2026-01-15', '02:45', winter).toISOString()).toBe('2026-01-16T02:45:00.000Z');

		// Unconfigured grid: every slot is on the gaming day itself
		expect(slotInstant('2026-07-15', '01:30', 0).toISOString()).toBe('2026-07-15T01:30:00.000Z');
	});
});
