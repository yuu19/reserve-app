	<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardHeader } from '$lib/components/ui/card';
	import { getCurrentPathWithSearch, loadSession, redirectToLoginWithNext } from '$lib/features/auth-session.svelte';
	import { loadOrganizations } from '$lib/features/organization-context.svelte';
	import { loadParticipantFeatureData } from '$lib/features/invitations-participant.svelte';
	import type { OrganizationPayload } from '$lib/rpc-client';

	let loading = $state(true);
	let activeOrganization = $state<OrganizationPayload | null>(null);
	let participantCount = $state(0);
	let pendingParticipantInviteCount = $state(0);

	const activeOrganizationLabel = $derived(
		activeOrganization?.name ?? activeOrganization?.id ?? '選択されていません'
	);

	const refreshDashboard = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}
		const { activeOrganization: nextActiveOrganization } = await loadOrganizations();
		activeOrganization = nextActiveOrganization;

		if (nextActiveOrganization?.id) {
			const participantData = await loadParticipantFeatureData(nextActiveOrganization.id);
			participantCount = participantData.participants.length;
			pendingParticipantInviteCount = participantData.sent.filter((inv) => inv.status === 'pending').length;
		} else {
			participantCount = 0;
			pendingParticipantInviteCount = 0;
		}
	};

	onMount(() => {
		void (async () => {
			loading = true;
			try {
				await refreshDashboard();
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold text-slate-900">ダッシュボード</h1>
		<p class="text-sm text-slate-600">運用状況のサマリーを確認します。組織設定は設定ページで行います。</p>
	</header>

	<section class="grid gap-4 md:grid-cols-3">
		<Card class="surface-panel border-slate-200/80 shadow-md">
			<CardHeader><h2 class="text-sm font-semibold text-slate-700">現在の利用中組織</h2></CardHeader>
			<CardContent>
				{#if loading}
					<p class="text-sm text-muted-foreground">確認中…</p>
				{:else}
					<p class="text-lg font-semibold text-slate-900">{activeOrganizationLabel}</p>
				{/if}
			</CardContent>
		</Card>
		<Card class="surface-panel border-slate-200/80 shadow-md">
			<CardHeader><h2 class="text-sm font-semibold text-slate-700">参加者数</h2></CardHeader>
			<CardContent><p class="metric-value text-3xl font-semibold text-slate-900">{participantCount}</p></CardContent>
		</Card>
		<Card class="surface-panel border-slate-200/80 shadow-md">
			<CardHeader><h2 class="text-sm font-semibold text-slate-700">保留中の参加者招待</h2></CardHeader>
			<CardContent><p class="metric-value text-3xl font-semibold text-slate-900">{pendingParticipantInviteCount}</p></CardContent>
		</Card>
	</section>

	<section class="flex flex-wrap gap-2">
		<Button type="button" onclick={() => goto(resolve('/settings'))}>設定へ移動</Button>
		<Button type="button" variant="outline" onclick={() => goto(resolve('/bookings'))}>予約へ移動</Button>
		<Button type="button" variant="outline" onclick={() => goto(resolve('/participants'))}>参加者へ移動</Button>
		<Button type="button" variant="outline" onclick={() => goto(resolve('/admin-invitations'))}
			>管理者招待へ移動</Button
		>
	</section>
</main>
