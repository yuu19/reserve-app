import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	getScopedContextFromUrlPath,
	normalizeAccessTreePayload,
	redirectToLoginWithNext,
	resolveLastUsedOrganizationId,
	resolvePortalHomePath
} from './auth-session.svelte';

describe('auth-session.svelte', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('redirects to login with encoded next path', () => {
		const assign = vi.fn();
		vi.stubGlobal('window', {
			location: {
				assign
			}
		});

		redirectToLoginWithNext('/events/slot-1?from=public#reserve');
		expect(assign).toHaveBeenCalledWith(
			'/login/participant?next=%2Fevents%2Fslot-1%3Ffrom%3Dpublic%23reserve'
		);
	});

	it('redirects admin paths to admin login', () => {
		const assign = vi.fn();
		vi.stubGlobal('window', {
			location: {
				assign
			}
		});

		redirectToLoginWithNext('/admin/bookings?from=2026-03-01');
		expect(assign).toHaveBeenCalledWith(
			'/login/admin?next=%2Fadmin%2Fbookings%3Ffrom%3D2026-03-01'
		);
	});

	it('redirects unknown paths to auth entry selection', () => {
		const assign = vi.fn();
		vi.stubGlobal('window', {
			location: {
				assign
			}
		});

		redirectToLoginWithNext('/unknown/path');
		expect(assign).toHaveBeenCalledWith('/?next=%2Funknown%2Fpath');
	});

	it('redirects participant invitation acceptance path to participant login', () => {
		const assign = vi.fn();
		vi.stubGlobal('window', {
			location: {
				assign
			}
		});

		redirectToLoginWithNext('/participants/invitations/accept?invitationId=test-invitation');
		expect(assign).toHaveBeenCalledWith(
			'/login/participant?next=%2Fparticipants%2Finvitations%2Faccept%3FinvitationId%3Dtest-invitation'
		);
	});

	it('prefers last used organization when it exists in membership', () => {
		const organizations = [
			{ id: 'org-a', name: 'A', slug: 'a' },
			{ id: 'org-b', name: 'B', slug: 'b' }
		];
		expect(resolveLastUsedOrganizationId(organizations, 'org-b')).toBe('org-b');
	});

	it('returns null when last used organization is not in membership', () => {
		const organizations = [{ id: 'org-a', name: 'A', slug: 'a' }];
		expect(resolveLastUsedOrganizationId(organizations, 'org-x')).toBeNull();
	});

	it('resolves admin dashboard when manage access exists', () => {
		expect(
			resolvePortalHomePath({
				hasOrganizationAdminAccess: true,
				hasParticipantAccess: true,
				canManage: true,
				canUseParticipantBooking: true,
				activeOrganizationRole: 'admin',
				activeClassroomRole: 'manager',
				hasActiveOrganization: true
			})
		).toBe('/admin/dashboard');
	});

	it('resolves admin dashboard when stage1 admin access exists even if active organization is participant-only', () => {
		expect(
			resolvePortalHomePath({
				hasOrganizationAdminAccess: true,
				hasParticipantAccess: true,
				canManage: false,
				canUseParticipantBooking: true,
				activeOrganizationRole: null,
				activeClassroomRole: 'participant',
				hasActiveOrganization: true
			})
		).toBe('/admin/dashboard');
	});

	it('resolves participant home when participant-only access exists', () => {
		expect(
			resolvePortalHomePath({
				hasOrganizationAdminAccess: false,
				hasParticipantAccess: true,
				canManage: false,
				canUseParticipantBooking: true,
				activeOrganizationRole: null,
				activeClassroomRole: 'participant',
				hasActiveOrganization: true
			})
		).toBe('/participant/home');
	});

	it('returns null when no portal access exists', () => {
		expect(
			resolvePortalHomePath({
				hasOrganizationAdminAccess: false,
				hasParticipantAccess: false,
				canManage: false,
				canUseParticipantBooking: false,
				activeOrganizationRole: null,
				activeClassroomRole: null,
				hasActiveOrganization: false
			})
		).toBeNull();
	});

	it('normalizes legacy array access tree payloads', () => {
		expect(
			normalizeAccessTreePayload([
				{
					organizationId: 'org-1',
					organizationSlug: 'org-one',
					organizationName: 'Org One',
					role: 'admin',
					classrooms: [
						{
							classroomId: 'classroom-1',
							classroomSlug: 'room-one',
							classroomName: 'Room One',
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
					orgRole: 'admin',
					classrooms: [
						{
							id: 'classroom-1',
							slug: 'room-one',
							name: 'Room One',
							logo: null,
							role: 'manager',
							canManage: true,
							canUseParticipantBooking: false
						}
					]
				}
			]
		});
	});

	it('accepts current object-shaped access tree payloads', () => {
		const payload = {
			orgs: [
				{
					org: {
						id: 'org-1',
						slug: 'org-one',
						name: 'Org One'
					},
					orgRole: 'owner',
					classrooms: [
						{
							id: 'classroom-1',
							slug: 'room-one',
							name: 'Room One',
							role: 'manager',
							canManage: true,
							canUseParticipantBooking: false
						}
					]
				}
			]
		};

		expect(normalizeAccessTreePayload(payload)).toEqual(payload);
	});

	it('resolves a scoped context from the current URL path when it exists in the access tree', () => {
		const accessTree = {
			orgs: [
				{
					org: {
						id: 'org-1',
						slug: 'org-one',
						name: 'Org One'
					},
					orgRole: 'owner' as const,
					classrooms: [
						{
							id: 'classroom-1',
							slug: 'room-a',
							name: 'Room A',
							role: 'manager' as const,
							canManage: true,
							canUseParticipantBooking: true
						},
						{
							id: 'classroom-2',
							slug: 'room-b',
							name: 'Room B',
							role: 'manager' as const,
							canManage: true,
							canUseParticipantBooking: true
						}
					]
				}
			]
		};

		expect(
			getScopedContextFromUrlPath(accessTree, '/org-one/room-b/admin/schedules/slots?month=2026-03')
		).toEqual({
			orgSlug: 'org-one',
			classroomSlug: 'room-b'
		});
	});

	it('returns null for unknown scoped contexts in the URL path', () => {
		const accessTree = {
			orgs: [
				{
					org: {
						id: 'org-1',
						slug: 'org-one',
						name: 'Org One'
					},
					orgRole: 'owner' as const,
					classrooms: [
						{
							id: 'classroom-1',
							slug: 'room-a',
							name: 'Room A',
							role: 'manager' as const,
							canManage: true,
							canUseParticipantBooking: true
						}
					]
				}
			]
		};

		expect(getScopedContextFromUrlPath(accessTree, '/org-one/room-b/admin/dashboard')).toBeNull();
	});
});
