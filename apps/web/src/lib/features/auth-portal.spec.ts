import { describe, expect, it } from 'vitest';
import { resolveLoginPathForNext } from './auth-portal';

describe('認証ポータル判定', () => {
	it('スコープ付き公開イベントパスを参加者ログインポータルへ振り分ける', () => {
		expect(resolveLoginPathForNext('/org-a/store-a/events')).toBe('/participant/login');
		expect(resolveLoginPathForNext('/org-a/store-a/events/slot-1')).toBe('/participant/login');
	});

	it('スコープ付き公開回数券パスを参加者ログインポータルへ振り分ける', () => {
		expect(resolveLoginPathForNext('/org-a/store-a/tickets/ticket-1')).toBe('/participant/login');
	});
});
