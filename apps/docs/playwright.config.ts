import { defineConfig } from '@playwright/test';

const port = 4173;

export default defineConfig({
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: [
		['html', { outputFolder: 'playwright-report', open: 'never' }],
		['list']
	],
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure'
	},
	webServer: {
		command: `pnpm run build && pnpm exec vite preview --host 127.0.0.1 --port ${port}`,
		url: `http://127.0.0.1:${port}`,
		reuseExistingServer: !process.env.CI
	},
	testMatch: '**/*.e2e.{ts,js}'
});
