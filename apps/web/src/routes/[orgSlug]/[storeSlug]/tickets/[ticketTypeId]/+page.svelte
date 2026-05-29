<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { buildLoginRedirectHref } from '$lib/features/auth-portal';
	import { loadSession } from '$lib/features/auth-session.svelte';
	import { loadPublicTicketType } from '$lib/features/public-site.svelte';
	import type { PublicTicketTypePayload } from '$lib/rpc-client';

	type ResolvablePath = Pathname;

	const orgSlug = $derived(page.params.orgSlug ?? '');
	const storeSlug = $derived(page.params.storeSlug ?? '');
	const ticketTypeId = $derived(page.params.ticketTypeId ?? '');
	const currentDetailPath = $derived(
		`/${encodeURIComponent(orgSlug)}/${encodeURIComponent(storeSlug)}/tickets/${encodeURIComponent(
			ticketTypeId
		)}`
	);
	const participantBookingsHref = $derived(
		`/${encodeURIComponent(orgSlug)}/${encodeURIComponent(
			storeSlug
		)}/participant/bookings?ticketTypeId=${encodeURIComponent(ticketTypeId)}`
	);

	let loading = $state(true);
	let authenticated = $state(false);
	let ticketType = $state<PublicTicketTypePayload | null>(null);
	let errorMessage = $state<string | null>(null);

	const toExceptionMessage = (error: unknown, fallback: string): string => {
		if (error instanceof Error && error.message) {
			return error.message;
		}
		return fallback;
	};

	const getTicketServiceLabel = (currentTicketType: PublicTicketTypePayload): string => {
		if (currentTicketType.serviceScope === 'all') {
			return 'すべてのサービス';
		}
		return currentTicketType.serviceNames.length > 0
			? currentTicketType.serviceNames.join('、')
			: '対象サービス未設定';
	};

	const getTicketExpirationLabel = (currentTicketType: PublicTicketTypePayload): string =>
		currentTicketType.expiresInDays ? `${currentTicketType.expiresInDays}日` : '期限なし';

	const purchaseHref = $derived(
		authenticated
			? resolve(participantBookingsHref as ResolvablePath)
			: buildLoginRedirectHref(currentDetailPath)
	);

	onMount(() => {
		void (async () => {
			loading = true;
			errorMessage = null;
			if (!orgSlug || !storeSlug || !ticketTypeId) {
				ticketType = null;
				errorMessage = '回数券詳細のURLが不正です。';
				loading = false;
				return;
			}

			try {
				const sessionPromise = loadSession().catch(() => ({ session: null, status: 0 }));
				const [loadedTicketType, sessionResult] = await Promise.all([
					loadPublicTicketType({ orgSlug, storeSlug, ticketTypeId }),
					sessionPromise
				]);
				ticketType = loadedTicketType;
				authenticated = Boolean(sessionResult.session);
			} catch (error) {
				ticketType = null;
				errorMessage = toExceptionMessage(error, '回数券詳細の取得に失敗しました。');
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold text-foreground">回数券詳細</h1>
		<p class="text-sm text-muted-foreground">
			購入申請はログイン後に行えます。申請後、運営の承認後に回数券が付与されます。
		</p>
	</header>

	<Card class="surface-panel border-border/80 shadow-lg">
		<CardHeader class="space-y-2">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h2 class="text-xl font-semibold text-foreground">
					{ticketType?.name ?? '回数券情報'}
				</h2>
				{#if ticketType}
					<Badge variant="outline">{getTicketServiceLabel(ticketType)}</Badge>
				{/if}
			</div>
			<CardDescription>
				{#if ticketType}
					{ticketType.totalCount}回 / 有効期限 {getTicketExpirationLabel(ticketType)}
				{:else}
					回数券情報を読み込み中です。
				{/if}
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-5">
			{#if loading}
				<p class="text-sm text-muted-foreground">回数券詳細を読み込み中…</p>
			{:else if errorMessage}
				<p class="text-sm text-destructive">{errorMessage}</p>
			{:else if ticketType}
				<div class="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
					<div class="rounded-md border border-border/80 bg-secondary/30 p-4">
						<p class="text-xs font-semibold text-secondary-foreground">利用回数</p>
						<p class="mt-1 text-lg font-semibold text-foreground">{ticketType.totalCount}回</p>
					</div>
					<div class="rounded-md border border-border/80 bg-secondary/30 p-4">
						<p class="text-xs font-semibold text-secondary-foreground">有効期限</p>
						<p class="mt-1 text-lg font-semibold text-foreground">
							{getTicketExpirationLabel(ticketType)}
						</p>
					</div>
				</div>

				<div class="space-y-2 text-sm text-muted-foreground">
					<p>対象サービス: {getTicketServiceLabel(ticketType)}</p>
					<p>支払方法: 現地決済 / 銀行振込</p>
					<p>購入申請後、運営の承認後に回数券が付与されます。</p>
				</div>

				<Button type="button" href={purchaseHref}>
					{authenticated ? '購入申請へ進む' : 'ログインして購入申請'}
				</Button>
			{/if}
		</CardContent>
	</Card>
</main>
