import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	getScopedContextFromUrlPath,
	normalizeAccessTreePayload,
	redirectToLoginWithNext,
	resolveLastUsedOrganizationId,
	resolvePortalHomePath
} from './auth-session.svelte';

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
	id: 'store-1',
	slug: 'room-one',
	name: 'Room One',
	facts: {
		orgRole: null,
		storeStaffRole: null,
		hasParticipantRecord: false
	},
	effective: {
		canManageOrganization: false,
		canManageStore: false,
		canManageBookings: false,
		canManageParticipants: false,
		canUseParticipantBooking: false
	},
	sources: {
		canManageOrganization: null,
		canManageStore: null,
		canManageBookings: null,
		canManageParticipants: null,
		canUseParticipantBooking: null
	},
	display: {
		primaryRole: null,
		badges: []
	},
	...overrides
});

describe('認証セッション処理', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('エンコード済み next パス付きでログインへリダイレクトする', () => {
		const assign = vi.fn();
		vi.stubGlobal('window', {
			location: {
				assign
			}
		});

		redirectToLoginWithNext('/org-one/room-one/events/slot-1?from=public#reserve');
		expect(assign).toHaveBeenCalledWith(
			'/participant/login?next=%2Forg-one%2Froom-one%2Fevents%2Fslot-1%3Ffrom%3Dpublic%23reserve'
		);
	});

	it('管理者パスを管理者ログインへリダイレクトする', () => {
		const assign = vi.fn();
		vi.stubGlobal('window', {
			location: {
				assign
			}
		});

		redirectToLoginWithNext('/admin/bookings?from=2026-03-01');
		expect(assign).toHaveBeenCalledWith(
			'/admin/login?next=%2Fadmin%2Fbookings%3Ffrom%3D2026-03-01'
		);
	});

	it('不明なパスを認証入口選択へリダイレクトする', () => {
		const assign = vi.fn();
		vi.stubGlobal('window', {
			location: {
				assign
			}
		});

		redirectToLoginWithNext('/unknown/path');
		expect(assign).toHaveBeenCalledWith('/?next=%2Funknown%2Fpath');
	});

	it('参加者招待受諾パスを参加者ログインへリダイレクトする', () => {
		const assign = vi.fn();
		vi.stubGlobal('window', {
			location: {
				assign
			}
		});

		redirectToLoginWithNext('/participants/invitations/accept?invitationId=test-invitation');
		expect(assign).toHaveBeenCalledWith(
			'/participant/login?next=%2Fparticipants%2Finvitations%2Faccept%3FinvitationId%3Dtest-invitation'
		);
	});

	it('メンバーシップに存在する場合は最後に使った組織を優先する', () => {
		const organizations = [
			{ id: 'org-a', name: 'A', slug: 'a' },
			{ id: 'org-b', name: 'B', slug: 'b' }
		];
		expect(resolveLastUsedOrganizationId(organizations, 'org-b')).toBe('org-b');
	});

	it('最後に使った組織がメンバーシップにない場合は null を返す', () => {
		const organizations = [{ id: 'org-a', name: 'A', slug: 'a' }];
		expect(resolveLastUsedOrganizationId(organizations, 'org-x')).toBeNull();
	});

	it('管理アクセスがある場合は管理ダッシュボードを解決する', () => {
		expect(
			resolvePortalHomePath(
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
			)
		).toBe('/admin/dashboard');
	});

	it('アクティブ組織が参加者専用でも stage1 管理アクセスがある場合は管理ダッシュボードを解決する', () => {
		expect(
			resolvePortalHomePath(
				buildPortalAccess({
					hasOrganizationAdminAccess: true,
					hasAdminPortalAccess: true,
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
			)
		).toBe('/admin/dashboard');
	});

	it('参加者専用アクセスがある場合は参加者ホームを解決する', () => {
		expect(
			resolvePortalHomePath(
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
			)
		).toBe('/participant/home');
	});

	it('スタッフ予約アクセスがある場合は管理予約を解決する', () => {
		expect(
			resolvePortalHomePath(
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
			)
		).toBe('/admin/bookings');
	});

	it('ポータルアクセスがない場合は null を返す', () => {
		expect(resolvePortalHomePath(buildPortalAccess())).toBeNull();
	});

	it('旧配列形式のアクセスツリーペイロードを正規化する', () => {
		expect(
			normalizeAccessTreePayload([
				{
					organizationId: 'org-1',
					organizationSlug: 'org-one',
					organizationName: 'Org One',
					role: 'admin',
					stores: [
						{
							storeId: 'store-1',
							storeSlug: 'room-one',
							storeName: 'Room One',
							role: 'manager',
							canManage: true,
							canUseParticipantBooking: false
						}
					]
				}
			])
		).toEqual({
			orgs: [
				{
					org: {
						id: 'org-1',
						slug: 'org-one',
						name: 'Org One',
						logo: null
					},
					stores: [
						buildStoreEntry({
							id: 'store-1',
							slug: 'room-one',
							name: 'Room One',
							logo: null,
							facts: {
								orgRole: 'admin',
								storeStaffRole: 'manager',
								hasParticipantRecord: false
							},
							effective: {
								canManageOrganization: true,
								canManageStore: true,
								canManageBookings: true,
								canManageParticipants: true,
								canUseParticipantBooking: false
							},
							sources: {
								canManageOrganization: 'org_role',
								canManageStore: 'store_member',
								canManageBookings: 'store_member',
								canManageParticipants: 'store_member',
								canUseParticipantBooking: null
							},
							display: {
								primaryRole: 'manager',
								badges: ['manager']
							}
						})
					]
				}
			]
		});
	});

	it('旧ペイロード正規化でスタッフ予約と参加者機能を保持する', () => {
		expect(
			normalizeAccessTreePayload([
				{
					organizationId: 'org-1',
					organizationSlug: 'org-one',
					organizationName: 'Org One',
					role: 'member',
					stores: [
						{
							storeId: 'store-1',
							storeSlug: 'room-one',
							storeName: 'Room One',
							role: 'staff',
							canManage: true,
							canUseParticipantBooking: false
						}
					]
				}
			])
		).toEqual({
			orgs: [
				{
					org: {
						id: 'org-1',
						slug: 'org-one',
						name: 'Org One',
						logo: null
					},
					stores: [
						buildStoreEntry({
							id: 'store-1',
							slug: 'room-one',
							name: 'Room One',
							logo: null,
							facts: {
								orgRole: 'member',
								storeStaffRole: 'staff',
								hasParticipantRecord: false
							},
							effective: {
								canManageOrganization: false,
								canManageStore: false,
								canManageBookings: true,
								canManageParticipants: true,
								canUseParticipantBooking: false
							},
							sources: {
								canManageOrganization: null,
								canManageStore: null,
								canManageBookings: 'store_member',
								canManageParticipants: 'store_member',
								canUseParticipantBooking: null
							},
							display: {
								primaryRole: 'staff',
								badges: ['staff']
							}
						})
					]
				}
			]
		});
	});

	it('現行のオブジェクト形式アクセスツリーペイロードを受け入れる', () => {
		const payload = {
			orgs: [
				{
					org: {
						id: 'org-1',
						slug: 'org-one',
						name: 'Org One'
					},
					stores: [
						buildStoreEntry({
							id: 'store-1',
							slug: 'room-one',
							name: 'Room One',
							facts: {
								orgRole: 'owner',
								storeStaffRole: 'manager',
								hasParticipantRecord: false
							},
							effective: {
								canManageOrganization: true,
								canManageStore: true,
								canManageBookings: true,
								canManageParticipants: true,
								canUseParticipantBooking: false
							},
							sources: {
								canManageOrganization: 'org_role',
								canManageStore: 'org_role',
								canManageBookings: 'org_role',
								canManageParticipants: 'org_role',
								canUseParticipantBooking: null
							},
							display: {
								primaryRole: 'owner',
								badges: ['owner', 'manager']
							}
						})
					]
				}
			]
		};

		expect(normalizeAccessTreePayload(payload)).toEqual(payload);
	});

	it('アクセスツリーに存在する場合は現在の URL パスからスコープ付きコンテキストを解決する', () => {
		const accessTree = {
			orgs: [
				{
					org: {
						id: 'org-1',
						slug: 'org-one',
						name: 'Org One'
					},
					stores: [
						buildStoreEntry({
							id: 'store-1',
							slug: 'room-a',
							name: 'Room A',
							facts: {
								orgRole: 'owner',
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
								primaryRole: 'owner',
								badges: ['owner', 'manager', 'participant']
							}
						}),
						buildStoreEntry({
							id: 'store-2',
							slug: 'room-b',
							name: 'Room B',
							facts: {
								orgRole: 'owner',
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
								primaryRole: 'owner',
								badges: ['owner', 'manager', 'participant']
							}
						})
					]
				}
			]
		};

		expect(
			getScopedContextFromUrlPath(accessTree, '/org-one/room-b/admin/schedules/slots?month=2026-03')
		).toEqual({
			orgSlug: 'org-one',
			storeSlug: 'room-b'
		});
	});

	it('URL パス内の不明なスコープ付きコンテキストには null を返す', () => {
		const accessTree = {
			orgs: [
				{
					org: {
						id: 'org-1',
						slug: 'org-one',
						name: 'Org One'
					},
					stores: [
						buildStoreEntry({
							id: 'store-1',
							slug: 'room-a',
							name: 'Room A',
							facts: {
								orgRole: 'owner',
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
								primaryRole: 'owner',
								badges: ['owner', 'manager', 'participant']
							}
						})
					]
				}
			]
		};

		expect(getScopedContextFromUrlPath(accessTree, '/org-one/room-b/admin/dashboard')).toBeNull();
	});
});
