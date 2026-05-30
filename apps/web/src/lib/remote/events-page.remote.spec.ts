import { describe, expect, it } from 'vitest';
import { getPublicEventDetail, getPublicEvents } from './events-page.remote';

describe('公開イベントページ remote', () => {
	it('公開イベントの remote query を export する', () => {
		expect(typeof getPublicEvents).toBe('function');
		expect(typeof getPublicEventDetail).toBe('function');
	});
});
