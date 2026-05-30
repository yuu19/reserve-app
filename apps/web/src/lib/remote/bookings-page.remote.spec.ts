import { describe, expect, it } from 'vitest';
import { getBookingsPageData } from './bookings-page.remote';

describe('予約ページ remote', () => {
	it('予約ページの remote query を export する', () => {
		expect(typeof getBookingsPageData).toBe('function');
	});
});
