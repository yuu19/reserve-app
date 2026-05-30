import { describe, expect, it } from 'vitest';
import {
	buildScopedPath,
	getRoutePathFromUrlPath,
	preserveScopedRouteContext,
	replacePortalPathWithScopedContext,
	splitScopedPath
} from './scoped-routing';

describe('スコープ付きルーティング', () => {
	it('スコープ付き URL パスから非スコープのポータルパスを抽出する', () => {
		expect(getRoutePathFromUrlPath('/org-a/room-b/admin/schedules/slots')).toBe(
			'/admin/schedules/slots'
		);
		expect(getRoutePathFromUrlPath('/org-a/room-b/events/slot-1')).toBe('/events/slot-1');
		expect(getRoutePathFromUrlPath('/org-a/room-b/tickets/ticket-1')).toBe('/tickets/ticket-1');
		expect(getRoutePathFromUrlPath('/admin/login')).toBe('/admin/login');
	});

	it('旧ポータルパスをスコープ付きコンテキストで置換する', () => {
		expect(
			replacePortalPathWithScopedContext('/admin/stores?tab=list', {
				orgSlug: 'org-a',
				storeSlug: 'room-b'
			})
		).toBe('/org-a/room-b/admin/stores?tab=list');
	});

	it('サブパスとクエリを保持しながら既存のスコープ付きコンテキストを置換する', () => {
		expect(
			replacePortalPathWithScopedContext('/org-a/room-a/admin/schedules/slots?month=2026-03', {
				orgSlug: 'org-a',
				storeSlug: 'room-b'
			})
		).toBe('/org-a/room-b/admin/schedules/slots?month=2026-03');
	});

	it('すでに一致しているスコープ付きポータルパスは変更しない', () => {
		expect(
			replacePortalPathWithScopedContext('/org-a/room-b/admin/dashboard', {
				orgSlug: 'org-a',
				storeSlug: 'room-b'
			})
		).toBe('/org-a/room-b/admin/dashboard');
	});

	it('現在の URL パスからスコープ付きコンテキストを保持する', () => {
		expect(
			preserveScopedRouteContext(
				'/admin/services/new?from=dashboard',
				'/org-a/room-b/admin/dashboard'
			)
		).toBe('/org-a/room-b/admin/services/new?from=dashboard');
	});

	it('現在の URL にスコープ付きコンテキストがない場合はポータルパスを非スコープのままにする', () => {
		expect(preserveScopedRouteContext('/admin/services/new', '/admin/dashboard')).toBe(
			'/admin/services/new'
		);
	});

	it('スコープ付きパスを組み立てコンテキストと残りのパスへ分解する', () => {
		const scopedPath = buildScopedPath(
			{
				orgSlug: 'org-a',
				storeSlug: 'room-b'
			},
			'/participant/bookings'
		);

		expect(scopedPath).toBe('/org-a/room-b/participant/bookings');
		expect(splitScopedPath(scopedPath)).toEqual({
			context: { orgSlug: 'org-a', storeSlug: 'room-b' },
			remainderPath: '/participant/bookings'
		});
	});

	it('スコープ付き公開回数券パスを組み立てコンテキストと残りのパスへ分解する', () => {
		const scopedPath = buildScopedPath(
			{
				orgSlug: 'org-a',
				storeSlug: 'room-b'
			},
			'/tickets/ticket-1'
		);

		expect(scopedPath).toBe('/org-a/room-b/tickets/ticket-1');
		expect(splitScopedPath(scopedPath)).toEqual({
			context: { orgSlug: 'org-a', storeSlug: 'room-b' },
			remainderPath: '/tickets/ticket-1'
		});
	});
});
