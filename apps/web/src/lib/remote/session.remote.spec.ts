import { describe, expect, it } from 'vitest';
import { getRemoteSession } from './session.remote';

describe('セッション remote', () => {
	it('remote query 関数を export する', () => {
		expect(typeof getRemoteSession).toBe('function');
	});
});
