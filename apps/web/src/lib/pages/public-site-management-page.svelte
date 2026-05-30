<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import {
		buildScopedPath,
		extractScopedRouteContext,
		getRoutePathFromUrlPath,
		preserveScopedRouteContext
	} from '$lib/features/scoped-routing';
	import {
		getCurrentPathWithSearch,
		loadPortalAccess,
		loadSession,
		redirectToLoginWithNext,
		resolvePortalHomePath
	} from '$lib/features/auth-session.svelte';
	import { loadPublicSiteSettings } from '$lib/features/public-site.svelte';
	import type { PublicSiteProfilePayload } from '$lib/rpc-client';

	type ResolvablePath = Pathname;

	let loading = $state(true);
	let publicSite = $state<PublicSiteProfilePayload | null>(null);
	let errorMessage = $state<string | null>(null);

	const pathname = $derived(getRoutePathFromUrlPath(page.url.pathname));
	const scopedContext = $derived(extractScopedRouteContext(page.url.pathname));
	const publicSitePath = $derived(scopedContext ? buildScopedPath(scopedContext, '/') : null);
	const publicEventsPath = $derived(
		scopedContext ? buildScopedPath(scopedContext, '/events') : null
	);
	const publicSiteCreatePath = $derived(
		scopedContext
			? buildScopedPath(scopedContext, '/admin/public-site/new')
			: '/admin/public-site/new'
	);
	const toScopedRoute = (targetPath: string): ResolvablePath =>
		preserveScopedRouteContext(targetPath, page.url.pathname) as ResolvablePath;

	const displayValue = (value: string | null | undefined): string => value?.trim() || '-';
	const publicSiteStatusLabel = (status: PublicSiteProfilePayload['status']): string => {
		if (status === 'public') {
			return '公開';
		}
		if (status === 'suspended') {
			return '停止中';
		}
		return '非公開';
	};

	const refreshPublicSite = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}

		const portalAccess = await loadPortalAccess();
		if (!portalAccess.hasOrganizationAdminAccess) {
			await goto(resolve(resolvePortalHomePath(portalAccess) ?? '/participant/home'));
			return;
		}

		if (!scopedContext) {
			publicSite = null;
			return;
		}

		publicSite = await loadPublicSiteSettings(scopedContext);
		if (!publicSite) {
			errorMessage = '予約サイト情報の取得に失敗しました。';
		}
	};

	onMount(() => {
		void (async () => {
			loading = true;
			errorMessage = null;
			try {
				if (pathname === '/public-site') {
					await goto(resolve(toScopedRoute('/admin/public-site')));
					return;
				}
				await refreshPublicSite();
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold text-foreground">予約サイト管理</h1>
		<p class="text-sm text-muted-foreground">
			店舗ごとの公開予約サイトを確認し、作成・編集ページへ移動できます。
		</p>
	</header>

	{#if loading}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">予約サイト情報を読み込み中…</p>
			</CardContent>
		</Card>
	{:else if !scopedContext}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardHeader>
				<h2 class="text-xl font-semibold text-foreground">店舗を選択してください</h2>
				<CardDescription>予約サイトは店舗ごとに管理します。</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<p class="text-sm text-muted-foreground">
					店舗を選択した管理画面から予約サイトを作成・編集できます。
				</p>
				<Button type="button" variant="outline" href={resolve(toScopedRoute('/admin/stores'))}>
					店舗管理へ移動
				</Button>
			</CardContent>
		</Card>
	{:else if errorMessage}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-destructive">{errorMessage}</p>
			</CardContent>
		</Card>
	{:else if publicSite}
		<section class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.72fr)]">
			<Card class="surface-panel border-border/80 shadow-lg">
				<CardHeader class="space-y-2">
					<h2 class="text-xl font-semibold text-foreground">公開情報</h2>
					<CardDescription>予約者に表示される店舗サイト情報です。</CardDescription>
				</CardHeader>
				<CardContent class="space-y-5">
					<div class="grid gap-4 md:grid-cols-2">
						<div class="space-y-1 md:col-span-2">
							<p class="text-xs text-muted-foreground">サイト名</p>
							<p class="text-lg font-semibold text-foreground">{publicSite.siteName}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">組織</p>
							<p class="text-sm text-foreground">{publicSite.organizationName}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">店舗</p>
							<p class="text-sm text-foreground">{publicSite.storeName}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">公開状態</p>
							<p class="text-sm text-foreground">{publicSiteStatusLabel(publicSite.status)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">予約受付</p>
							<p class="text-sm text-foreground">
								{publicSite.acceptBookings ? '受付中' : '停止中'}
							</p>
						</div>
						<div class="space-y-1 md:col-span-2">
							<p class="text-xs text-muted-foreground">検索除外</p>
							<p class="text-sm text-foreground">
								{publicSite.noindex ? '検索エンジンに掲載しない' : '検索エンジン掲載を許可'}
							</p>
						</div>
						<div class="space-y-1 md:col-span-2">
							<p class="text-xs text-muted-foreground">説明</p>
							<p class="whitespace-pre-line text-sm text-foreground">
								{displayValue(publicSite.description)}
							</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">住所</p>
							<p class="text-sm text-foreground">{displayValue(publicSite.address)}</p>
						</div>
						<div class="space-y-1">
							<p class="text-xs text-muted-foreground">電話番号</p>
							<p class="text-sm text-foreground">{displayValue(publicSite.phone)}</p>
						</div>
						<div class="space-y-1 md:col-span-2">
							<p class="text-xs text-muted-foreground">営業時間</p>
							<p class="whitespace-pre-line text-sm text-foreground">
								{displayValue(publicSite.businessHours)}
							</p>
						</div>
					</div>

					<div class="flex flex-wrap gap-2">
						<Button type="button" href={resolve(publicSiteCreatePath as ResolvablePath)}>
							予約サイトを作成・編集
						</Button>
						<Button
							type="button"
							variant="outline"
							href={publicSitePath ? resolve(publicSitePath as ResolvablePath) : undefined}
							disabled={!publicSitePath}
						>
							公開ページを開く
						</Button>
						<Button
							type="button"
							variant="outline"
							href={publicEventsPath ? resolve(publicEventsPath as ResolvablePath) : undefined}
							disabled={!publicEventsPath}
						>
							予約ページ一覧を開く
						</Button>
					</div>
				</CardContent>
			</Card>

			<Card class="surface-panel border-border/80 shadow-lg">
				<CardHeader>
					<h2 class="text-lg font-semibold text-foreground">メイン画像</h2>
				</CardHeader>
				<CardContent>
					{#if publicSite.imageUrl}
						<div class="overflow-hidden rounded-md border border-border/80 bg-secondary/50">
							<img
								src={publicSite.imageUrl}
								alt={`${publicSite.siteName} の画像`}
								class="h-64 w-full object-cover"
							/>
						</div>
					{:else}
						<div class="rounded-md border border-border/80 bg-secondary/60 p-4">
							<p class="text-sm text-muted-foreground">メイン画像は未設定です。</p>
						</div>
					{/if}
				</CardContent>
			</Card>
		</section>
	{/if}
</main>
