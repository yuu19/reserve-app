<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import OrganizationLogo from '$lib/components/organization-logo.svelte';
	import * as Popover from '$lib/components/ui/popover';
	import type { OrganizationPayload } from '$lib/rpc-client';
	import { cn } from '$lib/utils';
	import { Check, ChevronDown, Search } from '@lucide/svelte';

	type OrganizationSwitcherProps = {
		organizations: OrganizationPayload[];
		activeOrganizationId: string | null;
		activeOrganizationName: string;
		loading: boolean;
		busy: boolean;
		compact?: boolean;
		onSelect: (organizationId: string | null) => Promise<void> | void;
	};

	let {
		organizations = [],
		activeOrganizationId = null,
		activeOrganizationName = '組織未選択',
		loading = false,
		busy = false,
		compact = false,
		onSelect = () => {}
	}: OrganizationSwitcherProps = $props();

	let open = $state(false);
	let keyword = $state('');

	const filteredOrganizations = $derived.by(() => {
		const normalizedKeyword = keyword.trim().toLowerCase();
		if (normalizedKeyword.length === 0) {
			return organizations;
		}
		return organizations.filter((organization) =>
			`${organization.name} ${organization.slug}`.toLowerCase().includes(normalizedKeyword)
		);
	});

	const triggerLabel = $derived.by(() => {
		if (loading) {
			return '組織を読み込み中…';
		}
		return activeOrganizationName;
	});
	const activeOrganization = $derived.by(() =>
		organizations.find((organization) => organization.id === activeOrganizationId) ?? null
	);

	const selectOrganization = async (organizationId: string | null) => {
		await onSelect(organizationId);
		open = false;
		keyword = '';
	};
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		type="button"
		class={cn(
			buttonVariants({ variant: 'outline', size: compact ? 'sm' : 'default' }),
			`max-w-full justify-between gap-2 ${compact ? 'h-8 px-2.5 text-xs' : 'h-9 min-w-[260px] px-3 text-sm'}`
		)}
		aria-label="利用中の組織を切り替え"
		aria-expanded={open}
		disabled={loading || busy}
	>
		<span class="flex min-w-0 items-center gap-2">
			<OrganizationLogo
				name={activeOrganization?.name ?? activeOrganizationName}
				logo={activeOrganization?.logo}
				size="sm"
			/>
			<span class="truncate">{triggerLabel}</span>
		</span>
		<ChevronDown class={compact ? 'size-3.5' : 'size-4'} aria-hidden="true" />
	</Popover.Trigger>
	<Popover.Content
		class={`space-y-2 ${compact ? 'w-[min(90vw,320px)] p-2' : 'w-[min(92vw,380px)] p-3'}`}
		align="end"
	>
		<div class="relative">
			<Search
				class="text-muted-foreground pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2"
				aria-hidden="true"
			/>
			<Input
				id="organization-search"
				name="organization_search"
				type="text"
				placeholder="組織を検索"
				aria-label="組織を検索"
				class="h-8 pl-7 text-xs md:text-sm"
				bind:value={keyword}
				disabled={busy || organizations.length === 0}
			/>
		</div>

		{#if organizations.length === 0}
			<p class="px-1 py-3 text-xs text-muted-foreground">所属組織がありません。</p>
		{:else}
			<div class="max-h-64 space-y-1 overflow-y-auto pr-1">
				{#if filteredOrganizations.length === 0}
					<p class="px-1 py-3 text-xs text-muted-foreground">一致する組織がありません。</p>
				{:else}
					{#each filteredOrganizations as organization (organization.id)}
						<button
							type="button"
							class={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
								organization.id === activeOrganizationId
									? 'border-primary/40 bg-primary/5'
									: 'border-slate-200/80 bg-white hover:bg-slate-50'
							}`}
							onclick={() => void selectOrganization(organization.id)}
							disabled={busy}
							aria-label={`${organization.name}を利用中の組織に設定`}
						>
							<div class="flex items-center justify-between gap-2">
								<div class="flex min-w-0 items-center gap-2">
									<OrganizationLogo name={organization.name} logo={organization.logo} size="sm" />
									<div class="min-w-0">
										<p class="truncate text-sm font-medium text-slate-900">{organization.name}</p>
										<p class="truncate text-xs text-muted-foreground">slug: {organization.slug}</p>
									</div>
								</div>
								{#if organization.id === activeOrganizationId}
									<span class="flex items-center gap-1">
										<Check class="size-3.5 text-primary" aria-hidden="true" />
										<Badge variant="default">利用中</Badge>
									</span>
								{/if}
							</div>
						</button>
					{/each}
				{/if}
			</div>

			<div class="border-t border-slate-200/70 pt-2">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					class="w-full justify-start text-xs"
					onclick={() => void selectOrganization(null)}
					disabled={busy || !activeOrganizationId}
				>
					利用中の組織を解除
				</Button>
			</div>
		{/if}
	</Popover.Content>
</Popover.Root>
