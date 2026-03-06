<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Building2, CalendarDays, Settings, ShieldCheck, Users } from '@lucide/svelte';

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

	const challengeCards = [
		{
			title: '複数ツール運用で手間が増える',
			challenge: '受付表、連絡、集計が分断されると、日々の運用が煩雑になります。',
			solution: 'Reserve Appで受付・通知・管理を一元化して、運用工数を減らします。'
		},
		{
			title: '予約導線が分かりにくい',
			challenge: '管理者と参加者で操作が混ざると、導線ミスや問い合わせが増えます。',
			solution: '管理者/予約者の入口を分離し、役割ごとに迷わないUIを提供します。'
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
				'サービス・単発Slot・定期Scheduleの作成',
				'予約ステータス管理（承認/却下/キャンセル）',
				'管理者招待・参加者管理・契約管理'
			]
		},
		{
			title: '予約者向け機能',
			description: '予約体験をシンプルに保つ参加者向け導線',
			icon: CalendarDays,
			items: ['公開イベントの閲覧と予約', '予約確認・キャンセル', '参加者招待/管理者招待への対応']
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
			description: '単発/定期の予約枠を公開して受付を開始します。',
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
		name: 'Free' | 'Standard' | 'Business';
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
			name: 'Standard',
			price: '¥9,800 / 月',
			description: '日常運用を安定化したい一般運用向け',
			recommended: true,
			highlights: ['管理者/予約者導線分離', '単発/定期スケジュール運用', '招待・予約運用機能'],
			ctaLabel: '導入を始める',
			ctaPortal: 'admin',
			ctaVariant: 'default'
		},
		{
			name: 'Business',
			price: '¥29,800 / 月',
			description: '多拠点・高度運用を想定した上位プラン',
			highlights: ['高度な運用設計サポート', '組織運用強化機能', '優先サポート（予定）'],
			ctaLabel: '導入相談をする',
			ctaPortal: 'admin',
			ctaVariant: 'outline'
		}
	];

	const comparisonRows: Array<{ feature: string; free: string; standard: string; business: string }> = [
		{
			feature: '予約受付',
			free: '基本機能',
			standard: '拡張運用',
			business: '高度運用'
		},
		{
			feature: '管理者導線',
			free: '限定',
			standard: 'フル対応',
			business: 'フル対応'
		},
		{
			feature: 'サポート',
			free: 'コミュニティ',
			standard: '標準',
			business: '優先（予定）'
		}
	];
</script>

<a
	href="#main-content"
	class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
>
	メインコンテンツへスキップ
</a>

<main id="main-content" class="relative min-h-screen overflow-hidden">
	<div
		class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.16),transparent_48%),radial-gradient(circle_at_80%_8%,rgba(15,118,110,0.12),transparent_38%)]"
	></div>
	<div class="relative mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 md:px-8 md:py-10">
		<header class="surface-panel relative overflow-hidden rounded-3xl border border-slate-200/80 p-6 shadow-xl md:p-8">
			<div
				class="pointer-events-none absolute right-[-96px] top-[-120px] h-72 w-72 rounded-full bg-primary/15 blur-3xl"
			></div>
			<div class="relative grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start">
				<div class="space-y-5">
					<Badge variant="outline">予約運用を一元化</Badge>
					<h1 class="text-3xl font-semibold tracking-tight text-slate-900 md:text-5xl">
						予約運用を、ひとつの画面で。
					</h1>
					<p class="max-w-2xl text-sm leading-relaxed text-slate-600 md:text-base">
						Reserve App は、管理者と予約者の導線を分離しながら、予約作成・受付運用・参加者対応を
						一体で管理できる予約プラットフォームです。
					</p>
					{#if nextPath}
						<p class="rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-xs text-slate-700">
							ログイン後の遷移先: {nextPath}
						</p>
					{/if}
					<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
						<Button href={adminLoginHref} class="w-full sm:w-auto">管理者としてログイン</Button>
						<Button href={participantLoginHref} variant="outline" class="w-full sm:w-auto">
							予約者としてログイン
						</Button>
						<Button href="#pricing" variant="outline" class="w-full sm:w-auto">料金を見る</Button>
					</div>
				</div>

				<div class="grid gap-4">
					{#each portalCards as portal (portal.title)}
						<Card class="border-slate-200/80 bg-white/90 shadow-sm">
							<CardHeader class="space-y-2">
								<CardTitle class="flex items-center gap-2 text-base">
									<portal.icon class="size-4 text-primary" aria-hidden="true" />
									{portal.title}
								</CardTitle>
								<CardDescription>{portal.description}</CardDescription>
							</CardHeader>
						</Card>
					{/each}
				</div>
			</div>
		</header>

		<section class="space-y-4">
			<div class="space-y-2">
				<Badge variant="secondary">課題と解決</Badge>
				<h2 class="text-2xl font-semibold text-slate-900 md:text-3xl">
					予約運用のボトルネックを、実務視点で解消
				</h2>
			</div>
			<div class="grid gap-4 md:grid-cols-2">
				{#each challengeCards as item (item.title)}
					<Card class="surface-panel border-slate-200/80 shadow-md">
						<CardHeader class="space-y-2">
							<CardTitle class="text-lg">{item.title}</CardTitle>
							<CardDescription>{item.challenge}</CardDescription>
						</CardHeader>
						<CardContent>
							<p class="rounded-md border border-emerald-200/70 bg-emerald-50/70 px-3 py-2 text-sm text-emerald-900">
								{item.solution}
							</p>
						</CardContent>
					</Card>
				{/each}
			</div>
		</section>

		<section class="space-y-4">
			<div class="space-y-2">
				<Badge variant="secondary">主要機能</Badge>
				<h2 class="text-2xl font-semibold text-slate-900 md:text-3xl">役割ごとに最適化された機能セット</h2>
			</div>
			<div class="grid gap-4 md:grid-cols-2">
				{#each featureColumns as feature (feature.title)}
					<Card class="surface-panel border-slate-200/80 shadow-md">
						<CardHeader class="space-y-2">
							<CardTitle class="flex items-center gap-2 text-lg">
								<feature.icon class="size-4 text-primary" aria-hidden="true" />
								{feature.title}
							</CardTitle>
							<CardDescription>{feature.description}</CardDescription>
						</CardHeader>
						<CardContent>
							<ul class="space-y-2 text-sm text-slate-700">
								{#each feature.items as line (line)}
									<li class="rounded-md border border-slate-200/70 bg-white/70 px-3 py-2">{line}</li>
								{/each}
							</ul>
						</CardContent>
					</Card>
				{/each}
			</div>
		</section>

		<section class="space-y-4">
			<div class="space-y-2">
				<Badge variant="secondary">導入フロー</Badge>
				<h2 class="text-2xl font-semibold text-slate-900 md:text-3xl">最短4ステップで導入開始</h2>
			</div>
			<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				{#each onboardingSteps as step, index (step.title)}
					<Card class="surface-panel border-slate-200/80 shadow-sm">
						<CardHeader class="space-y-2">
							<p class="text-xs font-semibold tracking-wide text-primary">STEP {index + 1}</p>
							<CardTitle class="flex items-center gap-2 text-base">
								<step.icon class="size-4 text-primary" aria-hidden="true" />
								{step.title}
							</CardTitle>
						</CardHeader>
						<CardContent>
							<p class="text-sm text-slate-700">{step.description}</p>
						</CardContent>
					</Card>
				{/each}
			</div>
		</section>

		<section id="pricing" class="scroll-mt-24 space-y-4">
			<div class="space-y-2">
				<Badge variant="secondary">Pricing</Badge>
				<h2 class="text-2xl font-semibold text-slate-900 md:text-3xl">料金プラン</h2>
				<p class="text-sm text-slate-600">運用規模に合わせて選べる3プランを用意しています。</p>
			</div>

			<div class="grid gap-4 md:grid-cols-3">
				{#each pricingPlans as plan (plan.name)}
					<Card
						class={`surface-panel border-slate-200/80 shadow-md ${plan.recommended ? 'ring-2 ring-primary/40' : ''}`}
					>
						<CardHeader class="space-y-2">
							<div class="flex items-center justify-between gap-3">
								<CardTitle class="text-xl">{plan.name}</CardTitle>
								{#if plan.recommended}
									<Badge>おすすめ</Badge>
								{/if}
							</div>
							<p class="text-2xl font-semibold text-slate-900">{plan.price}</p>
							<CardDescription>{plan.description}</CardDescription>
						</CardHeader>
						<CardContent class="space-y-4">
							<ul class="space-y-2 text-sm text-slate-700">
								{#each plan.highlights as highlight (highlight)}
									<li class="rounded-md border border-slate-200/70 bg-white/70 px-3 py-2">{highlight}</li>
								{/each}
							</ul>
							<Button
								href={plan.ctaPortal === 'admin' ? adminLoginHref : participantLoginHref}
								variant={plan.ctaVariant}
								class="w-full"
								>{plan.ctaLabel}</Button
							>
						</CardContent>
					</Card>
				{/each}
			</div>

			<Card class="surface-panel border-slate-200/80 shadow-sm">
				<CardHeader>
					<CardTitle class="text-base">プラン比較</CardTitle>
				</CardHeader>
				<CardContent>
					<div class="overflow-x-auto">
						<table class="w-full min-w-[560px] text-sm">
							<thead class="bg-slate-50 text-slate-600">
								<tr>
									<th class="px-3 py-2 text-left font-medium">項目</th>
									<th class="px-3 py-2 text-left font-medium">Free</th>
									<th class="px-3 py-2 text-left font-medium">Standard</th>
									<th class="px-3 py-2 text-left font-medium">Business</th>
								</tr>
							</thead>
							<tbody>
								{#each comparisonRows as row (row.feature)}
									<tr class="border-t border-slate-200/70">
										<td class="px-3 py-2 font-medium text-slate-900">{row.feature}</td>
										<td class="px-3 py-2 text-slate-700">{row.free}</td>
										<td class="px-3 py-2 text-slate-700">{row.standard}</td>
										<td class="px-3 py-2 text-slate-700">{row.business}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</CardContent>
			</Card>
		</section>

		<section>
			<Card class="surface-panel border-slate-200/80 bg-slate-900 text-slate-100 shadow-xl">
				<CardHeader class="space-y-2">
					<CardTitle class="text-2xl">まずは入口を選んで、運用を開始しましょう</CardTitle>
					<CardDescription class="text-slate-300">
						管理者は設定と運用、予約者は予約確認と参加者対応。役割に応じた入口からすぐ利用できます。
					</CardDescription>
				</CardHeader>
				<CardContent class="flex flex-col gap-3 sm:flex-row">
					<Button href={adminLoginHref} class="w-full sm:w-auto">管理者としてログイン</Button>
					<Button href={participantLoginHref} variant="outline" class="w-full border-slate-500 text-slate-100 hover:bg-slate-800 sm:w-auto">
						予約者としてログイン
					</Button>
				</CardContent>
			</Card>
		</section>
	</div>
</main>
