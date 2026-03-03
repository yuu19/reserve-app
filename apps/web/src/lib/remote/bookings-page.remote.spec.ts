import { describe, expect, it } from 'vitest';
import { getBookingsPageData } from './bookings-page.remote';

describe('bookings-page.remote', () => {
	it('exports bookings page remote query', () => {
		expect(typeof getBookingsPageData).toBe('function');
	});
});
