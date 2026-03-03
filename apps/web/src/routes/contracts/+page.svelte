<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { getCurrentPathWithSearch, loadSession, redirectToLoginWithNext } from '$lib/features/auth-session.svelte';
	import { loadOrganizations } from '$lib/features/organization-context.svelte';
	import type { OrganizationPayload } from '$lib/rpc-client';

	let loading = $state(true);
	let activeOrganization = $state<OrganizationPayload | null>(null);

	const activeOrganizationLabel = $derived(
		activeOrganization?.name ?? activeOrganization?.id ?? '選択されていません'
	);
	const pathname = $derived(page.url.pathname);

	onMount(() => {
		void (async () => {
			if (pathname === '/contracts') {
				await goto(resolve('/admin/contracts'));
				return;
			}
			loading = true;
			try {
				const { session } = await loadSession();
				if (!session) {
					redirectToLoginWithNext(getCurrentPathWithSearch());
					return;
				}
				const { activeOrganization: nextActiveOrganization } = await loadOrganizations();
				activeOrganization = nextActiveOrganization;
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold text-slate-900">契約</h1>
		<p class="text-sm text-slate-600">契約・プラン情報を確認できます。</p>
	</header>

	<section class="grid gap-4 md:grid-cols-2">
		<Card class="surface-panel border-slate-200/80 shadow-md">
			<CardHeader>
				<h2 class="text-sm font-semibold text-slate-700">利用中の組織</h2>
			</CardHeader>
			<CardContent>
				{#if loading}
					<p class="text-sm text-muted-foreground">確認中…</p>
				{:else}
					<p class="text-lg font-semibold text-slate-900">{activeOrganizationLabel}</p>
				{/if}
			</CardContent>
		</Card>

		<Card class="surface-panel border-slate-200/80 shadow-md">
			<CardHeader>
				<h2 class="text-sm font-semibold text-slate-700">現在プラン</h2>
			</CardHeader>
			<CardContent class="space-y-2">
				<Badge variant="outline">契約機能は次フェーズで拡張予定</Badge>
				<p class="text-sm text-slate-700">現在は閲覧専用です。プラン変更、請求履歴、支払設定は未実装です。</p>
			</CardContent>
		</Card>
	</section>

	<section>
		<Card class="surface-panel border-slate-200/80 shadow-lg">
			<CardHeader>
				<h2 class="text-xl font-semibold text-slate-900">今後追加予定</h2>
				<CardDescription>契約と課金機能はこのページに段階的に集約します。</CardDescription>
			</CardHeader>
			<CardContent>
				<ul class="list-disc space-y-2 pl-5 text-sm text-slate-700">
					<li>プラン変更</li>
					<li>請求履歴</li>
					<li>支払方法管理</li>
				</ul>
			</CardContent>
		</Card>
	</section>
</main>
