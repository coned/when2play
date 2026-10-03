import { describe, it, expect, vi, afterEach } from 'vitest';
import { timingSafeEqualStrings, isValidBotToken } from '../../src/lib/bot-token';

describe('timingSafeEqualStrings', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const cases: Array<[string, string, boolean]> = [
		['secret', 'secret', true],
		['secret', 'secreT', false],
		['secret', 'secrets', false],
		['secrets', 'secret', false],
		['', '', true],
		['', 'x', false],
		['kéy', 'kéy', true],
		['kéy', 'key', false],
	];

	it('compares with the byte loop when crypto.subtle.timingSafeEqual is missing (Node)', () => {
		expect((globalThis.crypto?.subtle as { timingSafeEqual?: unknown } | undefined)?.timingSafeEqual).toBeUndefined();
		for (const [a, b, expected] of cases) expect(timingSafeEqualStrings(a, b)).toBe(expected);
	});

	it('uses crypto.subtle.timingSafeEqual when the runtime has it (Workers), always on equal-length buffers', () => {
		const timingSafeEqual = vi.fn((a: ArrayBufferView, b: ArrayBufferView) => {
			expect(a.byteLength).toBe(b.byteLength);
			const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
			const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
			return x.every((v, i) => v === y[i]);
		});
		vi.stubGlobal('crypto', { subtle: { timingSafeEqual } });
		for (const [a, b, expected] of cases) expect(timingSafeEqualStrings(a, b)).toBe(expected);
		expect(timingSafeEqual).toHaveBeenCalledTimes(cases.length);
	});
});

describe('isValidBotToken', () => {
	it('is false whenever the key is not configured', () => {
		expect(isValidBotToken(undefined, 'anything')).toBe(false);
		expect(isValidBotToken('', '')).toBe(false);
		expect(isValidBotToken(undefined, undefined)).toBe(false);
	});

	it('is false for a missing, empty or wrong token', () => {
		expect(isValidBotToken('key', undefined)).toBe(false);
		expect(isValidBotToken('key', null)).toBe(false);
		expect(isValidBotToken('key', '')).toBe(false);
		expect(isValidBotToken('key', 'kez')).toBe(false);
	});

	it('is true for the matching token', () => {
		expect(isValidBotToken('key', 'key')).toBe(true);
	});
});
