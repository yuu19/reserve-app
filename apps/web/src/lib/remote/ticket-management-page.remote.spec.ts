import { describe, expect, it } from 'vitest';
import { getTicketManagementPageData } from './ticket-management-page.remote';

describe('回数券管理ページ remote', () => {
	it('回数券管理ページの remote query を export する', () => {
		expect(typeof getTicketManagementPageData).toBe('function');
	});
});
