import { describe, it, expect } from 'vitest';
import { consensusOpacity } from '../../frontend/src/components/availability/TimeGrid';

describe('consensusOpacity', () => {
	it('returns 0 when no participants', () => {
		expect(consensusOpacity(3, 0)).toBe(0);
	});

	it('returns 0 when no overlap', () => {
		expect(consensusOpacity(0, 5)).toBe(0);
	});

	it('returns minimum opacity for 1 out of many', () => {
		const opacity = consensusOpacity(1, 10);
		// ratio = 0.1, expected = 0.08 + 0.1 * 0.42 = 0.122
		expect(opacity).toBeCloseTo(0.122, 3);
	});

	it('returns mid-range opacity for half the group', () => {
		const opacity = consensusOpacity(5, 10);
		// ratio = 0.5, expected = 0.08 + 0.5 * 0.42 = 0.29
		expect(opacity).toBeCloseTo(0.29, 3);
	});

	it('returns maximum opacity when all participants overlap', () => {
		const opacity = consensusOpacity(10, 10);
		// ratio = 1.0, expected = 0.08 + 1.0 * 0.42 = 0.50
		expect(opacity).toBeCloseTo(0.50, 3);
	});

	it('caps ratio at 1 when overlapCount exceeds totalParticipants', () => {
		const opacity = consensusOpacity(15, 10);
		// ratio capped at 1.0, expected = 0.50
		expect(opacity).toBeCloseTo(0.50, 3);
	});

	it('scales linearly between min and max', () => {
		const o1 = consensusOpacity(1, 4); // ratio=0.25
		const o2 = consensusOpacity(2, 4); // ratio=0.50
		const o3 = consensusOpacity(3, 4); // ratio=0.75
		const o4 = consensusOpacity(4, 4); // ratio=1.00

		// Each step should increase by the same amount (0.42 * 0.25 = 0.105)
		expect(o2 - o1).toBeCloseTo(o3 - o2, 3);
		expect(o3 - o2).toBeCloseTo(o4 - o3, 3);

		// Monotonically increasing
		expect(o2).toBeGreaterThan(o1);
		expect(o3).toBeGreaterThan(o2);
		expect(o4).toBeGreaterThan(o3);
	});

	it('returns correct value for single participant', () => {
		const opacity = consensusOpacity(1, 1);
		// ratio = 1.0, expected = 0.50
		expect(opacity).toBeCloseTo(0.50, 3);
	});
});
