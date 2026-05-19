import { describe, expect, it } from 'vitest';
import { resolveLoginPathForNext } from './auth-portal';

describe('auth-portal', () => {
	it('routes scoped public event paths to the participant login portal', () => {
		expect(resolveLoginPathForNext('/org-a/classroom-a/events')).toBe('/participant/login');
		expect(resolveLoginPathForNext('/org-a/classroom-a/events/slot-1')).toBe('/participant/login');
	});
});
