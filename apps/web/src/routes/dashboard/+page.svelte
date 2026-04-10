<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardHeader } from '$lib/components/ui/card';
	import {
		extractScopedRouteContext,
		getRoutePathFromUrlPath,
		replacePortalPathWithScopedContext
	} from '$lib/features/scoped-routing';
	import OrganizationLogo from '$lib/components/organization-logo.svelte';
	import {
		getCurrentPathWithSearch,
		loadPortalAccess,
		loadSession,
		resolvePortalHomePath,
		redirectToLoginWithNext
	} from '$lib/features/auth-session.svelte';
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
	const pathname = $derived(getRoutePathFromUrlPath(page.url.pathname));
	const resolveDashboardTarget = (targetPath: string): string => {
		const scopedContext = extractScopedRouteContext(page.url.pathname);
		return scopedContext
			? replacePortalPathWithScopedContext(targetPath, scopedContext)
			: targetPath;
	};
	const toResolvablePath = (targetPath: string): Pathname =>
		resolveDashboardTarget(targetPath) as Pathname;

	const refreshDashboard = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}
		const { activeOrganization: nextActiveOrganization } = await loadOrganizations();
		activeOrganization = nextActiveOrganization;

		if (nextActiveOrganization?.id) {
			const participantData = await loadParticipantFeatureData();
			participantCount = participantData.participants.length;
			pendingParticipantInviteCount = participantData.sent.filter(
				(inv) => inv.status === 'pending'
			).length;
		} else {
			participantCount = 0;
			pendingParticipantInviteCount = 0;
		}
	};

	onMount(() => {
		void (async () => {
			const { session } = await loadSession();
			if (!session) {
				redirectToLoginWithNext(getCurrentPathWithSearch());
				return;
			}

			const portalAccess = await loadPortalAccess();
			const homePath = resolvePortalHomePath(portalAccess) ?? '/participant/home';

			if (pathname === '/dashboard') {
				await goto(resolve(homePath));
				return;
			}
			if (pathname.startsWith('/admin') && homePath !== '/admin/dashboard') {
				await goto(resolve(homePath));
				return;
			}

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
		<h1 class="text-3xl font-semibold text-foreground">ダッシュボード</h1>
		<p class="text-sm text-muted-foreground">
			運用状況のサマリーを確認し、管理者向け・参加者向けの画面へ移動できます。
		</p>
	</header>

	<section class="grid gap-4 md:grid-cols-3">
		<Card class="surface-panel border-border/80 shadow-md">
			<CardHeader
				><h2 class="text-sm font-semibold text-secondary-foreground">
					現在の利用中組織
				</h2></CardHeader
			>
			<CardContent>
				{#if loading}
					<p class="text-sm text-muted-foreground">確認中…</p>
				{:else if activeOrganization}
					<div class="flex min-w-0 items-center gap-3">
						<OrganizationLogo
							name={activeOrganization.name}
							logo={activeOrganization.logo}
							size="lg"
						/>
						<p class="truncate text-lg font-semibold text-foreground">{activeOrganization.name}</p>
					</div>
				{:else}
					<p class="text-lg font-semibold text-foreground">{activeOrganizationLabel}</p>
				{/if}
			</CardContent>
		</Card>
		<Card class="surface-panel border-border/80 shadow-md">
			<CardHeader
				><h2 class="text-sm font-semibold text-secondary-foreground">参加者数</h2></CardHeader
			>
			<CardContent
				><p class="metric-value text-3xl font-semibold text-foreground">
					{participantCount}
				</p></CardContent
			>
		</Card>
		<Card class="surface-panel border-border/80 shadow-md">
			<CardHeader
				><h2 class="text-sm font-semibold text-secondary-foreground">
					保留中の参加者招待
				</h2></CardHeader
			>
			<CardContent
				><p class="metric-value text-3xl font-semibold text-foreground">
					{pendingParticipantInviteCount}
				</p></CardContent
			>
		</Card>
	</section>

	<section class="grid gap-4 lg:grid-cols-2">
		<Card class="surface-panel border-border/80 shadow-md">
			<CardHeader class="space-y-1">
				<h2 class="text-xl font-semibold text-foreground">管理者向け</h2>
				<p class="text-sm text-muted-foreground">
					組織運用・予約管理・招待管理など、管理権限が必要な操作をまとめています。
				</p>
			</CardHeader>
			<CardContent class="space-y-3">
				<div class="flex flex-wrap gap-2">
					<Button type="button" onclick={() => goto(resolve(toResolvablePath('/admin/settings')))}
						>設定へ移動</Button
					>
					<Button
						type="button"
						variant="outline"
						onclick={() => goto(resolve(toResolvablePath('/admin/classrooms')))}
						>教室管理へ移動</Button
					>
					<Button
						type="button"
						variant="outline"
						onclick={() => goto(resolve(toResolvablePath('/admin/bookings')))}
						>予約運用へ移動</Button
					>
					<Button
						type="button"
						variant="outline"
						onclick={() => goto(resolve(toResolvablePath('/admin/services')))}
						>サービス一覧へ移動</Button
					>
					<Button
						type="button"
						variant="outline"
						onclick={() => goto(resolve(toResolvablePath('/admin/schedules/slots')))}
						>単発一覧へ移動</Button
					>
					<Button
						type="button"
						variant="outline"
						onclick={() => goto(resolve(toResolvablePath('/admin/schedules/recurring')))}
						>定期一覧へ移動</Button
					>
					<Button
						type="button"
						variant="outline"
						onclick={() => goto(resolve(toResolvablePath('/admin/participants')))}
						>参加者へ移動</Button
					>
					<Button
						type="button"
						variant="outline"
						onclick={() => goto(resolve(toResolvablePath('/admin/invitations')))}
						>管理者招待へ移動</Button
					>
				</div>
			</CardContent>
		</Card>

		<Card class="surface-panel border-border/80 shadow-md">
			<CardHeader class="space-y-1">
				<h2 class="text-xl font-semibold text-foreground">参加者向け</h2>
				<p class="text-sm text-muted-foreground">
					公開イベントの確認や予約申込みなど、参加者導線に必要な画面へ移動できます。
				</p>
			</CardHeader>
			<CardContent class="space-y-3">
				<div class="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="outline"
						onclick={() => goto(resolve(toResolvablePath('/events')))}>イベント一覧へ移動</Button
					>
					<Button
						type="button"
						variant="outline"
						onclick={() => goto(resolve(toResolvablePath('/participant/bookings')))}
						>予約確認へ移動</Button
					>
					<Button
						type="button"
						variant="outline"
						onclick={() => goto(resolve(toResolvablePath('/participant/invitations')))}
						>参加者招待へ移動</Button
					>
				</div>
			</CardContent>
		</Card>
	</section>
</main>
