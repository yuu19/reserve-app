<script lang="ts">
	import { featuredManuals, manualCategories } from '$lib/manuals';

	const articleCardClass =
		'group block rounded-panel border border-line bg-white/92 p-6 shadow-panel transition-all duration-150 hover:-translate-y-0.5 hover:shadow-floating hover:no-underline';
	const supportCardClass = 'rounded-panel border border-line bg-white/92 p-6 shadow-panel';
</script>

<section class="pt-2 pb-2">
	<p class="mb-2 text-[0.8rem] font-bold tracking-[0.08em] text-primary uppercase">User Manuals</p>
	<h1 class="m-0 text-[clamp(2rem,5vw,3.5rem)] leading-tight font-bold text-ink">
		WakuReserve ユーザーマニュアル
	</h1>
	<p class="mt-[18px] max-w-[720px] text-[1.05rem] leading-[1.75] text-muted">
		管理者向けの初期設定から、今後追加する参加者向け導線まで、用途別にたどれる形で整理しています。
	</p>
</section>

<section class="pt-5">
	<div class="mb-[18px] flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
		<div>
			<p class="mb-2 text-[0.8rem] font-bold tracking-[0.08em] text-primary uppercase">
				Recommended
			</p>
			<h2 class="m-0 text-[1.6rem] leading-tight font-bold text-ink">最初に読みたいガイド</h2>
		</div>
	</div>

	<div class="grid grid-cols-1 gap-[18px] md:grid-cols-2">
		{#each featuredManuals as manual (manual.href)}
			<a class={articleCardClass} href={manual.href}>
				<p class="mb-2 text-[0.8rem] font-bold tracking-[0.08em] text-primary uppercase">
					{manual.categoryTitle}
				</p>
				<h3 class="m-0 text-[1.2rem] leading-[1.4] font-bold text-ink">{manual.title}</h3>
				<p class="mt-3 text-base leading-[1.75] text-muted">{manual.summary}</p>
				<div class="mt-[18px] flex flex-wrap gap-3 text-[0.85rem] text-soft">
					<span>{manual.audience}</span>
					<span>{manual.updatedAt}</span>
				</div>
			</a>
		{/each}
	</div>
</section>

<section class="pt-9 pb-4">
	<div class="mb-[18px] flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
		<div>
			<p class="mb-2 text-[0.8rem] font-bold tracking-[0.08em] text-primary uppercase">Browse</p>
			<h2 class="m-0 text-[1.6rem] leading-tight font-bold text-ink">カテゴリ別の案内</h2>
		</div>
	</div>

	<div class="grid grid-cols-1 gap-[18px] md:grid-cols-2">
		{#each manualCategories as category (category.id)}
			<article class={supportCardClass}>
				<p class="mb-2 text-[0.8rem] font-bold tracking-[0.08em] text-primary uppercase">
					{category.title}
				</p>
				<h3 class="m-0 text-[1.2rem] leading-[1.4] font-bold text-ink">{category.description}</h3>

				{#if category.items.length > 0}
					<ul class="m-0 mt-[18px] list-none p-0">
						{#each category.items as item (item.href)}
							<li class="mt-[10px] first:mt-0">
								<a
									class="flex items-center justify-between gap-4 rounded-xl bg-panel-soft px-[14px] py-3 font-bold text-ink transition-colors hover:bg-[#eef6fb] hover:text-primary hover:no-underline"
									href={item.href}
								>
									{item.title}
								</a>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-[18px] rounded-xl bg-panel-soft px-4 py-[14px] leading-[1.75] text-muted">
						公開準備中です。追加までしばらくお待ちください。
					</p>
				{/if}

				<div class="mt-[18px] flex flex-wrap gap-2" aria-label="追加予定のトピック">
					{#each category.plannedTopics as topic}
						<span
							class="inline-flex min-h-8 items-center rounded-full bg-primary/8 px-3 text-[0.85rem] font-bold text-primary"
						>
							{topic}
						</span>
					{/each}
				</div>
			</article>
		{/each}
	</div>
</section>
