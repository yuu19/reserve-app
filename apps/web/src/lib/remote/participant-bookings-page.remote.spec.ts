import { describe, expect, it } from 'vitest';
import { getParticipantBookingsPageData } from './participant-bookings-page.remote';

describe('participant-bookings-page.remote', () => {
	it('exports participant bookings remote query', () => {
		expect(typeof getParticipantBookingsPageData).toBe('function');
	});
});
