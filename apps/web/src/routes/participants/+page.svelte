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
	import {
		getRoutePathFromUrlPath,
		replacePortalPathWithScopedContext
	} from '$lib/features/scoped-routing';
	import {
		actParticipantInvitation,
		createParticipantInvitation
	} from '$lib/features/invitations-participant.svelte';
	import { loadOrganizationBilling } from '$lib/features/organization-context.svelte';
	import { loadParticipantsPageData } from '$lib/features/participants-page.svelte';
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
		ParticipantPayload
	} from '$lib/rpc-client';
	import type { OrganizationPremiumRestrictionPayload } from '$lib/features/premium-restrictions';
	import { toast } from 'svelte-sonner';

	let loading = $state(true);
	let busy = $state(false);
	let activeOrganizationId = $state<string | null>(null);
	let canManageParticipants = $state(false);
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
	let participantInvitationForm = $state({ email: '', participantName: '' });
	const pendingSentInvitationsCount = $derived(
		sentInvitations.filter((invitation) => invitation.status === 'pending').length
	);
	const pendingReceivedInvitationsCount = $derived(
		receivedInvitations.filter((invitation) => invitation.status === 'pending').length
	);
	const toExceptionMessage = (error: unknown, fallback: string): string => {
		if (error instanceof Error && error.message) {
			return error.message;
		}
		return fallback;
	};
	const resetParticipantViewState = () => {
		activeOrganizationId = null;
		canManageParticipants = false;
		billing = null;
		premiumRestriction = null;
		participants = [];
		sentInvitations = [];
		receivedInvitations = [];
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
			const scopedNextPath = portalAccess.activeContext
				? replacePortalPathWithScopedContext(nextPath, portalAccess.activeContext)
				: nextPath;
			await goto(resolve(scopedNextPath as Pathname));
			return;
		}
		try {
			const data = await loadParticipantsPageData();
			if (data.loadError) {
				toast.error(data.loadError);
			}
			if (!data.activeContext) {
				resetParticipantViewState();
				return;
			}
			activeOrganizationId = data.organizationId;
			canManageParticipants = data.canManageParticipants;
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
				: '参加者一覧・参加者招待を行います。'}
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
						<CardDescription>参加者一覧と招待送信を行う画面です。</CardDescription>
					</CardHeader>
					<CardContent class="grid gap-2 text-sm text-secondary-foreground sm:grid-cols-2">
						<div class="rounded-md border border-border/80 bg-card/80 px-3 py-2">
							<p class="text-xs text-muted-foreground">参加者数</p>
							<p class="text-base font-semibold text-foreground">{participants.length}</p>
						</div>
						<div class="rounded-md border border-border/80 bg-card/80 px-3 py-2">
							<p class="text-xs text-muted-foreground">送信中招待</p>
							<p class="text-base font-semibold text-foreground">{pendingSentInvitationsCount}</p>
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
				featureLabel="参加者管理"
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
	{/if}
</main>
