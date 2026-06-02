import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Layout from './+layout.svelte';

type MockAccessTree = {
	orgs?: Array<{
		org?: { slug?: string | null } | null;
		stores?: Array<{ slug?: string | null }> | null;
	}>;
} | null;

const renderLayout = () => render(Layout, { children: (() => null) as unknown as never });

const buildPortalAccess = (overrides: Record<string, unknown> = {}) => ({
	hasOrganizationAdminAccess: false,
	hasAdminPortalAccess: false,
	hasParticipantAccess: false,
	canManage: false,
	canManageStore: false,
	canManageBookings: false,
	canManageParticipants: false,
	canUseParticipantBooking: false,
	activeOrganizationRole: null,
	activeFacts: null,
	activeSources: null,
	activeDisplay: null,
	activeDisplayRole: null,
	hasActiveOrganization: false,
	...overrides
});

const buildStoreEntry = (overrides: Record<string, unknown> = {}) => ({
	id: 'room-1',
	name: 'Room A',
	slug: 'room-a',
	canManage: true,
	canManageStore: true,
	canManageBookings: true,
	canManageParticipants: true,
	canUseParticipantBooking: true,
	display: {
		primaryRole: 'manager',
		badges: ['manager', 'participant']
	},
	facts: {
		orgRole: 'admin',
		storeStaffRole: 'manager',
		hasParticipantRecord: true
	},
	sources: {
		canManageOrganization: 'org_role',
		canManageStore: 'org_role',
		canManageBookings: 'org_role',
		canManageParticipants: 'org_role',
		canUseParticipantBooking: 'participant_record'
	},
	...overrides
});

const buildAccessTreeStore = (overrides: Record<string, unknown> = {}) => ({
	id: 'room-1',
	name: 'Room A',
	slug: 'room-a',
	facts: {
		orgRole: 'admin',
		storeStaffRole: 'manager',
		hasParticipantRecord: true
	},
	effective: {
		canManageOrganization: true,
		canManageStore: true,
		canManageBookings: true,
		canManageParticipants: true,
		canUseParticipantBooking: true
	},
	sources: {
		canManageOrganization: 'org_role',
		canManageStore: 'org_role',
		canManageBookings: 'org_role',
		canManageParticipants: 'org_role',
		canUseParticipantBooking: 'participant_record'
	},
	display: {
		primaryRole: 'admin',
		badges: ['admin', 'manager', 'participant']
	},
	...overrides
});

const pageState = vi.hoisted(() => ({
	url: new URL('https://example.com/admin/dashboard')
}));

const publicEnv = vi.hoisted(() => ({
	env: {} as Record<string, string | undefined>
}));

const navigationCallbacks = vi.hoisted(() => ({
	before: new Set<(navigation: Record<string, unknown>) => void>(),
	after: new Set<(navigation: Record<string, unknown>) => void>()
}));

const mocks = vi.hoisted(() => ({
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	loadOrganizations: vi.fn(),
	setActiveOrganization: vi.fn(),
	listStoresByOrgSlug: vi.fn(),
	readLastAuthPortal: vi.fn(),
	writeLastAuthPortal: vi.fn(),
	goto: vi.fn(),
	onAuthSessionUpdated: vi.fn(() => () => {}),
	signOut: vi.fn(
		async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
	)
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto,
	beforeNavigate: (callback: (navigation: Record<string, unknown>) => void) => {
		navigationCallbacks.before.add(callback);
	},
	afterNavigate: (callback: (navigation: Record<string, unknown>) => void) => {
		navigationCallbacks.after.add(callback);
	}
}));

vi.mock('$app/paths', () => ({
	assets: '',
	base: '',
	resolve: (value: string) => value
}));

vi.mock('$app/state', () => ({
	page: pageState
}));

vi.mock('$lib/features/auth-portal', () => ({
	isPublicAuthEntryPath: () => false,
	resolveAuthPortalByPath: () => 'admin'
}));

vi.mock('$lib/features/auth-portal-preference', () => ({
	readLastAuthPortal: mocks.readLastAuthPortal,
	writeLastAuthPortal: mocks.writeLastAuthPortal
}));

vi.mock('$lib/features/auth-session.svelte', () => ({
	loadSession: mocks.loadSession,
	loadPortalAccess: mocks.loadPortalAccess,
	parseResponseBody: vi.fn(async () => ({})),
	toErrorMessage: vi.fn((_payload: unknown, fallback: string) => fallback),
	getScopedContextFromUrlPath: (accessTree: MockAccessTree, path: string) => {
		const match = /^\/([^/]+)\/([^/]+)\/(?:admin|participant|events)(?:\/.*)?$/u.exec(
			new URL(path, 'https://example.com').pathname
		);
		if (!match || !accessTree?.orgs) {
			return null;
		}
		const orgSlug = decodeURIComponent(match[1] ?? '');
		const storeSlug = decodeURIComponent(match[2] ?? '');
		for (const orgEntry of accessTree.orgs) {
			if (orgEntry.org?.slug !== orgSlug) {
				continue;
			}
			if (orgEntry.stores?.some((store) => store.slug === storeSlug)) {
				return { orgSlug, storeSlug };
			}
		}
		return null;
	}
}));

vi.mock('$lib/features/organization-context.svelte', () => ({
	loadOrganizations: mocks.loadOrganizations,
	setActiveOrganization: mocks.setActiveOrganization,
	listStoresByOrgSlug: mocks.listStoresByOrgSlug
}));

vi.mock('$lib/features/auth-lifecycle', () => ({
	onAuthSessionUpdated: mocks.onAuthSessionUpdated
}));

vi.mock('$lib/rpc-client', () => ({
	authRpc: {
		signOut: mocks.signOut,
		backendUrl: 'https://api.example.com'
	}
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv.env
}));

const emitBeforeNavigate = (
	overrides: Partial<{
		from: { url: URL | null } | null;
		to: { url: URL | null } | null;
		type: string;
		willUnload: boolean;
	}>
) => {
	const navigation = {
		from: { url: new URL('https://example.com/admin/dashboard') },
		to: { url: new URL('https://example.com/admin/bookings') },
		type: 'link',
		willUnload: false,
		...overrides
	};

	for (const callback of navigationCallbacks.before) {
		callback(navigation);
	}
};

const emitAfterNavigate = (
	overrides: Partial<{
		from: { url: URL | null } | null;
		to: { url: URL | null } | null;
		type: string;
	}>
) => {
	const navigation = {
		from: { url: new URL('https://example.com/admin/dashboard') },
		to: { url: new URL('https://example.com/admin/bookings') },
		type: 'link',
		...overrides
	};

	for (const callback of navigationCallbacks.after) {
		callback(navigation);
	}
};

describe('共通レイアウト', () => {
	beforeEach(() => {
		vi.useRealTimers();
		delete publicEnv.env.PUBLIC_AI_CHAT_ENABLED;
		pageState.url = new URL('https://example.com/admin/dashboard');
		navigationCallbacks.before.clear();
		navigationCallbacks.after.clear();
		mocks.loadSession.mockReset();
		mocks.loadPortalAccess.mockReset();
		mocks.loadOrganizations.mockReset();
		mocks.setActiveOrganization.mockReset();
		mocks.listStoresByOrgSlug.mockReset();
		mocks.readLastAuthPortal.mockReset();
		mocks.writeLastAuthPortal.mockReset();
		mocks.goto.mockReset();
		mocks.onAuthSessionUpdated.mockReset();
		mocks.signOut.mockReset();

		mocks.onAuthSessionUpdated.mockReturnValue(() => {});
		mocks.goto.mockResolvedValue(undefined);
		mocks.loadSession.mockResolvedValue({
			session: { user: { name: 'Layout User' }, session: {} },
			status: 200
		});
		mocks.loadOrganizations.mockResolvedValue({
			organizations: [{ id: 'org-1', name: 'Org One', slug: 'org-one' }],
			activeOrganization: { id: 'org-1', name: 'Org One', slug: 'org-one' },
			stores: [],
			activeStore: null
		});
		mocks.listStoresByOrgSlug.mockResolvedValue([]);
		mocks.loadPortalAccess.mockResolvedValue(
			buildPortalAccess({
				hasOrganizationAdminAccess: true,
				hasAdminPortalAccess: true,
				hasParticipantAccess: true,
				canManage: true,
				canManageStore: true,
				canManageBookings: true,
				canManageParticipants: true,
				canUseParticipantBooking: true,
				activeOrganizationRole: 'admin',
				activeFacts: {
					orgRole: 'admin',
					storeStaffRole: 'manager',
					hasParticipantRecord: true
				},
				activeSources: {
					canManageOrganization: 'org_role',
					canManageStore: 'org_role',
					canManageBookings: 'org_role',
					canManageParticipants: 'org_role',
					canUseParticipantBooking: 'participant_record'
				},
				activeDisplay: {
					primaryRole: 'admin',
					badges: ['admin', 'manager', 'participant']
				},
				activeDisplayRole: 'admin',
				hasActiveOrganization: true
			})
		);
		mocks.setActiveOrganization.mockResolvedValue({ ok: true, message: '' });
		mocks.signOut.mockResolvedValue(
			new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
		);
	});

	it('機能フラグが有効な場合はログイン後に AI ウィジェットを表示する', async () => {
		renderLayout();

		await vi.waitFor(() => {
			expect(document.querySelector('button[aria-label="AIサポートを開く"]')).not.toBeNull();
		});
	});

	it('機能フラグが false の場合は AI ウィジェットを隠す', async () => {
		publicEnv.env.PUBLIC_AI_CHAT_ENABLED = 'false';
		renderLayout();

		await vi.waitFor(() => {
			expect(document.querySelector('a[href="/admin/dashboard"]')).not.toBeNull();
		});
		expect(document.querySelector('button[aria-label="AIサポートを開く"]')).toBeNull();
	});

	it.each(['/pricing', '/terms', '/privacy', '/commerce'])(
		'ログイン中でも公開ページ %s ではサイドバーと AI ウィジェットを隠す',
		async (path) => {
			pageState.url = new URL(`https://example.com${path}`);
			renderLayout();

			await vi.waitFor(() => {
				expect(mocks.loadSession).toHaveBeenCalled();
				expect(document.body.textContent).toContain('WakuReserve');
				expect(document.querySelector('a[href="/admin/dashboard"]')).toBeNull();
				expect(document.querySelector('button[aria-label="AIサポートを開く"]')).toBeNull();
			});
			expect(document.querySelector('footer a[href="/pricing"]')?.textContent?.trim()).toBe('料金');
			expect(document.querySelector('footer a[href="/terms"]')?.textContent?.trim()).toBe(
				'利用規約'
			);
			expect(document.querySelector('footer a[href="/privacy"]')?.textContent?.trim()).toBe(
				'プライバシーポリシー'
			);
			expect(document.querySelector('footer a[href="/commerce"]')?.textContent?.trim()).toBe(
				'特定商取引法に基づく表記'
			);
		}
	);

	it('ログイン中でもトップページではアプリシェルと共通ブランドヘッダーを隠す', async () => {
		pageState.url = new URL('https://example.com/');
		renderLayout();

		await vi.waitFor(() => {
			expect(mocks.loadSession).toHaveBeenCalled();
			expect(document.querySelector('a[href="/admin/dashboard"]')).toBeNull();
			expect(document.querySelector('button[aria-label="AIサポートを開く"]')).toBeNull();
		});
		expect(document.body.textContent).not.toContain('予約管理プラットフォーム');
		expect(document.querySelector('header')).toBeNull();
		expect(document.querySelector('footer')).toBeNull();
	});

	it('ログイン前は AI ウィジェットを隠す', async () => {
		mocks.loadSession.mockResolvedValue({
			session: null,
			status: 401
		});
		renderLayout();

		await vi.waitFor(() => {
			expect(mocks.loadSession).toHaveBeenCalled();
		});
		expect(document.querySelector('button[aria-label="AIサポートを開く"]')).toBeNull();
	});

	it('アクティブポータルが管理者の場合は管理者サイドバー項目だけを表示する', async () => {
		mocks.readLastAuthPortal.mockReturnValue('admin');
		renderLayout();

		await vi.waitFor(() => {
			expect(document.querySelector('a[href="/admin/dashboard"]')).not.toBeNull();
			expect(document.querySelector('a[href="/admin/reminder-settings"]')).not.toBeNull();
			expect(document.querySelector('a[href="/admin/tickets"]')).not.toBeNull();
			expect(document.body.textContent).toContain('回数券管理');
			expect(document.querySelector('a[href="/events"]')).toBeNull();
			expect(document.body.textContent).toContain('参加者へ切替');
			expect(document.body.textContent).not.toContain('管理者へ切替');
		});
	});

	it('アクティブポータルが参加者の場合は参加者サイドバー項目だけを表示する', async () => {
		mocks.readLastAuthPortal.mockReturnValue('participant');
		renderLayout();

		await vi.waitFor(() => {
			expect(document.querySelector('a[href="/events"]')).not.toBeNull();
			expect(document.querySelector('a[href="/admin/dashboard"]')).toBeNull();
			expect(document.body.textContent).toContain('管理者へ切替');
			expect(document.body.textContent).not.toContain('参加者へ切替');
		});
	});

	it('スタッフには org-admin 項目なしで予約と参加者管理項目を表示する', async () => {
		mocks.readLastAuthPortal.mockReturnValue('admin');
		mocks.loadPortalAccess.mockResolvedValue(
			buildPortalAccess({
				hasOrganizationAdminAccess: false,
				hasAdminPortalAccess: true,
				hasParticipantAccess: false,
				canManage: false,
				canManageStore: false,
				canManageBookings: true,
				canManageParticipants: true,
				canUseParticipantBooking: false,
				activeFacts: {
					orgRole: null,
					storeStaffRole: 'staff',
					hasParticipantRecord: false
				},
				activeSources: {
					canManageOrganization: null,
					canManageStore: null,
					canManageBookings: 'store_member',
					canManageParticipants: 'store_member',
					canUseParticipantBooking: null
				},
				activeDisplay: {
					primaryRole: 'staff',
					badges: ['staff']
				},
				activeDisplayRole: 'staff',
				hasActiveOrganization: true
			})
		);
		mocks.loadOrganizations.mockResolvedValue({
			organizations: [{ id: 'org-1', name: 'Org One', slug: 'org-one' }],
			activeOrganization: { id: 'org-1', name: 'Org One', slug: 'org-one' },
			stores: [
				buildStoreEntry({
					canManage: false,
					canManageStore: false,
					canManageBookings: true,
					canManageParticipants: true,
					canUseParticipantBooking: false,
					display: {
						primaryRole: 'staff',
						badges: ['staff']
					},
					facts: {
						orgRole: null,
						storeStaffRole: 'staff',
						hasParticipantRecord: false
					},
					sources: {
						canManageOrganization: null,
						canManageStore: null,
						canManageBookings: 'store_member',
						canManageParticipants: 'store_member',
						canUseParticipantBooking: null
					}
				})
			],
			activeStore: buildStoreEntry({
				canManage: false,
				canManageStore: false,
				canManageBookings: true,
				canManageParticipants: true,
				canUseParticipantBooking: false,
				display: {
					primaryRole: 'staff',
					badges: ['staff']
				},
				facts: {
					orgRole: null,
					storeStaffRole: 'staff',
					hasParticipantRecord: false
				},
				sources: {
					canManageOrganization: null,
					canManageStore: null,
					canManageBookings: 'store_member',
					canManageParticipants: 'store_member',
					canUseParticipantBooking: null
				}
			})
		});
		renderLayout();

		await vi.waitFor(() => {
			expect(document.querySelector('a[href="/org-one/room-a/admin/bookings"]')).not.toBeNull();
			expect(document.querySelector('a[href="/org-one/room-a/admin/participants"]')).not.toBeNull();
			expect(document.querySelector('a[href="/org-one/room-a/admin/tickets"]')).not.toBeNull();
			expect(document.querySelector('a[href="/org-one/room-a/admin/services"]')).toBeNull();
			expect(document.querySelector('a[href="/org-one/room-a/admin/stores"]')).toBeNull();
			expect(document.body.textContent).not.toContain('参加者へ切替');
		});
	});

	it('保存済み管理者ポータルにアクセスできなくなった場合は参加者ポータルへフォールバックする', async () => {
		mocks.readLastAuthPortal.mockReturnValue('admin');
		mocks.loadPortalAccess.mockResolvedValue(
			buildPortalAccess({
				hasOrganizationAdminAccess: false,
				hasAdminPortalAccess: false,
				hasParticipantAccess: true,
				canManage: false,
				canManageStore: false,
				canManageBookings: false,
				canManageParticipants: false,
				canUseParticipantBooking: true,
				activeFacts: {
					orgRole: null,
					storeStaffRole: null,
					hasParticipantRecord: true
				},
				activeSources: {
					canManageOrganization: null,
					canManageStore: null,
					canManageBookings: null,
					canManageParticipants: null,
					canUseParticipantBooking: 'participant_record'
				},
				activeDisplay: {
					primaryRole: 'participant',
					badges: ['participant']
				},
				activeDisplayRole: 'participant',
				hasActiveOrganization: true
			})
		);
		renderLayout();

		await vi.waitFor(() => {
			expect(document.querySelector('a[href="/events"]')).not.toBeNull();
			expect(document.querySelector('a[href="/admin/dashboard"]')).toBeNull();
		});
	});

	it('古い店舗状態をスコープ付き URL コンテキストから再同期する', async () => {
		pageState.url = new URL('https://example.com/org-one/room-b/admin/dashboard');
		mocks.readLastAuthPortal.mockReturnValue('admin');

		const accessTree = {
			orgs: [
				{
					org: {
						id: 'org-1',
						name: 'Org One',
						slug: 'org-one'
					},
					stores: [
						buildAccessTreeStore(),
						buildAccessTreeStore({
							id: 'room-2',
							name: 'Room B',
							slug: 'room-b'
						})
					]
				}
			]
		};

		mocks.loadOrganizations
			.mockResolvedValueOnce({
				organizations: [{ id: 'org-1', name: 'Org One', slug: 'org-one' }],
				activeOrganization: { id: 'org-1', name: 'Org One', slug: 'org-one' },
				stores: [
					buildStoreEntry(),
					buildStoreEntry({ id: 'room-2', name: 'Room B', slug: 'room-b' })
				],
				activeStore: buildStoreEntry()
			})
			.mockResolvedValueOnce({
				organizations: [{ id: 'org-1', name: 'Org One', slug: 'org-one' }],
				activeOrganization: { id: 'org-1', name: 'Org One', slug: 'org-one' },
				stores: [
					buildStoreEntry(),
					buildStoreEntry({ id: 'room-2', name: 'Room B', slug: 'room-b' })
				],
				activeStore: buildStoreEntry({ id: 'room-2', name: 'Room B', slug: 'room-b' })
			});

		mocks.loadPortalAccess
			.mockResolvedValueOnce(
				buildPortalAccess({
					hasOrganizationAdminAccess: true,
					hasAdminPortalAccess: true,
					hasParticipantAccess: true,
					canManage: true,
					canManageStore: true,
					canManageBookings: true,
					canManageParticipants: true,
					canUseParticipantBooking: true,
					activeOrganizationRole: 'admin',
					activeFacts: {
						orgRole: 'admin',
						storeStaffRole: 'manager',
						hasParticipantRecord: true
					},
					activeSources: {
						canManageOrganization: 'org_role',
						canManageStore: 'org_role',
						canManageBookings: 'org_role',
						canManageParticipants: 'org_role',
						canUseParticipantBooking: 'participant_record'
					},
					activeDisplay: {
						primaryRole: 'admin',
						badges: ['admin', 'manager', 'participant']
					},
					activeDisplayRole: 'admin',
					hasActiveOrganization: true,
					activeContext: { orgSlug: 'org-one', storeSlug: 'room-a' },
					accessTree
				})
			)
			.mockResolvedValueOnce(
				buildPortalAccess({
					hasOrganizationAdminAccess: true,
					hasAdminPortalAccess: true,
					hasParticipantAccess: true,
					canManage: true,
					canManageStore: true,
					canManageBookings: true,
					canManageParticipants: true,
					canUseParticipantBooking: true,
					activeOrganizationRole: 'admin',
					activeFacts: {
						orgRole: 'admin',
						storeStaffRole: 'manager',
						hasParticipantRecord: true
					},
					activeSources: {
						canManageOrganization: 'org_role',
						canManageStore: 'org_role',
						canManageBookings: 'org_role',
						canManageParticipants: 'org_role',
						canUseParticipantBooking: 'participant_record'
					},
					activeDisplay: {
						primaryRole: 'admin',
						badges: ['admin', 'manager', 'participant']
					},
					activeDisplayRole: 'admin',
					hasActiveOrganization: true,
					activeContext: { orgSlug: 'org-one', storeSlug: 'room-b' },
					accessTree
				})
			);

		renderLayout();

		await vi.waitFor(() => {
			expect(mocks.loadOrganizations).toHaveBeenNthCalledWith(2, {
				orgSlug: 'org-one',
				storeSlug: 'room-b'
			});
			expect(mocks.loadPortalAccess).toHaveBeenNthCalledWith(2, {
				orgSlug: 'org-one',
				storeSlug: 'room-b'
			});
			expect(document.body.textContent).toContain('Room B');
		});
	});

	it('初期表示ではナビゲーション進捗バーを隠したままにする', async () => {
		renderLayout();

		await vi.waitFor(() => {
			expect(document.querySelector('[data-testid="navigation-progress"]')).toBeNull();
		});
	});

	it('遅延後にナビゲーション進捗バーを表示し完了後に隠す', async () => {
		vi.useFakeTimers();
		renderLayout();

		await vi.waitFor(() => {
			expect(document.querySelector('a[href="/admin/dashboard"]')).not.toBeNull();
		});

		emitBeforeNavigate({});
		await vi.advanceTimersByTimeAsync(119);
		expect(document.querySelector('[data-testid="navigation-progress"]')).toBeNull();

		await vi.advanceTimersByTimeAsync(1);
		await vi.waitFor(() => {
			expect(document.querySelector('[data-testid="navigation-progress"]')).not.toBeNull();
		});

		emitAfterNavigate({});
		await vi.advanceTimersByTimeAsync(180);
		await vi.waitFor(() => {
			expect(document.querySelector('[data-testid="navigation-progress"]')).toBeNull();
		});
	});

	it('高速な遷移ではナビゲーション進捗バーを表示しない', async () => {
		vi.useFakeTimers();
		renderLayout();

		await vi.waitFor(() => {
			expect(document.querySelector('a[href="/admin/dashboard"]')).not.toBeNull();
		});

		emitBeforeNavigate({});
		await vi.advanceTimersByTimeAsync(80);
		emitAfterNavigate({});
		await vi.advanceTimersByTimeAsync(80);

		expect(document.querySelector('[data-testid="navigation-progress"]')).toBeNull();
	});

	it('進捗バーではハッシュだけの遷移を無視する', async () => {
		vi.useFakeTimers();
		renderLayout();

		await vi.waitFor(() => {
			expect(document.querySelector('a[href="/admin/dashboard"]')).not.toBeNull();
		});

		emitBeforeNavigate({
			from: { url: new URL('https://example.com/admin/dashboard#overview') },
			to: { url: new URL('https://example.com/admin/dashboard#billing') }
		});
		await vi.advanceTimersByTimeAsync(200);

		expect(document.querySelector('[data-testid="navigation-progress"]')).toBeNull();
	});
});
