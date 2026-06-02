<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import {
		freePricingPlan,
		premiumPricingPlan,
		pricingComparisonRows,
		pricingNotes,
		pricingPlans,
		type PricingManualLink,
		type PricingPlan
	} from '$lib/content/pricing';
	import { ArrowLeft, ArrowRight, CheckCircle2, Info, LogIn, ShieldCheck } from '@lucide/svelte';

	const pageTitle = '料金 | WakuReserve';
	const pageDescription =
		'WakuReserve の Free / Premium プラン、月額・年額料金、7日間トライアル、機能比較を確認できます。';
	const sectionEyebrowClass = 'text-xs font-bold text-muted-foreground';
	const sectionHeadingClass = 'text-xl font-bold text-foreground md:text-2xl';
	const panelClass = 'surface-panel rounded-md border border-border/80 shadow-sm';
	const listTileClass = 'rounded-md border border-border/70 bg-stone-01 px-3 py-2';
	const manualLinkClass =
		'inline-flex min-h-7 items-center gap-1 rounded-md border border-border bg-card px-2 py-1 font-medium text-link transition-colors hover:bg-secondary hover:no-underline';
	const preparingBadgeClass =
		'rounded-sm border border-warning/50 bg-warning/25 px-1.5 py-0.5 text-xxs font-bold text-foreground';
	const adminLoginHref = resolve('/admin/login' as Pathname);
	const adminContractsHref = `${adminLoginHref}?next=${encodeURIComponent('/admin/contracts')}`;
	const planHref = (plan: PricingPlan) =>
		plan.name === 'Premium' ? adminContractsHref : adminLoginHref;
	const priceSummaryItems = [
		{ label: freePricingPlan.name, value: freePricingPlan.price, emphasized: false },
		{ label: premiumPricingPlan.name, value: premiumPricingPlan.price, emphasized: true },
		{
			label: '年額・トライアル',
			value: `${premiumPricingPlan.secondaryPrice} / ${premiumPricingPlan.trialLabel}`,
			emphasized: false
		}
	];
</script>

{#snippet manualLinkList(manualLinks: readonly PricingManualLink[])}
	{#if manualLinks.length > 0}
		<span class="mt-1 flex flex-wrap gap-1.5 text-xs" aria-label="関連マニュアル">
			{#each manualLinks as manualLink (manualLink.href)}
				<a class={manualLinkClass} href={manualLink.href}>
					<span>{manualLink.label}</span>
					{#if manualLink.status === 'preparing'}
						<span class={preparingBadgeClass}>準備中</span>
					{/if}
				</a>
			{/each}
		</span>
	{/if}
{/snippet}

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={pageDescription} />
</svelte:head>

<main id="main-content" class="min-h-screen bg-background">
	<section class="border-b border-border/80 bg-card">
		<div class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8 md:py-10">
			<div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
				<div class="space-y-3">
					<p class={sectionEyebrowClass}>料金</p>
					<h1 class="text-2xl font-bold leading-tight text-foreground">料金</h1>
					<p class="max-w-[46rem] text-sm leading-relaxed text-secondary-foreground">
						小規模運用を始める Free と、複数店舗・スタッフ運用まで広げる Premium
						を用意しています。申込や契約管理はログイン後の契約画面で扱います。
					</p>
				</div>
				<Button href={resolve('/' as Pathname)} variant="outline" class="w-full shrink-0 md:w-auto">
					<ArrowLeft class="size-4" aria-hidden="true" />
					トップページへ
				</Button>
			</div>

			<div class="grid gap-3 md:grid-cols-3">
				{#each priceSummaryItems as item (item.label)}
					<div
						class={`rounded-md border bg-background px-4 py-3 ${item.emphasized ? 'border-primary/25' : 'border-border/80'}`}
					>
						<p class="text-sm text-muted-foreground">{item.label}</p>
						<p class="metric-value mt-1 text-xl font-bold text-foreground">{item.value}</p>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<div class="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 md:px-8 md:py-10">
		<section class="space-y-4" aria-labelledby="plans-heading">
			<div class="space-y-2">
				<p class={sectionEyebrowClass}>プラン</p>
				<h2 id="plans-heading" class={sectionHeadingClass}>Free / Premium</h2>
				<p class="max-w-[44rem] text-sm leading-relaxed text-muted-foreground">
					公開予約受付を始める基本機能と、運営拡張に必要な Premium 機能を比較できます。
				</p>
			</div>

			<div class="grid gap-4 md:grid-cols-2">
				{#each pricingPlans as plan (plan.name)}
					<Card
						class={`${panelClass} ${plan.recommended ? 'border-primary/35 ring-1 ring-primary/15' : ''}`}
					>
						<CardHeader class="space-y-2 pb-0">
							<div class="flex items-center justify-between gap-3">
								<CardTitle class="text-xl">{plan.name}</CardTitle>
								{#if plan.recommended}
									<span
										class="rounded-md bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground"
									>
										おすすめ
									</span>
								{/if}
							</div>
							<div class="space-y-1">
								<p class="metric-value text-2xl font-bold leading-tight text-foreground">
									{plan.price}
								</p>
								{#if plan.secondaryPrice || plan.trialLabel}
									<p class="text-sm text-secondary-foreground">
										{#if plan.secondaryPrice}{plan.secondaryPrice}{/if}
										{#if plan.secondaryPrice && plan.trialLabel}
											/
										{/if}
										{#if plan.trialLabel}{plan.trialLabel}{/if}
									</p>
								{/if}
							</div>
							<CardDescription>{plan.description}</CardDescription>
						</CardHeader>
						<CardContent class="space-y-4 pt-4">
							<ul class="space-y-2 text-sm text-secondary-foreground">
								{#each plan.highlights as highlight (highlight.label)}
									<li class={`${listTileClass} flex items-start gap-2`}>
										<CheckCircle2 class="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
										<span class="min-w-0">
											<span>{highlight.label}</span>
											{@render manualLinkList(highlight.manualLinks)}
										</span>
									</li>
								{/each}
							</ul>
							<Button href={planHref(plan)} variant={plan.ctaVariant} class="w-full">
								<LogIn class="size-4" aria-hidden="true" />
								{plan.ctaLabel}
							</Button>
						</CardContent>
					</Card>
				{/each}
			</div>
		</section>

		<section class="space-y-4" aria-labelledby="comparison-heading">
			<div class="space-y-2">
				<p class={sectionEyebrowClass}>機能比較</p>
				<h2 id="comparison-heading" class={sectionHeadingClass}>プラン比較</h2>
			</div>

			<Card class={panelClass}>
				<CardContent class="pt-0">
					<div class="overflow-x-auto">
						<table class="w-full min-w-[640px] text-sm" aria-label="料金比較">
							<thead class="bg-secondary text-muted-foreground">
								<tr>
									<th scope="col" class="px-3 py-2 text-left font-medium">項目</th>
									<th scope="col" class="px-3 py-2 text-left font-medium">Free</th>
									<th scope="col" class="px-3 py-2 text-left font-medium">Premium</th>
								</tr>
							</thead>
							<tbody>
								{#each pricingComparisonRows as row (row.feature.label)}
									<tr class="border-t border-border/70">
										<th scope="row" class="px-3 py-2 text-left font-medium text-foreground">
											<span>{row.feature.label}</span>
											{@render manualLinkList(row.feature.manualLinks)}
										</th>
										<td class="px-3 py-2 text-secondary-foreground">{row.free}</td>
										<td class="px-3 py-2 text-secondary-foreground">{row.premium}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</CardContent>
			</Card>
		</section>

		<section class="space-y-4" aria-labelledby="notes-heading">
			<div class="space-y-2">
				<p class={sectionEyebrowClass}>注意事項</p>
				<h2 id="notes-heading" class={sectionHeadingClass}>契約と支払いに関する注意事項</h2>
			</div>

			<div class="rounded-md border border-border/80 bg-card p-5 shadow-sm">
				<ul class="space-y-3 text-sm leading-relaxed text-secondary-foreground">
					{#each pricingNotes as note (note)}
						<li class="flex gap-2">
							<Info class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
							<span>{note}</span>
						</li>
					{/each}
				</ul>
			</div>
		</section>

		<section>
			<div
				class="flex flex-col gap-5 rounded-md border border-primary/20 bg-card p-5 shadow-sm md:flex-row md:items-center md:justify-between"
			>
				<div class="space-y-2">
					<div class="flex items-center gap-2">
						<ShieldCheck class="size-4 text-primary" aria-hidden="true" />
						<h2 class="text-xl font-bold text-foreground">販売条件の詳細</h2>
					</div>
					<p class="max-w-[44rem] text-sm leading-relaxed text-secondary-foreground">
						Premium 契約の支払方法、提供時期、解約方法は特定商取引法に基づく表記にもまとめています。
					</p>
				</div>
				<Button href={resolve('/commerce' as Pathname)} variant="outline" class="w-full md:w-auto">
					<ArrowRight class="size-4" aria-hidden="true" />
					特定商取引法に基づく表記
				</Button>
			</div>
		</section>
	</div>
</main>
