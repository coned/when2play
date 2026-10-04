import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { THEMES } from '../../frontend/src/hooks/useTheme';
import { ACTION_COLORS } from '../../frontend/src/components/tree/treeConstants';
import { readableTextOn, contrastRatio } from '../../frontend/src/lib/contrast';

/**
 * Colour contrast of the theme tokens (WCAG 2 ratios). Parses the two stylesheets,
 * resolves the custom properties on :root for every theme and mode the way the
 * cascade would, and checks the ratios the UI relies on, so a new or edited theme
 * cannot regress them.
 */

const stylesDir = new URL('../../frontend/src/styles/', import.meta.url);
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, stylesDir)), 'utf8');

interface Rule {
	attrs: Record<string, string>;
	decls: Record<string, string>;
	order: number;
}

/** Rules whose selector is `:root` plus attribute selectors, with their custom properties */
function rootRules(css: string, startOrder: number): Rule[] {
	const rules: Rule[] = [];
	const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let m: RegExpExecArray | null;
	let order = startOrder;
	while ((m = re.exec(text))) {
		const selector = m[1].split(';').pop()!.trim();
		if (!/^:root(\[[^\]]+\])*$/.test(selector)) continue;
		const attrs: Record<string, string> = {};
		for (const a of selector.matchAll(/\[([\w-]+)="([^"]*)"\]/g)) attrs[a[1]] = a[2];
		const decls: Record<string, string> = {};
		for (const d of m[2].split(';')) {
			const i = d.indexOf(':');
			if (i < 0) continue;
			const name = d.slice(0, i).trim();
			if (name.startsWith('--')) decls[name] = d.slice(i + 1).trim();
		}
		rules.push({ attrs, decls, order: order++ });
	}
	return rules;
}

// global.css starts with `@import './themes.css'`, so the theme rules come first in the cascade
const themesCss = read('themes.css');
const globalCss = read('global.css');
expect(globalCss).toMatch(/@import '\.\/themes\.css';/);
const RULES = [...rootRules(themesCss, 0), ...rootRules(globalCss, 1000)];

type Mode = 'dark' | 'light';

/** Custom properties on <html> for a theme and mode, as useTheme sets the attributes */
function tokens(theme: string, mode: Mode): Record<string, string> {
	const attrs: Record<string, string> = { 'data-mode': mode };
	if (theme !== 'cyberpunk') attrs['data-theme'] = theme;
	const applies = RULES.filter((r) => Object.entries(r.attrs).every(([k, v]) => attrs[k] === v));
	// Specificity (number of attribute selectors), then source order
	applies.sort((a, b) => Object.keys(a.attrs).length - Object.keys(b.attrs).length || a.order - b.order);
	const out: Record<string, string> = {};
	for (const r of applies) Object.assign(out, r.decls);
	const resolve = (v: string, depth = 0): string =>
		depth > 5 ? v : v.replace(/var\((--[\w-]+)\)/g, (_, n: string) => resolve(out[n] ?? '', depth + 1));
	for (const k of Object.keys(out)) out[k] = resolve(out[k]);
	return out;
}

function luminance(hex: string): number {
	let h = hex.trim().replace('#', '');
	if (h.length === 3) h = h.split('').map((c) => c + c).join('');
	expect(h, `not a hex colour: ${hex}`).toMatch(/^[0-9a-f]{6}$/i);
	const [r, g, b] = [0, 2, 4]
		.map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
		.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
	const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
}

/**
 * background and color of a class rule in global.css for a mode, with the light
 * mode override (`:root[data-mode="light"] .name`) applied and var() resolved.
 */
function classColours(name: string, mode: Mode, tk: Record<string, string>): { background: string; color: string } {
	const text = globalCss.replace(/\/\*[\s\S]*?\*\//g, '');
	const out: Record<string, string> = {};
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let m: RegExpExecArray | null;
	const base: Record<string, string> = {};
	const light: Record<string, string> = {};
	while ((m = re.exec(text))) {
		const selector = m[1].trim();
		const target = selector === `.${name}` ? base : selector === `:root[data-mode="light"] .${name}` ? light : null;
		if (!target) continue;
		for (const d of m[2].split(';')) {
			const i = d.indexOf(':');
			if (i > 0) target[d.slice(0, i).trim()] = d.slice(i + 1).trim();
		}
	}
	Object.assign(out, base, mode === 'light' ? light : {});
	const resolve = (v: string | undefined) => (v ?? '').replace(/var\((--[\w-]+)\)/g, (_, n: string) => tk[n] ?? '');
	expect(out.background, `.${name} has a background`).toBeTruthy();
	expect(out.color, `.${name} has a color`).toBeTruthy();
	return { background: resolve(out.background), color: resolve(out.color) };
}

const BACKGROUNDS = ['--bg-primary', '--bg-secondary', '--bg-card', '--bg-tertiary'];
const MODES: Mode[] = ['dark', 'light'];
const CASES = THEMES.flatMap((t) => MODES.map((mode) => [t.id, mode] as const));

describe('theme colour contrast', () => {
	it('parses a rule for every theme', () => {
		for (const t of THEMES) {
			if (t.id === 'cyberpunk') continue;
			expect(RULES.some((r) => r.attrs['data-theme'] === t.id && !r.attrs['data-mode'])).toBe(true);
		}
	});

	describe.each(CASES)('%s, %s mode', (theme, mode) => {
		const tk = tokens(theme, mode);

		it('--text-muted is at least 4.5:1 on every background and dimmer than --text-secondary', () => {
			for (const bg of BACKGROUNDS) {
				expect(ratio(tk['--text-muted'], tk[bg]), `${bg} ${tk[bg]}`).toBeGreaterThanOrEqual(4.5);
				// Visibly dimmer: secondary text stands out from the background clearly more
				expect(ratio(tk['--text-secondary'], tk[bg]) / ratio(tk['--text-muted'], tk[bg]), bg).toBeGreaterThanOrEqual(1.25);
			}
		});

		it('--text-secondary and --text-primary are at least 4.5:1 on every background', () => {
			for (const bg of BACKGROUNDS) {
				expect(ratio(tk['--text-secondary'], tk[bg]), bg).toBeGreaterThanOrEqual(4.5);
				expect(ratio(tk['--text-primary'], tk[bg]), bg).toBeGreaterThanOrEqual(4.5);
			}
		});

		it('--on-accent is at least 4.5:1 on --accent and --accent-hover', () => {
			expect(ratio(tk['--on-accent'], tk['--accent'])).toBeGreaterThanOrEqual(4.5);
			expect(ratio(tk['--on-accent'], tk['--accent-hover'])).toBeGreaterThanOrEqual(4.5);
		});

		it('.badge-accent text is at least 4.5:1 on its background', () => {
			const { background, color } = classColours('badge-accent', mode, tk);
			expect(ratio(color, background), `${color} on ${background}`).toBeGreaterThanOrEqual(4.5);
		});

		it('--accent-text is at least 4.5:1 on every background', () => {
			for (const bg of BACKGROUNDS) {
				expect(ratio(tk['--accent-text'], tk[bg]), `${bg} ${tk[bg]}`).toBeGreaterThanOrEqual(4.5);
			}
		});
	});

	it('text on the rally action colours (tree node badge) is at least 4.5:1', () => {
		for (const [action, bg] of Object.entries(ACTION_COLORS)) {
			expect(contrastRatio(readableTextOn(bg), bg), `${action} ${bg}`).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('the theme picker colours match the stylesheets', () => {
		for (const t of THEMES) {
			const tk = tokens(t.id, 'dark');
			expect(tk['--accent'].toLowerCase(), t.id).toBe(t.accent);
			expect(tk['--on-accent'].toLowerCase(), t.id).toBe(t.onAccent);
			expect(ratio(t.onAccent, t.accent), t.id).toBeGreaterThanOrEqual(4.5);
		}
	});
});
