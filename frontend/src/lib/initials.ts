/**
 * Avatar initials. Safe for null, empty and whitespace-only names (they give "?")
 * and for names that start with an emoji or another multi code unit character:
 * whole grapheme clusters are taken, never half of a surrogate pair.
 */

type Segmenter = { segment(input: string): Iterable<{ segment: string }> };

let segmenter: Segmenter | null | undefined;

function graphemes(text: string): string[] {
	if (segmenter === undefined) {
		const Ctor = (Intl as unknown as { Segmenter?: new (locale?: string, opts?: { granularity: 'grapheme' }) => Segmenter }).Segmenter;
		segmenter = Ctor ? new Ctor(undefined, { granularity: 'grapheme' }) : null;
	}
	if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
	// Older engines: split by code point
	return Array.from(text);
}

/** The first `count` characters of the trimmed name, upper-cased; "?" when there is no name. */
export function avatarInitial(name: string | null | undefined, count = 1): string {
	const trimmed = (name ?? '').trim();
	if (trimmed === '') return '?';
	return graphemes(trimmed).slice(0, count).join('').toUpperCase();
}
