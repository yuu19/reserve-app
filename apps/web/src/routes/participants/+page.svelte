<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import PremiumRestrictionNotice from '$lib/components/premium-restriction-notice.svelte';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		getRoutePathFromUrlPath,
		readWindowScopedRouteContext
	} from '$lib/features/scoped-routing';
	import {
		actParticipantInvitation,
		createParticipantInvitation
	} from '$lib/features/invitations-participant.svelte';
	import { loadOrganizationBilling } from '$lib/features/organization-context.svelte';
	import { loadParticipantsPageData } from '$lib/features/participants-page.svelte';
	import {
		approveTicketPurchase,
		createTicketType,
		rejectTicketPurchase,
		grantTicketPack,
		toIsoFromDateTimeLocal
	} from '$lib/features/tickets.svelte';
	import {
		getCurrentPathWithSearch,
		loadPortalAccess,
		loadSession,
		resolvePortalHomePath,
		redirectToLoginWithNext
	} from '$lib/features/auth-session.svelte';
	import type {
		OrganizationBillingPayload,
		ParticipantInvitationPayload,
		ParticipantPayload,
		ServicePayload,
		TicketPurchasePayload,
		TicketTypePayload
	} from '$lib/rpc-client';
	import type { OrganizationPremiumRestrictionPayload } from '$lib/features/premium-restrictions';
	import { toast } from 'svelte-sonner';

	let loading = $state(true);
	let busy = $state(false);
	let activeOrganizationId = $state<string | null>(null);
	let canManageParticipants = $state(false);
	let canManageClassroom = $state(false);
	let billing = $state<OrganizationBillingPayload | null>(null);
	let premiumRestriction = $state<OrganizationPremiumRestrictionPayload | null>(null);
	const pathname = $derived(getRoutePathFromUrlPath(page.url.pathname));
	const participantsPageMode = $derived.by(() => {
		if (pathname.startsWith('/admin/participants')) {
			return 'admin';
		}
		if (pathname.startsWith('/participant/invitations')) {
			return 'participant';
		}
		return 'legacy';
	});
	let participants = $state<ParticipantPayload[]>([]);
	let sentInvitations = $state<ParticipantInvitationPayload[]>([]);
	let receivedInvitations = $state<ParticipantInvitationPayload[]>([]);
	let services = $state<ServicePayload[]>([]);
	let ticketTypes = $state<TicketTypePayload[]>([]);
	let ticketPurchases = $state<TicketPurchasePayload[]>([]);
	let participantInvitationForm = $state({ email: '', participantName: '' });
	let ticketTypeForm = $state({
		name: '',
		totalCount: '10',
		expiresInDays: '',
		serviceIds: [] as string[],
		isForSale: false,
		stripePriceId: ''
	});
	let ticketGrantForm = $state({
		participantId: '',
		ticketTypeId: '',
		count: '',
		expiresAt: ''
	});
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

	const toggleTicketTypeService = (serviceId: string, checked: boolean) => {
		if (checked) {
			if (!ticketTypeForm.serviceIds.includes(serviceId)) {
				ticketTypeForm.serviceIds = [...ticketTypeForm.serviceIds, serviceId];
			}
			return;
		}
		ticketTypeForm.serviceIds = ticketTypeForm.serviceIds.filter(
			(current) => current !== serviceId
		);
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
	const ticketPurchaseStatusLabelMap: Record<TicketPurchasePayload['status'], string> = {
		pending_payment: '決済待ち',
		pending_approval: '承認待ち',
		approved: '承認済み',
		rejected: '却下',
		cancelled_by_participant: '取り下げ'
	};
	const ticketPurchaseMethodLabelMap: Record<TicketPurchasePayload['paymentMethod'], string> = {
		stripe: 'Stripe',
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
	const pendingSentInvitationsCount = $derived(
		sentInvitations.filter((invitation) => invitation.status === 'pending').length
	);
	const pendingReceivedInvitationsCount = $derived(
		receivedInvitations.filter((invitation) => invitation.status === 'pending').length
	);
	const pendingTicketPurchaseApprovalCount = $derived(
		ticketPurchases.filter((purchase) => purchase.status === 'pending_approval').length
	);
	const formatTicketPurchaseIdShort = (purchaseId: string): string => purchaseId.slice(0, 8);
	const formatTicketTypeIdShort = (ticketTypeId: string): string => ticketTypeId.slice(0, 8);
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
	const resetParticipantViewState = () => {
		activeOrganizationId = null;
		canManageParticipants = false;
		canManageClassroom = false;
		billing = null;
		premiumRestriction = null;
		participants = [];
		sentInvitations = [];
		receivedInvitations = [];
		services = [];
		ticketTypes = [];
		ticketPurchases = [];
	};

	const refresh = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}
		if (pathname === '/participants') {
			const portalAccess = await loadPortalAccess();
			const nextPath =
				portalAccess.hasOrganizationAdminAccess || portalAccess.canManageParticipants
					? '/admin/participants'
					: portalAccess.hasParticipantAccess || portalAccess.canUseParticipantBooking
						? '/participant/invitations'
						: (resolvePortalHomePath(portalAccess) ?? '/participant/home');
			await goto(resolve(nextPath));
			return;
		}
		try {
			const data = await loadParticipantsPageData();
			if (!data.activeContext) {
				resetParticipantViewState();
				return;
			}
			const scopedContext = readWindowScopedRouteContext();
			activeOrganizationId = data.activeContext.orgSlug ?? scopedContext?.orgSlug ?? null;
			canManageParticipants = data.canManageParticipants;
			canManageClassroom = data.canManageClassroom;
			premiumRestriction = data.premiumRestriction ?? null;
			if (data.premiumRestriction && data.organizationId) {
				const billingResult = await loadOrganizationBilling(data.organizationId);
				billing = billingResult.ok ? billingResult.billing : null;
			} else {
				billing = null;
			}
			participants = data.participants;
			sentInvitations = data.sentInvitations;
			receivedInvitations = data.receivedInvitations;
			services = data.services;
			ticketTypes = data.ticketTypes;
			ticketPurchases = data.ticketPurchases;
		} catch (error) {
			resetParticipantViewState();
			toast.error(toExceptionMessage(error, '参加者データの取得に失敗しました。'));
		}
	};

	const submitCreateParticipantInvitation = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!activeOrganizationId || !canManageParticipants) return;
		busy = true;
		try {
			const result = await createParticipantInvitation({
				email: participantInvitationForm.email,
				participantName: participantInvitationForm.participantName,
				organizationId: activeOrganizationId
			});
			if (!result.ok) {
				if (result.premiumRestriction) {
					premiumRestriction = result.premiumRestriction;
				}
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			participantInvitationForm = { email: '', participantName: '' };
			await refresh();
		} finally {
			busy = false;
		}
	};

	const submitResendParticipantInvitation = async (invitation: ParticipantInvitationPayload) => {
		if (!canManageParticipants) return;
		busy = true;
		try {
			const result = await createParticipantInvitation({
				email: invitation.email,
				participantName: invitation.participantName ?? '',
				organizationId: invitation.organizationId,
				resend: true
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

	const submitAction = async (type: 'accept' | 'reject' | 'cancel', invitationId: string) => {
		if ((type === 'cancel' || type === 'reject') && !confirm('この操作を実行しますか？')) {
			return;
		}
		busy = true;
		try {
			const result = await actParticipantInvitation(type, invitationId);
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			busy = false;
		}
	};

	const submitCreateTicketType = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!activeOrganizationId || !canManageClassroom) return;

		const totalCount = parsePositiveInteger(ticketTypeForm.totalCount);
		if (!totalCount) {
			toast.error('回数は 1 以上の整数で入力してください。');
			return;
		}

		const expiresInDays = parsePositiveInteger(ticketTypeForm.expiresInDays);
		if (normalizeToText(ticketTypeForm.expiresInDays) && !expiresInDays) {
			toast.error('有効日数は 1 以上の整数で入力してください。');
			return;
		}
		const stripePriceId = normalizeToText(ticketTypeForm.stripePriceId);
		if (ticketTypeForm.isForSale && !stripePriceId) {
			toast.error('販売対象にする場合は Stripe 価格IDを入力してください。');
			return;
		}

		busy = true;
		try {
			const result = await createTicketType({
				organizationId: activeOrganizationId,
				name: ticketTypeForm.name,
				totalCount,
				expiresInDays,
				serviceIds: ticketTypeForm.serviceIds,
				isForSale: ticketTypeForm.isForSale,
				stripePriceId: stripePriceId || undefined
			});
			if (!result.ok) {
				if (result.premiumRestriction) {
					premiumRestriction = result.premiumRestriction;
				}
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			ticketTypeForm = {
				name: '',
				totalCount: '10',
				expiresInDays: '',
				serviceIds: [],
				isForSale: false,
				stripePriceId: ''
			};
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
		<h1 class="text-3xl font-semibold text-foreground">
			{participantsPageMode === 'participant' ? '参加者招待' : '参加者管理'}
		</h1>
		<p class="text-sm text-muted-foreground">
			{participantsPageMode === 'participant'
				? '受信した参加者招待の承諾・辞退を行います。'
				: '参加者一覧・参加者招待・回数券管理を行います。'}
		</p>
	</header>

	{#if loading}
		<Card class="surface-panel border-border/80 shadow-lg"
			><CardContent class="py-6"
				><p class="text-sm text-muted-foreground">参加者データを読み込み中…</p></CardContent
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
		<section class="grid gap-4 lg:grid-cols-2">
			{#if participantsPageMode !== 'participant'}
				<Card class="surface-panel border-border/80 shadow-md">
					<CardHeader class="space-y-1">
						<h2 class="text-lg font-semibold text-foreground">管理者向けエリア</h2>
						<CardDescription>
							参加者一覧、招待送信、回数券種別作成・購入承認などの運用を行う画面です。
						</CardDescription>
					</CardHeader>
					<CardContent class="grid gap-2 text-sm text-secondary-foreground sm:grid-cols-3">
						<div class="rounded-md border border-border/80 bg-card/80 px-3 py-2">
							<p class="text-xs text-muted-foreground">参加者数</p>
							<p class="text-base font-semibold text-foreground">{participants.length}</p>
						</div>
						<div class="rounded-md border border-border/80 bg-card/80 px-3 py-2">
							<p class="text-xs text-muted-foreground">送信中招待</p>
							<p class="text-base font-semibold text-foreground">{pendingSentInvitationsCount}</p>
						</div>
						<div class="rounded-md border border-border/80 bg-card/80 px-3 py-2">
							<p class="text-xs text-muted-foreground">承認待ち購入</p>
							<p class="text-base font-semibold text-foreground">
								{pendingTicketPurchaseApprovalCount}
							</p>
						</div>
					</CardContent>
				</Card>
			{/if}

			{#if participantsPageMode !== 'admin'}
				<Card class="surface-panel border-border/80 shadow-md">
					<CardHeader class="space-y-1">
						<h2 class="text-lg font-semibold text-foreground">参加者向けエリア</h2>
						<CardDescription>
							自分宛ての参加者招待を承諾・辞退し、利用可能な運用情報を確認する画面です。
						</CardDescription>
					</CardHeader>
					<CardContent class="grid gap-2 text-sm text-secondary-foreground sm:grid-cols-2">
						<div class="rounded-md border border-border/80 bg-card/80 px-3 py-2">
							<p class="text-xs text-muted-foreground">受信招待</p>
							<p class="text-base font-semibold text-foreground">{receivedInvitations.length}</p>
						</div>
						<div class="rounded-md border border-border/80 bg-card/80 px-3 py-2">
							<p class="text-xs text-muted-foreground">対応待ち招待</p>
							<p class="text-base font-semibold text-foreground">
								{pendingReceivedInvitationsCount}
							</p>
						</div>
					</CardContent>
				</Card>
			{/if}
		</section>

		{#if premiumRestriction}
			<PremiumRestrictionNotice
				featureLabel="参加者・回数券管理"
				restriction={premiumRestriction}
				{billing}
			/>
		{/if}

		<section class="grid gap-6 xl:grid-cols-[1fr_1fr]">
			{#if participantsPageMode !== 'participant'}
				<Card class="surface-panel border-border/80 shadow-lg">
					<CardHeader><h2 class="text-xl font-semibold">参加者一覧</h2></CardHeader>
					<CardContent>
						{#if premiumRestriction}
							<p class="text-sm text-muted-foreground">
								参加者一覧と参加者招待は Premium 利用開始後に管理できます。
							</p>
						{:else if !canManageParticipants}
							<p class="text-sm text-muted-foreground">
								参加者一覧の確認には参加者管理権限が必要です。
							</p>
						{:else if loading}
							<p class="text-sm text-muted-foreground">参加者を読み込み中…</p>
						{:else if participants.length === 0}
							<p class="text-sm text-muted-foreground">参加者はまだ登録されていません。</p>
						{:else}
							<div class="space-y-2">
								{#each participants as participant (participant.id)}
									<div class="rounded-lg border border-border/80 bg-card/80 p-3">
										<p class="text-sm font-semibold">{participant.name}</p>
										<p class="text-xs text-muted-foreground">{participant.email}</p>
									</div>
								{/each}
							</div>
						{/if}
					</CardContent>
				</Card>
			{/if}

			<Card class="surface-panel border-border/80 shadow-lg">
				<CardHeader
					><h2 class="text-xl font-semibold">
						{participantsPageMode === 'participant' ? '受信した参加者招待' : '参加者招待'}
					</h2>
					<CardDescription
						>{participantsPageMode === 'participant'
							? '自分宛てに届いた参加者招待の承諾・辞退を行います。'
							: '管理者向けの参加者招待送信・再送・取消を行います。'}</CardDescription
					></CardHeader
				>
				<CardContent class="space-y-4">
					{#if participantsPageMode !== 'participant' && premiumRestriction}
						<p class="text-sm text-muted-foreground">
							参加者招待は Premium 利用開始後に送信・再送・取消できます。
						</p>
					{:else if participantsPageMode !== 'participant' && !canManageParticipants}
						<p class="text-sm text-muted-foreground">
							参加者招待の管理には参加者管理権限が必要です。
						</p>
					{:else if participantsPageMode !== 'participant'}
						<form
							class="space-y-3 rounded-lg border border-border/80 bg-card/80 p-4"
							onsubmit={submitCreateParticipantInvitation}
						>
							<h3 class="text-sm font-semibold">管理者向け: 参加者招待を送信</h3>
							<div class="space-y-2">
								<Label for="participant-email">メールアドレス</Label><Input
									id="participant-email"
									name="participant_email"
									type="email"
									bind:value={participantInvitationForm.email}
									required
									spellcheck={false}
								/>
							</div>
							<div class="space-y-2">
								<Label for="participant-name">参加者名</Label><Input
									id="participant-name"
									name="participant_name"
									type="text"
									bind:value={participantInvitationForm.participantName}
									required
								/>
							</div>
							<Button type="submit" disabled={busy}>送信</Button>
						</form>
					{/if}

					{#if participantsPageMode !== 'participant'}
						<div class="space-y-2">
							<h3 class="text-sm font-semibold">管理者向け: 送信済み参加者招待</h3>
							{#if sentInvitations.length === 0}
								<p class="text-sm text-muted-foreground">送信済み参加者招待はありません。</p>
							{:else}
								<div class="space-y-2">
									{#each sentInvitations as invitation (invitation.id)}
										<div
											class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 bg-card/80 p-3"
										>
											<div>
												<p class="text-sm font-semibold">{invitation.participantName}</p>
												<p class="text-xs text-muted-foreground">{invitation.email}</p>
											</div>
											<div class="flex items-center gap-2">
												<Badge variant={invitation.status === 'pending' ? 'outline' : 'secondary'}
													>{invitation.status}</Badge
												>
												<Button
													type="button"
													variant="outline"
													onclick={() => submitResendParticipantInvitation(invitation)}
													disabled={busy ||
														invitation.status !== 'pending' ||
														!canManageParticipants}>再送</Button
												>
												<Button
													type="button"
													variant="destructive"
													onclick={() => submitAction('cancel', invitation.id)}
													disabled={busy ||
														invitation.status !== 'pending' ||
														!canManageParticipants}>取り消し</Button
												>
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}

					{#if participantsPageMode !== 'admin'}
						<div class="space-y-2">
							<h3 class="text-sm font-semibold">参加者向け: 受信した参加者招待</h3>
							{#if receivedInvitations.length === 0}
								<p class="text-sm text-muted-foreground">受信した参加者招待はありません。</p>
							{:else}
								<div class="space-y-2">
									{#each receivedInvitations as invitation (invitation.id)}
										<div
											class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 bg-card/80 p-3"
										>
											<div>
												<p class="text-sm font-semibold">{invitation.participantName}</p>
												<p class="text-xs text-muted-foreground">
													{invitation.organizationName ?? invitation.organizationId} / {invitation.status}
												</p>
											</div>
											<div class="flex items-center gap-2">
												<Button
													type="button"
													variant="secondary"
													onclick={() => submitAction('accept', invitation.id)}
													disabled={busy || invitation.status !== 'pending'}>承諾</Button
												><Button
													type="button"
													variant="outline"
													onclick={() => submitAction('reject', invitation.id)}
													disabled={busy || invitation.status !== 'pending'}>辞退</Button
												>
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</CardContent>
			</Card>
		</section>

		{#if participantsPageMode !== 'participant'}
			<section>
				<Card class="surface-panel border-border/80 shadow-lg">
					<CardHeader>
						<h2 class="text-xl font-semibold">回数券管理</h2>
						<CardDescription>
							回数券種別の作成、参加者への付与、購入申請の承認を行います。
						</CardDescription>
					</CardHeader>
					<CardContent class="space-y-4">
						{#if premiumRestriction}
							<p class="text-sm text-muted-foreground">
								回数券管理は Premium 利用開始後に利用できます。
							</p>
						{:else if !canManageParticipants && !canManageClassroom}
							<p class="text-sm text-muted-foreground">
								回数券管理には教室管理権限または参加者管理権限が必要です。
							</p>
						{:else}
							<section class="grid gap-4 xl:grid-cols-[1fr_1fr]">
								{#if canManageClassroom}
									<form
										class="space-y-3 rounded-lg border border-border/80 bg-card/80 p-4"
										onsubmit={submitCreateTicketType}
									>
										<h3 class="text-sm font-semibold">回数券種別作成</h3>
										<div class="space-y-2">
											<Label for="ticket-type-name">券種名</Label>
											<Input
												id="ticket-type-name"
												name="ticket_type_name"
												type="text"
												bind:value={ticketTypeForm.name}
												required
											/>
										</div>
										<div class="space-y-2">
											<Label for="ticket-type-total-count">回数</Label>
											<Input
												id="ticket-type-total-count"
												name="ticket_type_total_count"
												type="number"
												min="1"
												bind:value={ticketTypeForm.totalCount}
												required
											/>
										</div>
										<div class="space-y-2">
											<Label for="ticket-type-expires-in-days">有効日数（任意）</Label>
											<Input
												id="ticket-type-expires-in-days"
												name="ticket_type_expires_in_days"
												type="number"
												min="1"
												bind:value={ticketTypeForm.expiresInDays}
											/>
										</div>
										<div
											class="flex items-center gap-2 rounded-md border border-border/80 bg-secondary/60 px-3 py-2"
										>
											<input
												id="ticket-type-is-for-sale"
												name="ticket_type_is_for_sale"
												type="checkbox"
												bind:checked={ticketTypeForm.isForSale}
											/>
											<Label for="ticket-type-is-for-sale">参加者が購入できるようにする</Label>
										</div>
										<div class="space-y-2">
											<Label for="ticket-type-stripe-price-id">Stripe 価格ID（販売時必須）</Label>
											<Input
												id="ticket-type-stripe-price-id"
												name="ticket_type_stripe_price_id"
												type="text"
												bind:value={ticketTypeForm.stripePriceId}
												placeholder="price_xxx"
											/>
										</div>
										<div class="space-y-2">
											<p class="text-sm font-medium">対象サービス（任意）</p>
											{#if services.length === 0}
												<p class="text-sm text-muted-foreground">
													選択可能なサービスがありません。
												</p>
											{:else}
												<div
													class="max-h-40 space-y-2 overflow-y-auto rounded-md border border-border/80 bg-secondary/60 p-2"
												>
													{#each services as service (service.id)}
														<label
															class="flex items-center gap-2 text-sm text-secondary-foreground"
															for={`ticket-service-${service.id}`}
														>
															<input
																id={`ticket-service-${service.id}`}
																name={`ticket_service_${service.id}`}
																type="checkbox"
																checked={ticketTypeForm.serviceIds.includes(service.id)}
																onchange={(event) =>
																	toggleTicketTypeService(
																		service.id,
																		(event.currentTarget as HTMLInputElement).checked
																	)}
															/>
															<span>{service.name}</span>
														</label>
													{/each}
												</div>
											{/if}
										</div>
										<Button type="submit" disabled={busy}>作成</Button>
									</form>
								{:else}
									<div
										class="space-y-2 rounded-lg border border-dashed border-stone-03 bg-secondary/70 p-4"
									>
										<h3 class="text-sm font-semibold">回数券種別作成</h3>
										<p class="text-sm text-muted-foreground">
											回数券種別の作成には教室管理権限が必要です。
										</p>
									</div>
								{/if}

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
												{#each ticketTypes as ticketType (ticketType.id)}
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
								<h3 class="text-sm font-semibold">回数券種別一覧</h3>
								{#if ticketTypes.length === 0}
									<p class="text-sm text-muted-foreground">回数券種別はまだ作成されていません。</p>
								{:else}
									<div class="space-y-2">
										{#each ticketTypes as ticketType (ticketType.id)}
											<div
												class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 bg-card/80 p-3"
											>
												<div>
													<p class="text-sm font-semibold">{ticketType.name}</p>
													<p class="text-xs text-muted-foreground">
														回数: {ticketType.totalCount} / 有効日数: {ticketType.expiresInDays ??
															'無期限'} / 対象サービス: {ticketType.serviceIds?.length ?? 0}件 /
														販売:
														{ticketType.isForSale ? '公開' : '非公開'}
													</p>
													<p class="text-xs text-muted-foreground">
														Stripe価格ID: {ticketType.stripePriceId || '-'}
													</p>
													<p class="text-xs text-muted-foreground">
														作成: {formatDateTime(ticketType.createdAt)}
													</p>
												</div>
												<Badge variant={ticketType.isActive ? 'outline' : 'secondary'}>
													{ticketType.isActive ? 'active' : 'inactive'}
												</Badge>
											</div>
										{/each}
									</div>
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
												<option value="stripe">stripe</option>
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
															<td class="px-3 py-3"
																>{getParticipantLabel(purchase.participantId)}</td
															>
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
	{/if}
</main>
