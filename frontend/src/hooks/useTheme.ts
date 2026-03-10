import { useState, useEffect } from 'preact/hooks';

export const THEMES = [
	{ id: 'midnight', label: 'Midnight', accent: '#3b82f6' },
	{ id: 'cyberpunk', label: 'Cyberpunk', accent: '#ff2a6d' },
	{ id: 'ocean', label: 'Ocean', accent: '#06b6d4' },
	{ id: 'sakura', label: 'Sakura', accent: '#e891b9' },
	{ id: 'amber', label: 'Amber', accent: '#f59e0b' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];
export type Mode = 'dark' | 'light';

const THEME_KEY = 'w2p-theme';
const MODE_KEY = 'w2p-mode';

function applyTheme(id: ThemeId) {
	if (id === 'cyberpunk') {
		document.documentElement.removeAttribute('data-theme');
	} else {
		document.documentElement.setAttribute('data-theme', id);
	}
}

function applyMode(mode: Mode) {
	document.documentElement.setAttribute('data-mode', mode);
}

export function useTheme() {
	const [theme, setThemeState] = useState<ThemeId>(() => {
		const saved = localStorage.getItem(THEME_KEY) as ThemeId | null;
		// Migrate old themes
		if (saved === 'daylight') {
			localStorage.setItem(THEME_KEY, 'cyberpunk');
			localStorage.setItem(MODE_KEY, 'light');
			return 'cyberpunk';
		}
		if (saved === 'forest') {
			localStorage.setItem(THEME_KEY, 'ocean');
			return 'ocean';
		}
		return saved && THEMES.some((t) => t.id === saved) ? saved : 'cyberpunk';
	});

	const [mode, setModeState] = useState<Mode>(() => {
		const saved = localStorage.getItem(MODE_KEY) as Mode | null;
		// Migrate old daylight theme
		const oldTheme = localStorage.getItem(THEME_KEY);
		if (oldTheme === 'daylight') return 'light';
		return saved === 'light' || saved === 'dark' ? saved : 'dark';
	});

	useEffect(() => {
		applyTheme(theme);
	}, [theme]);

	useEffect(() => {
		applyMode(mode);
	}, [mode]);

	function setTheme(id: ThemeId) {
		localStorage.setItem(THEME_KEY, id);
		setThemeState(id);
	}

	function setMode(m: Mode) {
		localStorage.setItem(MODE_KEY, m);
		setModeState(m);
	}

	return { theme, setTheme, mode, setMode, themes: THEMES };
}

/** Apply saved theme + mode immediately (call before render to prevent flash) */
export function initTheme() {
	const savedTheme = localStorage.getItem(THEME_KEY) as ThemeId | null;
	const savedMode = localStorage.getItem(MODE_KEY) as Mode | null;

	// Migrate old themes
	if (savedTheme === 'daylight') {
		localStorage.setItem(THEME_KEY, 'cyberpunk');
		localStorage.setItem(MODE_KEY, 'light');
		document.documentElement.setAttribute('data-mode', 'light');
		return;
	}
	if (savedTheme === 'forest') {
		localStorage.setItem(THEME_KEY, 'ocean');
		document.documentElement.setAttribute('data-theme', 'ocean');
	}

	if (savedTheme && savedTheme !== 'cyberpunk' && THEMES.some((t) => t.id === savedTheme)) {
		document.documentElement.setAttribute('data-theme', savedTheme);
	}

	if (savedMode === 'light' || savedMode === 'dark') {
		document.documentElement.setAttribute('data-mode', savedMode);
	} else {
		document.documentElement.setAttribute('data-mode', 'dark');
	}
}
