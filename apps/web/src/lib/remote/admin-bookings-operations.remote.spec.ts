import { describe, expect, it } from 'vitest';
import { getAdminBookingsOperationsPageData } from './admin-bookings-operations.remote';

describe('管理予約操作 remote', () => {
	it('管理予約操作の remote query を export する', () => {
		expect(typeof getAdminBookingsOperationsPageData).toBe('function');
	});
});
