<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import {
		getCurrentPathWithSearch,
		loadPortalAccess,
		loadSession,
		resolvePortalHomePath,
		redirectToLoginWithNext
	} from '$lib/features/auth-session.svelte';
	import {
		extractScopedRouteContext,
		preserveScopedRouteContext,
		replacePortalPathWithScopedContext
	} from '$lib/features/scoped-routing';
	import type { ScopedApiContext } from '$lib/rpc-client';

	let loading = $state(true);
	let canUseParticipantBooking = $state(false);
	let publicEventsPath = $state<Pathname | null>(null);

	const toScopedRoute = (targetPath: string): Pathname =>
		preserveScopedRouteContext(targetPath, page.url.pathname) as Pathname;

	const goToPublicEvents = () => {
		const targetPath = publicEventsPath;
		if (!targetPath) {
			return;
		}
		void goto(resolve(targetPath));
	};

	onMount(() => {
		void (async () => {
			loading = true;
			try {
				const { session } = await loadSession();
				if (!session) {
					redirectToLoginWithNext(getCurrentPathWithSearch());
					return;
				}
				const portalAccess = await loadPortalAccess();
				const publicEventsContext: ScopedApiContext | null =
					portalAccess.activeContext ?? extractScopedRouteContext(page.url.pathname);
				publicEventsPath = publicEventsContext
					? (replacePortalPathWithScopedContext('/events', publicEventsContext) as Pathname)
					: null;
				const homePath = resolvePortalHomePath(portalAccess);
				if (homePath?.startsWith('/admin')) {
					const nextPath = portalAccess.activeContext
						? replacePortalPathWithScopedContext(homePath, portalAccess.activeContext)
						: preserveScopedRouteContext(homePath, page.url.pathname);
					await goto(resolve(nextPath as Pathname));
					return;
				}
				canUseParticipantBooking = portalAccess.canUseParticipantBooking;
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold text-foreground">参加者ホーム</h1>
		<p class="text-sm text-muted-foreground">参加者向けの導線をここから利用します。</p>
	</header>

	<section class="grid gap-4 md:grid-cols-2">
		<Card class="surface-panel border-border/80 shadow-md">
			<CardHeader class="space-y-1">
				<h2 class="text-xl font-semibold text-foreground">イベント・予約</h2>
				<CardDescription>公開イベントの確認と予約画面への移動。</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-wrap gap-2">
				{#if publicEventsPath}
					<Button type="button" variant="outline" onclick={goToPublicEvents}>イベント一覧へ移動</Button>
				{/if}
				<Button
					type="button"
					variant="outline"
					onclick={() => goto(resolve(toScopedRoute('/participant/bookings')))}
					disabled={!canUseParticipantBooking}
				>
					予約確認へ移動
				</Button>
			</CardContent>
		</Card>

		<Card class="surface-panel border-border/80 shadow-md">
			<CardHeader class="space-y-1">
				<h2 class="text-xl font-semibold text-foreground">招待対応</h2>
				<CardDescription>受信した招待の承諾・辞退を行います。</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					onclick={() => goto(resolve(toScopedRoute('/participant/invitations')))}
					>参加者招待へ移動</Button
				>
				<Button
					type="button"
					variant="outline"
					onclick={() => goto(resolve(toScopedRoute('/participant/admin-invitations')))}
				>
					運営招待へ移動
				</Button>
			</CardContent>
		</Card>
	</section>

	{#if loading}
		<p class="text-sm text-muted-foreground">参加者権限を確認しています…</p>
	{:else if !canUseParticipantBooking}
		<p class="text-sm text-muted-foreground">
			この組織で予約申込するには、参加者として所属している必要があります。
		</p>
	{/if}
</main>
