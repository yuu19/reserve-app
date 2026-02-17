<script lang="ts">
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		actParticipantInvitation,
		createParticipantInvitation,
		loadParticipantFeatureData
	} from '$lib/features/invitations-participant.svelte';
	import { getCurrentPathWithSearch, loadSession, redirectToLoginWithNext } from '$lib/features/auth-session.svelte';
	import { loadOrganizations } from '$lib/features/organization-context.svelte';
	import type { ParticipantInvitationPayload, ParticipantPayload } from '$lib/rpc-client';
	import { toast } from 'svelte-sonner';

	let loading = $state(true);
	let busy = $state(false);
	let activeOrganizationId = $state<string | null>(null);
	let canManage = $state(false);
	let participants = $state<ParticipantPayload[]>([]);
	let sentInvitations = $state<ParticipantInvitationPayload[]>([]);
	let receivedInvitations = $state<ParticipantInvitationPayload[]>([]);
	let participantInvitationForm = $state({ email: '', participantName: '' });

	const refresh = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}
		const { activeOrganization } = await loadOrganizations();
		activeOrganizationId = activeOrganization?.id ?? null;
		const participantData = await loadParticipantFeatureData(activeOrganizationId ?? undefined);
		participants = participantData.participants;
		sentInvitations = participantData.sent;
		receivedInvitations = participantData.received;
		canManage = participantData.canManage;
	};

	const submitCreateParticipantInvitation = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!activeOrganizationId || !canManage) return;
		busy = true;
		try {
			const result = await createParticipantInvitation({
				email: participantInvitationForm.email,
				participantName: participantInvitationForm.participantName,
				organizationId: activeOrganizationId
			});
			if (!result.ok) {
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
		if (!canManage) return;
		busy = true;
		try {
			const result = await createParticipantInvitation({
				email: invitation.email,
				participantName: invitation.participantName,
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
		<h1 class="text-3xl font-semibold text-slate-900">参加者</h1>
		<p class="text-sm text-slate-600">参加者一覧と参加者招待を管理します。</p>
	</header>

	{#if !activeOrganizationId}
		<Card class="surface-panel border-slate-200/80 shadow-lg"><CardContent class="py-6"><p class="text-sm text-muted-foreground">利用中の組織を `/dashboard` で選択してください。</p></CardContent></Card>
	{:else}
		<section class="grid gap-6 xl:grid-cols-[1fr_1fr]">
			<Card class="surface-panel border-slate-200/80 shadow-lg">
				<CardHeader><h2 class="text-xl font-semibold">参加者一覧</h2></CardHeader>
				<CardContent>
					{#if loading}
						<p class="text-sm text-muted-foreground">参加者を読み込み中…</p>
					{:else if participants.length === 0}
						<p class="text-sm text-muted-foreground">参加者はまだ登録されていません。</p>
					{:else}
						<div class="space-y-2">
							{#each participants as participant (participant.id)}
								<div class="rounded-lg border border-slate-200/80 bg-white/80 p-3"><p class="text-sm font-semibold">{participant.name}</p><p class="text-xs text-muted-foreground">{participant.email}</p></div>
							{/each}
						</div>
					{/if}
				</CardContent>
			</Card>

			<Card class="surface-panel border-slate-200/80 shadow-lg">
				<CardHeader><h2 class="text-xl font-semibold">参加者招待管理</h2><CardDescription>作成・再送・取消・受信招待の処理。</CardDescription></CardHeader>
				<CardContent class="space-y-4">
					{#if !canManage}
						<p class="text-sm text-muted-foreground">参加者招待の管理には admin または owner 権限が必要です。</p>
					{:else}
						<form class="space-y-3 rounded-lg border border-slate-200/80 bg-white/80 p-4" onsubmit={submitCreateParticipantInvitation}>
							<h3 class="text-sm font-semibold">参加者招待を送信</h3>
							<div class="space-y-2"><Label for="participant-email">メールアドレス</Label><Input id="participant-email" name="participant_email" type="email" bind:value={participantInvitationForm.email} required spellcheck={false} /></div>
							<div class="space-y-2"><Label for="participant-name">参加者名</Label><Input id="participant-name" name="participant_name" type="text" bind:value={participantInvitationForm.participantName} required /></div>
							<Button type="submit" disabled={busy}>送信</Button>
						</form>
					{/if}

					<div class="space-y-2">
						<h3 class="text-sm font-semibold">送信済み参加者招待</h3>
						{#if sentInvitations.length === 0}
							<p class="text-sm text-muted-foreground">送信済み参加者招待はありません。</p>
						{:else}
							<div class="space-y-2">
								{#each sentInvitations as invitation (invitation.id)}
									<div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white/80 p-3">
										<div><p class="text-sm font-semibold">{invitation.participantName}</p><p class="text-xs text-muted-foreground">{invitation.email}</p></div>
										<div class="flex items-center gap-2">
											<Badge variant={invitation.status === 'pending' ? 'outline' : 'secondary'}>{invitation.status}</Badge>
											<Button type="button" variant="outline" onclick={() => submitResendParticipantInvitation(invitation)} disabled={busy || invitation.status !== 'pending' || !canManage}>再送</Button>
											<Button type="button" variant="destructive" onclick={() => submitAction('cancel', invitation.id)} disabled={busy || invitation.status !== 'pending' || !canManage}>取り消し</Button>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>

					<div class="space-y-2">
						<h3 class="text-sm font-semibold">受信した参加者招待</h3>
						{#if receivedInvitations.length === 0}
							<p class="text-sm text-muted-foreground">受信した参加者招待はありません。</p>
						{:else}
							<div class="space-y-2">
								{#each receivedInvitations as invitation (invitation.id)}
									<div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white/80 p-3">
										<div><p class="text-sm font-semibold">{invitation.participantName}</p><p class="text-xs text-muted-foreground">{invitation.organizationName ?? invitation.organizationId} / {invitation.status}</p></div>
										<div class="flex items-center gap-2"><Button type="button" variant="secondary" onclick={() => submitAction('accept', invitation.id)} disabled={busy || invitation.status !== 'pending'}>承諾</Button><Button type="button" variant="outline" onclick={() => submitAction('reject', invitation.id)} disabled={busy || invitation.status !== 'pending'}>辞退</Button></div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</CardContent>
			</Card>
		</section>
	{/if}
</main>
