<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import { ArrowLeft } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';

	type Props = {
		title: string;
		description: string;
		updatedAt: string;
		children: Snippet;
	};

	let { title, description, updatedAt, children }: Props = $props();

	const legalLinks = [
		{ label: '利用規約', href: '/terms' },
		{ label: 'プライバシーポリシー', href: '/privacy' },
		{ label: '特定商取引法に基づく表記', href: '/commerce' }
	];

	const linkClass =
		'rounded-md px-3 py-2 text-sm font-medium text-link underline-offset-4 transition-colors hover:bg-secondary hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
</script>

<svelte:head>
	<title>{title} | WakuReserve</title>
	<meta name="description" content={description} />
</svelte:head>

<main id="main-content" class="min-h-screen bg-background">
	<section class="border-b border-border/80 bg-card">
		<div class="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-8 md:px-8 md:py-10">
			<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div class="space-y-3">
					<p class="text-xs font-bold text-muted-foreground">WakuReserve 法務情報</p>
					<h1 class="text-2xl font-bold leading-tight text-foreground">{title}</h1>
					<p class="max-w-[46rem] text-sm leading-relaxed text-secondary-foreground">
						{description}
					</p>
					<p class="text-xs text-muted-foreground">最終更新日: {updatedAt}</p>
				</div>
				<Button href={resolve('/' as Pathname)} variant="outline" class="w-full shrink-0 sm:w-auto">
					<ArrowLeft class="size-4" aria-hidden="true" />
					トップページへ
				</Button>
			</div>

			<nav class="flex flex-wrap gap-2" aria-label="法務ページ">
				{#each legalLinks as link (link.href)}
					<a class={linkClass} href={resolve(link.href as Pathname)}>{link.label}</a>
				{/each}
			</nav>
		</div>
	</section>

	<div
		class="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8 md:px-8 md:py-10 lg:grid-cols-[14rem_minmax(0,1fr)]"
	>
		<aside class="order-last lg:order-first" aria-label="文書メニュー">
			<div class="sticky top-6 rounded-md border border-border/80 bg-card p-3">
				<p class="px-2 text-xs font-bold text-muted-foreground">法務ページ</p>
				<div class="mt-2 grid gap-1">
					{#each legalLinks as link (link.href)}
						<a class={linkClass} href={resolve(link.href as Pathname)}>{link.label}</a>
					{/each}
				</div>
			</div>
		</aside>

		<article class="min-w-0 space-y-8">
			{@render children()}
		</article>
	</div>
</main>
