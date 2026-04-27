<script lang="ts">
	import { featuredManuals, manualCategories } from '$lib/manuals';

	const articleCardClass =
		'group block rounded-panel border border-line bg-white/92 p-6 shadow-panel transition-all duration-150 hover:-translate-y-0.5 hover:shadow-floating hover:no-underline';
	const supportCardClass = 'rounded-panel border border-line bg-white/92 p-6 shadow-panel';
</script>

<svelte:head>
	<title>WakuReserve ヘルプ</title>
	<meta
		name="description"
		content="WakuReserve の導入、初回設定、日々の運用をユーザー向けにまとめたサポートサイトです。"
	/>
</svelte:head>

<section class="mx-auto w-full max-w-[1200px] px-4 pt-10 pb-7 md:px-6 md:pt-16">
	<div class="mb-2 text-[0.8rem] font-bold tracking-[0.08em] text-primary uppercase">
		Support Center
	</div>
	<h1 class="m-0 max-w-[15ch] text-[clamp(2rem,5vw,3.5rem)] leading-tight font-bold text-ink">
		WakuReserve の使い方を、目的から探せるヘルプサイト
	</h1>
	<p class="mt-[18px] max-w-[720px] text-[1.05rem] leading-[1.75] text-muted">
		初回設定、日々の運用、これから追加するガイドまでを、ユーザー視点で読みやすく整理しています。
	</p>

	<div class="mt-7 flex flex-wrap gap-3">
		<a
			class="inline-flex min-h-[46px] items-center justify-center rounded-control bg-primary px-[18px] text-base font-bold text-white shadow-panel transition-transform hover:-translate-y-0.5 hover:no-underline"
			href="/manuals"
		>
			ユーザーマニュアルを見る
		</a>
		<a
			class="inline-flex min-h-[46px] items-center justify-center rounded-control border border-primary/20 bg-panel px-[18px] text-base font-bold text-primary transition-transform hover:-translate-y-0.5 hover:no-underline"
			href="/manuals/admin/getting-started"
		>
			管理者向け初回セットアップ
		</a>
	</div>
</section>

<section class="mx-auto w-full max-w-[1200px] px-4 pt-5 md:px-6">
	<div class="mb-[18px] flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
		<div>
			<p class="mb-2 text-[0.8rem] font-bold tracking-[0.08em] text-primary uppercase">Featured</p>
			<h2 class="m-0 text-[1.6rem] leading-tight font-bold text-ink">まずはここから</h2>
		</div>
		<a class="font-bold text-link-blue" href="/manuals">すべてのマニュアルを見る</a>
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

<section class="mx-auto w-full max-w-[1200px] px-4 pt-9 pb-4 md:px-6">
	<div class="mb-[18px] flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
		<div>
			<p class="mb-2 text-[0.8rem] font-bold tracking-[0.08em] text-primary uppercase">
				Categories
			</p>
			<h2 class="m-0 text-[1.6rem] leading-tight font-bold text-ink">カテゴリから探す</h2>
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
						現在公開している記事はありません。順次追加します。
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
