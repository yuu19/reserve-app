<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { freePricingPlan, premiumPricingPlan } from '$lib/content/pricing';
	import {
		ArrowRight,
		Building2,
		CalendarDays,
		CheckCircle2,
		ExternalLink,
		Github,
		Settings,
		ShieldCheck,
		TicketCheck,
		Twitter,
		Users
	} from '@lucide/svelte';

	const pageTitle = 'WakuReserve | 教室・スクール向け予約管理';
	const pageDescription =
		'WakuReserve は、小規模スクール・教室向けに、予約枠の公開、承認制受付、参加者対応、回数券管理をまとめて扱える予約管理SaaSです。';

	const pricingHref = resolve('/pricing' as Pathname);
	const freeStartHref = `${resolve('/admin/login' as Pathname)}?next=${encodeURIComponent(
		'/admin/onboarding'
	)}`;
	const developerHref = 'https://wakureserve.com/developer';

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
		key: 'admin' | 'participant';
		title: string;
		description: string;
		icon: IconComponent;
		ctaLabel: string;
	};

	const portalCards: PortalCard[] = [
		{
			key: 'admin',
			title: '管理者ポータル',
			description: 'サービス作成、受付運用、招待管理を行う入口です。',
			icon: ShieldCheck,
			ctaLabel: '管理者としてログイン'
		},
		{
			key: 'participant',
			title: '予約者ポータル',
			description: '予約確認、キャンセル、招待への対応を行う入口です。',
			icon: Users,
			ctaLabel: '予約者としてログイン'
		}
	];

	const operationStats = [
		{ label: '本日の予約', value: '18件' },
		{ label: '承認待ち', value: '3件' },
		{ label: '公開中の予約枠', value: '12枠' }
	];

	const previewRows = [
		{ time: '10:00', service: '朝ヨガ', status: '受付中', count: '7 / 8' },
		{ time: '13:30', service: '体験レッスン', status: '承認待ち', count: '3 / 6' },
		{ time: '18:00', service: 'ピラティス', status: '満席', count: '10 / 10' }
	];

	const operationCases = [
		'個人教室や少人数レッスンの予約受付',
		'体験予約や承認制のレッスン運用',
		'回数券制スクールの参加者対応',
		'管理者と予約者の入口を分けたい運用'
	];

	const challengeCards = [
		{
			title: '受付状況が分散する',
			challenge: 'LINE、紙、Googleフォームで受付を分けると、日々の確認や転記の手間が増えます。',
			solution: '予約枠、受付状況、参加者対応を同じ管理画面で確認できます。'
		},
		{
			title: '承認待ちを追いにくい',
			challenge: '体験予約や少人数制クラスでは、申込後の確認、調整、キャンセル対応が残ります。',
			solution: '予約ステータスを確認し、承認、却下、キャンセルを整理できます。'
		},
		{
			title: '予約者の導線が迷いやすい',
			challenge: '管理者向け操作と予約者向け操作が混ざると、問い合わせや操作ミスが増えます。',
			solution: '管理者ポータルと予約者ポータルを分け、役割ごとの入口を明確にします。'
		}
	];

	const featureCards: Array<{
		title: string;
		description: string;
		icon: IconComponent;
	}> = [
		{
			title: 'レッスン予約を公開する',
			description: '単発イベントや定期レッスンの予約枠を作成し、公開状態を管理できます。',
			icon: CalendarDays
		},
		{
			title: '承認制で受け付ける',
			description: '体験レッスンや少人数制クラスで、管理者が確認してから予約を確定できます。',
			icon: ShieldCheck
		},
		{
			title: '参加者ポータルを用意する',
			description: '予約確認、キャンセル、招待対応を予約者向けの入口から案内できます。',
			icon: Users
		},
		{
			title: '回数券を管理する',
			description: '回数券の申請、付与、利用対象サービスの管理に対応できます。',
			icon: TicketCheck
		},
		{
			title: 'スタッフを招待する',
			description: '店舗運用に関わる管理者やスタッフを招待し、役割に合わせて運用できます。',
			icon: Building2
		}
	];

	const onboardingSteps: Array<{ title: string; description: string; icon: IconComponent }> = [
		{
			title: '初期設定',
			description: '組織、店舗、サービス情報を登録します。',
			icon: Settings
		},
		{
			title: '予約枠を公開',
			description: '単発または定期の予約枠を公開します。',
			icon: CalendarDays
		},
		{
			title: '受付運用',
			description: '予約状況を確認し、承認や調整を進めます。',
			icon: ShieldCheck
		},
		{
			title: '回数券管理',
			description: '必要に応じて回数券の申請と付与を管理します。',
			icon: TicketCheck
		}
	];

	const publicFooterLinks = [
		{ label: '料金', href: '/pricing' },
		{ label: '利用規約', href: '/terms' },
		{ label: 'プライバシーポリシー', href: '/privacy' },
		{ label: '特定商取引法に基づく表記', href: '/commerce' }
	];

	const sectionEyebrowClass = 'text-xs font-bold text-muted-foreground';
	const sectionHeadingClass = 'text-xl font-bold text-foreground md:text-2xl';
	const panelClass = 'surface-panel rounded-md border border-border/80 shadow-sm';
	const linkClass =
		'inline-flex items-center gap-1.5 text-sm font-medium text-link underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
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

<main id="main-content" class="min-h-screen overflow-x-hidden bg-background">
	<header class="border-b border-border/80 bg-card">
		<div
			class="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-8"
		>
			<a
				href={resolve('/' as Pathname)}
				class="flex items-center gap-3 text-foreground no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
			>
				<img
					src={resolve('/brand/reservation-logo-44x44.svg')}
					alt=""
					class="size-10"
					width="40"
					height="40"
				/>
				<span class="text-lg font-bold">WakuReserve</span>
			</a>

			<nav class="flex flex-col gap-3 md:flex-row md:items-center" aria-label="トップページ">
				<div class="flex flex-wrap items-center gap-x-5 gap-y-3">
					<a class={linkClass} href="#features">機能</a>
					<a class={linkClass} href={pricingHref}>料金</a>
					<a class={linkClass} href={developerHref} target="_blank" rel="noreferrer">
						開発者情報
						<ExternalLink class="size-3.5" aria-hidden="true" />
					</a>
					<a class={linkClass} href="#portal-entry">ログイン</a>
				</div>
				<Button href={freeStartHref} class="w-full md:w-auto">
					<ArrowRight class="size-4" aria-hidden="true" />
					無料で始める
				</Button>
			</nav>
		</div>
	</header>

	<section class="border-b border-border/80 bg-card">
		<div
			class="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 md:px-8 md:py-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.8fr)] lg:items-center"
		>
			<div class="space-y-6">
				<div class="space-y-3">
					<p class={sectionEyebrowClass}>教室・スクール向け予約管理</p>
					<h1 class="max-w-[44rem] text-2xl font-bold leading-tight text-foreground">
						小規模スクール・教室の予約運用を、ひとつの管理画面に。
					</h1>
					<p class="max-w-[42rem] text-base leading-relaxed text-secondary-foreground">
						予約枠の公開、承認制受付、参加者対応、回数券管理まで。WakuReserve
						は、個人教室・スクール向けの予約管理SaaSです。
					</p>
				</div>

				<div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
					<Button href={freeStartHref} class="w-full sm:w-auto">
						<ArrowRight class="size-4" aria-hidden="true" />
						無料で始める
					</Button>
					<Button href={pricingHref} variant="outline" class="w-full sm:w-auto">
						<ArrowRight class="size-4" aria-hidden="true" />
						料金を見る
					</Button>
					<a class={linkClass} href="#portal-entry">既存利用者のログイン入口</a>
				</div>

				<div class="grid gap-3 sm:grid-cols-3">
					{#each operationStats as item (item.label)}
						<div class="rounded-md border border-border/80 bg-background px-4 py-3">
							<p class="text-sm text-muted-foreground">{item.label}</p>
							<p class="metric-value mt-1 text-xl font-bold text-foreground">{item.value}</p>
						</div>
					{/each}
				</div>
			</div>

			<aside
				class="rounded-md border border-border/80 bg-background p-4 shadow-sm"
				aria-label="WakuReserveの運用画面プレビュー"
			>
				<div
					class="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-3"
				>
					<div>
						<p class="text-sm font-bold text-foreground">本日の予約運用</p>
						<p class="text-xs text-muted-foreground">管理画面プレビュー</p>
					</div>
					<span
						class="inline-flex items-center gap-1 rounded-md border border-success/30 bg-[#f4fbf7] px-2 py-1 text-xs font-bold text-secondary-foreground"
					>
						<CheckCircle2 class="size-3.5 text-success" aria-hidden="true" />
						公開中
					</span>
				</div>

				<div class="mt-4 grid gap-3 sm:grid-cols-3">
					{#each operationStats as item (item.label)}
						<div class="rounded-md border border-border/70 bg-card px-3 py-2">
							<p class="text-xs text-muted-foreground">{item.label}</p>
							<p class="metric-value mt-1 text-lg font-bold text-foreground">{item.value}</p>
						</div>
					{/each}
				</div>

				<div class="mt-4 overflow-x-auto rounded-md border border-border/80 bg-card">
					<table class="w-full min-w-[440px] text-sm">
						<thead class="bg-secondary text-muted-foreground">
							<tr>
								<th scope="col" class="px-3 py-2 text-left font-medium">時刻</th>
								<th scope="col" class="px-3 py-2 text-left font-medium">サービス</th>
								<th scope="col" class="px-3 py-2 text-left font-medium">状態</th>
								<th scope="col" class="px-3 py-2 text-right font-medium">予約</th>
							</tr>
						</thead>
						<tbody>
							{#each previewRows as row (row.time)}
								<tr class="border-t border-border/70">
									<td class="metric-value px-3 py-2 text-secondary-foreground">{row.time}</td>
									<td class="px-3 py-2 font-medium text-foreground">{row.service}</td>
									<td class="px-3 py-2 text-secondary-foreground">{row.status}</td>
									<td class="metric-value px-3 py-2 text-right text-secondary-foreground">
										{row.count}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</aside>
		</div>
	</section>

	<div class="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 md:px-8 md:py-10">
		<section class="space-y-4" aria-labelledby="fit-heading">
			<div class="space-y-2">
				<p class={sectionEyebrowClass}>向いている運用</p>
				<h2 id="fit-heading" class={sectionHeadingClass}>こんな教室・スクールに向いています</h2>
				<p class="max-w-[44rem] text-sm leading-relaxed text-muted-foreground">
					予約受付、承認待ち、参加者対応が複数のツールに分かれている運用を整理できます。
				</p>
			</div>

			<div class="rounded-md border border-dashed border-border bg-card p-4">
				<ul class="grid gap-2 text-sm text-secondary-foreground md:grid-cols-2">
					{#each operationCases as item (item)}
						<li class="flex items-start gap-2">
							<CheckCircle2 class="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
							<span>{item}</span>
						</li>
					{/each}
				</ul>
			</div>
		</section>

		<section class="space-y-4" aria-labelledby="challenge-heading">
			<div class="space-y-2">
				<p class={sectionEyebrowClass}>課題と対応</p>
				<h2 id="challenge-heading" class={sectionHeadingClass}>予約運用で詰まりやすい点を整理</h2>
			</div>

			<div class="grid gap-4 md:grid-cols-3">
				{#each challengeCards as item (item.title)}
					<Card class={panelClass}>
						<CardHeader class="space-y-2">
							<CardTitle class="text-lg">{item.title}</CardTitle>
							<CardDescription class="leading-relaxed">{item.challenge}</CardDescription>
						</CardHeader>
						<CardContent class="pt-4">
							<div class="rounded-md border border-success/30 bg-[#f4fbf7] px-3 py-3">
								<p class="text-xs font-bold text-success">WakuReserve の対応</p>
								<p class="mt-1 text-sm leading-relaxed text-foreground">{item.solution}</p>
							</div>
						</CardContent>
					</Card>
				{/each}
			</div>
		</section>

		<section id="features" class="scroll-mt-24 space-y-4" aria-labelledby="feature-heading">
			<div class="space-y-2">
				<p class={sectionEyebrowClass}>主要機能</p>
				<h2 id="feature-heading" class={sectionHeadingClass}>利用シーンごとに必要な機能を配置</h2>
				<p class="max-w-[44rem] text-sm leading-relaxed text-muted-foreground">
					機能名の一覧ではなく、教室運営で使う場面に合わせて確認できます。
				</p>
			</div>

			<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{#each featureCards as feature (feature.title)}
					<Card class={panelClass}>
						<CardHeader class="space-y-2">
							<CardTitle class="flex items-center gap-2 text-lg">
								<feature.icon class="size-4 text-primary" aria-hidden="true" />
								{feature.title}
							</CardTitle>
							<CardDescription>{feature.description}</CardDescription>
						</CardHeader>
					</Card>
				{/each}
			</div>

			<p
				class="rounded-md border border-border/80 bg-card px-4 py-3 text-sm leading-relaxed text-secondary-foreground"
			>
				回数券管理、複数店舗、スタッフ招待など一部の機能は Premium の対象です。
				プランごとの利用可否は料金ページで確認できます。
			</p>
		</section>

		<section class="space-y-4" aria-labelledby="flow-heading">
			<div class="space-y-2">
				<p class={sectionEyebrowClass}>導入フロー</p>
				<h2 id="flow-heading" class={sectionHeadingClass}>最短4ステップで受付を開始</h2>
			</div>

			<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				{#each onboardingSteps as step, index (step.title)}
					<Card class={panelClass}>
						<CardHeader class="space-y-2 pb-0">
							<p class="metric-value text-xs font-bold text-primary">Step {index + 1}</p>
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

		<section
			id="pricing-summary"
			class="scroll-mt-24 space-y-4"
			aria-labelledby="pricing-summary-heading"
		>
			<div class="space-y-2">
				<p class={sectionEyebrowClass}>料金</p>
				<h2 id="pricing-summary-heading" class={sectionHeadingClass}>料金</h2>
				<p class="max-w-[44rem] text-sm leading-relaxed text-muted-foreground">
					{freePricingPlan.name} は {freePricingPlan.price}、{premiumPricingPlan.name} は
					{premiumPricingPlan.price} / {premiumPricingPlan.secondaryPrice} で利用できます。
					{premiumPricingPlan.trialLabel}にも対応しています。
				</p>
			</div>

			<div
				class="flex flex-col gap-4 rounded-md border border-border/80 bg-card p-5 shadow-sm md:flex-row md:items-center md:justify-between"
			>
				<div class="space-y-2">
					<p class="text-sm font-bold text-foreground">
						詳細な機能差分、注意事項、法務リンクは料金ページにまとめています。
					</p>
					<p class="text-sm leading-relaxed text-secondary-foreground">
						公開ページから直接決済は開始せず、申込や契約管理はログイン後の契約画面で扱います。
					</p>
				</div>
				<Button href={pricingHref} variant="outline" class="w-full md:w-auto">
					<ArrowRight class="size-4" aria-hidden="true" />
					料金ページへ
				</Button>
			</div>
		</section>

		<section
			class="flex flex-col gap-5 border-y border-primary/20 bg-card px-0 py-6 md:flex-row md:items-center md:justify-between"
			aria-labelledby="final-cta-heading"
		>
			<div class="space-y-2">
				<p class="text-xs font-bold text-primary">利用開始</p>
				<h2 id="final-cta-heading" class="text-xl font-bold text-foreground">
					まずは無料で予約運用を整理する
				</h2>
				<p class="max-w-[44rem] text-sm leading-relaxed text-secondary-foreground">
					管理者としてログインし、初期設定から組織、店舗、サービス、予約枠の準備を始められます。
				</p>
			</div>

			<div class="flex flex-col gap-3 sm:flex-row">
				<Button href={freeStartHref} class="w-full sm:w-auto">
					<ArrowRight class="size-4" aria-hidden="true" />
					無料で始める
				</Button>
				<Button href={pricingHref} variant="outline" class="w-full sm:w-auto">
					<ArrowRight class="size-4" aria-hidden="true" />
					料金を見る
				</Button>
			</div>
		</section>

		<section id="portal-entry" class="scroll-mt-24 space-y-4" aria-labelledby="portal-heading">
			<div class="space-y-2">
				<p class={sectionEyebrowClass}>ログイン入口</p>
				<h2 id="portal-heading" class={sectionHeadingClass}>
					既存利用者は役割に合わせて入口を選択
				</h2>
				<p class="max-w-[44rem] text-sm leading-relaxed text-muted-foreground">
					招待や予約確認が目的の場合は予約者ポータル、店舗や予約枠の運用は管理者ポータルを使います。
				</p>
			</div>

			{#if nextPath}
				<p
					class="break-all rounded-md border border-primary/20 bg-stone-01 px-3 py-2 text-sm text-secondary-foreground"
				>
					ログイン後は {nextPath} に戻ります。
				</p>
			{/if}

			<div class="grid gap-4 md:grid-cols-2">
				{#each portalCards as portal (portal.key)}
					<a
						class={`${panelClass} group block p-5 text-foreground no-underline transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
						href={resolve(
							(portal.key === 'admin' ? adminLoginHref : participantLoginHref) as Pathname
						)}
					>
						<div class="flex items-start justify-between gap-4">
							<div class="space-y-2">
								<div class="flex items-center gap-2 text-lg font-bold">
									<portal.icon class="size-4 text-primary" aria-hidden="true" />
									{portal.title}
								</div>
								<p class="text-sm leading-relaxed text-secondary-foreground">
									{portal.description}
								</p>
							</div>
							<ArrowRight class="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
						</div>
						<p class="mt-4 text-sm font-bold text-link">{portal.ctaLabel}</p>
					</a>
				{/each}
			</div>
		</section>
	</div>

	<footer class="border-t border-border/80 bg-card">
		<div
			class="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:flex-row sm:items-center sm:justify-between md:px-8 md:py-6"
		>
			<div
				class="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-7 sm:gap-y-3"
			>
				<p class="text-sm text-secondary-foreground">© WakuReserve. 個人開発プロジェクト</p>

				<div class="flex flex-wrap items-center gap-x-5 gap-y-3">
					<a class={linkClass} href="https://wakureserve.com" target="_blank" rel="noreferrer">
						サービス紹介
						<ExternalLink class="size-3.5" aria-hidden="true" />
					</a>
					<a class={linkClass} href={developerHref} target="_blank" rel="noreferrer">
						開発者情報
						<ExternalLink class="size-3.5" aria-hidden="true" />
					</a>
					{#each publicFooterLinks as link (link.href)}
						<a class={linkClass} href={resolve(link.href as Pathname)}>
							{link.label}
						</a>
					{/each}

					<div class="flex items-center gap-2">
						<a
							class="inline-flex size-10 items-center justify-center rounded-md text-link transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
							href="https://github.com/yuu19/reserve-app"
							target="_blank"
							rel="noreferrer"
							aria-label="GitHub"
							title="GitHub"
						>
							<Github class="size-5" aria-hidden="true" />
						</a>
						<a
							class="inline-flex size-10 items-center justify-center rounded-md text-link transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
							href="https://x.com/wakureserve"
							target="_blank"
							rel="noreferrer"
							aria-label="X"
							title="X"
						>
							<Twitter class="size-5" aria-hidden="true" />
						</a>
					</div>
				</div>
			</div>

			<Button href={freeStartHref} class="w-full sm:w-auto">
				<ArrowRight class="size-4" aria-hidden="true" />
				無料で始める
			</Button>
		</div>
	</footer>
</main>
