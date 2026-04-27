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
		createOrganizationBillingPaymentMethod,
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

	type OrganizationBillingHistoryEntry = Exclude<
		OrganizationBillingPayload['history'],
		null | undefined
	>[number];

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
	const formatJaDateTime = (value: string | null | undefined) =>
		value
			? new Date(value).toLocaleString('ja-JP', {
					dateStyle: 'medium',
					timeStyle: 'short'
				})
			: '日時未記録';
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
	const paidTierLabel = $derived.by(() => {
		if (billing?.paidTier?.label) {
			return billing.paidTier.label;
		}
		return billing?.planCode === 'premium' ? 'Premium' : 'Free';
	});
	const showUnknownPaidTierNotice = $derived(
		billing?.paidTier?.resolution === 'unknown_price'
	);
	const billingIntervalLabel = $derived(
		billing?.billingInterval === 'month'
			? '月額'
			: billing?.billingInterval === 'year'
				? '年額'
				: 'なし'
	);
	const trialEndsAtLabel = $derived(formatJaDate(billing?.trialEndsAt));
	const currentPeriodEndLabel = $derived(formatJaDate(billing?.currentPeriodEnd));
	const paymentMethodStatusLabel = $derived.by(() => {
		switch (billing?.paymentMethodStatus) {
			case 'registered':
				return '登録済み';
			case 'pending':
				return '登録手続き中';
			default:
				return '未登録';
		}
	});
	const paymentMethodStatusDescription = $derived.by(() => {
		switch (billing?.paymentMethodStatus) {
			case 'registered':
				return '支払い方法の登録を確認しました。トライアル終了後の継続準備が完了しています。';
			case 'pending':
				return 'Stripe 側の更新を確認中です。反映まで数秒かかる場合があります。';
			default:
				return 'トライアル期間中に支払い方法を登録すると、継続判断をスムーズに進められます。';
		}
	});
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
	const billingHistoryEntries = $derived.by(() => {
		if (!billing) {
			return null;
		}
		if (Array.isArray(billing.history)) {
			return billing.history;
		}
		return billing.canManageBilling ? [] : null;
	});
	const actionHeading = $derived(showOwnerActions ? '管理アクション' : '閲覧専用');
	const actionDescription = $derived.by(() => {
		if (!showOwnerActions) {
			return '契約状態は確認できますが、契約変更と支払い設定は organization owner のみが扱います。';
		}
		if (billing?.planState === 'free') {
			return 'organization owner はこの billing workspace から 7日間のPremiumトライアルを開始し、反映後の契約状態をここで確認できます。';
		}
		if (billing?.planState === 'premium_trial') {
			return billing.paymentMethodStatus === 'registered'
				? 'organization owner はトライアル継続準備が完了していることをこの画面で確認できます。必要なら状態を見直し、他ロールは閲覧のみ行えます。'
				: 'organization owner はこの billing workspace から支払い方法登録へ進み、トライアル終了前の継続準備を進められます。';
		}
		return 'organization owner は現在の契約状態を確認し、必要に応じて Stripe Customer Portal でプラン変更を開始できます。';
	});
	const ownerAuthorityNote =
		'契約変更と支払い設定は organization owner のみです。教室や参加者の運用権限とは分かれて管理されます。';
	const readOnlyAuthorityNote =
		'あなたの role では契約状態の閲覧のみ可能です。教室や参加者の運用権限があっても、billing authority は付与されません。';
	const readOnlyHistoryNote =
		'契約履歴の詳細は organization owner のみ確認できます。必要な場合は owner に確認を依頼してください。';
	const accessibleLifecycleSummary = $derived.by(() => {
		if (!billingReady || !billing) {
			return '';
		}

		switch (billing.planState) {
			case 'premium_trial':
				return `現在はPremiumトライアル中です。終了予定日は ${trialEndsAtLabel} で、同じ組織で新しいトライアルを重ねて開始することはできません。支払い方法の登録状況は ${paymentMethodStatusLabel} です。`;
			case 'premium_paid':
				return '現在はPremiumプラン利用中です。契約状態の確認と契約管理はできますが、契約変更と支払い設定は organization owner のみが実行できます。';
			default:
				return '現在は無料プランです。7日間のPremiumトライアルを開始できるのは organization owner のみで、この操作ではまだ支払い方法は登録されません。';
		}
	});
	const routeStatusNotice = $derived.by(() => {
		const paymentMethodResult = page.url.searchParams.get('paymentMethod');
		if (paymentMethodResult === 'success') {
			return billing?.paymentMethodStatus === 'registered'
				? {
						tone: 'success' as const,
						message: '支払い方法の登録を確認しました。トライアル終了後の継続準備が完了しています。'
					}
				: {
						tone: 'info' as const,
						message: '支払い方法の更新状況を確認しています。反映まで数秒かかる場合があります。'
					};
		}
		if (paymentMethodResult === 'cancel') {
			return {
				tone: 'info' as const,
				message: '支払い方法の登録をキャンセルしました。必要になったら再度お試しください。'
			};
		}
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
				return 'border-success/30 bg-success/10 text-foreground';
			case 'error':
				return 'border-destructive/30 bg-destructive/10 text-foreground';
			default:
				return 'border-warning/45 bg-warning/15 text-warning-foreground';
		}
	});
	const resolveHistoryTypeLabel = (
		eventType: OrganizationBillingHistoryEntry['eventType']
	): string => {
		switch (eventType) {
			case 'plan_transition':
				return '契約変更';
			case 'notification':
				return '通知';
			default:
				return '状態確認';
		}
	};
	const resolveHistoryToneClassName = (
		tone: OrganizationBillingHistoryEntry['tone']
	): string => {
		switch (tone) {
			case 'positive':
				return 'border-success/30 bg-success/10';
			case 'attention':
				return 'border-warning/45 bg-warning/10';
			default:
				return 'border-border/80 bg-secondary/40';
		}
	};

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

	const startPaymentMethodRegistration = async () => {
		if (!activeOrganization?.id) {
			return;
		}

		busy = true;
		localStatusNotice = {
			tone: 'info',
			message: '支払い方法登録画面へ移動しています。'
		};
		try {
			const result = await createOrganizationBillingPaymentMethod({
				organizationId: activeOrganization.id
			});
			if (!result.ok || !result.url) {
				localStatusNotice = { tone: 'error', message: result.message };
				toast.error(result.message);
				return;
			}
			window.location.href = result.url;
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
				const paymentMethodResult = page.url.searchParams.get('paymentMethod');
				if (paymentMethodResult === 'success') {
					toast.message('支払い方法の更新状況を確認しています。');
				}
				if (paymentMethodResult === 'cancel') {
					toast.message('支払い方法の登録をキャンセルしました。');
				}
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold text-foreground">契約</h1>
		<p class="text-sm text-muted-foreground">
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
		<Card class="surface-panel border-border/80 shadow-md">
			<CardHeader>
				<h2 class="text-sm font-semibold text-secondary-foreground">利用中の組織</h2>
			</CardHeader>
			<CardContent>
				{#if loading}
					<p class="text-sm text-muted-foreground" aria-live="polite">契約情報を確認しています…</p>
				{:else}
					<p class="text-lg font-semibold text-foreground">{activeOrganizationLabel}</p>
				{/if}
			</CardContent>
		</Card>

		<Card class="surface-panel border-border/80 shadow-md">
			<CardHeader>
				<h2 class="text-sm font-semibold text-secondary-foreground">現在プラン</h2>
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
					<p class="text-sm text-secondary-foreground">{currentPlanDescription}</p>
					<p class="text-sm text-secondary-foreground">契約ティア: {paidTierLabel}</p>
					{#if showUnknownPaidTierNotice}
						<p class="text-sm text-muted-foreground">
							契約ティアの詳細を確認中です。Premiumの基本機能は現在の契約状態に基づいて表示しています。
						</p>
					{/if}
					{#if billing?.planState === 'premium_trial'}
						<p class="text-sm text-secondary-foreground">トライアル終了日: {trialEndsAtLabel}</p>
						<p class="text-sm text-secondary-foreground">
							支払い方法の登録状況: {paymentMethodStatusLabel}
						</p>
						<p class="text-sm text-muted-foreground">{paymentMethodStatusDescription}</p>
					{/if}
					<p class="text-sm text-secondary-foreground">請求周期: {billingIntervalLabel}</p>
					<p class="text-sm text-secondary-foreground">次回更新日: {currentPeriodEndLabel}</p>
					<p class="text-sm text-secondary-foreground">
						解約予定: {billing?.cancelAtPeriodEnd ? '期間終了時に解約' : 'なし'}
					</p>
				{/if}
			</CardContent>
		</Card>
	</section>

	<section>
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardHeader>
				<h2 class="text-xl font-semibold text-foreground">{actionHeading}</h2>
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
					<div class="space-y-3">
						{#if billing.planState === 'premium_trial'}
							<div class="rounded-lg border border-border/80 bg-secondary/80 p-3">
								<p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
									支払い方法の登録状況
								</p>
								<p class="text-sm font-medium text-foreground">{paymentMethodStatusLabel}</p>
								<p class="text-sm text-muted-foreground">{paymentMethodStatusDescription}</p>
							</div>
						{/if}
						<p class="text-sm text-muted-foreground">
							{readOnlyAuthorityNote}
						</p>
					</div>
				{:else if billing.planState === 'free'}
					<div class="space-y-3">
						<p class="text-sm text-muted-foreground">
							7日間のPremiumトライアルでは、複数教室管理、スタッフ権限、定期スケジュールなどのPremium機能をまとめて確認できます。
						</p>
						<ul id="trial-entry-description" class="space-y-2 text-sm text-muted-foreground">
							<li>
								この操作ではまだ支払い方法は登録されません。継続設定は次のステップで案内されます。
							</li>
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
						<p class="text-sm text-muted-foreground">
							現在はPremiumトライアル中です。終了日まで Premium
							機能を確認でき、新しいトライアルを重ねて開始することはできません。
						</p>
						<div class="rounded-lg border border-border/80 bg-secondary/80 p-3">
							<p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								支払い方法の登録状況
							</p>
							<p class="text-sm font-medium text-foreground">{paymentMethodStatusLabel}</p>
							<p class="text-sm text-muted-foreground">{paymentMethodStatusDescription}</p>
						</div>
						<p class="text-sm text-muted-foreground">{ownerAuthorityNote}</p>
						{#if billing.paymentMethodStatus !== 'registered'}
							<div class="flex flex-col gap-3 sm:flex-row">
								<Button type="button" disabled={busy} onclick={startPaymentMethodRegistration}>
									支払い方法を登録
								</Button>
							</div>
						{/if}
					</div>
				{:else}
					<div class="space-y-3">
						<p class="text-sm text-muted-foreground">
							現在はPremiumプラン利用中です。プラン変更は Stripe
							の契約管理画面で進め、反映後の状態はこの画面で確認できます。
						</p>
						<p class="text-sm text-muted-foreground">{ownerAuthorityNote}</p>
						<div class="flex flex-col gap-3 sm:flex-row">
							<Button type="button" disabled={busy} onclick={redirectToBillingPortal}>
								プランを変更
							</Button>
						</div>
					</div>
				{/if}
			</CardContent>
		</Card>
	</section>

	<section>
		<Card class="surface-panel border-border/80 shadow-md">
			<CardHeader>
				<h2 class="text-xl font-semibold text-foreground">契約履歴</h2>
				<CardDescription>
					organization owner は、契約変更・通知・状態確認の履歴をこの画面から確認できます。
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				{#if loading}
					<p class="text-sm text-muted-foreground" aria-live="polite">
						契約履歴を確認しています。表示が反映されるまで少し時間がかかる場合があります。
					</p>
				{:else if !billing}
					<p class="text-sm text-muted-foreground">契約履歴を取得できませんでした。</p>
				{:else if !showOwnerActions}
					<p class="text-sm text-muted-foreground">{readOnlyHistoryNote}</p>
				{:else if !billingHistoryEntries || billingHistoryEntries.length === 0}
					<p class="text-sm text-muted-foreground">
						まだ表示できる契約履歴はありません。トライアル開始や契約更新が記録されると、ここに反映されます。
					</p>
				{:else}
					<ul class="space-y-3">
						{#each billingHistoryEntries as entry (entry.id)}
							<li class={`rounded-lg border p-4 ${resolveHistoryToneClassName(entry.tone)}`}>
								<div class="flex flex-wrap items-center gap-2">
									<Badge variant={entry.tone === 'positive' ? 'default' : 'secondary'}>
										{resolveHistoryTypeLabel(entry.eventType)}
									</Badge>
									<span class="text-xs text-muted-foreground">
										{formatJaDateTime(entry.occurredAt)}
									</span>
								</div>
								<p class="mt-3 text-sm font-semibold text-foreground">{entry.title}</p>
								<p class="mt-1 text-sm text-secondary-foreground">{entry.summary}</p>
								{#if entry.billingContext}
									<p class="mt-2 text-xs text-muted-foreground">{entry.billingContext}</p>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</CardContent>
		</Card>
	</section>

	<section class="grid gap-4 lg:grid-cols-2">
		<Card class="surface-panel border-border/80 shadow-md">
			<CardHeader>
				<h2 class="text-xl font-semibold text-foreground">無料で使える機能</h2>
				<CardDescription>小規模運用を始めるための基本機能です。</CardDescription>
			</CardHeader>
			<CardContent>
				<ul class="space-y-2 text-sm text-secondary-foreground">
					{#each freePlanFeatures as feature (feature)}
						<li>{feature}</li>
					{/each}
				</ul>
			</CardContent>
		</Card>

		<Card class="surface-panel border-border/80 shadow-md">
			<CardHeader>
				<h2 class="text-xl font-semibold text-foreground">Premiumで使える機能</h2>
				<CardDescription>運営の拡張に合わせて解放される管理機能です。</CardDescription>
			</CardHeader>
			<CardContent>
				<ul class="space-y-2 text-sm text-secondary-foreground">
					{#each premiumPlanFeatures as feature (feature)}
						<li>{feature}</li>
					{/each}
				</ul>
			</CardContent>
		</Card>
	</section>
</main>
