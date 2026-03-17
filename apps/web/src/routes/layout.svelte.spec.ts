import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Layout from './+layout.svelte';

type MockAccessTree = {
	orgs?: Array<{
		org?: { slug?: string | null } | null;
		classrooms?: Array<{ slug?: string | null }> | null;
	}>;
} | null;

const renderLayout = () =>
	render(Layout, { children: (() => null) as unknown as never });

const buildPortalAccess = (overrides: Record<string, unknown> = {}) => ({
	hasOrganizationAdminAccess: false,
	hasAdminPortalAccess: false,
	hasParticipantAccess: false,
	canManage: false,
	canManageClassroom: false,
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

const buildClassroomEntry = (overrides: Record<string, unknown> = {}) => ({
	id: 'room-1',
	name: 'Room A',
	slug: 'room-a',
	canManage: true,
	canManageClassroom: true,
	canManageBookings: true,
	canManageParticipants: true,
	canUseParticipantBooking: true,
	display: {
		primaryRole: 'manager',
		badges: ['manager', 'participant']
	},
	facts: {
		orgRole: 'admin',
		classroomStaffRole: 'manager',
		hasParticipantRecord: true
	},
	sources: {
		canManageOrganization: 'org_role',
		canManageClassroom: 'org_role',
		canManageBookings: 'org_role',
		canManageParticipants: 'org_role',
		canUseParticipantBooking: 'participant_record'
	},
	...overrides
});

const buildAccessTreeClassroom = (overrides: Record<string, unknown> = {}) => ({
	id: 'room-1',
	name: 'Room A',
	slug: 'room-a',
	facts: {
		orgRole: 'admin',
		classroomStaffRole: 'manager',
		hasParticipantRecord: true
	},
	effective: {
		canManageOrganization: true,
		canManageClassroom: true,
		canManageBookings: true,
		canManageParticipants: true,
		canUseParticipantBooking: true
	},
	sources: {
		canManageOrganization: 'org_role',
		canManageClassroom: 'org_role',
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

const mocks = vi.hoisted(() => ({
	loadSession: vi.fn(),
	loadPortalAccess: vi.fn(),
	loadOrganizations: vi.fn(),
	setActiveOrganization: vi.fn(),
	listClassroomsByOrgSlug: vi.fn(),
	readLastAuthPortal: vi.fn(),
	writeLastAuthPortal: vi.fn(),
	goto: vi.fn(),
	onAuthSessionUpdated: vi.fn(() => () => {}),
	signOut: vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
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
		const classroomSlug = decodeURIComponent(match[2] ?? '');
		for (const orgEntry of accessTree.orgs) {
			if (orgEntry.org?.slug !== orgSlug) {
				continue;
			}
			if (orgEntry.classrooms?.some((classroom) => classroom.slug === classroomSlug)) {
				return { orgSlug, classroomSlug };
			}
		}
		return null;
	}
}));

vi.mock('$lib/features/organization-context.svelte', () => ({
	loadOrganizations: mocks.loadOrganizations,
	setActiveOrganization: mocks.setActiveOrganization,
	listClassroomsByOrgSlug: mocks.listClassroomsByOrgSlug
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
	env: {}
}));

describe('/+layout.svelte', () => {
	beforeEach(() => {
		pageState.url = new URL('https://example.com/admin/dashboard');
		mocks.loadSession.mockReset();
		mocks.loadPortalAccess.mockReset();
		mocks.loadOrganizations.mockReset();
		mocks.setActiveOrganization.mockReset();
		mocks.listClassroomsByOrgSlug.mockReset();
		mocks.readLastAuthPortal.mockReset();
		mocks.writeLastAuthPortal.mockReset();
		mocks.goto.mockReset();
		mocks.onAuthSessionUpdated.mockReset();
		mocks.signOut.mockReset();

		mocks.onAuthSessionUpdated.mockReturnValue(() => {});
		mocks.loadSession.mockResolvedValue({
			session: { user: { name: 'Layout User' }, session: {} },
			status: 200
		});
		mocks.loadOrganizations.mockResolvedValue({
			organizations: [{ id: 'org-1', name: 'Org One', slug: 'org-one' }],
			activeOrganization: { id: 'org-1', name: 'Org One', slug: 'org-one' },
			classrooms: [],
			activeClassroom: null
		});
		mocks.listClassroomsByOrgSlug.mockResolvedValue([]);
		mocks.loadPortalAccess.mockResolvedValue(
			buildPortalAccess({
				hasOrganizationAdminAccess: true,
				hasAdminPortalAccess: true,
				hasParticipantAccess: true,
				canManage: true,
				canManageClassroom: true,
				canManageBookings: true,
				canManageParticipants: true,
				canUseParticipantBooking: true,
				activeOrganizationRole: 'admin',
				activeFacts: {
					orgRole: 'admin',
					classroomStaffRole: 'manager',
					hasParticipantRecord: true
				},
				activeSources: {
					canManageOrganization: 'org_role',
					canManageClassroom: 'org_role',
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

	it('shows only admin sidebar items when active portal is admin', async () => {
		mocks.readLastAuthPortal.mockReturnValue('admin');
		renderLayout();

		await vi.waitFor(() => {
			expect(document.querySelector('a[href="/admin/dashboard"]')).not.toBeNull();
			expect(document.querySelector('a[href="/events"]')).toBeNull();
			expect(document.body.textContent).toContain('参加者へ切替');
			expect(document.body.textContent).not.toContain('管理者へ切替');
		});
	});

	it('shows only participant sidebar items when active portal is participant', async () => {
		mocks.readLastAuthPortal.mockReturnValue('participant');
		renderLayout();

		await vi.waitFor(() => {
			expect(document.querySelector('a[href="/events"]')).not.toBeNull();
			expect(document.querySelector('a[href="/admin/dashboard"]')).toBeNull();
			expect(document.body.textContent).toContain('管理者へ切替');
			expect(document.body.textContent).not.toContain('参加者へ切替');
		});
	});

	it('shows booking and participant admin items for staff without org-admin items', async () => {
		mocks.readLastAuthPortal.mockReturnValue('admin');
		mocks.loadPortalAccess.mockResolvedValue(
			buildPortalAccess({
				hasOrganizationAdminAccess: false,
				hasAdminPortalAccess: true,
				hasParticipantAccess: false,
				canManage: false,
				canManageClassroom: false,
				canManageBookings: true,
				canManageParticipants: true,
				canUseParticipantBooking: false,
				activeFacts: {
					orgRole: null,
					classroomStaffRole: 'staff',
					hasParticipantRecord: false
				},
				activeSources: {
					canManageOrganization: null,
					canManageClassroom: null,
					canManageBookings: 'classroom_member',
					canManageParticipants: 'classroom_member',
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
			classrooms: [
				buildClassroomEntry({
					canManage: false,
					canManageClassroom: false,
					canManageBookings: true,
					canManageParticipants: true,
					canUseParticipantBooking: false,
					display: {
						primaryRole: 'staff',
						badges: ['staff']
					},
					facts: {
						orgRole: null,
						classroomStaffRole: 'staff',
						hasParticipantRecord: false
					},
					sources: {
						canManageOrganization: null,
						canManageClassroom: null,
						canManageBookings: 'classroom_member',
						canManageParticipants: 'classroom_member',
						canUseParticipantBooking: null
					}
				})
			],
			activeClassroom: buildClassroomEntry({
				canManage: false,
				canManageClassroom: false,
				canManageBookings: true,
				canManageParticipants: true,
				canUseParticipantBooking: false,
				display: {
					primaryRole: 'staff',
					badges: ['staff']
				},
				facts: {
					orgRole: null,
					classroomStaffRole: 'staff',
					hasParticipantRecord: false
				},
				sources: {
					canManageOrganization: null,
					canManageClassroom: null,
					canManageBookings: 'classroom_member',
					canManageParticipants: 'classroom_member',
					canUseParticipantBooking: null
				}
			})
		});
		renderLayout();

		await vi.waitFor(() => {
			expect(document.querySelector('a[href="/admin/bookings"]')).not.toBeNull();
			expect(document.querySelector('a[href="/admin/participants"]')).not.toBeNull();
			expect(document.querySelector('a[href="/admin/services"]')).toBeNull();
			expect(document.querySelector('a[href="/admin/classrooms"]')).toBeNull();
			expect(document.body.textContent).not.toContain('参加者へ切替');
		});
	});

	it('falls back to participant portal when stored admin is no longer accessible', async () => {
		mocks.readLastAuthPortal.mockReturnValue('admin');
		mocks.loadPortalAccess.mockResolvedValue(
			buildPortalAccess({
				hasOrganizationAdminAccess: false,
				hasAdminPortalAccess: false,
				hasParticipantAccess: true,
				canManage: false,
				canManageClassroom: false,
				canManageBookings: false,
				canManageParticipants: false,
				canUseParticipantBooking: true,
				activeFacts: {
					orgRole: null,
					classroomStaffRole: null,
					hasParticipantRecord: true
				},
				activeSources: {
					canManageOrganization: null,
					canManageClassroom: null,
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

	it('resyncs stale classroom state from the scoped url context', async () => {
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
					classrooms: [
						buildAccessTreeClassroom(),
						buildAccessTreeClassroom({
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
				classrooms: [
					buildClassroomEntry(),
					buildClassroomEntry({ id: 'room-2', name: 'Room B', slug: 'room-b' })
				],
				activeClassroom: buildClassroomEntry()
			})
			.mockResolvedValueOnce({
				organizations: [{ id: 'org-1', name: 'Org One', slug: 'org-one' }],
				activeOrganization: { id: 'org-1', name: 'Org One', slug: 'org-one' },
				classrooms: [
					buildClassroomEntry(),
					buildClassroomEntry({ id: 'room-2', name: 'Room B', slug: 'room-b' })
				],
				activeClassroom: buildClassroomEntry({ id: 'room-2', name: 'Room B', slug: 'room-b' })
			});

		mocks.loadPortalAccess
			.mockResolvedValueOnce(
				buildPortalAccess({
					hasOrganizationAdminAccess: true,
					hasAdminPortalAccess: true,
					hasParticipantAccess: true,
					canManage: true,
					canManageClassroom: true,
					canManageBookings: true,
					canManageParticipants: true,
					canUseParticipantBooking: true,
					activeOrganizationRole: 'admin',
					activeFacts: {
						orgRole: 'admin',
						classroomStaffRole: 'manager',
						hasParticipantRecord: true
					},
					activeSources: {
						canManageOrganization: 'org_role',
						canManageClassroom: 'org_role',
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
					activeContext: { orgSlug: 'org-one', classroomSlug: 'room-a' },
					accessTree
				})
			)
			.mockResolvedValueOnce(
				buildPortalAccess({
					hasOrganizationAdminAccess: true,
					hasAdminPortalAccess: true,
					hasParticipantAccess: true,
					canManage: true,
					canManageClassroom: true,
					canManageBookings: true,
					canManageParticipants: true,
					canUseParticipantBooking: true,
					activeOrganizationRole: 'admin',
					activeFacts: {
						orgRole: 'admin',
						classroomStaffRole: 'manager',
						hasParticipantRecord: true
					},
					activeSources: {
						canManageOrganization: 'org_role',
						canManageClassroom: 'org_role',
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
					activeContext: { orgSlug: 'org-one', classroomSlug: 'room-b' },
					accessTree
				})
			);

		renderLayout();

		await vi.waitFor(() => {
			expect(mocks.loadOrganizations).toHaveBeenNthCalledWith(2, {
				orgSlug: 'org-one',
				classroomSlug: 'room-b'
			});
			expect(mocks.loadPortalAccess).toHaveBeenNthCalledWith(2, {
				orgSlug: 'org-one',
				classroomSlug: 'room-b'
			});
			expect(document.body.textContent).toContain('Room B');
		});
	});
});
