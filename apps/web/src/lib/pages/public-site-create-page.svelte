<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		buildScopedPath,
		extractScopedRouteContext,
		getRoutePathFromUrlPath
	} from '$lib/features/scoped-routing';
	import {
		getCurrentPathWithSearch,
		loadPortalAccess,
		loadSession,
		redirectToLoginWithNext,
		resolvePortalHomePath
	} from '$lib/features/auth-session.svelte';
	import {
		loadPublicSiteSettings,
		updatePublicSiteSettings
	} from '$lib/features/public-site.svelte';
	import { toast } from 'svelte-sonner';

	type ResolvablePath = Pathname;

	type PublicSiteForm = {
		siteName: string;
		description: string;
		address: string;
		phone: string;
		businessHours: string;
		imageUrl: string;
	};

	let loading = $state(true);
	let busy = $state(false);
	let errorMessage = $state<string | null>(null);
	let publicSiteForm = $state<PublicSiteForm>({
		siteName: '',
		description: '',
		address: '',
		phone: '',
		businessHours: '',
		imageUrl: ''
	});

	const pathname = $derived(getRoutePathFromUrlPath(page.url.pathname));
	const scopedContext = $derived(extractScopedRouteContext(page.url.pathname));
	const publicSiteIndexPath = $derived(
		scopedContext ? buildScopedPath(scopedContext, '/admin/public-site') : '/admin/public-site'
	);
	const publicSitePath = $derived(scopedContext ? buildScopedPath(scopedContext, '/') : null);

	const syncPublicSiteForm = (site: {
		siteName?: string | null;
		description?: string | null;
		address?: string | null;
		phone?: string | null;
		businessHours?: string | null;
		imageUrl?: string | null;
	}) => {
		publicSiteForm = {
			siteName: site.siteName ?? '',
			description: site.description ?? '',
			address: site.address ?? '',
			phone: site.phone ?? '',
			businessHours: site.businessHours ?? '',
			imageUrl: site.imageUrl ?? ''
		};
	};

	const updatePublicSiteField = (field: keyof PublicSiteForm, event: Event) => {
		publicSiteForm[field] = (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
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
			return;
		}

		const publicSite = await loadPublicSiteSettings(scopedContext);
		if (publicSite) {
			syncPublicSiteForm(publicSite);
		} else {
			errorMessage = '予約サイト情報の取得に失敗しました。';
		}
	};

	const submitPublicSiteSettings = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!scopedContext) {
			toast.error('店舗を選択した管理画面から予約サイトを作成してください。');
			return;
		}

		busy = true;
		try {
			const result = await updatePublicSiteSettings(scopedContext, publicSiteForm);
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			if (result.publicSite) {
				syncPublicSiteForm(result.publicSite);
			}
			toast.success('予約サイトを保存しました。');
			await goto(resolve(publicSiteIndexPath as ResolvablePath));
		} finally {
			busy = false;
		}
	};

	onMount(() => {
		void (async () => {
			loading = true;
			errorMessage = null;
			try {
				if (pathname === '/public-site/new') {
					await goto(resolve('/admin/public-site/new'));
					return;
				}
				await refreshPublicSite();
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-3">
		<Button type="button" variant="ghost" href={resolve(publicSiteIndexPath as ResolvablePath)}>
			予約サイト管理へ戻る
		</Button>
		<div class="space-y-2">
			<h1 class="text-3xl font-semibold text-foreground">予約サイト作成</h1>
			<p class="text-sm text-muted-foreground">
				店舗ごとの公開予約サイトに表示する基本情報を設定します。
			</p>
		</div>
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
				<CardDescription>予約サイトは店舗ごとに作成します。</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<p class="text-sm text-muted-foreground">
					店舗を選択した管理画面から予約サイト作成ページを開いてください。
				</p>
				<Button type="button" variant="outline" href={resolve('/admin/stores' as ResolvablePath)}>
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
	{:else}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardHeader class="space-y-2">
				<h2 class="text-xl font-semibold text-foreground">公開情報</h2>
				<CardDescription>予約者が最初に見る店舗サイトの内容です。</CardDescription>
			</CardHeader>
			<CardContent>
				<form class="grid gap-4 md:grid-cols-2" onsubmit={submitPublicSiteSettings}>
					<div class="space-y-2 md:col-span-2">
						<Label for="public-site-name">サイト名</Label>
						<Input
							id="public-site-name"
							name="public_site_name"
							type="text"
							value={publicSiteForm.siteName}
							oninput={(event) => updatePublicSiteField('siteName', event)}
							disabled={busy}
							maxlength={120}
							required
						/>
					</div>
					<div class="space-y-2 md:col-span-2">
						<Label for="public-site-description">説明</Label>
						<textarea
							id="public-site-description"
							name="public_site_description"
							class="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
							value={publicSiteForm.description}
							oninput={(event) => updatePublicSiteField('description', event)}
							disabled={busy}
							maxlength={2000}
						></textarea>
					</div>
					<div class="space-y-2">
						<Label for="public-site-address">住所</Label>
						<Input
							id="public-site-address"
							name="public_site_address"
							type="text"
							value={publicSiteForm.address}
							oninput={(event) => updatePublicSiteField('address', event)}
							disabled={busy}
							maxlength={500}
						/>
					</div>
					<div class="space-y-2">
						<Label for="public-site-phone">電話番号</Label>
						<Input
							id="public-site-phone"
							name="public_site_phone"
							type="tel"
							value={publicSiteForm.phone}
							oninput={(event) => updatePublicSiteField('phone', event)}
							disabled={busy}
							maxlength={80}
						/>
					</div>
					<div class="space-y-2 md:col-span-2">
						<Label for="public-site-business-hours">営業時間</Label>
						<textarea
							id="public-site-business-hours"
							name="public_site_business_hours"
							class="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
							value={publicSiteForm.businessHours}
							oninput={(event) => updatePublicSiteField('businessHours', event)}
							disabled={busy}
							maxlength={1000}
						></textarea>
					</div>
					<div class="space-y-2 md:col-span-2">
						<Label for="public-site-image-url">メイン画像URL</Label>
						<Input
							id="public-site-image-url"
							name="public_site_image_url"
							type="url"
							value={publicSiteForm.imageUrl}
							oninput={(event) => updatePublicSiteField('imageUrl', event)}
							disabled={busy}
							maxlength={2048}
						/>
					</div>
					<div class="flex flex-wrap gap-2 md:col-span-2">
						<Button type="submit" disabled={busy}>
							{busy ? '保存中…' : '予約サイトを保存'}
						</Button>
						<Button
							type="button"
							variant="outline"
							href={publicSitePath ? resolve(publicSitePath as ResolvablePath) : undefined}
							disabled={!publicSitePath}
						>
							公開ページを開く
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	{/if}
</main>
