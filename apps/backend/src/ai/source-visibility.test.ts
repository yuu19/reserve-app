import { describe, expect, it } from 'vitest';
import type {
  OrganizationClassroomAccess,
  OrganizationRole,
  ClassroomStaffRole,
} from '../booking/authorization.js';
import {
  canUseInternalKnowledge,
  resolveAllowedVisibilities,
  sanitizeSourceReference,
  isSourceScopeAllowed,
} from './source-visibility.js';

const buildAccess = ({
  organizationId = 'org-a',
  classroomId = 'class-a',
  orgRole = null,
  classroomStaffRole = null,
  hasParticipantRecord = false,
}: {
  organizationId?: string;
  classroomId?: string;
  orgRole?: OrganizationRole;
  classroomStaffRole?: ClassroomStaffRole;
  hasParticipantRecord?: boolean;
} = {}): OrganizationClassroomAccess => ({
  organizationId,
  organizationSlug: organizationId,
  organizationName: 'Organization',
  classroomId,
  classroomSlug: classroomId,
  classroomName: 'Classroom',
  facts: {
    orgRole,
    classroomStaffRole,
    hasParticipantRecord,
  },
  effective: {
    canManageOrganization: orgRole === 'owner' || orgRole === 'admin',
    canManageClassroom:
      orgRole === 'owner' || orgRole === 'admin' || classroomStaffRole === 'manager',
    canManageBookings:
      orgRole === 'owner' ||
      orgRole === 'admin' ||
      classroomStaffRole === 'manager' ||
      classroomStaffRole === 'staff',
    canManageParticipants:
      orgRole === 'owner' ||
      orgRole === 'admin' ||
      classroomStaffRole === 'manager' ||
      classroomStaffRole === 'staff',
    canUseParticipantBooking: hasParticipantRecord,
  },
  sources: {
    canManageOrganization: orgRole === 'owner' || orgRole === 'admin' ? 'org_role' : null,
    canManageClassroom:
      orgRole === 'owner' || orgRole === 'admin'
        ? 'org_role'
        : classroomStaffRole === 'manager'
          ? 'classroom_member'
          : null,
    canManageBookings:
      orgRole === 'owner' || orgRole === 'admin'
        ? 'org_role'
        : classroomStaffRole
          ? 'classroom_member'
          : null,
    canManageParticipants:
      orgRole === 'owner' || orgRole === 'admin'
        ? 'org_role'
        : classroomStaffRole
          ? 'classroom_member'
          : null,
    canUseParticipantBooking: hasParticipantRecord ? 'participant_record' : null,
  },
  display: {
    primaryRole: orgRole ?? classroomStaffRole ?? (hasParticipantRecord ? 'participant' : null),
    badges: [],
  },
});

describe('AI source visibility', () => {
  it('maps owner/admin/manager/staff/participant roles to allowed visibility levels', () => {
    expect(resolveAllowedVisibilities(buildAccess({ orgRole: 'owner' }))).toEqual([
      'public',
      'authenticated',
      'participant',
      'staff',
      'manager',
      'admin',
      'owner',
    ]);
    expect(resolveAllowedVisibilities(buildAccess({ orgRole: 'admin' }))).toEqual([
      'public',
      'authenticated',
      'participant',
      'staff',
      'manager',
      'admin',
    ]);
    expect(resolveAllowedVisibilities(buildAccess({ classroomStaffRole: 'manager' }))).toEqual([
      'public',
      'authenticated',
      'participant',
      'staff',
      'manager',
    ]);
    expect(resolveAllowedVisibilities(buildAccess({ classroomStaffRole: 'staff' }))).toEqual([
      'public',
      'authenticated',
      'participant',
      'staff',
    ]);
    expect(resolveAllowedVisibilities(buildAccess({ hasParticipantRecord: true }))).toEqual([
      'public',
      'authenticated',
      'participant',
    ]);
  });

  it('enforces organization, classroom, locale, and internal-only source scope', () => {
    const participant = buildAccess({ hasParticipantRecord: true });

    expect(
      isSourceScopeAllowed({
        source: {
          visibility: 'participant',
          organizationId: 'org-a',
          classroomId: 'class-a',
          locale: 'ja',
        },
        access: participant,
      }),
    ).toBe(true);
    expect(
      isSourceScopeAllowed({
        source: {
          visibility: 'participant',
          organizationId: 'org-b',
          classroomId: 'class-a',
          locale: 'ja',
        },
        access: participant,
      }),
    ).toBe(false);
    expect(
      isSourceScopeAllowed({
        source: {
          visibility: 'participant',
          organizationId: 'org-a',
          classroomId: 'class-b',
          locale: 'ja',
        },
        access: participant,
      }),
    ).toBe(false);
    expect(
      isSourceScopeAllowed({
        source: {
          visibility: 'participant',
          organizationId: 'org-a',
          classroomId: 'class-a',
          locale: 'en',
        },
        access: participant,
      }),
    ).toBe(false);
    expect(
      isSourceScopeAllowed({
        source: {
          visibility: 'authenticated',
          internalOnly: true,
        },
        access: participant,
      }),
    ).toBe(false);
  });

  it('allows internal knowledge only for internal operators and org owner/admin users', () => {
    expect(canUseInternalKnowledge({ access: buildAccess({ orgRole: 'owner' }) })).toBe(true);
    expect(canUseInternalKnowledge({ access: buildAccess({ orgRole: 'admin' }) })).toBe(true);
    expect(
      canUseInternalKnowledge({
        access: buildAccess({ hasParticipantRecord: true }),
        internalOperator: true,
      }),
    ).toBe(true);
    expect(canUseInternalKnowledge({ access: buildAccess({ hasParticipantRecord: true }) })).toBe(
      false,
    );
  });

  it('hides internal spec paths unless the user is owner or internal operator', () => {
    const source = {
      sourceKind: 'specs' as const,
      title: 'AI chatbot spec',
      sourcePath: 'specs/004-ai-chatbot/spec.md',
      chunkId: 'chunk-1',
      visibility: 'admin' as const,
    };

    expect(
      sanitizeSourceReference({
        source,
        access: buildAccess({ orgRole: 'admin' }),
      }),
    ).toMatchObject({ sourcePath: null });
    expect(
      sanitizeSourceReference({
        source,
        access: buildAccess({ orgRole: 'owner' }),
      }),
    ).toMatchObject({ sourcePath: 'specs/004-ai-chatbot/spec.md' });
    expect(
      sanitizeSourceReference({
        source,
        access: buildAccess({ orgRole: 'admin' }),
        internalOperator: true,
      }),
    ).toMatchObject({ sourcePath: 'specs/004-ai-chatbot/spec.md' });
  });
});
