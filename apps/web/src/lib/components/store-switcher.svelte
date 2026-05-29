<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { buttonVariants } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Popover from '$lib/components/ui/popover';
	import type { StoreContextPayload } from '$lib/features/organization-context.svelte';
	import { cn } from '$lib/utils';
	import { Check, ChevronDown, Search } from '@lucide/svelte';

	type StoreSwitcherProps = {
		stores: StoreContextPayload[];
		activeStoreId: string | null;
		activeStoreName: string;
		loading: boolean;
		busy: boolean;
		compact?: boolean;
		onSelect: (storeSlug: string) => Promise<void> | void;
	};

	let {
		stores = [],
		activeStoreId = null,
		activeStoreName = '店舗未選択',
		loading = false,
		busy = false,
		compact = false,
		onSelect = () => {}
	}: StoreSwitcherProps = $props();

	let open = $state(false);
	let keyword = $state('');

	const filteredStores = $derived.by(() => {
		const normalizedKeyword = keyword.trim().toLowerCase();
		if (normalizedKeyword.length === 0) {
			return stores;
		}
		return stores.filter((store) =>
			`${store.name} ${store.slug}`.toLowerCase().includes(normalizedKeyword)
		);
	});

	const triggerLabel = $derived.by(() => {
		if (loading) {
			return '店舗を読み込み中…';
		}
		return activeStoreName;
	});

	const selectStore = async (storeSlug: string) => {
		await onSelect(storeSlug);
		open = false;
		keyword = '';
	};
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		type="button"
		class={cn(
			buttonVariants({ variant: 'outline', size: compact ? 'sm' : 'default' }),
			`max-w-full justify-between gap-2 ${compact ? 'h-8 px-2.5 text-xs' : 'h-9 min-w-[220px] px-3 text-sm'}`
		)}
		aria-label="利用中の店舗を切り替え"
		aria-expanded={open}
		disabled={loading || busy || stores.length === 0}
	>
		<span class="truncate">{triggerLabel}</span>
		<ChevronDown class={compact ? 'size-3.5' : 'size-4'} aria-hidden="true" />
	</Popover.Trigger>
	<Popover.Content
		class={`space-y-2 ${compact ? 'w-[min(90vw,300px)] p-2' : 'w-[min(92vw,340px)] p-3'}`}
		align="end"
	>
		<div class="relative">
			<Search
				class="text-muted-foreground pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2"
				aria-hidden="true"
			/>
			<Input
				id="store-search"
				name="store_search"
				type="text"
				placeholder="店舗を検索"
				aria-label="店舗を検索"
				class="h-8 pl-7 text-xs md:text-sm"
				bind:value={keyword}
				disabled={busy || stores.length === 0}
			/>
		</div>

		{#if stores.length === 0}
			<p class="px-1 py-3 text-xs text-muted-foreground">利用可能な店舗がありません。</p>
		{:else}
			<div class="max-h-64 space-y-1 overflow-y-auto pr-1">
				{#if filteredStores.length === 0}
					<p class="px-1 py-3 text-xs text-muted-foreground">一致する店舗がありません。</p>
				{:else}
					{#each filteredStores as store (store.id)}
						<button
							type="button"
							class={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
								store.id === activeStoreId
									? 'border-primary/40 bg-primary/5'
									: 'border-border/80 bg-card hover:bg-secondary'
							}`}
							onclick={() => void selectStore(store.slug)}
							disabled={busy}
							aria-label={`${store.name}へ切り替え`}
						>
							<div class="flex items-center justify-between gap-2">
								<div class="min-w-0">
									<p class="truncate text-sm font-medium text-foreground">{store.name}</p>
									<p class="truncate text-xs text-muted-foreground">
										URL識別子: {store.slug}
									</p>
								</div>
								{#if store.id === activeStoreId}
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
		{/if}
	</Popover.Content>
</Popover.Root>
