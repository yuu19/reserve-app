import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ComponentProps } from 'svelte';
import ContextSwitcher from './context-switcher.svelte';
import type { ClassroomContextPayload } from '$lib/features/organization-context.svelte';
import type { OrganizationPayload } from '$lib/rpc-client';

type ContextSwitcherProps = ComponentProps<typeof ContextSwitcher>;

const organizations: OrganizationPayload[] = [
	{ id: 'org-a', name: 'Alpha Org', slug: 'alpha', logo: null },
	{ id: 'org-b', name: 'Beta Org', slug: 'beta', logo: 'https://cdn.example.com/beta.webp' }
];

const classrooms: ClassroomContextPayload[] = [
	{
		id: 'room-a',
		name: 'Room A',
		slug: 'room-a',
		canManage: true,
		canManageClassroom: true,
		canManageBookings: true,
		canManageParticipants: true,
		canUseParticipantBooking: true,
		display: {
			primaryRole: 'manager',
			badges: ['manager']
		},
		facts: {
			orgRole: 'admin',
			classroomStaffRole: 'manager',
			hasParticipantRecord: false
		},
		sources: {
			canManageOrganization: 'org_role',
			canManageClassroom: 'org_role',
			canManageBookings: 'org_role',
			canManageParticipants: 'org_role',
			canUseParticipantBooking: null
		}
	},
	{
		id: 'room-b',
		name: 'Room B',
		slug: 'room-b',
		canManage: true,
		canManageClassroom: true,
		canManageBookings: true,
		canManageParticipants: true,
		canUseParticipantBooking: true,
		display: {
			primaryRole: 'manager',
			badges: ['manager']
		},
		facts: {
			orgRole: 'admin',
			classroomStaffRole: 'manager',
			hasParticipantRecord: false
		},
		sources: {
			canManageOrganization: 'org_role',
			canManageClassroom: 'org_role',
			canManageBookings: 'org_role',
			canManageParticipants: 'org_role',
			canUseParticipantBooking: null
		}
	}
];

const renderContextSwitcher = (overrides: Partial<ContextSwitcherProps> = {}) =>
	render(ContextSwitcher, {
		organizations,
		classrooms,
		activeOrganization: organizations[0],
		activeClassroom: classrooms[0],
		loading: false,
		busy: false,
		onSelectOrganization: vi.fn(),
		onSelectClassroom: vi.fn(),
		...overrides
	});

describe('context-switcher.svelte', () => {
	it('shows active organization and classroom on one trigger', async () => {
		renderContextSwitcher();

		await expect.element(page.getByText('Alpha Org')).toBeInTheDocument();
		await expect.element(page.getByText('Room A')).toBeInTheDocument();
		const triggerFallback = document.querySelector(
			'button[aria-label="利用中の組織と教室を切り替え"] [data-slot="organization-logo-fallback"]'
		);
		expect(triggerFallback).toBeTruthy();
	});

	it('calls onSelectOrganization with selected organization id', async () => {
		const onSelectOrganization = vi.fn();
		renderContextSwitcher({ onSelectOrganization });

		await page.getByRole('button', { name: '利用中の組織と教室を切り替え' }).click();
		await page.getByRole('button', { name: 'Beta Orgを利用中の組織に設定' }).click();

		expect(onSelectOrganization).toHaveBeenCalledWith('org-b');
	});

	it('calls onSelectClassroom with selected classroom slug', async () => {
		const onSelectClassroom = vi.fn();
		renderContextSwitcher({ onSelectClassroom });

		await page.getByRole('button', { name: '利用中の組織と教室を切り替え' }).click();
		await page.getByRole('button', { name: 'Room Bへ教室を切り替え' }).click();

		expect(onSelectClassroom).toHaveBeenCalledWith('room-b');
	});

	it('filters organization and classroom candidates by one keyword', async () => {
		renderContextSwitcher();

		await page.getByRole('button', { name: '利用中の組織と教室を切り替え' }).click();
		await page.getByRole('textbox', { name: '組織・教室を検索' }).fill('Beta');

		await expect
			.element(page.getByRole('button', { name: 'Beta Orgを利用中の組織に設定' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Alpha Orgを利用中の組織に設定' }))
			.not.toBeInTheDocument();
		await expect.element(page.getByText('一致する教室がありません。')).toBeInTheDocument();
	});
});
