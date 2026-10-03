import { configDefaults, defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	test: {
		globals: true,
		// e2e/ holds the Playwright browser suite (npm run e2e), not vitest tests
		exclude: [...configDefaults.exclude, 'e2e/**'],
	},
	resolve: {
		alias: {
			// Absolute path: a relative alias only works for type-only imports
			'@when2play/shared': fileURLToPath(new URL('./shared/index.ts', import.meta.url)),
		},
	},
});
