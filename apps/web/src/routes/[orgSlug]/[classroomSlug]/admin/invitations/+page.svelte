<script lang="ts">
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import PremiumRestrictionNotice from '$lib/components/premium-restriction-notice.svelte';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import {
		actOperatorInvitation,
		createClassroomInvitation,
		loadClassroomInvitations
	} from '$lib/features/invitations-classroom.svelte';
	import {
		getCurrentPathWithSearch,
		loadSession,
		redirectToLoginWithNext
	} from '$lib/features/auth-session.svelte';
	import {
		loadOrganizationBilling,
		loadOrganizations
	} from '$lib/features/organization-context.svelte';
	import { readWindowScopedRouteContext } from '$lib/features/scoped-routing';
	import type { InvitationPayload, OrganizationBillingPayload } from '$lib/rpc-client';
	import type { OrganizationPremiumRestrictionPayload } from '$lib/features/premium-restrictions';
	import { toast } from 'svelte-sonner';

	const invitationStatusLabel = (status: InvitationPayload['status']) =>
		({
			pending: '送信中',
			accepted: '承諾済み',
			rejected: '辞退済み',
			cancelled: '取消済み',
			expired: '期限切れ'
		})[status];

	const operatorRoleLabel = (role: InvitationPayload['role']) =>
		role === 'manager' ? 'manager' : role === 'staff' ? 'staff' : String(role);

	let loading = $state(true);
	let busy = $state(false);
	let activeOrganizationId = $state<string | null>(null);
	let organizationName = $state<string | null>(null);
	let classroomName = $state<string | null>(null);
	let canManageClassroom = $state(false);
	let canManageParticipants = $state(false);
	let billing = $state<OrganizationBillingPayload | null>(null);
	let premiumRestriction = $state<OrganizationPremiumRestrictionPayload | null>(null);
	let operatorInvitations = $state<InvitationPayload[]>([]);
	let participantInvitations = $state<InvitationPayload[]>([]);
	let operatorInvitationForm = $state({
		email: '',
		role: 'staff'
	});
	let participantInvitationForm = $state({
		email: '',
		participantName: ''
	});
	const pendingOperatorCount = $derived(
		operatorInvitations.filter((invitation) => invitation.status === 'pending').length
	);
	const pendingParticipantCount = $derived(
		participantInvitations.filter((invitation) => invitation.status === 'pending').length
	);

	const refresh = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}

		const context = readWindowScopedRouteContext();
		if (!context) {
			activeOrganizationId = null;
			organizationName = null;
			classroomName = null;
			canManageClassroom = false;
			canManageParticipants = false;
			billing = null;
			premiumRestriction = null;
			operatorInvitations = [];
			participantInvitations = [];
			return;
		}

		const [{ activeOrganization, activeClassroom }, invitationData] = await Promise.all([
			loadOrganizations(context),
			loadClassroomInvitations()
		]);
		activeOrganizationId = activeOrganization?.id ?? null;
		organizationName = activeOrganization?.name ?? context.orgSlug;
		classroomName = activeClassroom?.name ?? context.classroomSlug;
		premiumRestriction = invitationData.premiumRestriction ?? null;
		if (invitationData.premiumRestriction && invitationData.organizationId) {
			const billingResult = await loadOrganizationBilling(invitationData.organizationId);
			billing = billingResult.ok ? billingResult.billing : null;
		} else {
			billing = null;
		}
		canManageClassroom = invitationData.canManageClassroom;
		canManageParticipants = invitationData.canManageParticipants;
		operatorInvitations = invitationData.operatorInvitations;
		participantInvitations = invitationData.participantInvitations;
	};

	const submitOperatorInvitation = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!canManageClassroom) return;
		busy = true;
		try {
			const result = await createClassroomInvitation({
				email: operatorInvitationForm.email,
				role: operatorInvitationForm.role
			});
			if (!result.ok) {
				if (result.premiumRestriction && activeOrganizationId) {
					premiumRestriction = result.premiumRestriction;
					const billingResult = await loadOrganizationBilling(activeOrganizationId);
					billing = billingResult.ok ? billingResult.billing : null;
				}
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			operatorInvitationForm.email = '';
			operatorInvitationForm.role = 'staff';
			await refresh();
		} finally {
			busy = false;
		}
	};

	const submitParticipantInvitation = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!canManageParticipants) return;
		busy = true;
		try {
			const result = await createClassroomInvitation({
				email: participantInvitationForm.email,
				role: 'participant',
				participantName: participantInvitationForm.participantName
			});
			if (!result.ok) {
				if (result.premiumRestriction && activeOrganizationId) {
					premiumRestriction = result.premiumRestriction;
					const billingResult = await loadOrganizationBilling(activeOrganizationId);
					billing = billingResult.ok ? billingResult.billing : null;
				}
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			participantInvitationForm.email = '';
			participantInvitationForm.participantName = '';
			await refresh();
		} finally {
			busy = false;
		}
	};

	const submitResend = async (invitation: InvitationPayload) => {
		const requiresParticipantAccess = invitation.subjectKind === 'participant';
		if (
			(requiresParticipantAccess && !canManageParticipants) ||
			(!requiresParticipantAccess && !canManageClassroom)
		) {
			return;
		}
		busy = true;
		try {
			const result = await createClassroomInvitation({
				email: invitation.email,
				role: String(invitation.role),
				participantName: invitation.participantName ?? undefined,
				resend: true
			});
			if (!result.ok) {
				if (result.premiumRestriction && activeOrganizationId) {
					premiumRestriction = result.premiumRestriction;
					const billingResult = await loadOrganizationBilling(activeOrganizationId);
					billing = billingResult.ok ? billingResult.billing : null;
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

	const submitAction = async (type: 'cancel', invitationId: string) => {
		if (!confirm('この操作を実行しますか？')) {
			return;
		}
		busy = true;
		try {
			const result = await actOperatorInvitation(type, invitationId);
			if (!result.ok) {
				if (result.premiumRestriction && activeOrganizationId) {
					premiumRestriction = result.premiumRestriction;
					const billingResult = await loadOrganizationBilling(activeOrganizationId);
					billing = billingResult.ok ? billingResult.billing : null;
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
		<h1 class="text-3xl font-semibold text-foreground">教室招待</h1>
		<p class="text-sm text-muted-foreground">
			{organizationName ?? '組織'} / {classroomName ?? '教室'} に対する運営招待と参加者招待を管理します。
		</p>
	</header>

	{#if premiumRestriction}
		<PremiumRestrictionNotice
			featureLabel="教室招待と参加者招待管理"
			restriction={premiumRestriction}
			{billing}
		/>
	{/if}

	<section class="grid gap-4 lg:grid-cols-2">
		<Card class="surface-panel border-border/80 shadow-md">
			<CardHeader class="space-y-1">
				<h2 class="text-lg font-semibold text-foreground">教室運営招待</h2>
				<CardDescription>manager / staff の招待送信、再送、取消を行います。</CardDescription>
			</CardHeader>
			<CardContent class="grid gap-2 text-sm text-secondary-foreground sm:grid-cols-2">
				<div class="rounded-md border border-border/80 bg-card/80 px-3 py-2">
					<p class="text-xs text-muted-foreground">送信済み招待</p>
					<p class="text-base font-semibold text-foreground">{operatorInvitations.length}</p>
				</div>
				<div class="rounded-md border border-border/80 bg-card/80 px-3 py-2">
					<p class="text-xs text-muted-foreground">送信中招待</p>
					<p class="text-base font-semibold text-foreground">{pendingOperatorCount}</p>
				</div>
			</CardContent>
		</Card>

		<Card class="surface-panel border-border/80 shadow-md">
			<CardHeader class="space-y-1">
				<h2 class="text-lg font-semibold text-foreground">参加者招待</h2>
				<CardDescription>participant 招待の送信、再送、取消を行います。</CardDescription>
			</CardHeader>
			<CardContent class="grid gap-2 text-sm text-secondary-foreground sm:grid-cols-2">
				<div class="rounded-md border border-border/80 bg-card/80 px-3 py-2">
					<p class="text-xs text-muted-foreground">送信済み招待</p>
					<p class="text-base font-semibold text-foreground">{participantInvitations.length}</p>
				</div>
				<div class="rounded-md border border-border/80 bg-card/80 px-3 py-2">
					<p class="text-xs text-muted-foreground">送信中招待</p>
					<p class="text-base font-semibold text-foreground">{pendingParticipantCount}</p>
				</div>
			</CardContent>
		</Card>
	</section>

	{#if loading}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">招待データを読み込み中…</p>
			</CardContent>
		</Card>
	{:else if !classroomName}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">
					教室コンテキストを識別できませんでした。教室管理画面から開き直してください。
				</p>
			</CardContent>
		</Card>
	{:else}
		<section class="grid gap-6 xl:grid-cols-[1fr_1fr]">
			<Card class="surface-panel border-border/80 shadow-lg">
				<CardHeader>
					<h2 class="text-xl font-semibold">送信済み教室運営招待</h2>
					<CardDescription>manager / staff の付与先をここで管理します。</CardDescription>
				</CardHeader>
				<CardContent class="space-y-3">
					{#if !canManageClassroom}
						<p class="text-sm text-muted-foreground">
							教室運営招待の作成・再送・取消には教室管理権限が必要です。
						</p>
					{:else}
						<form
							class="space-y-3 rounded-lg border border-border/80 bg-card/80 p-4"
							onsubmit={submitOperatorInvitation}
						>
							<h3 class="text-sm font-semibold">教室運営招待を送信</h3>
							<div class="space-y-2">
								<Label for="operator-email">メールアドレス</Label>
								<Input
									id="operator-email"
									name="operator_email"
									type="email"
									bind:value={operatorInvitationForm.email}
									required
									spellcheck={false}
								/>
							</div>
							<div class="space-y-2">
								<Label for="operator-role">ロール</Label>
								<Select.Root type="single" bind:value={operatorInvitationForm.role}>
									<Select.Trigger id="operator-role" class="w-full">
										{operatorInvitationForm.role}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="manager" label="manager" />
										<Select.Item value="staff" label="staff" />
									</Select.Content>
								</Select.Root>
							</div>
							<Button type="submit" disabled={busy}>送信</Button>
						</form>
					{/if}

					{#if operatorInvitations.length === 0}
						<p class="text-sm text-muted-foreground">送信済み教室運営招待はありません。</p>
					{:else}
						<div class="space-y-2">
							{#each operatorInvitations as invitation (invitation.id)}
								<div
									class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 bg-card/80 p-3"
								>
									<div class="space-y-1">
										<p class="text-sm font-semibold">{invitation.email}</p>
										<p class="text-xs text-muted-foreground">
											role: {operatorRoleLabel(invitation.role)}
										</p>
									</div>
									<div class="flex items-center gap-2">
										<Badge variant={invitation.status === 'pending' ? 'outline' : 'secondary'}>
											{invitationStatusLabel(invitation.status)}
										</Badge>
										<Button
											type="button"
											variant="outline"
											onclick={() => submitResend(invitation)}
											disabled={busy || invitation.status !== 'pending' || !canManageClassroom}
										>
											再送
										</Button>
										<Button
											type="button"
											variant="destructive"
											onclick={() => submitAction('cancel', invitation.id)}
											disabled={busy || invitation.status !== 'pending' || !canManageClassroom}
										>
											取り消し
										</Button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</CardContent>
			</Card>

			<Card class="surface-panel border-border/80 shadow-lg">
				<CardHeader>
					<h2 class="text-xl font-semibold">送信済み参加者招待</h2>
					<CardDescription>participant 招待では参加者名も記録します。</CardDescription>
				</CardHeader>
				<CardContent class="space-y-3">
					{#if !canManageParticipants}
						<p class="text-sm text-muted-foreground">
							参加者招待の作成・再送・取消には参加者管理権限が必要です。
						</p>
					{:else}
						<form
							class="space-y-3 rounded-lg border border-border/80 bg-card/80 p-4"
							onsubmit={submitParticipantInvitation}
						>
							<h3 class="text-sm font-semibold">参加者招待を送信</h3>
							<div class="space-y-2">
								<Label for="participant-email">メールアドレス</Label>
								<Input
									id="participant-email"
									name="participant_email"
									type="email"
									bind:value={participantInvitationForm.email}
									required
									spellcheck={false}
								/>
							</div>
							<div class="space-y-2">
								<Label for="participant-name">参加者名</Label>
								<Input
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

					{#if participantInvitations.length === 0}
						<p class="text-sm text-muted-foreground">送信済み参加者招待はありません。</p>
					{:else}
						<div class="space-y-2">
							{#each participantInvitations as invitation (invitation.id)}
								<div
									class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 bg-card/80 p-3"
								>
									<div class="space-y-1">
										<p class="text-sm font-semibold">{invitation.participantName}</p>
										<p class="text-xs text-muted-foreground">{invitation.email}</p>
									</div>
									<div class="flex items-center gap-2">
										<Badge variant={invitation.status === 'pending' ? 'outline' : 'secondary'}>
											{invitationStatusLabel(invitation.status)}
										</Badge>
										<Button
											type="button"
											variant="outline"
											onclick={() => submitResend(invitation)}
											disabled={busy || invitation.status !== 'pending' || !canManageParticipants}
										>
											再送
										</Button>
										<Button
											type="button"
											variant="destructive"
											onclick={() => submitAction('cancel', invitation.id)}
											disabled={busy || invitation.status !== 'pending' || !canManageParticipants}
										>
											取り消し
										</Button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</CardContent>
			</Card>
		</section>
	{/if}
</main>
