import { describe, expect, it } from 'vitest';
import { getAdminRecurringPageData } from './admin-recurring-page.remote';

describe('管理繰り返し枠ページ remote', () => {
	it('管理繰り返し枠の remote query を export する', () => {
		expect(typeof getAdminRecurringPageData).toBe('function');
	});
});
