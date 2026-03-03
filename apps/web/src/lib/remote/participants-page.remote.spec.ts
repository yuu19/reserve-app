import { describe, expect, it } from 'vitest';
import { getParticipantsPageData } from './participants-page.remote';

describe('participants-page.remote', () => {
	it('exports participants page remote query', () => {
		expect(typeof getParticipantsPageData).toBe('function');
	});
});
