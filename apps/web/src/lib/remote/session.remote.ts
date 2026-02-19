import { getRequestEvent, query } from '$app/server';
import { z } from 'zod';

export const getRemoteHealth = query(async () => {
	const event = getRequestEvent();
	return {
		ok: true,
		now: new Date().toISOString(),
		path: event.url.pathname
	};
});

const echoSchema = z.object({
	message: z.string().trim().min(1).max(200)
});

export const getRemoteEcho = query(echoSchema, async ({ message }) => {
	return {
		message,
		length: message.length,
		now: new Date().toISOString()
	};
});
