import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const webRoot = fileURLToPath(new URL('.', import.meta.url));
const backendEnvFile = path.join(os.tmpdir(), 'reserve-app-backend-e2e.vars');
const billingE2eRequested =
	process.env.BILLING_E2E_ENABLED === 'true' ||
	process.argv.some((argument) => argument.includes('tests/e2e/billing'));

const requiredEnv = (name: string): string => {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required for Stripe billing E2E tests.`);
	}
	return value;
};

const quoteEnvValue = (value: string): string => JSON.stringify(value);

const writeBackendEnvFile = () => {
	const stripeSecretKey = requiredEnv('STRIPE_SECRET_KEY');
	if (!stripeSecretKey.startsWith('sk_test_')) {
		throw new Error('STRIPE_SECRET_KEY must be a Stripe testmode key for billing E2E tests.');
	}

	const e2eTestSecret = process.env.E2E_TEST_SECRET?.trim() || 'reserve-app-e2e-secret';
	const webhookSecret =
		process.env.STRIPE_WEBHOOK_SECRET?.trim() ||
		process.env.E2E_STRIPE_WEBHOOK_SECRET?.trim() ||
		'whsec_reserve_app_local_e2e';

	const values: Record<string, string> = {
		BETTER_AUTH_URL: 'http://localhost:3000',
		BETTER_AUTH_SECRET:
			process.env.BETTER_AUTH_SECRET?.trim() ||
			'reserve-app-e2e-secret-at-least-32-characters',
		BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173,mobile://',
		BETTER_AUTH_COOKIE_DOMAIN: '',
		WEB_BASE_URL: 'http://localhost:5173',
		INVITATION_ACCEPT_URL_BASE: 'http://localhost:5173/invitations/accept',
		PARTICIPANT_INVITATION_ACCEPT_URL_BASE:
			'http://localhost:5173/participants/invitations/accept',
		PUBLIC_EVENTS_ORGANIZATION_SLUG: 'public-events',
		RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL?.trim() || 'onboarding@resend.dev',
		STRIPE_SECRET_KEY: stripeSecretKey,
		STRIPE_WEBHOOK_SECRET: webhookSecret,
		STRIPE_PREMIUM_MONTHLY_PRICE_ID: requiredEnv('STRIPE_PREMIUM_MONTHLY_PRICE_ID'),
		STRIPE_PREMIUM_YEARLY_PRICE_ID: requiredEnv('STRIPE_PREMIUM_YEARLY_PRICE_ID'),
		STRIPE_PREMIUM_TRIAL_SUBSCRIPTION_ENABLED: 'true',
		E2E_TESTING_ENABLED: 'true',
		E2E_TEST_SECRET: e2eTestSecret,
		SENTRY_ENVIRONMENT: 'e2e'
	};

	fs.writeFileSync(
		backendEnvFile,
		Object.entries(values)
			.map(([key, value]) => `${key}=${quoteEnvValue(value)}`)
			.join('\n') + '\n',
		{ mode: 0o600 }
	);
};

if (billingE2eRequested) {
	writeBackendEnvFile();
}

export default defineConfig({
	testDir: './tests/e2e',
	testIgnore: billingE2eRequested ? [] : ['**/billing/**'],
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: 'http://localhost:5173',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	},
	webServer: billingE2eRequested
		? [
				{
					command: 'pnpm --filter @apps/backend run dev:e2e:stripe',
					cwd: repoRoot,
					env: {
						...process.env,
						E2E_BACKEND_ENV_FILE: backendEnvFile
					},
					url: 'http://localhost:3000/api/health',
					reuseExistingServer: !process.env.CI,
					timeout: 120_000
				},
				{
					command: 'pnpm --filter @apps/web run dev:e2e',
					cwd: repoRoot,
					env: {
						...process.env,
						PUBLIC_BACKEND_URL: 'http://localhost:3000'
					},
					url: 'http://localhost:5173',
					reuseExistingServer: !process.env.CI,
					timeout: 120_000
				}
			]
		: undefined,
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	],
	outputDir: path.join(webRoot, 'test-results')
});
