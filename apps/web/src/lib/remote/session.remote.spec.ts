import { describe, expect, it } from 'vitest';
import { getRemoteEcho, getRemoteHealth } from './session.remote';

describe('session.remote', () => {
	it('exports remote query functions', () => {
		expect(typeof getRemoteHealth).toBe('function');
		expect(typeof getRemoteEcho).toBe('function');
	});
});
