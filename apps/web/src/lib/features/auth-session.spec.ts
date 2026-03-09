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
	hasParticipantAccess: false,
	canManage: false,
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
	id: 'classroom-1',
	slug: 'room-one',
	name: 'Room One',
	facts: {
		orgRole: null,
		classroomStaffRole: null,
		hasParticipantRecord: false
	},
	effective: {
		canManageOrganization: false,
		canManageClassroom: false,
		canManageBookings: false,
		canManageParticipants: false,
		canUseParticipantBooking: false
	},
	sources: {
		canManageOrganization: null,
		canManageClassroom: null,
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
			resolvePortalHomePath(
				buildPortalAccess({
					hasOrganizationAdminAccess: true,
					hasParticipantAccess: true,
					canManage: true,
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
			)
		).toBe('/admin/dashboard');
	});

	it('resolves admin dashboard when stage1 admin access exists even if active organization is participant-only', () => {
		expect(
			resolvePortalHomePath(
				buildPortalAccess({
					hasOrganizationAdminAccess: true,
					hasParticipantAccess: true,
					canManage: false,
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
			)
		).toBe('/admin/dashboard');
	});

	it('resolves participant home when participant-only access exists', () => {
		expect(
			resolvePortalHomePath(
				buildPortalAccess({
					hasOrganizationAdminAccess: false,
					hasParticipantAccess: true,
					canManage: false,
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
			)
		).toBe('/participant/home');
	});

	it('returns null when no portal access exists', () => {
		expect(resolvePortalHomePath(buildPortalAccess())).toBeNull();
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
					classrooms: [
						buildClassroomEntry({
							id: 'classroom-1',
							slug: 'room-one',
							name: 'Room One',
							logo: null,
							facts: {
								orgRole: 'admin',
								classroomStaffRole: 'manager',
								hasParticipantRecord: false
							},
							effective: {
								canManageOrganization: true,
								canManageClassroom: true,
								canManageBookings: true,
								canManageParticipants: true,
								canUseParticipantBooking: false
							},
							sources: {
								canManageOrganization: 'org_role',
								canManageClassroom: 'classroom_member',
								canManageBookings: 'classroom_member',
								canManageParticipants: 'classroom_member',
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

	it('accepts current object-shaped access tree payloads', () => {
		const payload = {
			orgs: [
				{
					org: {
						id: 'org-1',
						slug: 'org-one',
						name: 'Org One'
					},
					classrooms: [
						buildClassroomEntry({
							id: 'classroom-1',
							slug: 'room-one',
							name: 'Room One',
							facts: {
								orgRole: 'owner',
								classroomStaffRole: 'manager',
								hasParticipantRecord: false
							},
							effective: {
								canManageOrganization: true,
								canManageClassroom: true,
								canManageBookings: true,
								canManageParticipants: true,
								canUseParticipantBooking: false
							},
							sources: {
								canManageOrganization: 'org_role',
								canManageClassroom: 'org_role',
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

	it('resolves a scoped context from the current URL path when it exists in the access tree', () => {
		const accessTree = {
			orgs: [
				{
					org: {
						id: 'org-1',
						slug: 'org-one',
						name: 'Org One'
					},
					classrooms: [
						buildClassroomEntry({
							id: 'classroom-1',
							slug: 'room-a',
							name: 'Room A',
							facts: {
								orgRole: 'owner',
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
								primaryRole: 'owner',
								badges: ['owner', 'manager', 'participant']
							}
						}),
						buildClassroomEntry({
							id: 'classroom-2',
							slug: 'room-b',
							name: 'Room B',
							facts: {
								orgRole: 'owner',
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
					classrooms: [
						buildClassroomEntry({
							id: 'classroom-1',
							slug: 'room-a',
							name: 'Room A',
							facts: {
								orgRole: 'owner',
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
