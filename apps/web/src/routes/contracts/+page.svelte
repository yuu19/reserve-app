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
		createOrganizationBillingCheckout,
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

	const activeOrganizationLabel = $derived(
		activeOrganization?.name ?? activeOrganization?.id ?? '選択されていません'
	);
	const pathname = $derived(getRoutePathFromUrlPath(page.url.pathname));
	const currentPlanLabel = $derived(billing?.planCode === 'premium' ? 'Premium' : 'Free');
	const billingIntervalLabel = $derived(
		billing?.billingInterval === 'month'
			? '月額'
			: billing?.billingInterval === 'year'
				? '年額'
				: 'なし'
	);
	const currentPeriodEndLabel = $derived(
		billing?.currentPeriodEnd
			? new Date(billing.currentPeriodEnd).toLocaleDateString('ja-JP')
			: 'なし'
	);
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

	const redirectToStripeCheckout = async (billingInterval: 'month' | 'year') => {
		if (!activeOrganization?.id) {
			return;
		}
		busy = true;
		try {
			const result = await createOrganizationBillingCheckout({
				organizationId: activeOrganization.id,
				billingInterval
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
		<p class="text-sm text-slate-600">組織の現在プランと Stripe 契約管理を確認できます。</p>
	</header>

	<section class="grid gap-4 md:grid-cols-2">
		<Card class="surface-panel border-slate-200/80 shadow-md">
			<CardHeader>
				<h2 class="text-sm font-semibold text-slate-700">利用中の組織</h2>
			</CardHeader>
			<CardContent>
				{#if loading}
					<p class="text-sm text-muted-foreground">確認中…</p>
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
				<div class="flex items-center gap-2">
					<Badge variant={billing?.planCode === 'premium' ? 'default' : 'outline'}>
						{currentPlanLabel}
					</Badge>
					<Badge variant="secondary">{subscriptionStatusLabel}</Badge>
				</div>
				<p class="text-sm text-slate-700">請求周期: {billingIntervalLabel}</p>
				<p class="text-sm text-slate-700">次回更新日: {currentPeriodEndLabel}</p>
				<p class="text-sm text-slate-700">
					解約予定: {billing?.cancelAtPeriodEnd ? '期間終了時に解約' : 'なし'}
				</p>
			</CardContent>
		</Card>
	</section>

	<section>
		<Card class="surface-panel border-slate-200/80 shadow-lg">
			<CardHeader>
				<h2 class="text-xl font-semibold text-slate-900">管理アクション</h2>
				<CardDescription>
					owner は Premium 申込と Stripe Customer Portal での契約管理ができます。admin
					は閲覧のみです。
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				{#if loading}
					<p class="text-sm text-muted-foreground">契約情報を取得しています…</p>
				{:else if !billing}
					<p class="text-sm text-muted-foreground">契約情報を取得できませんでした。</p>
				{:else if billing.planCode === 'free'}
					<div class="flex flex-col gap-3 sm:flex-row">
						<Button
							type="button"
							disabled={busy || !billing.canManageBilling}
							onclick={() => redirectToStripeCheckout('month')}
						>
							Premium 月額へアップグレード
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={busy || !billing.canManageBilling}
							onclick={() => redirectToStripeCheckout('year')}
						>
							Premium 年額へアップグレード
						</Button>
					</div>
				{:else}
					<div class="flex flex-col gap-3 sm:flex-row">
						<Button
							type="button"
							disabled={busy || !billing.canManageBilling}
							onclick={redirectToBillingPortal}
						>
							契約を管理
						</Button>
					</div>
				{/if}

				{#if billing && !billing.canManageBilling}
					<p class="text-sm text-slate-600">
						請求管理は owner 権限のみ実行できます。admin は契約状態の閲覧のみ可能です。
					</p>
				{/if}
			</CardContent>
		</Card>
	</section>
</main>
