<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import PremiumRestrictionNotice from '$lib/components/premium-restriction-notice.svelte';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { loadOrganizationBilling } from '$lib/features/organization-context.svelte';
	import { loadTicketManagementPageData } from '$lib/features/ticket-management-page.svelte';
	import {
		adjustTicketPack,
		approveTicketPurchase,
		grantTicketPack,
		loadTicketPacks,
		rejectTicketPurchase,
		toIsoFromDateTimeLocal,
		updateTicketType
	} from '$lib/features/tickets.svelte';
	import {
		getCurrentPathWithSearch,
		loadSession,
		redirectToLoginWithNext
	} from '$lib/features/auth-session.svelte';
	import { preserveScopedRouteContext } from '$lib/features/scoped-routing';
	import type { OrganizationPremiumRestrictionPayload } from '$lib/features/premium-restrictions';
	import type {
		OrganizationBillingPayload,
		ParticipantPayload,
		ServicePayload,
		TicketPackPayload,
		TicketPurchasePayload,
		TicketTypePayload
	} from '$lib/rpc-client';
	import { Plus } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	let loading = $state(true);
	let busy = $state(false);
	let activeOrganizationId = $state<string | null>(null);
	let canManageParticipants = $state(false);
	let canManageStore = $state(false);
	let billing = $state<OrganizationBillingPayload | null>(null);
	let premiumRestriction = $state<OrganizationPremiumRestrictionPayload | null>(null);
	let participants = $state<ParticipantPayload[]>([]);
	let services = $state<ServicePayload[]>([]);
	let ticketTypes = $state<TicketTypePayload[]>([]);
	let ticketPacks = $state<TicketPackPayload[]>([]);
	let ticketPurchases = $state<TicketPurchasePayload[]>([]);
	let ticketTypeEditForms = $state<
		Record<
			string,
			{
				name: string;
				totalCount: string;
				expiresInDays: string;
				serviceScope: 'all' | 'specific';
				serviceIds: string[];
				isActive: boolean;
				isForSale: boolean;
			}
		>
	>({});
	let ticketGrantForm = $state({
		participantId: '',
		ticketTypeId: '',
		count: '',
		expiresAt: ''
	});
	let ticketPackFilterForm = $state({
		participantId: ''
	});
	let ticketPackAdjustForms = $state<
		Record<
			string,
			{
				remainingCount: string;
				expiresAt: string;
				reason: string;
			}
		>
	>({});
	let loadingTicketPacks = $state(false);
	let ticketPurchaseFilter = $state({
		status: 'all' as 'all' | TicketPurchasePayload['status'],
		paymentMethod: 'all' as 'all' | TicketPurchasePayload['paymentMethod'],
		participantId: ''
	});
	let ticketPurchaseAction = $state<{
		kind: 'approve' | 'reject';
		id: string;
	} | null>(null);

	const normalizeToText = (value: string | number): string => String(value).trim();

	const parsePositiveInteger = (value: string | number): number | undefined => {
		const normalized = normalizeToText(value);
		if (!normalized) {
			return undefined;
		}
		const parsed = Number(normalized);
		if (!Number.isInteger(parsed) || parsed <= 0) {
			return undefined;
		}
		return parsed;
	};
	const parseNonNegativeInteger = (value: string | number): number | undefined => {
		const normalized = normalizeToText(value);
		if (!normalized) {
			return undefined;
		}
		const parsed = Number(normalized);
		if (!Number.isInteger(parsed) || parsed < 0) {
			return undefined;
		}
		return parsed;
	};

	const toggleTicketTypeEditService = (
		ticketTypeId: string,
		serviceId: string,
		checked: boolean
	) => {
		const form = ticketTypeEditForms[ticketTypeId];
		if (!form) {
			return;
		}
		if (checked) {
			ticketTypeEditForms = {
				...ticketTypeEditForms,
				[ticketTypeId]: {
					...form,
					serviceIds: form.serviceIds.includes(serviceId)
						? form.serviceIds
						: [...form.serviceIds, serviceId]
				}
			};
			return;
		}
		ticketTypeEditForms = {
			...ticketTypeEditForms,
			[ticketTypeId]: {
				...form,
				serviceIds: form.serviceIds.filter((current) => current !== serviceId)
			}
		};
	};

	const formatDateTime = (value: string): string => {
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) {
			return value;
		}
		return parsed.toLocaleString('ja-JP', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	};
	const toDateTimeLocalValue = (value?: string | null): string => {
		if (!value) {
			return '';
		}
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) {
			return '';
		}
		const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60 * 1000);
		return local.toISOString().slice(0, 16);
	};

	const ticketPurchaseStatusLabelMap: Record<TicketPurchasePayload['status'], string> = {
		pending_payment: '決済待ち',
		pending_approval: '承認待ち',
		approved: '承認済み',
		rejected: '却下',
		cancelled_by_participant: '取り下げ'
	};
	const ticketPurchaseMethodLabelMap: Record<TicketPurchasePayload['paymentMethod'], string> = {
		stripe: 'Stripe（保留）',
		cash_on_site: '現地決済',
		bank_transfer: '銀行振込'
	};
	const filteredTicketPurchases = $derived.by(() =>
		ticketPurchases
			.filter((purchase) => {
				if (
					ticketPurchaseFilter.status !== 'all' &&
					purchase.status !== ticketPurchaseFilter.status
				) {
					return false;
				}
				if (
					ticketPurchaseFilter.paymentMethod !== 'all' &&
					purchase.paymentMethod !== ticketPurchaseFilter.paymentMethod
				) {
					return false;
				}
				if (
					ticketPurchaseFilter.participantId &&
					purchase.participantId !== ticketPurchaseFilter.participantId
				) {
					return false;
				}
				return true;
			})
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
	);
	const pendingTicketPurchaseApprovalCount = $derived(
		ticketPurchases.filter((purchase) => purchase.status === 'pending_approval').length
	);
	const activeTicketTypes = $derived(ticketTypes.filter((ticketType) => ticketType.isActive));
	const ticketPackStatusLabelMap: Record<TicketPackPayload['status'], string> = {
		active: '有効',
		exhausted: '使い切り',
		expired: '期限切れ'
	};

	const formatTicketPurchaseIdShort = (purchaseId: string): string => purchaseId.slice(0, 8);
	const formatTicketTypeIdShort = (ticketTypeId: string): string => ticketTypeId.slice(0, 8);
	const getTicketTypeLabel = (ticketTypeId: string) => {
		const ticketType = ticketTypes.find((item) => item.id === ticketTypeId);
		return ticketType ? `${ticketType.name} / ${ticketType.totalCount}回` : ticketTypeId;
	};
	const getServiceName = (serviceId: string): string => {
		const service = services.find((item) => item.id === serviceId);
		return service?.name ?? serviceId;
	};
	const resolveTicketServiceScope = (ticket: {
		serviceScope?: 'all' | 'specific';
		serviceIds?: string[];
	}): 'all' | 'specific' =>
		ticket.serviceScope ?? ((ticket.serviceIds?.length ?? 0) > 0 ? 'specific' : 'all');
	const formatTicketServiceScope = (ticket: {
		serviceScope?: 'all' | 'specific';
		serviceIds?: string[];
	}): string => {
		if (resolveTicketServiceScope(ticket) === 'all') {
			return 'すべて';
		}
		const serviceIds = ticket.serviceIds ?? [];
		return serviceIds.length > 0 ? serviceIds.map(getServiceName).join('、') : '未指定';
	};
	const getParticipantLabel = (participantId: string) => {
		const participant = participants.find((item) => item.id === participantId);
		return participant ? `${participant.name} / ${participant.email}` : participantId;
	};
	const isTicketPurchaseActionInProgress = (
		kind: 'approve' | 'reject',
		purchaseId: string
	): boolean => ticketPurchaseAction?.kind === kind && ticketPurchaseAction.id === purchaseId;
	const toExceptionMessage = (error: unknown, fallback: string): string => {
		if (error instanceof Error && error.message) {
			return error.message;
		}
		return fallback;
	};
	const toScopedRoute = (targetPath: string): Pathname =>
		preserveScopedRouteContext(targetPath, page.url.pathname) as Pathname;
	const navigateToTicketTypeCreate = () => {
		void goto(resolve(toScopedRoute('/admin/tickets/new')));
	};
	const syncTicketTypeEditForms = (items: TicketTypePayload[]) => {
		ticketTypeEditForms = Object.fromEntries(
			items.map((ticketType) => [
				ticketType.id,
				{
					name: ticketType.name,
					totalCount: String(ticketType.totalCount),
					expiresInDays:
						ticketType.expiresInDays === null || ticketType.expiresInDays === undefined
							? ''
							: String(ticketType.expiresInDays),
					serviceScope: resolveTicketServiceScope(ticketType),
					serviceIds: ticketType.serviceIds ?? [],
					isActive: ticketType.isActive,
					isForSale: ticketType.isForSale
				}
			])
		);
	};
	const syncTicketPackAdjustForms = (items: TicketPackPayload[]) => {
		ticketPackAdjustForms = Object.fromEntries(
			items.map((ticketPack) => [
				ticketPack.id,
				{
					remainingCount: String(ticketPack.remainingCount),
					expiresAt: toDateTimeLocalValue(ticketPack.expiresAt),
					reason: ''
				}
			])
		);
	};
	const resetTicketManagementViewState = () => {
		activeOrganizationId = null;
		canManageParticipants = false;
		canManageStore = false;
		billing = null;
		premiumRestriction = null;
		participants = [];
		services = [];
		ticketTypes = [];
		ticketPacks = [];
		ticketPurchases = [];
		ticketTypeEditForms = {};
		ticketPackFilterForm = { participantId: '' };
		ticketPackAdjustForms = {};
	};

	const refresh = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}
		try {
			const data = await loadTicketManagementPageData();
			if (data.loadError) {
				toast.error(data.loadError);
			}
			if (!data.activeContext) {
				resetTicketManagementViewState();
				return;
			}
			activeOrganizationId = data.organizationId;
			canManageParticipants = data.canManageParticipants;
			canManageStore = data.canManageStore;
			premiumRestriction = data.premiumRestriction ?? null;
			if (data.premiumRestriction && data.organizationId) {
				const billingResult = await loadOrganizationBilling(data.organizationId);
				billing = billingResult.ok ? billingResult.billing : null;
			} else {
				billing = null;
			}
			participants = data.participants;
			services = data.services;
			ticketTypes = data.ticketTypes;
			syncTicketTypeEditForms(data.ticketTypes);
			ticketPurchases = data.ticketPurchases;
		} catch (error) {
			resetTicketManagementViewState();
			toast.error(toExceptionMessage(error, '回数券管理データの取得に失敗しました。'));
		}
	};

	const loadSelectedTicketPacks = async () => {
		if (!canManageParticipants || !ticketPackFilterForm.participantId) {
			ticketPacks = [];
			ticketPackAdjustForms = {};
			return;
		}
		loadingTicketPacks = true;
		try {
			const result = await loadTicketPacks({
				participantId: ticketPackFilterForm.participantId
			});
			if (!result.ok) {
				toast.error(result.error ?? '発行済み回数券の取得に失敗しました。');
				ticketPacks = [];
				ticketPackAdjustForms = {};
				return;
			}
			ticketPacks = result.packs;
			syncTicketPackAdjustForms(result.packs);
		} finally {
			loadingTicketPacks = false;
		}
	};

	const submitUpdateTicketType = async (event: SubmitEvent, ticketTypeId: string) => {
		event.preventDefault();
		if (!activeOrganizationId || !canManageStore) return;

		const form = ticketTypeEditForms[ticketTypeId];
		if (!form) {
			toast.error('編集対象の回数券種別が見つかりません。');
			return;
		}

		const totalCount = parsePositiveInteger(form.totalCount);
		if (!totalCount) {
			toast.error('回数は 1 以上の整数で入力してください。');
			return;
		}

		const expiresInDaysText = normalizeToText(form.expiresInDays);
		const expiresInDays = parsePositiveInteger(form.expiresInDays);
		if (expiresInDaysText && !expiresInDays) {
			toast.error('有効日数は 1 以上の整数で入力してください。');
			return;
		}
		if (form.serviceScope === 'specific' && form.serviceIds.length === 0) {
			toast.error('対象サービスを 1 件以上選択してください。');
			return;
		}

		busy = true;
		try {
			const result = await updateTicketType({
				organizationId: activeOrganizationId,
				ticketTypeId,
				name: form.name,
				totalCount,
				expiresInDays: expiresInDaysText ? expiresInDays : null,
				serviceScope: form.serviceScope,
				serviceIds: form.serviceScope === 'specific' ? form.serviceIds : [],
				isActive: form.isActive,
				isForSale: form.isForSale
			});
			if (!result.ok) {
				if (result.premiumRestriction) {
					premiumRestriction = result.premiumRestriction;
				}
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			busy = false;
		}
	};

	const submitDeactivateTicketType = async (ticketTypeId: string) => {
		if (!activeOrganizationId || !canManageStore || busy) return;
		if (!confirm('この回数券種別を無効化しますか？ 発行済み回数券は残ります。')) {
			return;
		}
		busy = true;
		try {
			const result = await updateTicketType({
				organizationId: activeOrganizationId,
				ticketTypeId,
				isActive: false
			});
			if (!result.ok) {
				if (result.premiumRestriction) {
					premiumRestriction = result.premiumRestriction;
				}
				toast.error(result.message);
				return;
			}
			toast.success('回数券種別を無効化しました。');
			await refresh();
		} finally {
			busy = false;
		}
	};

	const submitGrantTicketPack = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!activeOrganizationId || !canManageParticipants) return;

		if (!ticketGrantForm.participantId) {
			toast.error('付与対象の参加者を選択してください。');
			return;
		}
		if (!ticketGrantForm.ticketTypeId) {
			toast.error('回数券種別を選択してください。');
			return;
		}

		const count = parsePositiveInteger(ticketGrantForm.count);
		if (normalizeToText(ticketGrantForm.count) && !count) {
			toast.error('付与回数は 1 以上の整数で入力してください。');
			return;
		}

		const expiresAt = toIsoFromDateTimeLocal(ticketGrantForm.expiresAt);
		if (normalizeToText(ticketGrantForm.expiresAt) && !expiresAt) {
			toast.error('有効期限の形式が不正です。');
			return;
		}

		busy = true;
		try {
			const grantedParticipantId = ticketGrantForm.participantId;
			const result = await grantTicketPack({
				organizationId: activeOrganizationId,
				participantId: ticketGrantForm.participantId,
				ticketTypeId: ticketGrantForm.ticketTypeId,
				count,
				expiresAt
			});
			if (!result.ok) {
				if (result.premiumRestriction) {
					premiumRestriction = result.premiumRestriction;
				}
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			ticketGrantForm = {
				participantId: '',
				ticketTypeId: '',
				count: '',
				expiresAt: ''
			};
			await refresh();
			if (ticketPackFilterForm.participantId === grantedParticipantId) {
				await loadSelectedTicketPacks();
			}
		} finally {
			busy = false;
		}
	};

	const submitLoadTicketPacks = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!ticketPackFilterForm.participantId) {
			toast.error('参加者を選択してください。');
			return;
		}
		await loadSelectedTicketPacks();
	};

	const submitAdjustTicketPack = async (event: SubmitEvent, ticketPack: TicketPackPayload) => {
		event.preventDefault();
		if (!canManageParticipants) return;

		const form = ticketPackAdjustForms[ticketPack.id];
		if (!form) {
			toast.error('調整対象の回数券が見つかりません。');
			return;
		}

		const remainingCount = parseNonNegativeInteger(form.remainingCount);
		if (remainingCount === undefined) {
			toast.error('残数は 0 以上の整数で入力してください。');
			return;
		}
		if (remainingCount > ticketPack.initialCount) {
			toast.error('残数は発行時回数以下で入力してください。');
			return;
		}

		const expiresAtText = normalizeToText(form.expiresAt);
		const expiresAt = expiresAtText ? toIsoFromDateTimeLocal(form.expiresAt) : null;
		if (expiresAtText && !expiresAt) {
			toast.error('有効期限の形式が不正です。');
			return;
		}

		const reason = form.reason.trim();
		if (!reason) {
			toast.error('調整理由を入力してください。');
			return;
		}

		busy = true;
		try {
			const result = await adjustTicketPack({
				ticketPackId: ticketPack.id,
				remainingCount,
				expiresAt,
				reason
			});
			if (!result.ok) {
				if (result.premiumRestriction) {
					premiumRestriction = result.premiumRestriction;
				}
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await loadSelectedTicketPacks();
		} finally {
			busy = false;
		}
	};

	const submitApproveTicketPurchase = async (purchaseId: string) => {
		if (!canManageParticipants || ticketPurchaseAction) {
			return;
		}
		if (!confirm('この回数券購入申請を承認しますか？')) {
			return;
		}
		ticketPurchaseAction = { kind: 'approve', id: purchaseId };
		try {
			const result = await approveTicketPurchase(purchaseId);
			if (!result.ok) {
				if (result.premiumRestriction) {
					premiumRestriction = result.premiumRestriction;
				}
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			ticketPurchaseAction = null;
		}
	};

	const submitRejectTicketPurchase = async (purchaseId: string) => {
		if (!canManageParticipants || ticketPurchaseAction) {
			return;
		}
		if (!confirm('この回数券購入申請を却下しますか？')) {
			return;
		}
		const reasonInput = prompt('却下理由を入力してください（任意）', '');
		if (reasonInput === null) {
			return;
		}
		ticketPurchaseAction = { kind: 'reject', id: purchaseId };
		try {
			const result = await rejectTicketPurchase(purchaseId, reasonInput);
			if (!result.ok) {
				if (result.premiumRestriction) {
					premiumRestriction = result.premiumRestriction;
				}
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			ticketPurchaseAction = null;
		}
	};

	onMount(() => {
		void (async () => {
			loading = true;
			try {
				await refresh();
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold text-foreground">回数券管理</h1>
		<p class="text-sm text-muted-foreground">
			回数券種別の作成、参加者への付与、購入申請の承認を行います。
		</p>
	</header>

	{#if loading}
		<Card class="surface-panel border-border/80 shadow-lg"
			><CardContent class="py-6"
				><p class="text-sm text-muted-foreground">回数券管理データを読み込み中…</p></CardContent
			></Card
		>
	{:else if !activeOrganizationId}
		<Card class="surface-panel border-border/80 shadow-lg"
			><CardContent class="py-6"
				><p class="text-sm text-muted-foreground">
					利用中の組織を `/admin/dashboard` で選択してください。
				</p></CardContent
			></Card
		>
	{:else}
		<section class="grid gap-4 md:grid-cols-3">
			<Card class="surface-panel border-border/80 shadow-md">
				<CardHeader
					><h2 class="text-sm font-semibold text-secondary-foreground">回数券種別</h2></CardHeader
				>
				<CardContent
					><p class="metric-value text-3xl font-semibold text-foreground">
						{ticketTypes.length}
					</p></CardContent
				>
			</Card>
			<Card class="surface-panel border-border/80 shadow-md">
				<CardHeader
					><h2 class="text-sm font-semibold text-secondary-foreground">参加者数</h2></CardHeader
				>
				<CardContent
					><p class="metric-value text-3xl font-semibold text-foreground">
						{participants.length}
					</p></CardContent
				>
			</Card>
			<Card class="surface-panel border-border/80 shadow-md">
				<CardHeader
					><h2 class="text-sm font-semibold text-secondary-foreground">承認待ち購入</h2></CardHeader
				>
				<CardContent
					><p class="metric-value text-3xl font-semibold text-foreground">
						{pendingTicketPurchaseApprovalCount}
					</p></CardContent
				>
			</Card>
		</section>

		{#if premiumRestriction}
			<PremiumRestrictionNotice
				featureLabel="回数券管理"
				restriction={premiumRestriction}
				{billing}
			/>
		{/if}

		<section>
			<Card class="surface-panel border-border/80 shadow-lg">
				<CardHeader>
					<h2 class="text-xl font-semibold">回数券管理</h2>
					<CardDescription>
						参加者の購入申請は、現地決済または銀行振込の承認フローで受け付けます。
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if premiumRestriction}
						<p class="text-sm text-muted-foreground">
							回数券管理は Premium 利用開始後に利用できます。
						</p>
					{:else if !canManageParticipants && !canManageStore}
						<p class="text-sm text-muted-foreground">
							回数券管理には店舗管理権限または参加者管理権限が必要です。
						</p>
					{:else}
						<section class="space-y-4">
							{#if canManageParticipants}
								<form
									class="space-y-3 rounded-lg border border-border/80 bg-card/80 p-4"
									onsubmit={submitGrantTicketPack}
								>
									<h3 class="text-sm font-semibold">回数券付与</h3>
									<div class="space-y-2">
										<Label for="ticket-grant-participant">付与先参加者</Label>
										<select
											id="ticket-grant-participant"
											name="ticket_grant_participant"
											class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
											bind:value={ticketGrantForm.participantId}
											required
										>
											<option value="" disabled>参加者を選択</option>
											{#each participants as participant (participant.id)}
												<option value={participant.id}
													>{participant.name} / {participant.email}</option
												>
											{/each}
										</select>
									</div>
									<div class="space-y-2">
										<Label for="ticket-grant-type">回数券種別</Label>
										<select
											id="ticket-grant-type"
											name="ticket_grant_type"
											class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
											bind:value={ticketGrantForm.ticketTypeId}
											required
										>
											<option value="" disabled>回数券種別を選択</option>
											{#each activeTicketTypes as ticketType (ticketType.id)}
												<option value={ticketType.id}
													>{ticketType.name} / {ticketType.totalCount}回</option
												>
											{/each}
										</select>
									</div>
									<div class="space-y-2">
										<Label for="ticket-grant-count">付与回数（任意）</Label>
										<Input
											id="ticket-grant-count"
											name="ticket_grant_count"
											type="number"
											min="1"
											bind:value={ticketGrantForm.count}
										/>
									</div>
									<div class="space-y-2">
										<Label for="ticket-grant-expires-at">有効期限（任意）</Label>
										<Input
											id="ticket-grant-expires-at"
											name="ticket_grant_expires_at"
											type="datetime-local"
											bind:value={ticketGrantForm.expiresAt}
										/>
									</div>
									<Button type="submit" disabled={busy}>付与</Button>
								</form>
							{:else}
								<div
									class="space-y-2 rounded-lg border border-dashed border-stone-03 bg-secondary/70 p-4"
								>
									<h3 class="text-sm font-semibold">回数券付与</h3>
									<p class="text-sm text-muted-foreground">
										回数券付与には参加者管理権限が必要です。
									</p>
								</div>
							{/if}
						</section>

						<section class="space-y-2">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<h3 class="text-sm font-semibold">回数券種別一覧</h3>
								{#if canManageStore}
									<Button type="button" size="sm" onclick={navigateToTicketTypeCreate}>
										<Plus class="size-4" aria-hidden="true" />
										追加する
									</Button>
								{/if}
							</div>
							{#if ticketTypes.length === 0}
								<p class="text-sm text-muted-foreground">回数券種別はまだ作成されていません。</p>
							{:else}
								<div class="space-y-2">
									{#each ticketTypes as ticketType (ticketType.id)}
										{@const editForm = ticketTypeEditForms[ticketType.id]}
										<form
											class="space-y-3 rounded-lg border border-border/80 bg-card/80 p-3"
											onsubmit={(event) => submitUpdateTicketType(event, ticketType.id)}
										>
											<div class="flex flex-wrap items-start justify-between gap-3">
												<div>
													<p class="text-sm font-semibold">{ticketType.name}</p>
													<p class="text-xs text-muted-foreground">
														作成: {formatDateTime(ticketType.createdAt)}
													</p>
													<p class="text-xs text-muted-foreground">
														対象サービス: {formatTicketServiceScope(ticketType)}
													</p>
												</div>
												<div class="flex flex-wrap gap-2">
													<Badge variant={ticketType.isActive ? 'outline' : 'secondary'}>
														{ticketType.isActive ? '有効' : '無効'}
													</Badge>
													<Badge variant={ticketType.isForSale ? 'outline' : 'secondary'}>
														{ticketType.isForSale ? '販売中' : '販売停止'}
													</Badge>
												</div>
											</div>

											{#if canManageStore && editForm}
												<div class="grid gap-3 md:grid-cols-[1.4fr_0.7fr_0.7fr]">
													<div class="space-y-2">
														<Label for={`ticket-type-edit-name-${ticketType.id}`}>券種名</Label>
														<Input
															id={`ticket-type-edit-name-${ticketType.id}`}
															name={`ticket_type_edit_name_${ticketType.id}`}
															type="text"
															bind:value={editForm.name}
															required
														/>
													</div>
													<div class="space-y-2">
														<Label for={`ticket-type-edit-count-${ticketType.id}`}>回数</Label>
														<Input
															id={`ticket-type-edit-count-${ticketType.id}`}
															name={`ticket_type_edit_count_${ticketType.id}`}
															type="number"
															min="1"
															bind:value={editForm.totalCount}
															required
														/>
													</div>
													<div class="space-y-2">
														<Label for={`ticket-type-edit-expiry-${ticketType.id}`}>有効日数</Label>
														<Input
															id={`ticket-type-edit-expiry-${ticketType.id}`}
															name={`ticket_type_edit_expiry_${ticketType.id}`}
															type="number"
															min="1"
															placeholder="無期限"
															bind:value={editForm.expiresInDays}
														/>
													</div>
												</div>

												<div class="grid gap-3 md:grid-cols-2">
													<label
														class="flex items-center gap-2 rounded-md border border-border/80 bg-secondary/60 px-3 py-2 text-sm"
														for={`ticket-type-edit-active-${ticketType.id}`}
													>
														<input
															id={`ticket-type-edit-active-${ticketType.id}`}
															name={`ticket_type_edit_active_${ticketType.id}`}
															type="checkbox"
															bind:checked={editForm.isActive}
														/>
														<span>有効にする</span>
													</label>
													<label
														class="flex items-center gap-2 rounded-md border border-border/80 bg-secondary/60 px-3 py-2 text-sm"
														for={`ticket-type-edit-sale-${ticketType.id}`}
													>
														<input
															id={`ticket-type-edit-sale-${ticketType.id}`}
															name={`ticket_type_edit_sale_${ticketType.id}`}
															type="checkbox"
															bind:checked={editForm.isForSale}
														/>
														<span>販売中にする</span>
													</label>
												</div>

												<fieldset class="space-y-2">
													<legend class="text-sm font-medium">対象サービス</legend>
													<div class="grid gap-2 sm:grid-cols-2">
														<label
															class="flex items-center gap-2 rounded-md border border-border/80 bg-secondary/60 px-3 py-2 text-sm"
															for={`ticket-type-edit-scope-all-${ticketType.id}`}
														>
															<input
																id={`ticket-type-edit-scope-all-${ticketType.id}`}
																name={`ticket_type_edit_scope_${ticketType.id}`}
																type="radio"
																value="all"
																bind:group={editForm.serviceScope}
															/>
															<span>すべてのサービス</span>
														</label>
														<label
															class="flex items-center gap-2 rounded-md border border-border/80 bg-secondary/60 px-3 py-2 text-sm"
															for={`ticket-type-edit-scope-specific-${ticketType.id}`}
														>
															<input
																id={`ticket-type-edit-scope-specific-${ticketType.id}`}
																name={`ticket_type_edit_scope_${ticketType.id}`}
																type="radio"
																value="specific"
																bind:group={editForm.serviceScope}
															/>
															<span>サービスを個別指定</span>
														</label>
													</div>
													{#if editForm.serviceScope === 'specific'}
														{#if services.length === 0}
															<p class="text-sm text-muted-foreground">
																選択可能なサービスがありません。
															</p>
														{:else}
															<div
																class="grid gap-2 rounded-md border border-border/80 bg-secondary/60 p-2 md:grid-cols-2"
															>
																{#each services as service (service.id)}
																	<label
																		class="flex items-center gap-2 text-sm text-secondary-foreground"
																		for={`ticket-type-edit-service-${ticketType.id}-${service.id}`}
																	>
																		<input
																			id={`ticket-type-edit-service-${ticketType.id}-${service.id}`}
																			name={`ticket_type_edit_service_${ticketType.id}_${service.id}`}
																			type="checkbox"
																			checked={editForm.serviceIds.includes(service.id)}
																			onchange={(event) =>
																				toggleTicketTypeEditService(
																					ticketType.id,
																					service.id,
																					(event.currentTarget as HTMLInputElement).checked
																				)}
																		/>
																		<span>{service.name}</span>
																	</label>
																{/each}
															</div>
														{/if}
													{/if}
												</fieldset>

												<div class="flex flex-wrap gap-2">
													<Button
														type="submit"
														size="sm"
														disabled={busy ||
															(editForm.serviceScope === 'specific' &&
																editForm.serviceIds.length === 0)}
													>
														更新
													</Button>
													{#if ticketType.isActive}
														<Button
															type="button"
															size="sm"
															variant="outline"
															disabled={busy}
															onclick={() => submitDeactivateTicketType(ticketType.id)}
														>
															無効化
														</Button>
													{/if}
												</div>
											{:else}
												<p class="text-xs text-muted-foreground">
													回数: {ticketType.totalCount} / 有効日数: {ticketType.expiresInDays ??
														'無期限'} / 対象サービス: {formatTicketServiceScope(ticketType)}
												</p>
											{/if}
										</form>
									{/each}
								</div>
							{/if}
						</section>

						<section class="space-y-3">
							<h3 class="text-sm font-semibold">発行済み回数券調整</h3>
							{#if !canManageParticipants}
								<p class="text-sm text-muted-foreground">
									発行済み回数券の調整には参加者管理権限が必要です。
								</p>
							{:else}
								<form
									class="grid gap-3 rounded-lg border border-border/80 bg-card/80 p-3 md:grid-cols-[1fr_auto]"
									onsubmit={submitLoadTicketPacks}
								>
									<div class="space-y-2">
										<Label for="ticket-pack-filter-participant">参加者</Label>
										<select
											id="ticket-pack-filter-participant"
											name="ticket_pack_filter_participant"
											class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
											bind:value={ticketPackFilterForm.participantId}
											required
										>
											<option value="" disabled>参加者を選択</option>
											{#each participants as participant (participant.id)}
												<option value={participant.id}
													>{participant.name} / {participant.email}</option
												>
											{/each}
										</select>
									</div>
									<div class="flex items-end">
										<Button type="submit" disabled={loadingTicketPacks}>表示</Button>
									</div>
								</form>

								{#if loadingTicketPacks}
									<p class="text-sm text-muted-foreground">発行済み回数券を読み込み中…</p>
								{:else if !ticketPackFilterForm.participantId}
									<p class="text-sm text-muted-foreground">参加者を選択してください。</p>
								{:else if ticketPacks.length === 0}
									<p class="text-sm text-muted-foreground">発行済み回数券はありません。</p>
								{:else}
									<div class="space-y-2">
										{#each ticketPacks as ticketPack (ticketPack.id)}
											{@const adjustForm = ticketPackAdjustForms[ticketPack.id]}
											<form
												class="space-y-3 rounded-lg border border-border/80 bg-card/80 p-3"
												onsubmit={(event) => submitAdjustTicketPack(event, ticketPack)}
											>
												<div class="flex flex-wrap items-start justify-between gap-3">
													<div>
														<p class="text-sm font-semibold">
															{getTicketTypeLabel(ticketPack.ticketTypeId)}
														</p>
														<p class="text-xs text-muted-foreground">
															発行時回数: {ticketPack.initialCount} / 現在残数:
															{ticketPack.remainingCount} / 有効期限:
															{ticketPack.expiresAt
																? formatDateTime(ticketPack.expiresAt)
																: '無期限'}
														</p>
														<p class="text-xs text-muted-foreground">
															対象サービス: {formatTicketServiceScope(ticketPack)}
														</p>
													</div>
													<Badge
														variant={ticketPack.status === 'active'
															? 'outline'
															: ticketPack.status === 'expired'
																? 'destructive'
																: 'secondary'}
													>
														{ticketPackStatusLabelMap[ticketPack.status]}
													</Badge>
												</div>

												{#if adjustForm}
													<div class="grid gap-3 md:grid-cols-[0.7fr_1fr_1.3fr_auto]">
														<div class="space-y-2">
															<Label for={`ticket-pack-remaining-${ticketPack.id}`}>残数</Label>
															<Input
																id={`ticket-pack-remaining-${ticketPack.id}`}
																name={`ticket_pack_remaining_${ticketPack.id}`}
																type="number"
																min="0"
																max={ticketPack.initialCount}
																bind:value={adjustForm.remainingCount}
																required
															/>
														</div>
														<div class="space-y-2">
															<Label for={`ticket-pack-expires-${ticketPack.id}`}>有効期限</Label>
															<Input
																id={`ticket-pack-expires-${ticketPack.id}`}
																name={`ticket_pack_expires_${ticketPack.id}`}
																type="datetime-local"
																bind:value={adjustForm.expiresAt}
															/>
														</div>
														<div class="space-y-2">
															<Label for={`ticket-pack-reason-${ticketPack.id}`}>調整理由</Label>
															<Input
																id={`ticket-pack-reason-${ticketPack.id}`}
																name={`ticket_pack_reason_${ticketPack.id}`}
																type="text"
																maxlength={500}
																bind:value={adjustForm.reason}
																required
															/>
														</div>
														<div class="flex items-end">
															<Button type="submit" size="sm" disabled={busy}>調整</Button>
														</div>
													</div>
												{/if}
											</form>
										{/each}
									</div>
								{/if}
							{/if}
						</section>

						<section class="space-y-3">
							<h3 class="text-sm font-semibold">回数券購入管理</h3>
							{#if !canManageParticipants}
								<p class="text-sm text-muted-foreground">
									回数券購入申請の承認には参加者管理権限が必要です。
								</p>
							{:else}
								<div class="grid gap-3 md:grid-cols-3">
									<div class="space-y-2">
										<Label for="purchase-filter-status">ステータス</Label>
										<select
											id="purchase-filter-status"
											name="purchase_filter_status"
											class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
											bind:value={ticketPurchaseFilter.status}
										>
											<option value="all">all</option>
											<option value="pending_payment">pending_payment</option>
											<option value="pending_approval">pending_approval</option>
											<option value="approved">approved</option>
											<option value="rejected">rejected</option>
											<option value="cancelled_by_participant">cancelled_by_participant</option>
										</select>
									</div>
									<div class="space-y-2">
										<Label for="purchase-filter-method">支払方法</Label>
										<select
											id="purchase-filter-method"
											name="purchase_filter_method"
											class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
											bind:value={ticketPurchaseFilter.paymentMethod}
										>
											<option value="all">all</option>
											<option value="cash_on_site">cash_on_site</option>
											<option value="bank_transfer">bank_transfer</option>
										</select>
									</div>
									<div class="space-y-2">
										<Label for="purchase-filter-participant">参加者</Label>
										<select
											id="purchase-filter-participant"
											name="purchase_filter_participant"
											class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
											bind:value={ticketPurchaseFilter.participantId}
										>
											<option value="">すべて</option>
											{#each participants as participant (participant.id)}
												<option value={participant.id}
													>{participant.name} / {participant.email}</option
												>
											{/each}
										</select>
									</div>
								</div>

								{#if filteredTicketPurchases.length === 0}
									<p class="text-sm text-muted-foreground">該当する購入申請はありません。</p>
								{:else}
									<div class="overflow-x-auto rounded-lg border border-border/80 bg-card/80">
										<table class="w-full min-w-[980px] text-sm">
											<thead class="bg-secondary text-muted-foreground">
												<tr>
													<th class="px-3 py-2 text-left font-medium">申請ID</th>
													<th class="px-3 py-2 text-left font-medium">参加者</th>
													<th class="px-3 py-2 text-left font-medium">券種ID</th>
													<th class="px-3 py-2 text-left font-medium">支払方法</th>
													<th class="px-3 py-2 text-left font-medium">ステータス</th>
													<th class="px-3 py-2 text-left font-medium">申請日時</th>
													<th class="px-3 py-2 text-left font-medium">操作</th>
												</tr>
											</thead>
											<tbody>
												{#each filteredTicketPurchases as purchase (purchase.id)}
													{@const isPendingApproval = purchase.status === 'pending_approval'}
													<tr class="border-t border-border/70 align-top">
														<td class="px-3 py-3 font-mono text-xs">
															{formatTicketPurchaseIdShort(purchase.id)}
														</td>
														<td class="px-3 py-3">{getParticipantLabel(purchase.participantId)}</td>
														<td class="px-3 py-3 font-mono text-xs">
															{formatTicketTypeIdShort(purchase.ticketTypeId)}
														</td>
														<td class="px-3 py-3">
															{ticketPurchaseMethodLabelMap[purchase.paymentMethod]}
														</td>
														<td class="px-3 py-3">
															<Badge
																variant={purchase.status === 'approved'
																	? 'outline'
																	: purchase.status === 'rejected'
																		? 'destructive'
																		: 'secondary'}
															>
																{ticketPurchaseStatusLabelMap[purchase.status]}
															</Badge>
															{#if purchase.rejectReason}
																<p class="mt-1 text-xs text-destructive">
																	理由: {purchase.rejectReason}
																</p>
															{/if}
														</td>
														<td class="px-3 py-3">{formatDateTime(purchase.createdAt)}</td>
														<td class="px-3 py-3">
															{#if isPendingApproval}
																<div class="flex flex-wrap gap-2">
																	<Button
																		type="button"
																		size="sm"
																		onclick={() => submitApproveTicketPurchase(purchase.id)}
																		disabled={busy || !!ticketPurchaseAction}
																	>
																		{isTicketPurchaseActionInProgress('approve', purchase.id)
																			? '処理中…'
																			: '承認'}
																	</Button>
																	<Button
																		type="button"
																		size="sm"
																		variant="outline"
																		onclick={() => submitRejectTicketPurchase(purchase.id)}
																		disabled={busy || !!ticketPurchaseAction}
																	>
																		{isTicketPurchaseActionInProgress('reject', purchase.id)
																			? '処理中…'
																			: '却下'}
																	</Button>
																</div>
															{:else}
																<span class="text-xs text-muted-foreground">操作不可</span>
															{/if}
														</td>
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
								{/if}
							{/if}
						</section>
					{/if}
				</CardContent>
			</Card>
		</section>
	{/if}
</main>
