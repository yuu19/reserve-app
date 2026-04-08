<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import {
		createOrganizationBillingTrial,
		createOrganizationBillingPortal,
		loadOrganizationBilling,
		loadOrganizations
	} from '$lib/features/organization-context.svelte';
	import {
		getCurrentPathWithSearch,
		loadPortalAccess,
		loadSession,
		redirectToLoginWithNext,
		resolvePortalHomePath
	} from '$lib/features/auth-session.svelte';
	import { getRoutePathFromUrlPath } from '$lib/features/scoped-routing';
	import type { OrganizationBillingPayload, OrganizationPayload } from '$lib/rpc-client';

	let loading = $state(true);
	let busy = $state(false);
	let activeOrganization = $state<OrganizationPayload | null>(null);
	let billing = $state<OrganizationBillingPayload | null>(null);
	let localStatusNotice = $state<{ tone: 'info' | 'success' | 'error'; message: string } | null>(
		null
	);

	const freePlanFeatures = [
		'1組織・1教室での基本運用',
		'単発予約枠の公開と受付',
		'基本的な参加者管理'
	];

	const premiumPlanFeatures = [
		'複数教室・複数拠点の管理',
		'スタッフ招待と権限管理',
		'定期スケジュール運用',
		'承認制予約フロー',
		'回数券・月額課金などの継続運用',
		'契約管理と分析機能'
	];

	const activeOrganizationLabel = $derived(
		activeOrganization?.name ?? activeOrganization?.id ?? '選択されていません'
	);
	const pathname = $derived(getRoutePathFromUrlPath(page.url.pathname));
	const billingReady = $derived(billing !== null);
	const formatJaDate = (value: string | null | undefined) =>
		value ? new Date(value).toLocaleDateString('ja-JP') : 'なし';
	const currentPlanLabel = $derived.by(() => {
		switch (billing?.planState) {
			case 'premium_trial':
				return 'プレミアムトライアル';
			case 'premium_paid':
				return 'Premiumプラン';
			default:
				return '無料プラン';
		}
	});
	const currentPlanDescription = $derived.by(() => {
		switch (billing?.planState) {
			case 'premium_trial':
				return 'Premium機能の確認期間中です。終了日までに継続判断を進めれば、運営への影響を抑えられます。';
			case 'premium_paid':
				return 'Premium機能を利用中です。契約変更と支払い設定は owner のみが実行し、他ロールは状態確認のみ行えます。';
			default:
				return '無料プランで基本運用を続けながら、Premiumトライアルで複数教室管理やスタッフ権限などの拡張機能を7日間確認できます。';
		}
	});
	const billingIntervalLabel = $derived(
		billing?.billingInterval === 'month'
			? '月額'
			: billing?.billingInterval === 'year'
				? '年額'
				: 'なし'
	);
	const trialEndsAtLabel = $derived(formatJaDate(billing?.trialEndsAt));
	const currentPeriodEndLabel = $derived(formatJaDate(billing?.currentPeriodEnd));
	const subscriptionStatusLabel = $derived.by(() => {
		switch (billing?.subscriptionStatus) {
			case 'trialing':
				return 'トライアル中';
			case 'active':
				return '有効';
			case 'past_due':
				return '支払い遅延';
			case 'canceled':
				return '解約済み';
			case 'unpaid':
				return '未払い';
			case 'incomplete':
				return '処理中';
			default:
				return 'Free';
		}
	});
	const showOwnerActions = $derived(Boolean(billing?.canManageBilling));
	const actionHeading = $derived(showOwnerActions ? '管理アクション' : '閲覧専用');
	const actionDescription = $derived.by(() => {
		if (!showOwnerActions) {
			return '契約状態は確認できますが、契約変更と支払い設定は organization owner のみが扱います。';
		}
		if (billing?.planState === 'free') {
			return 'organization owner はこの billing workspace から 7日間のPremiumトライアルを開始し、反映後の契約状態をここで確認できます。';
		}
		return 'organization owner は現在の契約状態を確認し、必要に応じて Stripe Customer Portal で管理できます。';
	});
	const ownerAuthorityNote =
		'契約変更と支払い設定は organization owner のみです。教室や参加者の運用権限とは分かれて管理されます。';
	const readOnlyAuthorityNote =
		'あなたの role では契約状態の閲覧のみ可能です。教室や参加者の運用権限があっても、billing authority は付与されません。';
	const accessibleLifecycleSummary = $derived.by(() => {
		if (!billingReady || !billing) {
			return '';
		}

		switch (billing.planState) {
			case 'premium_trial':
				return `現在はPremiumトライアル中です。終了予定日は ${trialEndsAtLabel} で、同じ組織で新しいトライアルを重ねて開始することはできません。`;
			case 'premium_paid':
				return '現在はPremiumプラン利用中です。契約状態の確認と契約管理はできますが、契約変更と支払い設定は organization owner のみが実行できます。';
			default:
				return '現在は無料プランです。7日間のPremiumトライアルを開始できるのは organization owner のみで、この操作ではまだ支払い方法は登録されません。';
		}
	});
	const routeStatusNotice = $derived.by(() => {
		const subscriptionResult = page.url.searchParams.get('subscription');
		if (subscriptionResult === 'success') {
			return {
				tone: 'info' as const,
				message: 'Premium の申込処理を開始しました。反映まで数秒かかる場合があります。'
			};
		}
		if (subscriptionResult === 'cancel') {
			return {
				tone: 'info' as const,
				message: 'Premium の申込をキャンセルしました。必要になったら再度お試しください。'
			};
		}
		return null;
	});
	const currentStatusNotice = $derived.by(() => localStatusNotice ?? routeStatusNotice);
	const statusNoticeClassName = $derived.by(() => {
		switch (currentStatusNotice?.tone) {
			case 'success':
				return 'border-emerald-200 bg-emerald-50/80 text-emerald-900';
			case 'error':
				return 'border-rose-200 bg-rose-50/80 text-rose-900';
			default:
				return 'border-amber-200 bg-amber-50/80 text-amber-900';
		}
	});

	const refreshContracts = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}

		const portalAccess = await loadPortalAccess();
		if (pathname === '/contracts') {
			const nextPath = portalAccess.hasOrganizationAdminAccess
				? '/admin/contracts'
				: (resolvePortalHomePath(portalAccess) ?? '/participant/home');
			await goto(resolve(nextPath));
			return;
		}
		if (!portalAccess.hasOrganizationAdminAccess) {
			await goto(resolve(resolvePortalHomePath(portalAccess) ?? '/participant/home'));
			return;
		}

		const { activeOrganization: nextActiveOrganization } = await loadOrganizations();
		activeOrganization = nextActiveOrganization;
		if (!nextActiveOrganization?.id) {
			billing = null;
			return;
		}

		const billingResult = await loadOrganizationBilling(nextActiveOrganization.id);
		if (!billingResult.ok) {
			toast.error(billingResult.message);
			billing = null;
			return;
		}
		billing = billingResult.billing;
	};

	const startPremiumTrial = async () => {
		if (!activeOrganization?.id) {
			return;
		}

		busy = true;
		localStatusNotice = {
			tone: 'info',
			message: '7日間のPremiumトライアルを開始しています。契約状態の反映を確認中です。'
		};
		try {
			const result = await createOrganizationBillingTrial({
				organizationId: activeOrganization.id
			});
			if (!result.ok) {
				localStatusNotice = { tone: 'error', message: result.message };
				toast.error(result.message);
				return;
			}

			const billingResult = await loadOrganizationBilling(activeOrganization.id);
			if (billingResult.ok && billingResult.billing) {
				billing = billingResult.billing;
				localStatusNotice =
					billingResult.billing.planState === 'premium_trial' && billingResult.billing.trialEndsAt
						? {
								tone: 'success',
								message: `7日間のPremiumトライアルを開始しました。終了日は ${formatJaDate(billingResult.billing.trialEndsAt)} です。`
							}
						: {
								tone: 'info',
								message: '7日間のPremiumトライアルを開始しました。契約状態の反映を確認中です。'
							};
			} else {
				localStatusNotice = {
					tone: 'info',
					message: '7日間のPremiumトライアルを開始しました。契約状態の反映を確認中です。'
				};
			}
			toast.success('7日間のPremiumトライアルを開始しました。');
		} finally {
			busy = false;
		}
	};

	const redirectToBillingPortal = async () => {
		if (!activeOrganization?.id) {
			return;
		}
		busy = true;
		try {
			const result = await createOrganizationBillingPortal({
				organizationId: activeOrganization.id
			});
			if (!result.ok || !result.url) {
				toast.error(result.message);
				return;
			}
			window.location.href = result.url;
		} finally {
			busy = false;
		}
	};

	onMount(() => {
		void (async () => {
			loading = true;
			try {
				await refreshContracts();
				const subscriptionResult = page.url.searchParams.get('subscription');
				if (subscriptionResult === 'success') {
					toast.success('Premium の申込処理を開始しました。反映まで数秒かかる場合があります。');
				}
				if (subscriptionResult === 'cancel') {
					toast.message('Premium の申込をキャンセルしました。');
				}
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold text-slate-900">契約</h1>
		<p class="text-sm text-slate-600">
			組織の現在プラン、Premiumの価値、継続判断に必要な状態を確認できます。
		</p>
	</header>

	{#if currentStatusNotice}
		<section>
			<Card class={`surface-panel shadow-sm ${statusNoticeClassName}`}>
				<CardContent class="py-4">
					<p role="status" aria-live="polite" class="text-sm font-medium">
						{currentStatusNotice.message}
					</p>
				</CardContent>
			</Card>
		</section>
	{/if}

	<section class="grid gap-4 md:grid-cols-2">
		<Card class="surface-panel border-slate-200/80 shadow-md">
			<CardHeader>
				<h2 class="text-sm font-semibold text-slate-700">利用中の組織</h2>
			</CardHeader>
			<CardContent>
				{#if loading}
					<p class="text-sm text-muted-foreground" aria-live="polite">契約情報を確認しています…</p>
				{:else}
					<p class="text-lg font-semibold text-slate-900">{activeOrganizationLabel}</p>
				{/if}
			</CardContent>
		</Card>

		<Card class="surface-panel border-slate-200/80 shadow-md">
			<CardHeader>
				<h2 class="text-sm font-semibold text-slate-700">現在プラン</h2>
			</CardHeader>
			<CardContent class="space-y-3">
				{#if loading}
					<p class="text-sm text-muted-foreground" aria-live="polite">
						契約情報を確認しています。表示が反映されるまで少し時間がかかる場合があります。
					</p>
				{:else if !billingReady}
					<p class="text-sm text-muted-foreground">契約情報を取得できませんでした。</p>
				{:else}
					<p class="sr-only">{accessibleLifecycleSummary}</p>
					<div class="flex flex-wrap items-center gap-2">
						<Badge variant={billing?.planState === 'free' ? 'outline' : 'default'}>
							{currentPlanLabel}
						</Badge>
						<Badge variant="secondary">{subscriptionStatusLabel}</Badge>
					</div>
					<p class="text-sm text-slate-700">{currentPlanDescription}</p>
					{#if billing?.planState === 'premium_trial'}
						<p class="text-sm text-slate-700">トライアル終了日: {trialEndsAtLabel}</p>
					{/if}
					<p class="text-sm text-slate-700">請求周期: {billingIntervalLabel}</p>
					<p class="text-sm text-slate-700">次回更新日: {currentPeriodEndLabel}</p>
					<p class="text-sm text-slate-700">
						解約予定: {billing?.cancelAtPeriodEnd ? '期間終了時に解約' : 'なし'}
					</p>
				{/if}
			</CardContent>
		</Card>
	</section>

	<section>
		<Card class="surface-panel border-slate-200/80 shadow-lg">
			<CardHeader>
				<h2 class="text-xl font-semibold text-slate-900">{actionHeading}</h2>
				<CardDescription>{actionDescription}</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				{#if loading}
					<p class="text-sm text-muted-foreground" aria-live="polite">
						契約情報を確認しています。表示が反映されるまで少し時間がかかる場合があります。
					</p>
				{:else if !billing}
					<p class="text-sm text-muted-foreground">契約情報を取得できませんでした。</p>
				{:else if !showOwnerActions}
					<p class="text-sm text-slate-600">
						{readOnlyAuthorityNote}
					</p>
				{:else if billing.planState === 'free'}
					<div class="space-y-3">
						<p class="text-sm text-slate-600">
							7日間のPremiumトライアルでは、複数教室管理、スタッフ権限、定期スケジュールなどのPremium機能をまとめて確認できます。
						</p>
						<ul id="trial-entry-description" class="space-y-2 text-sm text-slate-600">
							<li>この操作ではまだ支払い方法は登録されません。継続設定は次のステップで案内されます。</li>
							<li>{ownerAuthorityNote}</li>
							<li>トライアル開始後は、この画面で終了日と現在の契約状態を確認できます。</li>
						</ul>
						<Button
							type="button"
							aria-describedby="trial-entry-description"
							disabled={busy}
							onclick={startPremiumTrial}
						>
							7日間のPremiumトライアルを開始
						</Button>
					</div>
				{:else if billing.planState === 'premium_trial'}
					<div class="space-y-3">
						<p class="text-sm text-slate-600">
							現在はPremiumトライアル中です。終了日まで Premium 機能を確認でき、新しいトライアルを重ねて開始することはできません。
						</p>
						<p class="text-sm text-slate-600">{ownerAuthorityNote}</p>
					</div>
				{:else}
					<div class="space-y-3">
						<p class="text-sm text-slate-600">
							現在はPremiumプラン利用中です。重複した trial action は不要で、必要な契約変更は契約管理から進めます。
						</p>
						<p class="text-sm text-slate-600">{ownerAuthorityNote}</p>
						<div class="flex flex-col gap-3 sm:flex-row">
							<Button
								type="button"
								disabled={busy}
								onclick={redirectToBillingPortal}
							>
								契約を管理
							</Button>
						</div>
					</div>
				{/if}
			</CardContent>
		</Card>
	</section>

	<section class="grid gap-4 lg:grid-cols-2">
		<Card class="surface-panel border-slate-200/80 shadow-md">
			<CardHeader>
				<h2 class="text-xl font-semibold text-slate-900">無料で使える機能</h2>
				<CardDescription>小規模運用を始めるための基本機能です。</CardDescription>
			</CardHeader>
			<CardContent>
				<ul class="space-y-2 text-sm text-slate-700">
					{#each freePlanFeatures as feature (feature)}
						<li>{feature}</li>
					{/each}
				</ul>
			</CardContent>
		</Card>

		<Card class="surface-panel border-slate-200/80 shadow-md">
			<CardHeader>
				<h2 class="text-xl font-semibold text-slate-900">Premiumで使える機能</h2>
				<CardDescription>運営の拡張に合わせて解放される管理機能です。</CardDescription>
			</CardHeader>
			<CardContent>
				<ul class="space-y-2 text-sm text-slate-700">
					{#each premiumPlanFeatures as feature (feature)}
						<li>{feature}</li>
					{/each}
				</ul>
			</CardContent>
		</Card>
	</section>
</main>
