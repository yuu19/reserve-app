import { describe, expect, it } from 'vitest';
import { getAdminSlotsPageData } from './admin-slots-page.remote';

describe('admin-slots-page.remote', () => {
	it('exports admin slots remote query', () => {
		expect(typeof getAdminSlotsPageData).toBe('function');
	});
});
