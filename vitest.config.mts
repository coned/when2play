import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	test: {
		globals: true,
	},
	resolve: {
		alias: {
			// Absolute path: a relative alias only works for type-only imports
			'@when2play/shared': fileURLToPath(new URL('./shared/index.ts', import.meta.url)),
		},
	},
});
