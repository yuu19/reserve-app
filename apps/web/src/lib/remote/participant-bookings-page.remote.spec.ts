import { describe, expect, it } from 'vitest';
import { getParticipantBookingsPageData } from './participant-bookings-page.remote';

describe('参加者予約ページ remote', () => {
	it('参加者予約の remote query を export する', () => {
		expect(typeof getParticipantBookingsPageData).toBe('function');
	});
});
