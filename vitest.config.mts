import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
	},
	resolve: {
		alias: {
			'@when2play/shared': './shared/index.ts',
		},
	},
});
