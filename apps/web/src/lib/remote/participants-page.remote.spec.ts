import { describe, expect, it } from 'vitest';
import { getParticipantsPageData } from './participants-page.remote';

describe('参加者ページ remote', () => {
	it('参加者ページの remote query を export する', () => {
		expect(typeof getParticipantsPageData).toBe('function');
	});
});
