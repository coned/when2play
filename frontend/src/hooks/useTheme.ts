import { useState, useEffect } from 'preact/hooks';

export const THEMES = [
	{ id: 'midnight', label: 'Midnight', accent: '#3b82f6' },
	{ id: 'cyberpunk', label: 'Cyberpunk', accent: '#ff2a6d' },
	{ id: 'forest', label: 'Forest', accent: '#2ecc71' },
	{ id: 'sakura', label: 'Sakura', accent: '#e891b9' },
	{ id: 'amber', label: 'Amber', accent: '#f59e0b' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

const STORAGE_KEY = 'w2p-theme';

function applyTheme(id: ThemeId) {
	if (id === 'midnight') {
		document.documentElement.removeAttribute('data-theme');
	} else {
		document.documentElement.setAttribute('data-theme', id);
	}
}

export function useTheme() {
	const [theme, setThemeState] = useState<ThemeId>(() => {
		const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
		return saved && THEMES.some((t) => t.id === saved) ? saved : 'midnight';
	});

	useEffect(() => {
		applyTheme(theme);
	}, [theme]);

	function setTheme(id: ThemeId) {
		localStorage.setItem(STORAGE_KEY, id);
		setThemeState(id);
	}

	return { theme, setTheme, themes: THEMES };
}

/** Apply saved theme immediately (call before render to prevent flash) */
export function initTheme() {
	const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
	if (saved && saved !== 'midnight' && THEMES.some((t) => t.id === saved)) {
		document.documentElement.setAttribute('data-theme', saved);
	}
}
