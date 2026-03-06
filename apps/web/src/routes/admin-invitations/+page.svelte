<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import {
		actAdminInvitation,
		createAdminInvitation,
		loadAdminInvitations
	} from '$lib/features/invitations-admin.svelte';
	import {
		getCurrentPathWithSearch,
		loadSession,
		redirectToLoginWithNext
	} from '$lib/features/auth-session.svelte';
	import { loadOrganizations } from '$lib/features/organization-context.svelte';
	import type { InvitationPayload } from '$lib/rpc-client';
	import { toast } from 'svelte-sonner';

	let { routeMode = null }: { routeMode?: 'admin' | 'participant' | null } = $props();

	let loading = $state(true);
	let busy = $state(false);
	let activeOrganizationId = $state<string | null>(null);
	let canManage = $state(false);
	const pathname = $derived(page.url.pathname);
	const adminInvitationPageMode = $derived.by(() => {
		if (routeMode) {
			return routeMode;
		}
		if (pathname.startsWith('/admin/invitations')) {
			return 'admin';
		}
		if (pathname.startsWith('/participant/admin-invitations')) {
			return 'participant';
		}
		return 'legacy';
	});
	let sentInvitations = $state<InvitationPayload[]>([]);
	let receivedInvitations = $state<InvitationPayload[]>([]);
	let invitationForm = $state({ email: '', role: 'member' });
	const pendingSentCount = $derived(
		sentInvitations.filter((invitation) => invitation.status === 'pending').length
	);
	const pendingReceivedCount = $derived(
		receivedInvitations.filter((invitation) => invitation.status === 'pending').length
	);

	const refresh = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}
		if (pathname === '/admin-invitations') {
			await goto(resolve('/admin/invitations'));
			return;
		}
		const { activeOrganization } = await loadOrganizations();
		activeOrganizationId = activeOrganization?.id ?? null;
		const data = await loadAdminInvitations(activeOrganizationId ?? undefined);
		sentInvitations = data.sent;
		receivedInvitations = data.received;
		canManage = data.canManage;
	};

	const submitCreateInvitation = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!activeOrganizationId || !canManage) return;
		busy = true;
		try {
			const result = await createAdminInvitation({
				email: invitationForm.email,
				role: invitationForm.role,
				organizationId: activeOrganizationId
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			invitationForm.email = '';
			await refresh();
		} finally {
			busy = false;
		}
	};

	const submitResend = async (invitation: InvitationPayload) => {
		if (!canManage) return;
		busy = true;
		try {
			const result = await createAdminInvitation({
				email: invitation.email,
				role: invitation.role,
				organizationId: invitation.organizationId,
				resend: true
			});
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

	const submitAction = async (type: 'accept' | 'reject' | 'cancel', invitationId: string) => {
		if ((type === 'reject' || type === 'cancel') && !confirm('この操作を実行しますか？')) {
			return;
		}
		busy = true;
		try {
			const result = await actAdminInvitation(type, invitationId);
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
		<h1 class="text-3xl font-semibold text-slate-900">
			{adminInvitationPageMode === 'participant' ? '受信した管理者招待' : '管理者招待'}
		</h1>
		<p class="text-sm text-slate-600">
			{adminInvitationPageMode === 'participant'
				? '自分宛てに届いた管理者招待の承諾・辞退を行います。'
				: '管理者向けの招待送信・再送・取消を行います。'}
		</p>
	</header>

	<section class="grid gap-4 lg:grid-cols-2">
		{#if adminInvitationPageMode !== 'participant'}
			<Card class="surface-panel border-slate-200/80 shadow-md">
				<CardHeader class="space-y-1">
					<h2 class="text-lg font-semibold text-slate-900">管理者向け操作</h2>
					<CardDescription>管理者招待の作成・再送・取消を行います。</CardDescription>
				</CardHeader>
				<CardContent class="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
					<div class="rounded-md border border-slate-200/80 bg-white/80 px-3 py-2">
						<p class="text-xs text-slate-500">送信済み招待</p>
						<p class="text-base font-semibold text-slate-900">{sentInvitations.length}</p>
					</div>
					<div class="rounded-md border border-slate-200/80 bg-white/80 px-3 py-2">
						<p class="text-xs text-slate-500">送信中招待</p>
						<p class="text-base font-semibold text-slate-900">{pendingSentCount}</p>
					</div>
				</CardContent>
			</Card>
		{/if}

		{#if adminInvitationPageMode !== 'admin'}
			<Card class="surface-panel border-slate-200/80 shadow-md">
				<CardHeader class="space-y-1">
					<h2 class="text-lg font-semibold text-slate-900">参加者向け操作</h2>
					<CardDescription>受信した管理者招待の承諾・辞退を行います。</CardDescription>
				</CardHeader>
				<CardContent class="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
					<div class="rounded-md border border-slate-200/80 bg-white/80 px-3 py-2">
						<p class="text-xs text-slate-500">受信招待</p>
						<p class="text-base font-semibold text-slate-900">{receivedInvitations.length}</p>
					</div>
					<div class="rounded-md border border-slate-200/80 bg-white/80 px-3 py-2">
						<p class="text-xs text-slate-500">対応待ち招待</p>
						<p class="text-base font-semibold text-slate-900">{pendingReceivedCount}</p>
					</div>
				</CardContent>
			</Card>
		{/if}
	</section>

	{#if loading}
		<Card class="surface-panel border-slate-200/80 shadow-lg"
			><CardContent class="py-6"
				><p class="text-sm text-muted-foreground">招待データを読み込み中…</p></CardContent
			></Card
		>
	{:else if !activeOrganizationId}
		<Card class="surface-panel border-slate-200/80 shadow-lg"
			><CardContent class="py-6"
				><p class="text-sm text-muted-foreground">
					利用中の組織を `/admin/dashboard` で選択してください。
				</p></CardContent
			></Card
		>
	{:else}
		<section class="grid gap-6 xl:grid-cols-[1fr_1fr]">
			{#if adminInvitationPageMode !== 'participant'}
				<Card class="surface-panel border-slate-200/80 shadow-lg">
				<CardHeader><h2 class="text-xl font-semibold">送信済み管理者招待</h2></CardHeader>
				<CardContent class="space-y-3">
					{#if !canManage}
						<p class="text-sm text-muted-foreground">
							管理者招待の作成・再送・取消には管理権限が必要です。
						</p>
					{:else}
						<form
							class="space-y-3 rounded-lg border border-slate-200/80 bg-white/80 p-4"
							onsubmit={submitCreateInvitation}
						>
							<h3 class="text-sm font-semibold">管理者招待を送信</h3>
							<div class="space-y-2">
								<Label for="admin-email">メールアドレス</Label><Input
									id="admin-email"
									name="admin_email"
									type="email"
									bind:value={invitationForm.email}
									required
									spellcheck={false}
								/>
							</div>
							<div class="space-y-2">
								<Label for="admin-role">ロール</Label><Select.Root
									type="single"
									bind:value={invitationForm.role}
									><Select.Trigger id="admin-role" class="w-full"
										>{invitationForm.role}</Select.Trigger
									><Select.Content
										><Select.Item value="admin" label="admin" /><Select.Item
											value="member"
											label="member"
										/></Select.Content
									></Select.Root
								>
							</div>
							<Button type="submit" disabled={busy}>送信</Button>
						</form>
					{/if}

					{#if sentInvitations.length === 0}
						<p class="text-sm text-muted-foreground">送信済み管理者招待はありません。</p>
					{:else}
						<div class="space-y-2">
							{#each sentInvitations as invitation (invitation.id)}
								<div
									class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white/80 p-3"
								>
									<div>
										<p class="text-sm font-semibold">{invitation.email}</p>
										<p class="text-xs text-muted-foreground">role: {invitation.role}</p>
									</div>
									<div class="flex items-center gap-2">
										<Badge variant={invitation.status === 'pending' ? 'outline' : 'secondary'}
											>{invitation.status}</Badge
										><Button
											type="button"
											variant="outline"
											onclick={() => submitResend(invitation)}
											disabled={busy || invitation.status !== 'pending' || !canManage}>再送</Button
										><Button
											type="button"
											variant="destructive"
											onclick={() => submitAction('cancel', invitation.id)}
											disabled={busy || invitation.status !== 'pending' || !canManage}
											>取り消し</Button
										>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</CardContent>
				</Card>
			{/if}

			{#if adminInvitationPageMode !== 'admin'}
				<Card class="surface-panel border-slate-200/80 shadow-lg">
				<CardHeader
					><h2 class="text-xl font-semibold">受信した管理者招待</h2>
					<CardDescription>自分に届いた管理者招待の承諾/辞退。</CardDescription></CardHeader
				>
				<CardContent>
					{#if loading}
						<p class="text-sm text-muted-foreground">受信招待を読み込み中…</p>
					{:else if receivedInvitations.length === 0}
						<p class="text-sm text-muted-foreground">受信した管理者招待はありません。</p>
					{:else}
						<div class="space-y-2">
							{#each receivedInvitations as invitation (invitation.id)}
								<div
									class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white/80 p-3"
								>
									<div>
										<p class="text-sm font-semibold">
											{invitation.organizationName ?? invitation.organizationId}
										</p>
										<p class="text-xs text-muted-foreground">
											role: {invitation.role} / {invitation.status}
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
				</CardContent>
				</Card>
			{/if}
		</section>
	{/if}
</main>
