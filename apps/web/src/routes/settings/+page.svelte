<script lang="ts">
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		createOrganization,
		loadOrganizations,
		setActiveOrganization,
		uploadOrganizationLogo
	} from '$lib/features/organization-context.svelte';
	import { getCurrentPathWithSearch, loadSession, redirectToLoginWithNext } from '$lib/features/auth-session.svelte';
	import { toast } from 'svelte-sonner';
	import type { OrganizationPayload } from '$lib/rpc-client';

	let loading = $state(true);
	let busy = $state(false);
	let organizations = $state<OrganizationPayload[]>([]);
	let activeOrganization = $state<OrganizationPayload | null>(null);
	let organizationForm = $state({ name: '', slug: '' });
	let organizationLogoFiles = $state<FileList | undefined>(undefined);

	const selectedOrganizationLogoFile = $derived(organizationLogoFiles?.item(0) ?? null);
	const activeOrganizationId = $derived(activeOrganization?.id ?? null);

	const refreshSettings = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}
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
				slug: organizationForm.slug,
				logo
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			organizationForm = { name: '', slug: '' };
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
				await refreshSettings();
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold text-slate-900">設定</h1>
		<p class="text-sm text-slate-600">組織設定と利用中組織の切り替えを行います。</p>
	</header>

	<section>
		<Card class="surface-panel border-slate-200/80 shadow-lg">
			<CardHeader class="space-y-2">
				<h2 class="text-xl font-semibold text-slate-900">組織設定</h2>
				<CardDescription>組織の新規作成と利用中組織の切り替えを行います。</CardDescription>
			</CardHeader>
			<CardContent class="space-y-5">
				<form class="space-y-4 rounded-lg border border-slate-200/80 bg-white/80 p-4" onsubmit={submitCreateOrganization}>
					<h3 class="text-sm font-semibold text-slate-900">組織を作成</h3>
					<div class="space-y-2">
						<Label for="organization-name">組織名</Label>
						<Input id="organization-name" name="organization_name" type="text" required bind:value={organizationForm.name} />
					</div>
					<div class="space-y-2">
						<Label for="organization-slug">識別子 (slug)</Label>
						<Input id="organization-slug" name="organization_slug" type="text" required bind:value={organizationForm.slug} />
					</div>
					<div class="space-y-2">
						<Label for="organization-logo">ロゴ画像 (任意)</Label>
						<Input id="organization-logo" name="organization_logo" type="file" bind:files={organizationLogoFiles} disabled={busy} />
						{#if selectedOrganizationLogoFile}
							<p class="text-xs text-slate-600">選択中: {selectedOrganizationLogoFile.name}</p>
						{/if}
					</div>
					<Button type="submit" disabled={busy}>組織を作成</Button>
				</form>

				<div class="space-y-3">
					<div class="flex items-center justify-between gap-3">
						<h2 class="text-sm font-semibold text-slate-900">所属組織</h2>
						<Button type="button" variant="outline" onclick={refreshSettings} disabled={loading || busy}>最新化</Button>
					</div>

					{#if loading}
						<p class="text-sm text-muted-foreground">組織を取得しています…</p>
					{:else if organizations.length === 0}
						<p class="text-sm text-muted-foreground">所属組織はまだありません。</p>
					{:else}
						<div class="space-y-2">
							{#each organizations as organization (organization.id)}
								<div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white/80 p-3">
									<div>
										<p class="text-sm font-semibold text-slate-900">{organization.name}</p>
										<p class="text-xs text-muted-foreground">slug: {organization.slug}</p>
									</div>
									<div class="flex items-center gap-2">
										<Badge variant={organization.id === activeOrganizationId ? 'default' : 'outline'}>
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

				<Button type="button" variant="ghost" onclick={() => submitSetActiveOrganization(null)} disabled={busy || !activeOrganizationId}>
					利用中の組織を解除
				</Button>
			</CardContent>
		</Card>
	</section>
</main>
