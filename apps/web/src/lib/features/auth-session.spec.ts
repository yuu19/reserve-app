import { afterEach, describe, expect, it, vi } from 'vitest';
import { redirectToLoginWithNext, resolveLastUsedOrganizationId } from './auth-session.svelte';

describe('auth-session.svelte', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('redirects to login with encoded next path', () => {
		const assign = vi.fn();
		vi.stubGlobal('window', {
			location: {
				assign
			}
		});

		redirectToLoginWithNext('/events/slot-1?from=public#reserve');
		expect(assign).toHaveBeenCalledWith('/?next=%2Fevents%2Fslot-1%3Ffrom%3Dpublic%23reserve');
	});

	it('prefers last used organization when it exists in membership', () => {
		const organizations = [
			{ id: 'org-a', name: 'A', slug: 'a' },
			{ id: 'org-b', name: 'B', slug: 'b' }
		];
		expect(resolveLastUsedOrganizationId(organizations, 'org-b')).toBe('org-b');
	});

	it('returns null when last used organization is not in membership', () => {
		const organizations = [{ id: 'org-a', name: 'A', slug: 'a' }];
		expect(resolveLastUsedOrganizationId(organizations, 'org-x')).toBeNull();
	});
});
