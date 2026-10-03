import { defineConfig, devices } from '@playwright/test';

// Browser smoke suite for the frontend. Runs against the built frontend
// (frontend/dist, served by `vite preview`) with every /api request mocked in
// the test (see e2e/fixtures.ts). No Worker, no wrangler, no network.
// Run with `npm run e2e` or `make e2e`, which build first.
const PORT = 4179;

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	forbidOnly: true,
	reporter: [['list']],
	timeout: 30_000,
	expect: { timeout: 5_000 },
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		headless: true,
		video: 'off',
		trace: 'off',
		screenshot: 'off',
		locale: 'en-US',
		timezoneId: 'America/New_York',
		serviceWorkers: 'block',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
		},
	],
	webServer: {
		command: `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
		cwd: 'frontend',
		url: `http://127.0.0.1:${PORT}/`,
		reuseExistingServer: false,
		timeout: 30_000,
		stdout: 'ignore',
		stderr: 'pipe',
	},
});
