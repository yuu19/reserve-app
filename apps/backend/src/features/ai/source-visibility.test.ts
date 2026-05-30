import { describe, expect, it } from 'vitest';
import type {
  OrganizationStoreAccess,
  OrganizationRole,
  StoreStaffRole,
} from '../../domain/booking/authorization.js';
import {
  canUseInternalKnowledge,
  resolveAllowedVisibilities,
  sanitizeSourceReference,
  isSourceScopeAllowed,
} from './source-visibility.js';

const buildAccess = ({
  organizationId = 'org-a',
  storeId = 'class-a',
  orgRole = null,
  storeStaffRole = null,
  hasParticipantRecord = false,
}: {
  organizationId?: string;
  storeId?: string;
  orgRole?: OrganizationRole;
  storeStaffRole?: StoreStaffRole;
  hasParticipantRecord?: boolean;
} = {}): OrganizationStoreAccess => ({
  organizationId,
  organizationSlug: organizationId,
  organizationName: 'Organization',
  storeId,
  storeSlug: storeId,
  storeName: 'Store',
  facts: {
    orgRole,
    storeStaffRole,
    hasParticipantRecord,
  },
  effective: {
    canManageOrganization: orgRole === 'owner' || orgRole === 'admin',
    canManageStore: orgRole === 'owner' || orgRole === 'admin' || storeStaffRole === 'manager',
    canManageBookings:
      orgRole === 'owner' ||
      orgRole === 'admin' ||
      storeStaffRole === 'manager' ||
      storeStaffRole === 'staff',
    canManageParticipants:
      orgRole === 'owner' ||
      orgRole === 'admin' ||
      storeStaffRole === 'manager' ||
      storeStaffRole === 'staff',
    canUseParticipantBooking: hasParticipantRecord,
  },
  sources: {
    canManageOrganization: orgRole === 'owner' || orgRole === 'admin' ? 'org_role' : null,
    canManageStore:
      orgRole === 'owner' || orgRole === 'admin'
        ? 'org_role'
        : storeStaffRole === 'manager'
          ? 'store_member'
          : null,
    canManageBookings:
      orgRole === 'owner' || orgRole === 'admin'
        ? 'org_role'
        : storeStaffRole
          ? 'store_member'
          : null,
    canManageParticipants:
      orgRole === 'owner' || orgRole === 'admin'
        ? 'org_role'
        : storeStaffRole
          ? 'store_member'
          : null,
    canUseParticipantBooking: hasParticipantRecord ? 'participant_record' : null,
  },
  display: {
    primaryRole: orgRole ?? storeStaffRole ?? (hasParticipantRecord ? 'participant' : null),
    badges: [],
  },
});

describe('AI ソース可視性', () => {
  it('owner・admin・manager・staff・participant ロールを許可可視性レベルへ対応付ける', () => {
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
    expect(resolveAllowedVisibilities(buildAccess({ storeStaffRole: 'manager' }))).toEqual([
      'public',
      'authenticated',
      'participant',
      'staff',
      'manager',
    ]);
    expect(resolveAllowedVisibilities(buildAccess({ storeStaffRole: 'staff' }))).toEqual([
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

  it('組織・店舗・ロケール・内部専用のソーススコープを強制する', () => {
    const participant = buildAccess({ hasParticipantRecord: true });

    expect(
      isSourceScopeAllowed({
        source: {
          visibility: 'participant',
          organizationId: 'org-a',
          storeId: 'class-a',
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
          storeId: 'class-a',
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
          storeId: 'class-b',
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
          storeId: 'class-a',
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

  it('内部ナレッジを内部オペレーターと組織 owner/admin ユーザーだけに許可する', () => {
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

  it('ユーザーがオーナーまたは内部オペレーターでない場合は内部 spec パスを隠す', () => {
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
