import { useEffect } from 'preact/hooks';

/**
 * Runs `callback` on mount (and whenever `callback` changes), then every
 * `intervalMs` while the tab is visible. The timer stops while the tab is
 * hidden, and the callback runs once more as soon as the tab is visible again.
 */
export function useVisiblePolling(callback: () => unknown, intervalMs: number): void {
	useEffect(() => {
		let timer: ReturnType<typeof setInterval> | null = null;

		const start = () => {
			if (timer === null) timer = setInterval(callback, intervalMs);
		};
		const stop = () => {
			if (timer !== null) {
				clearInterval(timer);
				timer = null;
			}
		};
		const onVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				callback();
				start();
			} else {
				stop();
			}
		};

		callback();
		if (document.visibilityState === 'visible') start();
		document.addEventListener('visibilitychange', onVisibilityChange);

		return () => {
			stop();
			document.removeEventListener('visibilitychange', onVisibilityChange);
		};
	}, [callback, intervalMs]);
}
