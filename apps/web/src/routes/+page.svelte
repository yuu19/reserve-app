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
		ArrowDown,
		ArrowRight,
		Building2,
		CalendarDays,
		CheckCircle2,
		ExternalLink,
		Github,
		LogIn,
		Settings,
		ShieldCheck,
		TicketCheck,
		Twitter,
		Users
	} from '@lucide/svelte';

	const pageTitle = 'WakuReserve | 予約管理プラットフォーム';
	const pageDescription =
		'WakuReserve は、管理者と予約者の導線を分離しながら、予約作成・受付運用・参加者対応を一体で管理できる予約プラットフォームです。';

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
		{ label: '公開枠', value: '12枠' }
	];

	const previewRows = [
		{ time: '10:00', service: '朝ヨガ', status: '受付中', count: '7 / 8' },
		{ time: '13:30', service: '体験レッスン', status: '承認待ち', count: '3 / 6' },
		{ time: '18:00', service: 'ピラティス', status: '満席', count: '10 / 10' }
	];

	const operationCases = [
		'管理者と予約者の入口を分けたい',
		'公開イベントから予約受付まで一続きで運用したい',
		'予約確認、キャンセル、招待対応まで同じサービスで管理したい'
	];

	const challengeCards = [
		{
			title: '受付状況が分散する',
			challenge: '受付表、連絡、集計が別々になると、日々の確認や転記の手間が増えます。',
			solution: '予約枠、受付状況、参加者対応を同じ管理画面で確認できます。'
		},
		{
			title: '予約者の導線が迷いやすい',
			challenge: '管理者向け操作と予約者向け操作が混ざると、問い合わせや操作ミスが増えます。',
			solution: '管理者ポータルと予約者ポータルを分け、役割ごとの入口を明確にします。'
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
			description: '受付運用と設定作業をまとめる機能群',
			icon: Building2,
			items: [
				'サービス、単発予約枠、定期スケジュールの作成',
				'予約ステータス管理（承認・却下・キャンセル）',
				'管理者招待、参加者管理、契約管理'
			]
		},
		{
			title: '予約者向け機能',
			description: '予約体験をシンプルに保つ参加者向け導線',
			icon: CalendarDays,
			items: ['公開イベントの閲覧と予約', '予約確認・キャンセル', '参加者招待・管理者招待への対応']
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

	const pricingPlans: Array<{
		name: 'Free' | 'Premium';
		price: string;
		description: string;
		recommended?: boolean;
		highlights: string[];
		ctaLabel: string;
		ctaVariant: 'default' | 'outline';
	}> = [
		{
			name: 'Free',
			price: '¥0 / 月',
			description: '小規模な予約受付を始めたい方向け',
			highlights: ['基本的な予約受付', '公開イベントページ', 'メールログイン'],
			ctaLabel: '無料で始める',
			ctaVariant: 'outline'
		},
		{
			name: 'Premium',
			price: '¥9,800 / 月',
			description: '日常運用を安定化したい組織向け',
			recommended: true,
			highlights: ['管理者 / 予約者導線分離', '単発 / 定期スケジュール運用', '契約管理'],
			ctaLabel: 'Premium を始める',
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

	const footerLinks = [
		{ label: 'サービス紹介', href: 'https://wakureserve.com' },
		{ label: '開発者情報', href: 'https://wakureserve.com/developer' },
		{ label: '利用規約', href: 'https://wakureserve.com/terms' },
		{ label: 'プライバシーポリシー', href: 'https://wakureserve.com/privacy' }
	];

	const sectionEyebrowClass = 'text-xs font-bold text-muted-foreground';
	const sectionHeadingClass = 'text-xl font-bold text-foreground md:text-2xl';
	const panelClass = 'surface-panel rounded-md border border-border/80 shadow-sm';
	const linkClass =
		'inline-flex items-center gap-1.5 text-sm font-medium text-link underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
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

<main id="main-content" class="min-h-screen overflow-x-hidden bg-background">
	<section id="portal-entry" class="border-b border-border/80 bg-card">
		<div
			class="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 md:px-8 md:py-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.8fr)] lg:items-center"
		>
			<div class="space-y-6">
				<div class="space-y-3">
					<p class={sectionEyebrowClass}>予約管理プラットフォーム</p>
					<h1 class="text-2xl font-bold leading-tight text-foreground">WakuReserve</h1>
					<p class="max-w-[42rem] text-base leading-relaxed text-secondary-foreground">
						予約枠の公開、受付状況の確認、参加者対応をひとつの画面で扱える予約管理サービスです。
						管理者と予約者の入口を分け、役割ごとに必要な操作へ案内します。
					</p>
				</div>

				{#if nextPath}
					<p
						class="break-all rounded-md border border-primary/20 bg-stone-01 px-3 py-2 text-sm text-secondary-foreground"
					>
						ログイン後は {nextPath} に戻ります。
					</p>
				{/if}

				<div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
					<Button href={adminLoginHref} class="w-full sm:w-auto">
						<LogIn class="size-4" aria-hidden="true" />
						管理者としてログイン
					</Button>
					<Button href={participantLoginHref} variant="outline" class="w-full sm:w-auto">
						<Users class="size-4" aria-hidden="true" />
						予約者としてログイン
					</Button>
					<Button href="#pricing" variant="outline" class="w-full sm:w-auto">
						<ArrowDown class="size-4" aria-hidden="true" />
						料金を見る
					</Button>
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
		<section class="space-y-4" aria-labelledby="portal-heading">
			<div class="space-y-2">
				<p class={sectionEyebrowClass}>ログイン入口</p>
				<h2 id="portal-heading" class={sectionHeadingClass}>役割に合わせて入口を選択</h2>
				<p class="max-w-[44rem] text-sm leading-relaxed text-muted-foreground">
					招待や予約確認が目的の場合は予約者ポータル、店舗や予約枠の運用は管理者ポータルを使います。
				</p>
			</div>

			<div class="grid gap-4 md:grid-cols-2">
				{#each portalCards as portal (portal.key)}
					<a
						class={`${panelClass} group block p-5 text-foreground no-underline transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
						href={portal.key === 'admin' ? adminLoginHref : participantLoginHref}
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
							<ArrowRight
								class="mt-1 size-4 shrink-0 text-primary"
								aria-hidden="true"
							/>
						</div>
						<p class="mt-4 text-sm font-bold text-link">{portal.ctaLabel}</p>
					</a>
				{/each}
			</div>

			<div class="rounded-md border border-dashed border-border bg-card p-4">
				<p class={sectionEyebrowClass}>向いている運用</p>
				<ul class="mt-3 grid gap-2 text-sm text-secondary-foreground md:grid-cols-3">
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

			<div class="grid gap-4 md:grid-cols-2">
				{#each challengeCards as item (item.title)}
					<Card class={panelClass}>
						<CardHeader class="space-y-2 pb-0">
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

		<section class="space-y-4" aria-labelledby="feature-heading">
			<div class="space-y-2">
				<p class={sectionEyebrowClass}>主要機能</p>
				<h2 id="feature-heading" class={sectionHeadingClass}>役割ごとに必要な機能を配置</h2>
			</div>

			<div class="grid gap-4 md:grid-cols-2">
				{#each featureColumns as feature (feature.title)}
					<Card class={panelClass}>
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

		<section id="pricing" class="scroll-mt-24 space-y-4" aria-labelledby="pricing-heading">
			<div class="space-y-2">
				<p class={sectionEyebrowClass}>料金</p>
				<h2 id="pricing-heading" class={sectionHeadingClass}>料金プラン</h2>
				<p class="max-w-[44rem] text-sm leading-relaxed text-muted-foreground">
					運用規模に応じて、Free / Premium の 2 プランから選べます。
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
							<p class="metric-value text-2xl font-bold leading-tight text-foreground">
								{plan.price}
							</p>
							<CardDescription>{plan.description}</CardDescription>
						</CardHeader>
						<CardContent class="space-y-4 pt-4">
							<ul class="space-y-2 text-sm text-secondary-foreground">
								{#each plan.highlights as highlight (highlight)}
									<li class={listTileClass}>{highlight}</li>
								{/each}
							</ul>
							<Button href={adminLoginHref} variant={plan.ctaVariant} class="w-full">
								<LogIn class="size-4" aria-hidden="true" />
								{plan.ctaLabel}
							</Button>
						</CardContent>
					</Card>
				{/each}
			</div>

			<Card class={panelClass}>
				<CardHeader class="pb-0">
					<CardTitle class="text-base">プラン比較</CardTitle>
				</CardHeader>
				<CardContent class="pt-4">
					<div class="overflow-x-auto">
						<table class="w-full min-w-[560px] text-sm">
							<thead class="bg-secondary text-muted-foreground">
								<tr>
									<th scope="col" class="px-3 py-2 text-left font-medium">項目</th>
									<th scope="col" class="px-3 py-2 text-left font-medium">Free</th>
									<th scope="col" class="px-3 py-2 text-left font-medium">Premium</th>
								</tr>
							</thead>
							<tbody>
								{#each comparisonRows as row (row.feature)}
									<tr class="border-t border-border/70">
										<th scope="row" class="px-3 py-2 text-left font-medium text-foreground">
											{row.feature}
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

		<section>
			<Card class="surface-panel rounded-md border border-primary/20 bg-card shadow-sm">
				<CardContent
					class="flex flex-col gap-5 p-5 md:flex-row md:items-end md:justify-between md:p-6"
				>
					<div class="space-y-2">
						<p class="text-xs font-bold text-primary">利用開始</p>
						<h2 class="text-xl font-bold text-foreground">まずは入口を選択してください</h2>
						<p class="max-w-[44rem] text-sm leading-relaxed text-secondary-foreground">
							管理者は設定と運用、予約者は予約確認と招待対応から始められます。
						</p>
					</div>

					<div class="flex flex-col gap-3 sm:flex-row">
						<Button href={adminLoginHref} class="w-full sm:w-auto">
							<LogIn class="size-4" aria-hidden="true" />
							管理者としてログイン
						</Button>
						<Button href={participantLoginHref} variant="outline" class="w-full sm:w-auto">
							<Users class="size-4" aria-hidden="true" />
							予約者としてログイン
						</Button>
					</div>
				</CardContent>
			</Card>
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
					{#each footerLinks as link (link.href)}
						<a class={linkClass} href={link.href} target="_blank" rel="noreferrer">
							{link.label}
							<ExternalLink class="size-3.5" aria-hidden="true" />
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

			<Button href="#portal-entry" variant="outline" class="w-full sm:w-auto">
				<ArrowDown class="size-4" aria-hidden="true" />
				ログイン入口へ
			</Button>
		</div>
	</footer>
</main>
