import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	clearLastAuthPortal,
	readLastAuthPortal,
	writeLastAuthPortal
} from './auth-portal-preference';

const STORAGE_KEY = 'reserve-app:last-auth-portal';

describe('auth-portal-preference', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('persists and clears auth portal value', () => {
		const store = new Map<string, string>();
		vi.stubGlobal('window', {
			localStorage: {
				getItem: (key: string) => store.get(key) ?? null,
				setItem: (key: string, value: string) => {
					store.set(key, value);
				},
				removeItem: (key: string) => {
					store.delete(key);
				}
			}
		});

		expect(readLastAuthPortal()).toBeNull();
		writeLastAuthPortal('admin');
		expect(readLastAuthPortal()).toBe('admin');
		writeLastAuthPortal('participant');
		expect(readLastAuthPortal()).toBe('participant');
		clearLastAuthPortal();
		expect(store.has(STORAGE_KEY)).toBe(false);
		expect(readLastAuthPortal()).toBeNull();
	});

	it('returns null for invalid stored value', () => {
		vi.stubGlobal('window', {
			localStorage: {
				getItem: () => 'unknown',
				setItem: vi.fn(),
				removeItem: vi.fn()
			}
		});

		expect(readLastAuthPortal()).toBeNull();
	});

	it('is safe when window is unavailable', () => {
		expect(readLastAuthPortal()).toBeNull();
		expect(() => writeLastAuthPortal('admin')).not.toThrow();
		expect(() => clearLastAuthPortal()).not.toThrow();
	});
});
