import { describe, expect, it } from 'vitest';
import { getTicketManagementPageData } from './ticket-management-page.remote';

describe('ticket-management-page.remote', () => {
	it('exports ticket management page remote query', () => {
		expect(typeof getTicketManagementPageData).toBe('function');
	});
});
