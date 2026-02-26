import { useState, useEffect } from 'preact/hooks';

export function useMediaQuery(maxWidth: number): boolean {
	const [matches, setMatches] = useState(() => window.matchMedia(`(max-width: ${maxWidth}px)`).matches);

	useEffect(() => {
		const mql = window.matchMedia(`(max-width: ${maxWidth}px)`);
		const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	}, [maxWidth]);

	return matches;
}
