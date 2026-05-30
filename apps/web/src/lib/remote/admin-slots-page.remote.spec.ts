import { describe, expect, it } from 'vitest';
import { getAdminSlotsPageData } from './admin-slots-page.remote';

describe('管理枠ページ remote', () => {
	it('管理枠の remote query を export する', () => {
		expect(typeof getAdminSlotsPageData).toBe('function');
	});
});
