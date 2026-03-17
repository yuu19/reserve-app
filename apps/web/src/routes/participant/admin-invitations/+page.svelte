<script lang="ts">
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import {
		actOperatorInvitation,
		loadReceivedOperatorInvitations
	} from '$lib/features/invitations-classroom.svelte';
	import {
		getCurrentPathWithSearch,
		loadSession,
		redirectToLoginWithNext
	} from '$lib/features/auth-session.svelte';
	import type { InvitationPayload } from '$lib/rpc-client';
	import { toast } from 'svelte-sonner';

	const invitationStatusLabel = (status: InvitationPayload['status']) =>
		({
			pending: '対応待ち',
			accepted: '承諾済み',
			rejected: '辞退済み',
			cancelled: '取消済み',
			expired: '期限切れ'
		})[status];

	const invitationKindLabel = (invitation: InvitationPayload) =>
		invitation.subjectKind === 'org_operator' ? '組織運営招待' : '教室運営招待';

	let loading = $state(true);
	let busy = $state(false);
	let receivedInvitations = $state<InvitationPayload[]>([]);
	const pendingReceivedCount = $derived(
		receivedInvitations.filter((invitation) => invitation.status === 'pending').length
	);
	const orgInvitationCount = $derived(
		receivedInvitations.filter((invitation) => invitation.subjectKind === 'org_operator').length
	);
	const classroomInvitationCount = $derived(
		receivedInvitations.filter((invitation) => invitation.subjectKind === 'classroom_operator').length
	);

	const refresh = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}
		const data = await loadReceivedOperatorInvitations();
		receivedInvitations = data.received;
	};

	const submitAction = async (type: 'accept' | 'reject', invitationId: string) => {
		if (type === 'reject' && !confirm('この操作を実行しますか？')) {
			return;
		}
		busy = true;
		try {
			const result = await actOperatorInvitation(type, invitationId);
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
		<h1 class="text-3xl font-semibold text-slate-900">受信した運営招待</h1>
		<p class="text-sm text-slate-600">
			自分宛てに届いた組織運営招待と教室運営招待の承諾・辞退を行います。
		</p>
	</header>

	<section class="grid gap-4 lg:grid-cols-3">
		<Card class="surface-panel border-slate-200/80 shadow-md">
			<CardHeader class="space-y-1">
				<h2 class="text-lg font-semibold text-slate-900">受信招待</h2>
				<CardDescription>現在対応できる運営招待の総数です。</CardDescription>
			</CardHeader>
			<CardContent>
				<p class="text-2xl font-semibold text-slate-900">{receivedInvitations.length}</p>
			</CardContent>
		</Card>

		<Card class="surface-panel border-slate-200/80 shadow-md">
			<CardHeader class="space-y-1">
				<h2 class="text-lg font-semibold text-slate-900">組織 / 教室</h2>
				<CardDescription>招待種別の内訳です。</CardDescription>
			</CardHeader>
			<CardContent class="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
				<div class="rounded-md border border-slate-200/80 bg-white/80 px-3 py-2">
					<p class="text-xs text-slate-500">組織運営</p>
					<p class="text-base font-semibold text-slate-900">{orgInvitationCount}</p>
				</div>
				<div class="rounded-md border border-slate-200/80 bg-white/80 px-3 py-2">
					<p class="text-xs text-slate-500">教室運営</p>
					<p class="text-base font-semibold text-slate-900">{classroomInvitationCount}</p>
				</div>
			</CardContent>
		</Card>

		<Card class="surface-panel border-slate-200/80 shadow-md">
			<CardHeader class="space-y-1">
				<h2 class="text-lg font-semibold text-slate-900">対応待ち</h2>
				<CardDescription>未承諾の招待です。</CardDescription>
			</CardHeader>
			<CardContent>
				<p class="text-2xl font-semibold text-slate-900">{pendingReceivedCount}</p>
			</CardContent>
		</Card>
	</section>

	<Card class="surface-panel border-slate-200/80 shadow-lg">
		<CardHeader>
			<h2 class="text-xl font-semibold">受信した運営招待一覧</h2>
			<CardDescription>participant 招待は `/participant/invitations` で対応します。</CardDescription>
		</CardHeader>
		<CardContent>
			{#if loading}
				<p class="text-sm text-muted-foreground">受信招待を読み込み中…</p>
			{:else if receivedInvitations.length === 0}
				<p class="text-sm text-muted-foreground">受信した運営招待はありません。</p>
			{:else}
				<div class="space-y-2">
					{#each receivedInvitations as invitation (invitation.id)}
						<div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white/80 p-3">
							<div class="space-y-1">
								<p class="text-sm font-semibold">{invitationKindLabel(invitation)}</p>
								<p class="text-xs text-muted-foreground">
									{invitation.organizationName}
									{#if invitation.classroomName}
										/ {invitation.classroomName}
									{/if}
								</p>
								<p class="text-xs text-muted-foreground">
									{invitation.email}
								</p>
							</div>
							<div class="flex items-center gap-2">
								<Badge variant={invitation.status === 'pending' ? 'outline' : 'secondary'}>
									{invitationStatusLabel(invitation.status)}
								</Badge>
								<Button
									type="button"
									variant="secondary"
									onclick={() => submitAction('accept', invitation.id)}
									disabled={busy || invitation.status !== 'pending'}
								>
									承諾
								</Button>
								<Button
									type="button"
									variant="outline"
									onclick={() => submitAction('reject', invitation.id)}
									disabled={busy || invitation.status !== 'pending'}
								>
									辞退
								</Button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</CardContent>
	</Card>
</main>
