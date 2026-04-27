<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import {
		Building2,
		CalendarDays,
		ExternalLink,
		Github,
		LogIn,
		Settings,
		ShieldCheck,
		Twitter,
		Users
	} from '@lucide/svelte';

	const pageTitle = 'WakuReserve | 予約管理プラットフォーム';
	const pageDescription =
		'WakuReserve は、管理者と予約者の導線を分離しながら、予約作成・受付運用・参加者対応を一体で管理できる予約プラットフォームです。';
	const marketingBaseUrl = 'https://wakureserve.com';

	const nextPath = $derived.by(() => {
		const next = page.url.searchParams.get('next');
		if (!next || !next.startsWith('/')) {
			return null;
		}
		return next;
	});

	const adminLoginHref = $derived.by(() => {
		const basePath = resolve('/admin/login');
		if (!nextPath) {
			return basePath;
		}
		return `${basePath}?next=${encodeURIComponent(nextPath)}`;
	});

	const participantLoginHref = $derived.by(() => {
		const basePath = resolve('/participant/login');
		if (!nextPath) {
			return basePath;
		}
		return `${basePath}?next=${encodeURIComponent(nextPath)}`;
	});

	type IconComponent = typeof ShieldCheck;

	type PortalCard = {
		title: string;
		description: string;
		icon: IconComponent;
	};

	const portalCards: PortalCard[] = [
		{
			title: '管理者ポータル',
			description: 'サービス作成、受付運用、招待管理をひとつの導線で管理します。',
			icon: ShieldCheck
		},
		{
			title: '予約者ポータル',
			description: '公開イベント確認、予約・キャンセル、招待対応をスムーズに行えます。',
			icon: Users
		}
	];

	const heroHighlights: Array<{ title: string; description: string; icon: IconComponent }> = [
		{
			title: '導線を分離',
			description: '管理者と予約者の入口を分け、迷いにくい画面構成で案内します。',
			icon: ShieldCheck
		},
		{
			title: '公開から受付まで',
			description: '公開イベントの掲載から予約受付、確認まで同じ導線で進められます。',
			icon: CalendarDays
		},
		{
			title: '運用を継続改善',
			description: '受付状況や参加者対応を見ながら、次回の設定に反映できます。',
			icon: Settings
		}
	];

	const fitCases = [
		'管理者と予約者で入口を分けたい',
		'公開イベントから予約を受け付けたい',
		'予約確認や参加者対応まで同じサービスで運用したい'
	];

	const challengeCards = [
		{
			title: '複数ツール運用で手間が増える',
			challenge: '受付表、連絡、集計が分断されると、日々の運用が煩雑になります。',
			solution: 'WakuReserve で受付・通知・管理を一元化して、運用工数を減らします。'
		},
		{
			title: '予約導線が分かりにくい',
			challenge: '管理者と参加者で操作が混ざると、導線ミスや問い合わせが増えます。',
			solution: '管理者と予約者の入口を分離し、役割ごとに迷わない UI を提供します。'
		}
	];

	const featureColumns: Array<{
		title: string;
		description: string;
		icon: IconComponent;
		items: string[];
	}> = [
		{
			title: '管理者向け機能',
			description: '受付運用と設定作業を効率化する機能群',
			icon: Building2,
			items: [
				'サービス・単発 Slot・定期 Schedule の作成',
				'予約ステータス管理（承認・却下・キャンセル）',
				'管理者招待・参加者管理・契約管理'
			]
		},
		{
			title: '予約者向け機能',
			description: '予約体験をシンプルに保つ参加者向け導線',
			icon: CalendarDays,
			items: ['公開イベントの閲覧と予約', '予約確認・キャンセル', '参加者招待 / 管理者招待への対応']
		}
	];

	const onboardingSteps: Array<{ title: string; description: string; icon: IconComponent }> = [
		{
			title: '初期設定',
			description: '管理者ポータルで組織・サービス情報を設定します。',
			icon: Settings
		},
		{
			title: '公開',
			description: '単発 / 定期の予約枠を公開して受付を開始します。',
			icon: CalendarDays
		},
		{
			title: '受付運用',
			description: '予約状況を見ながら承認・調整を進めます。',
			icon: ShieldCheck
		},
		{
			title: '改善',
			description: '運用結果を確認し、次回の設定に反映します。',
			icon: Users
		}
	];

	const pricingPlans: Array<{
		name: 'Free' | 'Premium';
		price: string;
		description: string;
		recommended?: boolean;
		highlights: string[];
		ctaLabel: string;
		ctaPortal: 'admin' | 'participant';
		ctaVariant: 'default' | 'outline';
	}> = [
		{
			name: 'Free',
			price: '¥0 / 月',
			description: '小規模な予約受付をすぐ始めたい方向け',
			highlights: ['基本的な予約受付', '公開イベントページ', 'メールログイン'],
			ctaLabel: '無料で始める',
			ctaPortal: 'participant',
			ctaVariant: 'outline'
		},
		{
			name: 'Premium',
			price: '¥9,800 / 月',
			description: '日常運用を安定化したい組織向けの有料プラン',
			recommended: true,
			highlights: [
				'管理者 / 予約者導線分離',
				'単発 / 定期スケジュール運用',
				'契約管理と Premium サポート導線'
			],
			ctaLabel: 'Premium を始める',
			ctaPortal: 'admin',
			ctaVariant: 'default'
		}
	];

	const comparisonRows: Array<{ feature: string; free: string; premium: string }> = [
		{
			feature: '予約受付',
			free: '基本機能',
			premium: '拡張運用'
		},
		{
			feature: '管理者導線',
			free: '限定',
			premium: 'フル対応'
		},
		{
			feature: 'サポート',
			free: 'コミュニティ',
			premium: '標準'
		}
	];

	const footerLinks: Array<{ label: string; href: string }> = [
		{ label: 'サービス紹介', href: marketingBaseUrl },
		{ label: '開発者情報', href: `${marketingBaseUrl}/developer` },
		{ label: '利用規約', href: `${marketingBaseUrl}/terms` },
		{ label: 'プライバシーポリシー', href: `${marketingBaseUrl}/privacy` }
	];

	const footerIconLinks: Array<{ label: string; href: string; icon: IconComponent }> = [
		{
			label: 'GitHub',
			href: 'https://github.com/yuu19/reserve-app',
			icon: Github
		},
		{
			label: 'X',
			href: 'https://x.com/wakureserve',
			icon: Twitter
		}
	];

	const sectionEyebrowClass =
		'text-xxs font-bold tracking-[0.08em] text-muted-foreground uppercase';
	const sectionHeadingClass =
		'text-[1.9rem] font-bold tracking-tight text-foreground md:text-[2.5rem]';
	const panelClass = 'surface-panel rounded-md border border-border/80 shadow-sm';
	const listTileClass = 'rounded-md border border-border/70 bg-stone-01 px-3 py-2';
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={pageDescription} />
</svelte:head>

<a
	href="#main-content"
	class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
>
	メインコンテンツへスキップ
</a>

<main id="main-content" class="relative min-h-screen overflow-hidden">
	<div
		class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,119,199,0.10),transparent_34%),radial-gradient(circle_at_100%_0,rgba(0,196,204,0.08),transparent_22%),linear-gradient(180deg,#f8f7f6_0%,#f8f7f6_62%,#f2f1f0_100%)]"
	></div>

	<div class="relative mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 md:px-8 md:py-8">
		<header
			id="portal-entry"
			class="surface-panel scroll-mt-24 rounded-md border border-border/90 p-5 shadow-sm md:p-6"
		>
			<div class="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start">
				<div class="space-y-5">
					<div class="space-y-3">
						<p class={sectionEyebrowClass}>Reservation Operations</p>
						<h1 class="text-[2rem] leading-[1.08] font-bold tracking-tight text-foreground sm:text-[2.35rem] md:text-[4rem]">
							<span class="block">予約運用を、</span>
							<span class="block">ひとつの画面で。</span>
						</h1>
						<p class="max-w-[42rem] text-base leading-relaxed text-secondary-foreground">
							WakuReserve は、管理者と予約者の導線を分離しながら、予約作成・受付運用・参加者対応を
							一体で管理できる予約プラットフォームです。
						</p>
					</div>

					{#if nextPath}
						<p class="rounded-md border border-primary/20 bg-primary/8 px-3 py-2 text-xs text-secondary-foreground">
							ログイン後の遷移先: {nextPath}
						</p>
					{/if}

					<div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
						<Button href={adminLoginHref} class="w-full sm:w-auto">管理者としてログイン</Button>
						<Button href={participantLoginHref} variant="outline" class="w-full sm:w-auto">
							予約者としてログイン
						</Button>
						<Button href="#pricing" variant="outline" class="w-full sm:w-auto">料金を見る</Button>
					</div>

					<div class="grid gap-3 sm:grid-cols-3">
						{#each heroHighlights as item (item.title)}
							<div class="rounded-md border border-border/70 bg-secondary/55 px-4 py-3">
								<div class="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
									<item.icon class="size-4 text-primary" aria-hidden="true" />
									{item.title}
								</div>
								<p class="text-sm leading-relaxed text-secondary-foreground">{item.description}</p>
							</div>
						{/each}
					</div>
				</div>

				<div class="space-y-3">
					<div class="rounded-md border border-border/80 bg-stone-01/80 p-4">
						<p class={sectionEyebrowClass}>入口の選び方</p>
						<div class="mt-3 space-y-3">
							{#each portalCards as portal (portal.title)}
								<div class="rounded-md border border-border/70 bg-card px-4 py-3 shadow-xs">
									<div class="flex items-center gap-2 text-base font-semibold text-foreground">
										<portal.icon class="size-4 text-primary" aria-hidden="true" />
										{portal.title}
									</div>
									<p class="mt-2 text-sm leading-relaxed text-secondary-foreground">
										{portal.description}
									</p>
								</div>
							{/each}
						</div>
					</div>

					<div class="rounded-md border border-dashed border-border bg-card/80 p-4">
						<p class={sectionEyebrowClass}>向いている運用</p>
						<ul class="mt-3 space-y-2 text-sm text-secondary-foreground">
							{#each fitCases as item (item)}
								<li class="flex items-start gap-2">
									<span class="mt-1 inline-block size-1.5 shrink-0 rounded-full bg-primary"></span>
									<span>{item}</span>
								</li>
							{/each}
						</ul>
					</div>
				</div>
			</div>
		</header>

		<section class="space-y-4">
			<div class="space-y-2">
				<p class={sectionEyebrowClass}>課題と解決</p>
				<h2 class={sectionHeadingClass}>予約運用のボトルネックを、実務視点で解消</h2>
				<p class="max-w-[44rem] text-sm leading-relaxed text-muted-foreground">
					導入時に迷いやすいポイントを、運用側と予約者側の両面から整理しています。
				</p>
			</div>

			<div class="grid gap-4 md:grid-cols-2">
				{#each challengeCards as item (item.title)}
					<Card class={`${panelClass} rounded-md`}>
						<CardHeader class="space-y-2 pb-0">
							<CardTitle class="text-lg">{item.title}</CardTitle>
							<CardDescription class="leading-relaxed">{item.challenge}</CardDescription>
						</CardHeader>
						<CardContent class="pt-4">
							<div class="rounded-md border border-success/30 bg-[#f4fbf7] px-3 py-3">
								<p class="text-xxs font-bold tracking-[0.06em] text-success uppercase">
									WakuReserve の対応
								</p>
								<p class="mt-1 text-sm leading-relaxed text-foreground">{item.solution}</p>
							</div>
						</CardContent>
					</Card>
				{/each}
			</div>
		</section>

		<section class="space-y-4">
			<div class="space-y-2">
				<p class={sectionEyebrowClass}>主要機能</p>
				<h2 class={sectionHeadingClass}>役割ごとに最適化された機能セット</h2>
			</div>

			<div class="grid gap-4 md:grid-cols-2">
				{#each featureColumns as feature (feature.title)}
					<Card class={`${panelClass} rounded-md`}>
						<CardHeader class="space-y-2 pb-0">
							<CardTitle class="flex items-center gap-2 text-lg">
								<feature.icon class="size-4 text-primary" aria-hidden="true" />
								{feature.title}
							</CardTitle>
							<CardDescription>{feature.description}</CardDescription>
						</CardHeader>
						<CardContent class="pt-4">
							<ul class="space-y-2 text-sm text-secondary-foreground">
								{#each feature.items as line (line)}
									<li class={listTileClass}>{line}</li>
								{/each}
							</ul>
						</CardContent>
					</Card>
				{/each}
			</div>
		</section>

		<section class="space-y-4">
			<div class="space-y-2">
				<p class={sectionEyebrowClass}>導入フロー</p>
				<h2 class={sectionHeadingClass}>最短4ステップで導入開始</h2>
			</div>

			<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				{#each onboardingSteps as step, index (step.title)}
					<Card class={`${panelClass} rounded-md`}>
						<CardHeader class="space-y-2 pb-0">
							<p class="text-xxs font-bold tracking-[0.08em] text-primary uppercase">Step {index + 1}</p>
							<CardTitle class="flex items-center gap-2 text-base">
								<step.icon class="size-4 text-primary" aria-hidden="true" />
								{step.title}
							</CardTitle>
						</CardHeader>
						<CardContent class="pt-4">
							<p class="text-sm leading-relaxed text-secondary-foreground">{step.description}</p>
						</CardContent>
					</Card>
				{/each}
			</div>
		</section>

		<section id="pricing" class="scroll-mt-24 space-y-4">
			<div class="space-y-2">
				<p class={sectionEyebrowClass}>Pricing</p>
				<h2 class={sectionHeadingClass}>料金プラン</h2>
				<p class="max-w-[44rem] text-sm leading-relaxed text-muted-foreground">
					運用規模に応じて、Free / Premium の 2 プランから選べます。
				</p>
			</div>

			<div class="grid gap-4 md:grid-cols-2">
				{#each pricingPlans as plan (plan.name)}
					<Card
						class={`${panelClass} rounded-md ${plan.recommended ? 'border-primary/35 ring-1 ring-primary/15' : ''}`}
					>
						<CardHeader class="space-y-2 pb-0">
							<div class="flex items-center justify-between gap-3">
								<CardTitle class="text-xl">{plan.name}</CardTitle>
								{#if plan.recommended}
									<span class="rounded-full bg-primary px-2.5 py-1 text-xxs font-bold text-primary-foreground">
										おすすめ
									</span>
								{/if}
							</div>
							<p class="text-[2rem] leading-tight font-bold text-foreground">{plan.price}</p>
							<CardDescription>{plan.description}</CardDescription>
						</CardHeader>
						<CardContent class="space-y-4 pt-4">
							<ul class="space-y-2 text-sm text-secondary-foreground">
								{#each plan.highlights as highlight (highlight)}
									<li class={listTileClass}>{highlight}</li>
								{/each}
							</ul>
							<Button
								href={plan.ctaPortal === 'admin' ? adminLoginHref : participantLoginHref}
								variant={plan.ctaVariant}
								class="w-full">{plan.ctaLabel}</Button
							>
						</CardContent>
					</Card>
				{/each}
			</div>

			<Card class={`${panelClass} rounded-md`}>
				<CardHeader class="pb-0">
					<CardTitle class="text-base">プラン比較</CardTitle>
				</CardHeader>
				<CardContent class="pt-4">
					<div class="overflow-x-auto">
						<table class="w-full min-w-[560px] text-sm">
							<thead class="bg-secondary/90 text-muted-foreground">
								<tr>
									<th class="px-3 py-2 text-left font-medium">項目</th>
									<th class="px-3 py-2 text-left font-medium">Free</th>
									<th class="px-3 py-2 text-left font-medium">Premium</th>
								</tr>
							</thead>
							<tbody>
								{#each comparisonRows as row (row.feature)}
									<tr class="border-t border-border/70">
										<td class="px-3 py-2 font-medium text-foreground">{row.feature}</td>
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

		<section>
			<Card class="surface-panel rounded-md border border-primary/20 bg-card shadow-sm">
				<CardContent class="flex flex-col gap-5 p-5 md:flex-row md:items-end md:justify-between md:p-6">
					<div class="space-y-2">
						<p class="text-xxs font-bold tracking-[0.08em] text-primary uppercase">Get Started</p>
						<h2 class="text-2xl font-bold tracking-tight text-foreground">
							まずは入口を選んで、運用を開始しましょう
						</h2>
						<p class="max-w-[44rem] text-sm leading-relaxed text-secondary-foreground">
							管理者は設定と運用、予約者は予約確認と参加者対応。役割に応じた入口からすぐ利用できます。
						</p>
					</div>

					<div class="flex flex-col gap-3 sm:flex-row">
						<Button href={adminLoginHref} class="w-full sm:w-auto">管理者としてログイン</Button>
						<Button href={participantLoginHref} variant="outline" class="w-full sm:w-auto">
							予約者としてログイン
						</Button>
					</div>
				</CardContent>
			</Card>
		</section>
	</div>

	<footer class="relative border-t border-border/80 bg-white/92 backdrop-blur">
		<div
			class="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:flex-row sm:items-center sm:justify-between md:px-8 md:py-6"
		>
			<div class="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-7 sm:gap-y-3">
				<p class="text-base text-secondary-foreground">© WakuReserve. 個人開発プロジェクト</p>

				<div class="flex flex-wrap items-center gap-x-5 gap-y-3">
					{#each footerLinks as item (item.href)}
						<a
							class="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
							href={item.href}
							target="_blank"
							rel="noreferrer"
						>
							{item.label}
							<ExternalLink class="size-3.5" aria-hidden="true" />
						</a>
					{/each}

					<div class="flex items-center gap-2">
						{#each footerIconLinks as item (item.label)}
							<a
								class="inline-flex size-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary hover:text-primary"
								href={item.href}
								target="_blank"
								rel="noreferrer"
								aria-label={item.label}
								title={item.label}
							>
								<item.icon class="size-5" aria-hidden="true" />
							</a>
						{/each}
					</div>
				</div>
			</div>

			<Button
				href="#portal-entry"
				variant="outline"
				class="h-14 w-full rounded-full border-border/90 bg-white px-6 text-lg font-bold text-foreground shadow-none hover:bg-secondary sm:w-auto sm:min-w-[13rem]"
			>
				ログイン
				<LogIn class="size-5 text-brand" aria-hidden="true" />
			</Button>
		</div>
	</footer>
</main>
