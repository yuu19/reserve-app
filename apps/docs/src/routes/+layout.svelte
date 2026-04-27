<script lang="ts">
	import type { Pathname } from '$app/types';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { locales, localizeHref } from '$lib/paraglide/runtime';
	import './layout.css';

	let { children } = $props();

	const brandMarkHref = '/brand/reservation-logo-44x44.svg';
	const brandIcon16Href = '/brand/reservation-logo-16x16.svg';
	const brandIcon32Href = '/brand/reservation-logo-32x32.svg';

	const siteLinks = [
		{ href: '/' as Pathname, label: 'ヘルプトップ' },
		{ href: '/manuals' as Pathname, label: 'ユーザーマニュアル' },
		{ href: '/manuals/admin/getting-started' as Pathname, label: '初回セットアップ' }
	];

	const shellInnerClass = 'mx-auto w-full max-w-[1360px] px-4 md:px-6';
	const navLinkBaseClass =
		'inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold text-soft transition-colors hover:bg-panel hover:text-primary hover:no-underline';

	function navLinkClass(href: Pathname) {
		const isCurrent =
			page.url.pathname === href || (href !== '/' && page.url.pathname.startsWith(href));

		return `${navLinkBaseClass} ${isCurrent ? 'bg-panel text-primary shadow-[inset_0_0_0_1px_rgba(0,119,199,0.16)]' : ''}`;
	}
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" sizes="32x32" href={brandIcon32Href} />
	<link rel="icon" type="image/svg+xml" sizes="16x16" href={brandIcon16Href} />
</svelte:head>
<div class="flex min-h-screen flex-col">
	<a
		class="absolute top-4 left-6 z-50 -translate-y-20 rounded-control bg-primary px-3.5 py-2.5 text-sm font-bold text-white shadow-panel transition-transform focus:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
		href="#main-content"
	>
		本文へ移動
	</a>

	<header class="sticky top-0 z-30 border-b border-line/90 bg-page/90 backdrop-blur">
		<div class={`${shellInnerClass} flex items-center justify-between gap-6 py-4`}>
			<a class="inline-flex items-center gap-3 text-ink no-underline hover:no-underline" href="/">
				<img
					alt=""
					aria-hidden="true"
					class="size-11 shrink-0 rounded-2xl border border-line/80 bg-white shadow-panel"
					height="44"
					src={brandMarkHref}
					width="44"
				/>
				<span class="flex flex-col gap-0.5">
					<strong class="text-base">WakuReserve ヘルプ</strong>
					<small class="text-[0.8rem] text-muted">導入から運用までを迷わず進めるためのガイド</small>
				</span>
			</a>

			<nav class="flex flex-wrap gap-2" aria-label="グローバルナビゲーション">
				{#each siteLinks as item (item.href)}
					<a class={navLinkClass(item.href)} href={item.href}>{item.label}</a>
				{/each}
			</nav>
		</div>
	</header>

	<main id="main-content" class="flex-1">
		{@render children()}
	</main>

	<footer class="mt-12 border-t border-line/90 bg-white/70">
		<div
			class={`${shellInnerClass} flex flex-col items-start justify-between gap-4 py-5 text-sm text-muted md:flex-row md:items-center md:pb-7`}
		>
			<p class="m-0">WakuReserve のユーザー向けマニュアルを `apps/docs` で公開しています。</p>
			<a class="font-bold text-link-blue" href="/manuals">マニュアル一覧を見る</a>
		</div>
	</footer>
</div>

<div style="display:none">
	{#each locales as locale (locale)}
		<a href={resolve(localizeHref(page.url.pathname, { locale }) as Pathname)}>{locale}</a>
	{/each}
</div>
