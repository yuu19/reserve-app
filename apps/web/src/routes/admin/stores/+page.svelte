<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import PremiumRestrictionNotice from '$lib/components/premium-restriction-notice.svelte';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import {
		createStore,
		listStoresByOrgSlug,
		loadOrganizationBilling,
		loadOrganizations,
		updateStore,
		type StoreContextPayload
	} from '$lib/features/organization-context.svelte';
	import {
		getCurrentPathWithSearch,
		loadPortalAccess,
		loadSession,
		redirectToLoginWithNext,
		resolvePortalHomePath
	} from '$lib/features/auth-session.svelte';
	import {
		createSlugCandidate,
		createUniqueSlugCandidate,
		normalizeSlug,
		SLUG_INPUT_HINT,
		SLUG_PATTERN_ATTRIBUTE
	} from '$lib/features/slug';
	import type { OrganizationBillingPayload, OrganizationPayload } from '$lib/rpc-client';
	import type { OrganizationPremiumRestrictionPayload } from '$lib/features/premium-restrictions';
	import { toast } from 'svelte-sonner';

	let loading = $state(true);
	let busy = $state(false);
	let activeOrganization = $state<OrganizationPayload | null>(null);
	let activeStore = $state<StoreContextPayload | null>(null);
	let stores = $state<StoreContextPayload[]>([]);
	let canManageOrganization = $state(false);
	let billing = $state<OrganizationBillingPayload | null>(null);
	let premiumRestriction = $state<OrganizationPremiumRestrictionPayload | null>(null);
	let createForm = $state({ name: '', slug: '' });
	let createSlugManuallyEdited = $state(false);
	let editDialogOpen = $state(false);
	let slugChangeDialogOpen = $state(false);
	let editTarget = $state<StoreContextPayload | null>(null);
	let editForm = $state({ name: '', slug: '' });

	const roleLabelMap = {
		manager: 'manager',
		staff: 'staff',
		participant: 'participant'
	} as const;

	const resolveStoreRoleLabel = (store: StoreContextPayload) => {
		const primaryRole = store.display.primaryRole;
		if (primaryRole === 'manager' || primaryRole === 'staff' || primaryRole === 'participant') {
			return roleLabelMap[primaryRole];
		}
		return null;
	};

	const storeSlugs = () => stores.map((store) => store.slug);

	const updateCreateName = (event: Event) => {
		const name = (event.currentTarget as HTMLInputElement).value;
		createForm.name = name;
		if (!createSlugManuallyEdited) {
			createForm.slug = createUniqueSlugCandidate({
				value: name,
				fallback: 'store',
				existingSlugs: storeSlugs()
			});
		}
	};

	const updateCreateSlug = (event: Event) => {
		createSlugManuallyEdited = true;
		createForm.slug = normalizeSlug((event.currentTarget as HTMLInputElement).value);
	};

	const updateEditName = (event: Event) => {
		editForm.name = (event.currentTarget as HTMLInputElement).value;
	};

	const updateEditSlug = (event: Event) => {
		editForm.slug = normalizeSlug((event.currentTarget as HTMLInputElement).value);
	};

	const refresh = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}

		const [{ activeOrganization: nextOrganization, activeStore: nextStore }, portalAccess] =
			await Promise.all([loadOrganizations(), loadPortalAccess()]);

		activeOrganization = nextOrganization;
		activeStore = nextStore;
		canManageOrganization = portalAccess.hasOrganizationAdminAccess;
		billing = null;
		premiumRestriction = null;
		if (!portalAccess.hasOrganizationAdminAccess) {
			stores = [];
			await goto(resolve(resolvePortalHomePath(portalAccess) ?? '/participant/home'));
			return;
		}

		if (!nextOrganization?.slug) {
			stores = [];
			return;
		}

		stores = await listStoresByOrgSlug(nextOrganization.slug);
	};

	const submitCreateStore = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!activeOrganization?.slug || !canManageOrganization) {
			return;
		}

		busy = true;
		try {
			const result = await createStore(activeOrganization.slug, {
				name: createForm.name,
				slug: createForm.slug
					? normalizeSlug(createForm.slug)
					: createUniqueSlugCandidate({
							value: createForm.name,
							fallback: 'store',
							existingSlugs: storeSlugs()
						})
			});
			if (!result.ok) {
				if (result.premiumRestriction) {
					premiumRestriction = result.premiumRestriction;
					const billingResult = await loadOrganizationBilling(activeOrganization.id);
					billing = billingResult.ok ? billingResult.billing : null;
				}
				toast.error(result.message);
				return;
			}

			toast.success(result.message);
			createForm = { name: '', slug: '' };
			createSlugManuallyEdited = false;
			await refresh();
		} finally {
			busy = false;
		}
	};

	const openEditDialog = (store: StoreContextPayload) => {
		editTarget = store;
		editForm = {
			name: store.name,
			slug: store.slug
		};
		slugChangeDialogOpen = false;
		editDialogOpen = true;
	};

	const submitUpdateStore = async (event: SubmitEvent) => {
		event.preventDefault();
		await submitUpdateStoreForm(false);
	};

	const submitUpdateStoreForm = async (slugChangeConfirmed: boolean) => {
		if (!activeOrganization?.slug || !editTarget || !canManageOrganization) {
			return;
		}

		const nextSlug = createSlugCandidate(editForm.slug || editForm.name, 'store');
		editForm.slug = nextSlug;
		if (nextSlug !== editTarget.slug && !slugChangeConfirmed) {
			slugChangeDialogOpen = true;
			return;
		}

		busy = true;
		try {
			const result = await updateStore(activeOrganization.slug, editTarget.slug, {
				name: editForm.name,
				slug: nextSlug
			});
			if (!result.ok || !result.store) {
				if (result.premiumRestriction) {
					premiumRestriction = result.premiumRestriction;
					const billingResult = await loadOrganizationBilling(activeOrganization.id);
					billing = billingResult.ok ? billingResult.billing : null;
				}
				toast.error(result.message);
				return;
			}

			toast.success(result.message);
			editDialogOpen = false;
			slugChangeDialogOpen = false;

			if (activeStore?.slug === editTarget.slug) {
				await goto(
					resolve('/[orgSlug]/[storeSlug]/admin/stores', {
						orgSlug: activeOrganization.slug,
						storeSlug: result.store.slug
					}),
					{ invalidateAll: true }
				);
				return;
			}

			await refresh();
		} finally {
			busy = false;
		}
	};

	const openStore = async (storeSlug: string) => {
		if (!activeOrganization?.slug) {
			return;
		}
		await goto(
			resolve('/[orgSlug]/[storeSlug]/admin/stores', {
				orgSlug: activeOrganization.slug,
				storeSlug
			}),
			{ invalidateAll: true }
		);
	};

	const openStoreInvitations = async (storeSlug: string) => {
		if (!activeOrganization?.slug) {
			return;
		}
		await goto(
			resolve('/[orgSlug]/[storeSlug]/admin/invitations', {
				orgSlug: activeOrganization.slug,
				storeSlug
			})
		);
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
		<h1 class="text-3xl font-semibold text-foreground">店舗管理</h1>
		<p class="text-sm text-muted-foreground">
			店舗の作成、名称・URL識別子の更新、店舗ごとの管理導線への遷移を行います。
		</p>
	</header>

	{#if premiumRestriction}
		<PremiumRestrictionNotice
			featureLabel="複数店舗管理"
			restriction={premiumRestriction}
			{billing}
		/>
	{/if}

	{#if loading}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">店舗情報を読み込み中…</p>
			</CardContent>
		</Card>
	{:else if !activeOrganization}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">利用中の組織を選択してください。</p>
			</CardContent>
		</Card>
	{:else}
		<section class="grid gap-6 xl:grid-cols-[360px_1fr]">
			<Card class="surface-panel border-border/80 shadow-lg">
				<CardHeader class="space-y-2">
					<h2 class="text-xl font-semibold text-foreground">店舗を作成</h2>
					<CardDescription>
						対象組織: <span class="font-medium text-foreground">{activeOrganization.name}</span>
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if !canManageOrganization}
						<p class="text-sm text-muted-foreground">
							店舗の作成と設定更新は owner / admin のみ実行できます。
						</p>
					{:else}
						<form
							class="space-y-4 rounded-lg border border-border/80 bg-card/80 p-4"
							onsubmit={submitCreateStore}
						>
							<div class="space-y-2">
								<Label for="store-name">店舗名</Label>
								<Input
									id="store-name"
									name="store_name"
									value={createForm.name}
									oninput={updateCreateName}
									maxlength={120}
									required
									disabled={busy}
								/>
							</div>
							<div class="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
								URL識別子:
								<code class="font-mono text-foreground">
									{createForm.slug || '店舗名から自動生成'}
								</code>
							</div>
							<details class="rounded-md border border-border/80 bg-card/80 px-3 py-2">
								<summary class="cursor-pointer text-sm font-medium text-foreground">
									URL識別子を編集
								</summary>
								<div class="mt-3 space-y-2">
									<Label for="store-slug">店舗のURL識別子</Label>
									<Input
										id="store-slug"
										name="store_slug"
										value={createForm.slug}
										oninput={updateCreateSlug}
										pattern={SLUG_PATTERN_ATTRIBUTE}
										title={SLUG_INPUT_HINT}
										autocomplete="off"
										maxlength={120}
										disabled={busy}
									/>
									<p class="text-xs text-muted-foreground">{SLUG_INPUT_HINT}</p>
								</div>
							</details>
							<Button type="submit" disabled={busy}>店舗を作成</Button>
						</form>
					{/if}
				</CardContent>
			</Card>

			<Card class="surface-panel border-border/80 shadow-lg">
				<CardHeader class="space-y-2">
					<h2 class="text-xl font-semibold text-foreground">店舗一覧</h2>
					<CardDescription>現在アクセス可能な店舗と、その管理導線です。</CardDescription>
				</CardHeader>
				<CardContent class="space-y-3">
					{#if stores.length === 0}
						<p class="text-sm text-muted-foreground">表示できる店舗はまだありません。</p>
					{:else}
						<div class="space-y-3">
							{#each stores as store (store.id)}
								{@const storeRoleLabel = resolveStoreRoleLabel(store)}
								<div class="rounded-lg border border-border/80 bg-card/80 p-4">
									<div class="flex flex-wrap items-start justify-between gap-3">
										<div class="space-y-2">
											<div class="flex flex-wrap items-center gap-2">
												<p class="text-base font-semibold text-foreground">{store.name}</p>
												{#if store.slug === activeStore?.slug}
													<Badge variant="default">利用中</Badge>
												{/if}
												{#if storeRoleLabel}
													<Badge variant="outline">{storeRoleLabel}</Badge>
												{/if}
											</div>
											<p class="text-xs text-muted-foreground">
												URL識別子: {store.slug}
											</p>
										</div>
										<div class="flex flex-wrap gap-2">
											<Button
												type="button"
												variant="secondary"
												onclick={() => openStore(store.slug)}
											>
												この店舗を開く
											</Button>
											<Button
												type="button"
												variant="outline"
												onclick={() => openStoreInvitations(store.slug)}
											>
												招待管理
											</Button>
											<Button
												type="button"
												variant="outline"
												onclick={() => openEditDialog(store)}
												disabled={!canManageOrganization}
											>
												編集
											</Button>
										</div>
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

<Dialog bind:open={editDialogOpen}>
	<DialogContent aria-describedby="store-edit-description" class="sm:max-w-lg">
		<DialogHeader>
			<DialogTitle>店舗を編集</DialogTitle>
			<DialogDescription id="store-edit-description">
				店舗名を更新します。URL識別子を変更すると、この店舗のURLも変わります。
			</DialogDescription>
		</DialogHeader>
		{#if editTarget}
			<form class="space-y-4" onsubmit={submitUpdateStore}>
				<div class="space-y-2">
					<Label for="edit-store-name">店舗名</Label>
					<Input
						id="edit-store-name"
						name="edit_store_name"
						value={editForm.name}
						oninput={updateEditName}
						maxlength={120}
						required
						disabled={busy}
					/>
				</div>
				<div class="space-y-2">
					<Label for="edit-store-slug">店舗のURL識別子</Label>
					<Input
						id="edit-store-slug"
						name="edit_store_slug"
						value={editForm.slug}
						oninput={updateEditSlug}
						pattern={SLUG_PATTERN_ATTRIBUTE}
						title={SLUG_INPUT_HINT}
						autocomplete="off"
						maxlength={120}
						required
						disabled={busy}
					/>
					<p class="text-xs text-muted-foreground">{SLUG_INPUT_HINT}</p>
					{#if editTarget && editForm.slug !== editTarget.slug}
						<p class="text-xs text-destructive">
							保存時に確認が必要です。既存のURLや共有済みリンクに影響します。
						</p>
					{/if}
				</div>
				<DialogFooter>
					<Button
						type="button"
						variant="ghost"
						onclick={() => (editDialogOpen = false)}
						disabled={busy}
					>
						閉じる
					</Button>
					<Button type="submit" disabled={busy}>保存</Button>
				</DialogFooter>
			</form>
		{/if}
	</DialogContent>
</Dialog>

<Dialog bind:open={slugChangeDialogOpen}>
	<DialogContent aria-describedby="store-slug-change-description" class="sm:max-w-lg">
		<DialogHeader>
			<DialogTitle>URL識別子を変更しますか</DialogTitle>
			<DialogDescription id="store-slug-change-description">
				{editTarget?.name} のURLが
				<code class="font-mono">{editTarget?.slug}</code>
				から
				<code class="font-mono">{editForm.slug}</code>
				に変わります。共有済みのURLが使えなくなる可能性があります。
			</DialogDescription>
		</DialogHeader>
		<DialogFooter>
			<Button
				type="button"
				variant="ghost"
				onclick={() => (slugChangeDialogOpen = false)}
				disabled={busy}
			>
				戻る
			</Button>
			<Button
				type="button"
				variant="destructive"
				onclick={() => void submitUpdateStoreForm(true)}
				disabled={busy}
			>
				URL識別子を変更して保存
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
