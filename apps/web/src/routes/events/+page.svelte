<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { formatJaDateTime } from '$lib/date/format';
	import { loadPublicEvents } from '$lib/features/events.svelte';
	import type { ScopedRouteContext } from '$lib/features/scoped-routing';
	import type { PublicEventListItemPayload, PublicTicketTypePayload } from '$lib/rpc-client';

	let loading = $state(true);
	let events = $state<PublicEventListItemPayload[]>([]);
	let ticketTypes = $state<PublicTicketTypePayload[]>([]);
	let errorMessage = $state<string | null>(null);

	type ResolvablePath = Pathname;

	const publicEventsContext = $derived.by((): ScopedRouteContext | undefined => {
		const orgSlug = page.params.orgSlug?.trim();
		const storeSlug = page.params.storeSlug?.trim();
		return orgSlug && storeSlug ? { orgSlug, storeSlug } : undefined;
	});

	const toExceptionMessage = (error: unknown, fallback: string): string => {
		if (error instanceof Error && error.message) {
			return error.message;
		}
		return fallback;
	};

	const getTicketServiceLabel = (ticketType: PublicTicketTypePayload): string => {
		if (ticketType.serviceScope === 'all') {
			return 'すべてのサービス';
		}
		return ticketType.serviceNames.length > 0
			? ticketType.serviceNames.join('、')
			: '対象サービス未設定';
	};

	const getTicketExpirationLabel = (ticketType: PublicTicketTypePayload): string =>
		ticketType.expiresInDays ? `${ticketType.expiresInDays}日` : '期限なし';

	const getEventDetailHref = (event: PublicEventListItemPayload): string =>
		event.organizationSlug && event.storeSlug
			? `/${event.organizationSlug}/${event.storeSlug}/events/${event.slotId}`
			: `/events/${event.slotId}`;

	onMount(() => {
		void (async () => {
			loading = true;
			errorMessage = null;
			try {
				const publicEventsPage = await loadPublicEvents(publicEventsContext);
				events = publicEventsPage.events;
				ticketTypes = publicEventsPage.ticketTypes;
			} catch (error) {
				errorMessage = toExceptionMessage(error, '公開イベントの取得に失敗しました。');
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold text-foreground">公開イベント</h1>
		<p class="text-sm text-muted-foreground">
			イベント閲覧と予約はログイン不要です。回数券が必要なサービスは参加者画面から予約してください。
		</p>
	</header>

	{#if loading}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">公開イベントを読み込み中…</p>
			</CardContent>
		</Card>
	{:else if errorMessage}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-destructive">{errorMessage}</p>
			</CardContent>
		</Card>
	{:else}
		<section class="space-y-3" aria-labelledby="public-ticket-types-heading">
			<div class="space-y-1">
				<h2 id="public-ticket-types-heading" class="text-xl font-semibold text-foreground">
					回数券
				</h2>
				<p class="text-sm text-muted-foreground">支払方法: 現地決済 / 銀行振込</p>
			</div>

			{#if ticketTypes.length === 0}
				<Card class="surface-panel border-border/80 shadow-lg">
					<CardContent class="py-6">
						<p class="text-sm text-muted-foreground">現在購入可能な回数券はありません。</p>
					</CardContent>
				</Card>
			{:else}
				<div class="grid gap-4 md:grid-cols-2">
					{#each ticketTypes as ticketType (ticketType.id)}
						<a
							class="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
							href={resolve(ticketType.href as ResolvablePath)}
						>
							<Card
								class="surface-panel h-full border-border/80 shadow-lg transition-colors hover:border-primary/60"
							>
								<CardHeader class="space-y-2">
									<div class="flex flex-wrap items-center justify-between gap-2">
										<h3 class="text-lg font-semibold text-foreground">{ticketType.name}</h3>
										<Badge variant="outline">{getTicketServiceLabel(ticketType)}</Badge>
									</div>
									<CardDescription>
										{ticketType.totalCount}回 / 有効期限 {getTicketExpirationLabel(ticketType)}
									</CardDescription>
								</CardHeader>
								<CardContent class="space-y-1 text-sm text-muted-foreground">
									<p>対象サービス: {getTicketServiceLabel(ticketType)}</p>
									<p>支払方法: 現地決済 / 銀行振込</p>
									<p class="font-medium text-primary">詳細を見る</p>
								</CardContent>
							</Card>
						</a>
					{/each}
				</div>
			{/if}
		</section>

		<section class="space-y-3" aria-labelledby="public-events-heading">
			<h2 id="public-events-heading" class="text-xl font-semibold text-foreground">イベント一覧</h2>

			{#if events.length === 0}
				<Card class="surface-panel border-border/80 shadow-lg">
					<CardContent class="py-6">
						<p class="text-sm text-muted-foreground">現在公開中のイベントはありません。</p>
					</CardContent>
				</Card>
			{:else}
				<div class="grid gap-4 md:grid-cols-2">
					{#each events as event (event.slotId)}
						<a
							class="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
							href={resolve(getEventDetailHref(event) as ResolvablePath)}
						>
							<Card
								class="surface-panel h-full border-border/80 shadow-lg transition-colors hover:border-primary/60"
							>
								<CardHeader class="space-y-2">
									{#if event.serviceImageUrl}
										<div class="overflow-hidden rounded-md border border-border/80 bg-secondary/60">
											<img
												src={event.serviceImageUrl}
												alt={`${event.serviceName} の画像`}
												class="h-44 w-full object-cover"
												loading="lazy"
											/>
										</div>
									{/if}
									<div class="flex items-center justify-between gap-2">
										<h3 class="text-lg font-semibold text-foreground">{event.serviceName}</h3>
										<Badge variant={event.isBookable ? 'outline' : 'secondary'}>
											{event.isBookable ? '予約受付中' : '受付外'}
										</Badge>
									</div>
									<CardDescription>
										{formatJaDateTime(event.startAt)} - {formatJaDateTime(event.endAt)}
									</CardDescription>
								</CardHeader>
								<CardContent class="space-y-3">
									<div class="space-y-1 text-sm text-muted-foreground">
										{#if event.serviceDescription}
											<p class="whitespace-pre-line text-secondary-foreground">
												{event.serviceDescription}
											</p>
										{/if}
										<p>残枠: {event.remainingCount} / {event.capacity}</p>
										<p>
											予約受付: {formatJaDateTime(event.bookingOpenAt)} 〜 {formatJaDateTime(
												event.bookingCloseAt
											)}
										</p>
										{#if event.locationLabel}
											<p>場所: {event.locationLabel}</p>
										{/if}
									</div>
									<p class="text-sm font-medium text-primary">イベント詳細へ</p>
								</CardContent>
							</Card>
						</a>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</main>
