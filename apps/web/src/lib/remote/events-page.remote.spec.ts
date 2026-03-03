import { describe, expect, it } from 'vitest';
import { getPublicEventDetail, getPublicEvents } from './events-page.remote';

describe('events-page.remote', () => {
	it('exports public events remote queries', () => {
		expect(typeof getPublicEvents).toBe('function');
		expect(typeof getPublicEventDetail).toBe('function');
	});
});
