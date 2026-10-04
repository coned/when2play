import { avatarInitial } from '../../frontend/src/lib/initials';
import { getInitials } from '../../frontend/src/components/tree/treeConstants';

describe('avatarInitial', () => {
	it('upper-cases the first character', () => {
		expect(avatarInitial('alice')).toBe('A');
		expect(avatarInitial('  bob ')).toBe('B');
		expect(avatarInitial('Zoë')).toBe('Z');
	});

	it('gives "?" for missing, empty and whitespace names', () => {
		expect(avatarInitial(null)).toBe('?');
		expect(avatarInitial(undefined)).toBe('?');
		expect(avatarInitial('')).toBe('?');
		expect(avatarInitial('   \t\n')).toBe('?');
	});

	it('keeps an emoji whole', () => {
		expect(avatarInitial('\u{1F3AE} gamer')).toBe('\u{1F3AE}');
		// A family emoji is one grapheme made of several code points
		const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
		expect(avatarInitial(`${family}x`)).toBe(family);
		// A flag is two regional indicators
		expect(avatarInitial('\u{1F1E9}\u{1F1EA}team')).toBe('\u{1F1E9}\u{1F1EA}');
	});

	it('takes several characters when asked (tree lanes)', () => {
		expect(getInitials('carol')).toBe('CA');
		expect(getInitials('\u{1F525}\u{1F525}\u{1F525}')).toBe('\u{1F525}\u{1F525}');
		expect(getInitials('')).toBe('?');
	});
});
