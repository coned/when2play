/** WCAG 2 colour contrast helpers for fixed (non-theme) colours such as the rally action colours. */

function channel(c: number): number {
	const v = c / 255;
	return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a #rgb or #rrggbb colour. */
export function luminance(hex: string): number {
	let h = hex.trim().replace(/^#/, '');
	if (h.length === 3) h = h.split('').map((c) => c + c).join('');
	if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`not a hex colour: ${hex}`);
	const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
	const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
}

export const DARK_TEXT = '#111111';
export const LIGHT_TEXT = '#ffffff';

/** The text colour (near black or white) that reads better on a fixed background colour. */
export function readableTextOn(background: string): string {
	return contrastRatio(DARK_TEXT, background) >= contrastRatio(LIGHT_TEXT, background) ? DARK_TEXT : LIGHT_TEXT;
}
