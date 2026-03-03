import { describe, expect, it } from 'vitest';
import { getAdminBookingsOperationsPageData } from './admin-bookings-operations.remote';

describe('admin-bookings-operations.remote', () => {
	it('exports admin bookings operations remote query', () => {
		expect(typeof getAdminBookingsOperationsPageData).toBe('function');
	});
});
