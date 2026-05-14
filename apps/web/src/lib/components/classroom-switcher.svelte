<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Popover from '$lib/components/ui/popover';
	import type { ClassroomContextPayload } from '$lib/features/organization-context.svelte';
	import { cn } from '$lib/utils';
	import { Check, ChevronDown, Search } from '@lucide/svelte';

	type ClassroomSwitcherProps = {
		classrooms: ClassroomContextPayload[];
		activeClassroomId: string | null;
		activeClassroomName: string;
		loading: boolean;
		busy: boolean;
		compact?: boolean;
		onSelect: (classroomSlug: string) => Promise<void> | void;
	};

	let {
		classrooms = [],
		activeClassroomId = null,
		activeClassroomName = '教室未選択',
		loading = false,
		busy = false,
		compact = false,
		onSelect = () => {}
	}: ClassroomSwitcherProps = $props();

	let open = $state(false);
	let keyword = $state('');

	const filteredClassrooms = $derived.by(() => {
		const normalizedKeyword = keyword.trim().toLowerCase();
		if (normalizedKeyword.length === 0) {
			return classrooms;
		}
		return classrooms.filter((classroom) =>
			`${classroom.name} ${classroom.slug}`.toLowerCase().includes(normalizedKeyword)
		);
	});

	const triggerLabel = $derived.by(() => {
		if (loading) {
			return '教室を読み込み中…';
		}
		return activeClassroomName;
	});

	const selectClassroom = async (classroomSlug: string) => {
		await onSelect(classroomSlug);
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
		aria-label="利用中の教室を切り替え"
		aria-expanded={open}
		disabled={loading || busy || classrooms.length === 0}
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
				id="classroom-search"
				name="classroom_search"
				type="text"
				placeholder="教室を検索"
				aria-label="教室を検索"
				class="h-8 pl-7 text-xs md:text-sm"
				bind:value={keyword}
				disabled={busy || classrooms.length === 0}
			/>
		</div>

		{#if classrooms.length === 0}
			<p class="px-1 py-3 text-xs text-muted-foreground">利用可能な教室がありません。</p>
		{:else}
			<div class="max-h-64 space-y-1 overflow-y-auto pr-1">
				{#if filteredClassrooms.length === 0}
					<p class="px-1 py-3 text-xs text-muted-foreground">一致する教室がありません。</p>
				{:else}
					{#each filteredClassrooms as classroom (classroom.id)}
						<button
							type="button"
							class={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
								classroom.id === activeClassroomId
									? 'border-primary/40 bg-primary/5'
									: 'border-border/80 bg-card hover:bg-secondary'
							}`}
							onclick={() => void selectClassroom(classroom.slug)}
							disabled={busy}
							aria-label={`${classroom.name}へ切り替え`}
						>
							<div class="flex items-center justify-between gap-2">
								<div class="min-w-0">
									<p class="truncate text-sm font-medium text-foreground">{classroom.name}</p>
									<p class="truncate text-xs text-muted-foreground">
										URL識別子: {classroom.slug}
									</p>
								</div>
								{#if classroom.id === activeClassroomId}
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
