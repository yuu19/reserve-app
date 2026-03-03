import { describe, expect, it } from 'vitest';
import { getRemoteSession } from './session.remote';

describe('session.remote', () => {
	it('exports remote query functions', () => {
		expect(typeof getRemoteSession).toBe('function');
	});
});
