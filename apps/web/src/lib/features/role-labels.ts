import type {
	AccessDisplayRole,
	OrganizationInvitationRole,
	StoreInvitationRole
} from '$lib/rpc-client';

export type RoleDisplayValue =
	| AccessDisplayRole
	| OrganizationInvitationRole
	| StoreInvitationRole
	| 'member';

export const ROLE_DISPLAY_LABELS = {
	owner: '組織オーナー',
	admin: '組織管理者',
	member: '組織メンバー',
	manager: '店舗管理者',
	staff: '店舗スタッフ',
	participant: '参加者'
} as const satisfies Record<RoleDisplayValue, string>;

export const ORGANIZATION_INVITATION_ROLE_OPTIONS = [
	{ value: 'admin', label: ROLE_DISPLAY_LABELS.admin },
	{ value: 'member', label: ROLE_DISPLAY_LABELS.member }
] as const satisfies ReadonlyArray<{
	value: OrganizationInvitationRole;
	label: string;
}>;

export const STORE_OPERATOR_INVITATION_ROLE_OPTIONS = [
	{ value: 'manager', label: ROLE_DISPLAY_LABELS.manager },
	{ value: 'staff', label: ROLE_DISPLAY_LABELS.staff }
] as const satisfies ReadonlyArray<{
	value: Exclude<StoreInvitationRole, 'participant'>;
	label: string;
}>;

export const ROLE_DISPLAY_VALUES = Object.keys(ROLE_DISPLAY_LABELS) as RoleDisplayValue[];

export const isRoleDisplayValue = (value: unknown): value is RoleDisplayValue =>
	typeof value === 'string' && ROLE_DISPLAY_VALUES.includes(value as RoleDisplayValue);

export const resolveRoleLabel = (role: string | null | undefined, fallback = '-'): string =>
	isRoleDisplayValue(role) ? ROLE_DISPLAY_LABELS[role] : fallback;
