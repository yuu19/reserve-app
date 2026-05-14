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
	import OrganizationLogo from '$lib/components/organization-logo.svelte';
	import { getRoutePathFromUrlPath } from '$lib/features/scoped-routing';
	import {
		createOrganization,
		loadOrganizations,
		setActiveOrganization,
		uploadOrganizationLogo
	} from '$lib/features/organization-context.svelte';
	import {
		createSlugCandidate,
		normalizeSlug,
		SLUG_INPUT_HINT,
		SLUG_PATTERN_ATTRIBUTE
	} from '$lib/features/slug';
	import {
		getCurrentPathWithSearch,
		loadPortalAccess,
		loadSession,
		redirectToLoginWithNext,
		resolvePortalHomePath
	} from '$lib/features/auth-session.svelte';
	import { toast } from 'svelte-sonner';
	import type { OrganizationPayload } from '$lib/rpc-client';

	let loading = $state(true);
	let busy = $state(false);
	let canCreateOrganization = $state(false);
	let organizations = $state<OrganizationPayload[]>([]);
	let activeOrganization = $state<OrganizationPayload | null>(null);
	let organizationForm = $state({ name: '', slug: '' });
	let organizationSlugManuallyEdited = $state(false);
	let organizationLogoFiles = $state<FileList | undefined>(undefined);

	const selectedOrganizationLogoFile = $derived(organizationLogoFiles?.item(0) ?? null);
	const activeOrganizationId = $derived(activeOrganization?.id ?? null);
	const pathname = $derived(getRoutePathFromUrlPath(page.url.pathname));

	const updateOrganizationName = (event: Event) => {
		const name = (event.currentTarget as HTMLInputElement).value;
		organizationForm.name = name;
		if (!organizationSlugManuallyEdited) {
			organizationForm.slug = createSlugCandidate(name, 'organization');
		}
	};

	const updateOrganizationSlug = (event: Event) => {
		organizationSlugManuallyEdited = true;
		organizationForm.slug = normalizeSlug((event.currentTarget as HTMLInputElement).value);
	};

	const refreshSettings = async () => {
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
		canCreateOrganization = portalAccess.activeOrganizationRole === 'owner';
		const { organizations: nextOrganizations, activeOrganization: nextActiveOrganization } =
			await loadOrganizations();
		organizations = nextOrganizations;
		activeOrganization = nextActiveOrganization;
	};

	const submitCreateOrganization = async (event: SubmitEvent) => {
		event.preventDefault();
		busy = true;
		try {
			let logo: string | undefined;
			const logoFile = organizationLogoFiles?.item(0) ?? null;
			if (logoFile) {
				const uploaded = await uploadOrganizationLogo(logoFile);
				if (!uploaded.ok || !uploaded.logoUrl) {
					toast.error(uploaded.message);
					return;
				}
				logo = uploaded.logoUrl;
			}

			const result = await createOrganization({
				name: organizationForm.name,
				slug: createSlugCandidate(organizationForm.slug || organizationForm.name, 'organization'),
				logo
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			organizationForm = { name: '', slug: '' };
			organizationSlugManuallyEdited = false;
			organizationLogoFiles = undefined;
			await refreshSettings();
		} finally {
			busy = false;
		}
	};

	const submitSetActiveOrganization = async (organizationId: string | null) => {
		busy = true;
		try {
			const result = await setActiveOrganization(organizationId);
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refreshSettings();
		} finally {
			busy = false;
		}
	};

	onMount(() => {
		void (async () => {
			loading = true;
			try {
				const portalAccess = await loadPortalAccess();
				if (pathname === '/settings') {
					const nextPath = portalAccess.hasOrganizationAdminAccess
						? '/admin/settings'
						: (resolvePortalHomePath(portalAccess) ?? '/participant/home');
					await goto(resolve(nextPath));
					return;
				}
				await refreshSettings();
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold text-foreground">設定</h1>
		<p class="text-sm text-muted-foreground">組織設定と利用中組織の切り替えを行います。</p>
	</header>

	<section>
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardHeader class="space-y-2">
				<h2 class="text-xl font-semibold text-foreground">組織設定</h2>
				<CardDescription
					>組織の新規作成、利用中組織の切り替え、教室管理への移動を行います。</CardDescription
				>
			</CardHeader>
			<CardContent class="space-y-5">
				<div class="flex flex-wrap gap-2 rounded-lg border border-border/80 bg-card/80 p-4">
					<Button
						type="button"
						variant="secondary"
						onclick={() => goto(resolve('/admin/classrooms'))}>教室管理へ移動</Button
					>
				</div>

				{#if canCreateOrganization}
					<form
						class="space-y-4 rounded-lg border border-border/80 bg-card/80 p-4"
						onsubmit={submitCreateOrganization}
					>
						<h3 class="text-sm font-semibold text-foreground">組織を作成</h3>
						<div class="space-y-2">
							<Label for="organization-name">組織名</Label>
							<Input
								id="organization-name"
								name="organization_name"
								type="text"
								required
								value={organizationForm.name}
								oninput={updateOrganizationName}
								disabled={busy}
							/>
						</div>
						<details class="rounded-md border border-border/80 bg-card/80 px-3 py-2">
							<summary class="cursor-pointer text-sm font-medium text-foreground">
								URL識別子を編集
							</summary>
							<div class="mt-3 space-y-2">
								<Label for="organization-slug">組織のURL識別子</Label>
								<Input
									id="organization-slug"
									name="organization_slug"
									type="text"
									value={organizationForm.slug}
									oninput={updateOrganizationSlug}
									pattern={SLUG_PATTERN_ATTRIBUTE}
									title={SLUG_INPUT_HINT}
									autocomplete="off"
									disabled={busy}
								/>
								<p class="text-xs text-muted-foreground">{SLUG_INPUT_HINT}</p>
							</div>
						</details>
						<div class="space-y-2">
							<Label for="organization-logo">ロゴ画像 (任意)</Label>
							<Input
								id="organization-logo"
								name="organization_logo"
								type="file"
								bind:files={organizationLogoFiles}
								disabled={busy}
							/>
							{#if selectedOrganizationLogoFile}
								<p class="text-xs text-muted-foreground">
									選択中: {selectedOrganizationLogoFile.name}
								</p>
							{/if}
						</div>
						<Button type="submit" disabled={busy}>組織を作成</Button>
					</form>
				{:else}
					<div class="rounded-lg border border-border/80 bg-card/80 p-4">
						<h3 class="text-sm font-semibold text-foreground">組織作成</h3>
						<p class="mt-2 text-sm text-muted-foreground">
							招待参加ユーザーは新しい組織を作成できません。組織の追加が必要な場合は owner
							権限の管理者に依頼してください。
						</p>
					</div>
				{/if}

				<div class="space-y-3">
					<div class="flex items-center justify-between gap-3">
						<h2 class="text-sm font-semibold text-foreground">所属組織</h2>
						<Button
							type="button"
							variant="outline"
							onclick={refreshSettings}
							disabled={loading || busy}>最新化</Button
						>
					</div>

					{#if loading}
						<p class="text-sm text-muted-foreground">組織を取得しています…</p>
					{:else if organizations.length === 0}
						<p class="text-sm text-muted-foreground">所属組織はまだありません。</p>
					{:else}
						<div class="space-y-2">
							{#each organizations as organization (organization.id)}
								<div
									class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 bg-card/80 p-3"
								>
									<div class="flex min-w-0 items-center gap-3">
										<OrganizationLogo name={organization.name} logo={organization.logo} size="md" />
										<div class="min-w-0">
											<p class="truncate text-sm font-semibold text-foreground">
												{organization.name}
											</p>
											<p class="truncate text-xs text-muted-foreground">
												URL識別子: {organization.slug}
											</p>
										</div>
									</div>
									<div class="flex items-center gap-2">
										<Badge
											variant={organization.id === activeOrganizationId ? 'default' : 'outline'}
										>
											{organization.id === activeOrganizationId ? '利用中' : '待機中'}
										</Badge>
										<Button
											type="button"
											variant="secondary"
											onclick={() => submitSetActiveOrganization(organization.id)}
											disabled={busy || organization.id === activeOrganizationId}
										>
											選択
										</Button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<Button
					type="button"
					variant="ghost"
					onclick={() => submitSetActiveOrganization(null)}
					disabled={busy || !activeOrganizationId}
				>
					利用中の組織を解除
				</Button>
			</CardContent>
		</Card>
	</section>
</main>
