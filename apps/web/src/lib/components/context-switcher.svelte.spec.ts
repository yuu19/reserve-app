import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ComponentProps } from 'svelte';
import ContextSwitcher from './context-switcher.svelte';
import type { StoreContextPayload } from '$lib/features/organization-context.svelte';
import type { OrganizationPayload } from '$lib/rpc-client';

type ContextSwitcherProps = ComponentProps<typeof ContextSwitcher>;

const organizations: OrganizationPayload[] = [
	{ id: 'org-a', name: 'Alpha Org', slug: 'alpha', logo: null },
	{ id: 'org-b', name: 'Beta Org', slug: 'beta', logo: 'https://cdn.example.com/beta.webp' }
];

const stores: StoreContextPayload[] = [
	{
		id: 'room-a',
		name: 'Room A',
		slug: 'room-a',
		canManage: true,
		canManageStore: true,
		canManageBookings: true,
		canManageParticipants: true,
		canUseParticipantBooking: true,
		display: {
			primaryRole: 'manager',
			badges: ['manager']
		},
		facts: {
			orgRole: 'admin',
			storeStaffRole: 'manager',
			hasParticipantRecord: false
		},
		sources: {
			canManageOrganization: 'org_role',
			canManageStore: 'org_role',
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
		canManageStore: true,
		canManageBookings: true,
		canManageParticipants: true,
		canUseParticipantBooking: true,
		display: {
			primaryRole: 'manager',
			badges: ['manager']
		},
		facts: {
			orgRole: 'admin',
			storeStaffRole: 'manager',
			hasParticipantRecord: false
		},
		sources: {
			canManageOrganization: 'org_role',
			canManageStore: 'org_role',
			canManageBookings: 'org_role',
			canManageParticipants: 'org_role',
			canUseParticipantBooking: null
		}
	}
];

const renderContextSwitcher = (overrides: Partial<ContextSwitcherProps> = {}) =>
	render(ContextSwitcher, {
		organizations,
		stores,
		activeOrganization: organizations[0],
		activeStore: stores[0],
		loading: false,
		busy: false,
		onSelectOrganization: vi.fn(),
		onSelectStore: vi.fn(),
		...overrides
	});

describe('コンテキスト切り替えコンポーネント', () => {
	it('1 つのトリガーにアクティブ組織と店舗を表示する', async () => {
		renderContextSwitcher();

		await expect.element(page.getByText('Alpha Org')).toBeInTheDocument();
		await expect.element(page.getByText('Room A')).toBeInTheDocument();
		const triggerFallback = document.querySelector(
			'button[aria-label="利用中の組織と店舗を切り替え"] [data-slot="organization-logo-fallback"]'
		);
		expect(triggerFallback).toBeTruthy();
	});

	it('選択した組織 ID で onSelectOrganization を呼び出す', async () => {
		const onSelectOrganization = vi.fn();
		renderContextSwitcher({ onSelectOrganization });

		await page.getByRole('button', { name: '利用中の組織と店舗を切り替え' }).click();
		await page.getByRole('button', { name: 'Beta Orgを利用中の組織に設定' }).click();

		expect(onSelectOrganization).toHaveBeenCalledWith('org-b');
	});

	it('選択した店舗 slug で onSelectStore を呼び出す', async () => {
		const onSelectStore = vi.fn();
		renderContextSwitcher({ onSelectStore });

		await page.getByRole('button', { name: '利用中の組織と店舗を切り替え' }).click();
		await page.getByRole('button', { name: 'Room Bへ店舗を切り替え' }).click();

		expect(onSelectStore).toHaveBeenCalledWith('room-b');
	});

	it('1 つのキーワードで組織と店舗候補を絞り込む', async () => {
		renderContextSwitcher();

		await page.getByRole('button', { name: '利用中の組織と店舗を切り替え' }).click();
		await page.getByRole('textbox', { name: '組織・店舗を検索' }).fill('Beta');

		await expect
			.element(page.getByRole('button', { name: 'Beta Orgを利用中の組織に設定' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Alpha Orgを利用中の組織に設定' }))
			.not.toBeInTheDocument();
		await expect.element(page.getByText('一致する店舗がありません。')).toBeInTheDocument();
	});
});
