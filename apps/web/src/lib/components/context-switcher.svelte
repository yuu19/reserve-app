<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import OrganizationLogo from '$lib/components/organization-logo.svelte';
	import * as Popover from '$lib/components/ui/popover';
	import type { ClassroomContextPayload } from '$lib/features/organization-context.svelte';
	import type { OrganizationPayload } from '$lib/rpc-client';
	import { cn } from '$lib/utils';
	import { Check, ChevronDown, Search } from '@lucide/svelte';

	type ContextSwitcherProps = {
		organizations: OrganizationPayload[];
		classrooms: ClassroomContextPayload[];
		activeOrganization: OrganizationPayload | null;
		activeClassroom: ClassroomContextPayload | null;
		loading: boolean;
		busy: boolean;
		compact?: boolean;
		onSelectOrganization: (organizationId: string | null) => Promise<void> | void;
		onSelectClassroom: (classroomSlug: string) => Promise<void> | void;
	};

	let {
		organizations = [],
		classrooms = [],
		activeOrganization = null,
		activeClassroom = null,
		loading = false,
		busy = false,
		compact = false,
		onSelectOrganization = () => {},
		onSelectClassroom = () => {}
	}: ContextSwitcherProps = $props();

	let open = $state(false);
	let keyword = $state('');

	const organizationLabel = $derived.by(() => {
		if (loading) {
			return '読み込み中…';
		}
		return activeOrganization?.name ?? '組織未選択';
	});

	const classroomLabel = $derived.by(() => {
		if (loading) {
			return '読み込み中…';
		}
		if (!activeOrganization) {
			return '教室未選択';
		}
		return activeClassroom?.name ?? (classrooms.length > 0 ? '教室を選択' : '組織全体');
	});

	const normalizedKeyword = $derived(keyword.trim().toLowerCase());
	const filteredOrganizations = $derived.by(() => {
		if (normalizedKeyword.length === 0) {
			return organizations;
		}
		return organizations.filter((organization) =>
			`${organization.name} ${organization.slug}`.toLowerCase().includes(normalizedKeyword)
		);
	});
	const filteredClassrooms = $derived.by(() => {
		if (normalizedKeyword.length === 0) {
			return classrooms;
		}
		return classrooms.filter((classroom) =>
			`${classroom.name} ${classroom.slug}`.toLowerCase().includes(normalizedKeyword)
		);
	});

	const resetPopover = () => {
		open = false;
		keyword = '';
	};

	const selectOrganization = async (organizationId: string | null) => {
		await onSelectOrganization(organizationId);
		resetPopover();
	};

	const selectClassroom = async (classroomSlug: string) => {
		await onSelectClassroom(classroomSlug);
		resetPopover();
	};
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		type="button"
		class={cn(
			buttonVariants({ variant: 'outline', size: compact ? 'sm' : 'default' }),
			'max-w-full justify-between gap-2 text-left',
			compact
				? 'h-auto min-h-10 w-[min(38vw,240px)] px-2 py-1.5'
				: 'h-auto min-h-12 min-w-[320px] px-3 py-2'
		)}
		aria-label="利用中の組織と教室を切り替え"
		aria-expanded={open}
		disabled={loading || busy}
	>
		<span class="flex min-w-0 items-center gap-2">
			<OrganizationLogo
				name={activeOrganization?.name ?? '組織'}
				logo={activeOrganization?.logo}
				size="sm"
			/>
			<span class="grid min-w-0 gap-0.5">
				<span class="flex min-w-0 items-center gap-1">
					<span class="shrink-0 text-[10px] leading-none text-muted-foreground">組織</span>
					<span
						class={compact ? 'truncate text-xs font-semibold' : 'truncate text-sm font-semibold'}
					>
						{organizationLabel}
					</span>
				</span>
				<span class="flex min-w-0 items-center gap-1">
					<span class="shrink-0 text-[10px] leading-none text-muted-foreground">教室</span>
					<span class="truncate text-[11px] font-normal text-muted-foreground">
						{classroomLabel}
					</span>
				</span>
			</span>
		</span>
		<ChevronDown class={compact ? 'size-3.5' : 'size-4'} aria-hidden="true" />
	</Popover.Trigger>

	<Popover.Content
		class={`space-y-3 ${compact ? 'w-[min(94vw,360px)] p-2' : 'w-[min(94vw,440px)] p-3'}`}
		align="end"
	>
		<div class="relative">
			<Search
				class="text-muted-foreground pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2"
				aria-hidden="true"
			/>
			<Input
				id="context-search"
				name="context_search"
				type="text"
				placeholder="組織・教室を検索…"
				aria-label="組織・教室を検索"
				autocomplete="off"
				class="h-8 pl-7 text-xs md:text-sm"
				bind:value={keyword}
				disabled={busy || (organizations.length === 0 && classrooms.length === 0)}
			/>
		</div>

		<section class="space-y-1" aria-labelledby="context-organization-heading">
			<div class="flex items-center justify-between gap-2 px-1">
				<h2 id="context-organization-heading" class="text-xs font-semibold text-muted-foreground">
					組織
				</h2>
				{#if activeOrganization}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="h-7 px-2 text-xs"
						onclick={() => void selectOrganization(null)}
						disabled={busy}
						aria-label="利用中の組織を解除"
					>
						解除
					</Button>
				{/if}
			</div>

			{#if organizations.length === 0}
				<p class="px-1 py-3 text-xs text-muted-foreground">所属組織がありません。</p>
			{:else if filteredOrganizations.length === 0}
				<p class="px-1 py-3 text-xs text-muted-foreground">一致する組織がありません。</p>
			{:else}
				<div class="max-h-48 space-y-1 overflow-y-auto pr-1">
					{#each filteredOrganizations as organization (organization.id)}
						<button
							type="button"
							class={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
								organization.id === activeOrganization?.id
									? 'border-primary/40 bg-primary/5'
									: 'border-border/80 bg-card hover:bg-secondary'
							}`}
							onclick={() => void selectOrganization(organization.id)}
							disabled={busy}
							aria-label={`${organization.name}を利用中の組織に設定`}
						>
							<div class="flex items-center justify-between gap-2">
								<div class="flex min-w-0 items-center gap-2">
									<OrganizationLogo name={organization.name} logo={organization.logo} size="sm" />
									<div class="min-w-0">
										<p class="truncate text-sm font-medium text-foreground">{organization.name}</p>
										<p class="truncate text-xs text-muted-foreground">
											URL識別子: <span translate="no">{organization.slug}</span>
										</p>
									</div>
								</div>
								{#if organization.id === activeOrganization?.id}
									<span class="flex shrink-0 items-center gap-1">
										<Check class="size-3.5 text-primary" aria-hidden="true" />
										<Badge variant="default">利用中</Badge>
									</span>
								{/if}
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</section>

		<section
			class="space-y-1 border-t border-border/70 pt-3"
			aria-labelledby="context-classroom-heading"
		>
			<h2 id="context-classroom-heading" class="px-1 text-xs font-semibold text-muted-foreground">
				教室
			</h2>

			{#if !activeOrganization}
				<p class="px-1 py-3 text-xs text-muted-foreground">
					組織を選択すると教室を切り替えられます。
				</p>
			{:else if classrooms.length === 0}
				<p class="px-1 py-3 text-xs text-muted-foreground">
					この組織には利用可能な教室がありません。
				</p>
			{:else if filteredClassrooms.length === 0}
				<p class="px-1 py-3 text-xs text-muted-foreground">一致する教室がありません。</p>
			{:else}
				<div class="max-h-44 space-y-1 overflow-y-auto pr-1">
					{#each filteredClassrooms as classroom (classroom.id)}
						<button
							type="button"
							class={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
								classroom.id === activeClassroom?.id
									? 'border-primary/40 bg-primary/5'
									: 'border-border/80 bg-card hover:bg-secondary'
							}`}
							onclick={() => void selectClassroom(classroom.slug)}
							disabled={busy}
							aria-label={`${classroom.name}へ教室を切り替え`}
						>
							<div class="flex items-center justify-between gap-2">
								<div class="min-w-0">
									<p class="truncate text-sm font-medium text-foreground">{classroom.name}</p>
									<p class="truncate text-xs text-muted-foreground">
										URL識別子: <span translate="no">{classroom.slug}</span>
									</p>
								</div>
								{#if classroom.id === activeClassroom?.id}
									<span class="flex shrink-0 items-center gap-1">
										<Check class="size-3.5 text-primary" aria-hidden="true" />
										<Badge variant="default">利用中</Badge>
									</span>
								{/if}
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</section>
	</Popover.Content>
</Popover.Root>
