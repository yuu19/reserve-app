import * as Sentry from '@sentry/sveltekit';
import { env } from '$env/dynamic/public';

Sentry.init({
	dsn: env.PUBLIC_SENTRY_DSN_WEB,
	environment: env.PUBLIC_SENTRY_ENVIRONMENT || 'production',
	release: env.PUBLIC_SENTRY_RELEASE,
	tracesSampleRate: 0.1,
	sendDefaultPii: false
});
