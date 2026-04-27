<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { manualCategories, manualLookup } from '$lib/manuals';
	import { tick } from 'svelte';

	let { children } = $props();

	type ManualHeading = {
		id: string;
		text: string;
		level: 2 | 3;
	};

	const visibleCategories = manualCategories.filter((category) => category.items.length > 0);
	const sidebarLinkBaseClass =
		'block leading-6 text-soft transition-colors hover:text-primary hover:underline';
	const breadcrumbClass = 'flex flex-wrap gap-2 text-[0.88rem] text-muted';

	let headings = $state<ManualHeading[]>([]);
	let manualContentElement = $state<HTMLElement | null>(null);

	const currentManual = $derived(manualLookup.get(page.url.pathname));
	const currentCategory = $derived(
		currentManual
			? manualCategories.find((category) => category.id === currentManual.categoryId)
			: undefined
	);
	const isDirectoryPage = $derived(page.url.pathname === '/manuals');

	function createSlug(value: string) {
		return value
			.trim()
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s-]/gu, '')
			.replace(/\s+/g, '-');
	}

	async function syncHeadings() {
		await tick();

		if (!browser || isDirectoryPage || !manualContentElement) {
			headings = [];
			return;
		}

		const slugCounts = new Map<string, number>();
		const nextHeadings = Array.from(manualContentElement.querySelectorAll('h2, h3'))
			.map((heading, index) => {
				const text = heading.textContent?.trim() ?? '';

				if (!text) {
					return null;
				}

				const baseId = heading.id || createSlug(text) || `section-${index + 1}`;
				const currentCount = slugCounts.get(baseId) ?? 0;
				slugCounts.set(baseId, currentCount + 1);

				const id = currentCount === 0 ? baseId : `${baseId}-${currentCount + 1}`;
				heading.id = id;

				return {
					id,
					text,
					level: heading.tagName === 'H3' ? 3 : 2
				} satisfies ManualHeading;
			})
			.filter((heading): heading is ManualHeading => heading !== null);

		headings = nextHeadings;
	}

	$effect(() => {
		page.url.pathname;
		void syncHeadings();
	});

	function manualLinkClass(href: string) {
		return `${sidebarLinkBaseClass} ${page.url.pathname === href ? 'font-bold text-primary' : ''}`;
	}

	function outlineLinkClass(level: 2 | 3) {
		return `${sidebarLinkBaseClass} ${level === 3 ? 'pl-3 text-[0.9rem]' : ''}`;
	}
</script>

<svelte:head>
	<title>
		{currentManual
			? `${currentManual.title} | WakuReserve ヘルプ`
			: 'ユーザーマニュアル | WakuReserve ヘルプ'}
	</title>
	<meta
		name="description"
		content={currentManual
			? currentManual.summary
			: 'WakuReserve のユーザー向けマニュアルをカテゴリ別にまとめたサポートページです。'}
	/>
</svelte:head>

<div class="mx-auto w-full max-w-[1180px] px-5 pt-6">
	{#if isDirectoryPage}
		<div class="min-w-0">
			{@render children()}
		</div>
	{:else}
		<div class="grid items-start gap-7 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
			<aside class="pt-2 lg:sticky lg:top-[92px]" aria-label="マニュアルカテゴリ">
				<div>
					<p class="mb-2 text-[0.8rem] font-bold tracking-[0.08em] text-primary uppercase">
						Manuals
					</p>
					<h2 class="m-0 text-base font-bold text-ink">関連ガイド</h2>
					<p class="mt-2.5 text-[0.88rem] leading-[1.7] text-muted">
						同じ流れで読みたいページをまとめています。
					</p>
				</div>

				{#each visibleCategories as category (category.id)}
					<section class="mt-6 border-t border-line/70 pt-6 first:mt-0 first:border-t-0 first:pt-0">
						<h3 class="mb-3 text-[0.88rem] font-bold text-soft">{category.title}</h3>
						<ul class="m-0 list-none p-0">
							{#each category.items as item (item.href)}
								<li class="mt-2.5 first:mt-0">
									<a
										class={manualLinkClass(item.href)}
										href={item.href}
										aria-current={page.url.pathname === item.href ? 'page' : undefined}
									>
										<span>{item.title}</span>
										<small class="mt-1 block text-[0.78rem] font-normal text-muted">
											{item.audience}
										</small>
									</a>
								</li>
							{/each}
						</ul>
					</section>
				{/each}

				{#if headings.length > 0}
					<section class="mt-6 border-l-2 border-line/70 pl-3">
						<h3 class="mb-3 text-[0.88rem] font-bold text-soft">このページの内容</h3>
						<ul class="m-0 list-none p-0">
							{#each headings as heading (heading.id)}
								<li class="mt-2.5 first:mt-0">
									<a class={outlineLinkClass(heading.level)} href={`#${heading.id}`}>
										{heading.text}
									</a>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
			</aside>

			<section class="min-w-0">
				<nav class={breadcrumbClass} aria-label="パンくず">
					<a class="font-bold text-link-blue" href="/manuals">ユーザーマニュアル</a>
					{#if currentCategory}
						<span>/</span>
						<span>{currentCategory.title}</span>
					{/if}
				</nav>

				<div class="rounded-panel border border-line bg-white/95 p-7 shadow-panel md:p-10 lg:p-12">
					<div class="mb-[18px] flex flex-wrap gap-[10px] gap-y-3 text-[0.85rem] text-muted">
						<span class="inline-flex min-h-7 items-center rounded-full bg-panel-soft px-2.5">
							{currentManual?.audience}
						</span>
						<span class="inline-flex min-h-7 items-center rounded-full bg-panel-soft px-2.5">
							最終更新 {currentManual?.updatedAt}
						</span>
					</div>

					<div class="manual-prose" bind:this={manualContentElement}>
						{@render children()}
					</div>
				</div>
			</section>
		</div>
	{/if}
</div>
