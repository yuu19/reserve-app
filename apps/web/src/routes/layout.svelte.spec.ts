import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Layout from './+layout.svelte';

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
	getScopedContextFromUrlPath: (accessTree: any, path: string) => {
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
			if (orgEntry.classrooms?.some((classroom: any) => classroom.slug === classroomSlug)) {
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
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: true,
			hasParticipantAccess: true,
			canManage: true,
			canUseParticipantBooking: true,
			activeOrganizationRole: 'admin',
			activeClassroomRole: 'manager',
			hasActiveOrganization: true
		});
		mocks.setActiveOrganization.mockResolvedValue({ ok: true, message: '' });
		mocks.signOut.mockResolvedValue(
			new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
		);
	});

	it('shows only admin sidebar items when active portal is admin', async () => {
		mocks.readLastAuthPortal.mockReturnValue('admin');
		render(Layout as any, { children: (() => null) as any });

		await vi.waitFor(() => {
			expect(document.querySelector('a[href="/admin/dashboard"]')).not.toBeNull();
			expect(document.querySelector('a[href="/events"]')).toBeNull();
			expect(document.body.textContent).toContain('参加者へ切替');
			expect(document.body.textContent).not.toContain('管理者へ切替');
		});
	});

	it('shows only participant sidebar items when active portal is participant', async () => {
		mocks.readLastAuthPortal.mockReturnValue('participant');
		render(Layout as any, { children: (() => null) as any });

		await vi.waitFor(() => {
			expect(document.querySelector('a[href="/events"]')).not.toBeNull();
			expect(document.querySelector('a[href="/admin/dashboard"]')).toBeNull();
			expect(document.body.textContent).toContain('管理者へ切替');
			expect(document.body.textContent).not.toContain('参加者へ切替');
		});
	});

	it('falls back to participant portal when stored admin is no longer accessible', async () => {
		mocks.readLastAuthPortal.mockReturnValue('admin');
		mocks.loadPortalAccess.mockResolvedValue({
			hasOrganizationAdminAccess: false,
			hasParticipantAccess: true,
			canManage: false,
			canUseParticipantBooking: true,
			activeOrganizationRole: null,
			activeClassroomRole: 'participant',
			hasActiveOrganization: true
		});
		render(Layout as any, { children: (() => null) as any });

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
					orgRole: 'admin',
					classrooms: [
						{
							id: 'room-1',
							name: 'Room A',
							slug: 'room-a',
							role: 'manager',
							canManage: true,
							canUseParticipantBooking: true
						},
						{
							id: 'room-2',
							name: 'Room B',
							slug: 'room-b',
							role: 'manager',
							canManage: true,
							canUseParticipantBooking: true
						}
					]
				}
			]
		};

		mocks.loadOrganizations
			.mockResolvedValueOnce({
				organizations: [{ id: 'org-1', name: 'Org One', slug: 'org-one' }],
				activeOrganization: { id: 'org-1', name: 'Org One', slug: 'org-one' },
				classrooms: [
					{ id: 'room-1', name: 'Room A', slug: 'room-a', role: 'manager', canManage: true, canUseParticipantBooking: true },
					{ id: 'room-2', name: 'Room B', slug: 'room-b', role: 'manager', canManage: true, canUseParticipantBooking: true }
				],
				activeClassroom: { id: 'room-1', name: 'Room A', slug: 'room-a', role: 'manager', canManage: true, canUseParticipantBooking: true }
			})
			.mockResolvedValueOnce({
				organizations: [{ id: 'org-1', name: 'Org One', slug: 'org-one' }],
				activeOrganization: { id: 'org-1', name: 'Org One', slug: 'org-one' },
				classrooms: [
					{ id: 'room-1', name: 'Room A', slug: 'room-a', role: 'manager', canManage: true, canUseParticipantBooking: true },
					{ id: 'room-2', name: 'Room B', slug: 'room-b', role: 'manager', canManage: true, canUseParticipantBooking: true }
				],
				activeClassroom: { id: 'room-2', name: 'Room B', slug: 'room-b', role: 'manager', canManage: true, canUseParticipantBooking: true }
			});

		mocks.loadPortalAccess
			.mockResolvedValueOnce({
				hasOrganizationAdminAccess: true,
				hasParticipantAccess: true,
				canManage: true,
				canUseParticipantBooking: true,
				activeOrganizationRole: 'admin',
				activeClassroomRole: 'manager',
				hasActiveOrganization: true,
				activeContext: { orgSlug: 'org-one', classroomSlug: 'room-a' },
				accessTree
			})
			.mockResolvedValueOnce({
				hasOrganizationAdminAccess: true,
				hasParticipantAccess: true,
				canManage: true,
				canUseParticipantBooking: true,
				activeOrganizationRole: 'admin',
				activeClassroomRole: 'manager',
				hasActiveOrganization: true,
				activeContext: { orgSlug: 'org-one', classroomSlug: 'room-b' },
				accessTree
			});

		render(Layout as any, { children: (() => null) as any });

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
