import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	clearLastAuthPortal,
	readLastAuthPortal,
	writeLastAuthPortal
} from './auth-portal-preference';

const STORAGE_KEY = 'reserve-app:last-auth-portal';

describe('認証ポータル設定', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('認証ポータル値を保存・クリアする', () => {
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

	it('保存値が不正な場合は null を返す', () => {
		vi.stubGlobal('window', {
			localStorage: {
				getItem: () => 'unknown',
				setItem: vi.fn(),
				removeItem: vi.fn()
			}
		});

		expect(readLastAuthPortal()).toBeNull();
	});

	it('window が利用できない場合も安全に扱う', () => {
		expect(readLastAuthPortal()).toBeNull();
		expect(() => writeLastAuthPortal('admin')).not.toThrow();
		expect(() => clearLastAuthPortal()).not.toThrow();
	});
});
