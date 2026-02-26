import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import path from 'path';

export default defineConfig({
	plugins: [preact()],
	resolve: {
		alias: {
			'@when2play/shared': path.resolve(__dirname, '../shared/index.ts'),
		},
	},
	server: {
		proxy: {
			'/api': {
				target: 'http://localhost:8787',
				changeOrigin: true,
			},
		},
	},
});
