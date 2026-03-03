import { describe, expect, it } from 'vitest';
import { getAdminRecurringPageData } from './admin-recurring-page.remote';

describe('admin-recurring-page.remote', () => {
	it('exports admin recurring remote query', () => {
		expect(typeof getAdminRecurringPageData).toBe('function');
	});
});
