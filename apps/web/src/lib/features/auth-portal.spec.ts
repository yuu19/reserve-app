import { describe, expect, it } from 'vitest';
import { resolveLoginPathForNext } from './auth-portal';

describe('auth-portal', () => {
	it('routes scoped public event paths to the participant login portal', () => {
		expect(resolveLoginPathForNext('/org-a/store-a/events')).toBe('/participant/login');
		expect(resolveLoginPathForNext('/org-a/store-a/events/slot-1')).toBe('/participant/login');
	});

	it('routes scoped public ticket paths to the participant login portal', () => {
		expect(resolveLoginPathForNext('/org-a/store-a/tickets/ticket-1')).toBe('/participant/login');
	});
});
