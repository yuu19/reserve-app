import { handleErrorWithSentry, sentryHandle } from '@sentry/sveltekit';

export const handle = sentryHandle();
export const handleError = handleErrorWithSentry();
