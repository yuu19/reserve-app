<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { formatJaDateTime } from '$lib/date/format';
	import { loadPublicSitePage } from '$lib/features/public-site.svelte';
	import type {
		PublicBookingPagePayload,
		PublicSitePagePayload,
		PublicTicketTypePayload
	} from '$lib/rpc-client';

	type ResolvablePath = Pathname;

	const orgSlug = $derived(page.params.orgSlug ?? '');
	const classroomSlug = $derived(page.params.classroomSlug ?? '');
	const eventsPath = $derived(`/${orgSlug}/${classroomSlug}/events`);

	let loading = $state(true);
	let errorMessage = $state<string | null>(null);
	let publicSitePage = $state<PublicSitePagePayload | null>(null);

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

	const openBookingPage = async (bookingPage: PublicBookingPagePayload) => {
		await goto(resolve(bookingPage.href as ResolvablePath));
	};

	onMount(() => {
		void (async () => {
			loading = true;
			errorMessage = null;
			try {
				publicSitePage = await loadPublicSitePage({ orgSlug, classroomSlug });
			} catch (error) {
				publicSitePage = null;
				errorMessage = toExceptionMessage(error, '予約サイトの取得に失敗しました。');
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	{#if loading}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">予約サイトを読み込み中…</p>
			</CardContent>
		</Card>
	{:else if errorMessage}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-destructive">{errorMessage}</p>
			</CardContent>
		</Card>
	{:else if publicSitePage}
		{@const firstBookingPage = publicSitePage.bookingPages[0]}
		<section class="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
			<div class="flex min-h-[360px] flex-col justify-center gap-5 py-4">
				<div class="space-y-3">
					<p class="text-sm font-medium text-muted-foreground">
						{publicSitePage.site.organizationName}
					</p>
					<h1 class="text-4xl font-semibold leading-tight text-foreground md:text-5xl">
						{publicSitePage.site.siteName}
					</h1>
					{#if publicSitePage.site.description}
						<p class="max-w-2xl whitespace-pre-line text-base leading-7 text-muted-foreground">
							{publicSitePage.site.description}
						</p>
					{/if}
				</div>
				<div class="flex flex-wrap gap-3">
					<Button type="button" href={resolve(eventsPath as ResolvablePath)}
						>予約ページ一覧へ</Button
					>
					{#if firstBookingPage}
						<Button
							type="button"
							variant="outline"
							onclick={() => openBookingPage(firstBookingPage)}>直近の予約ページへ</Button
						>
					{/if}
				</div>
			</div>

			<div class="space-y-4">
				{#if publicSitePage.site.imageUrl}
					<div class="overflow-hidden rounded-md border border-border/80 bg-secondary/50">
						<img
							src={publicSitePage.site.imageUrl}
							alt={`${publicSitePage.site.siteName} の画像`}
							class="h-72 w-full object-cover md:h-96"
						/>
					</div>
				{/if}
				<Card class="surface-panel border-border/80 shadow-lg">
					<CardHeader>
						<h2 class="text-lg font-semibold text-foreground">基本情報</h2>
					</CardHeader>
					<CardContent class="space-y-2 text-sm text-muted-foreground">
						<p>教室: {publicSitePage.site.classroomName}</p>
						{#if publicSitePage.site.address}
							<p>住所: {publicSitePage.site.address}</p>
						{/if}
						{#if publicSitePage.site.phone}
							<p>電話: {publicSitePage.site.phone}</p>
						{/if}
						{#if publicSitePage.site.businessHours}
							<p class="whitespace-pre-line">営業時間: {publicSitePage.site.businessHours}</p>
						{/if}
					</CardContent>
				</Card>
			</div>
		</section>

		<section class="space-y-3" aria-labelledby="booking-pages-heading">
			<div class="flex flex-wrap items-end justify-between gap-3">
				<div class="space-y-1">
					<h2 id="booking-pages-heading" class="text-xl font-semibold text-foreground">
						予約ページ一覧
					</h2>
					<p class="text-sm text-muted-foreground">
						レッスン、イベント、メニューなどの予約ページを選択できます。
					</p>
				</div>
				<Button type="button" variant="outline" href={resolve(eventsPath as ResolvablePath)}
					>すべて見る</Button
				>
			</div>

			{#if publicSitePage.bookingPages.length === 0}
				<Card class="surface-panel border-border/80 shadow-lg">
					<CardContent class="py-6">
						<p class="text-sm text-muted-foreground">現在公開中の予約ページはありません。</p>
					</CardContent>
				</Card>
			{:else}
				<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
					{#each publicSitePage.bookingPages as bookingPage (bookingPage.id)}
						<Card class="surface-panel border-border/80 shadow-lg">
							<CardHeader class="space-y-2">
								{#if bookingPage.imageUrl}
									<div class="overflow-hidden rounded-md border border-border/80 bg-secondary/60">
										<img
											src={bookingPage.imageUrl}
											alt={`${bookingPage.title} の画像`}
											class="h-40 w-full object-cover"
											loading="lazy"
										/>
									</div>
								{/if}
								<div class="flex flex-wrap items-center justify-between gap-2">
									<h3 class="text-lg font-semibold text-foreground">{bookingPage.title}</h3>
									<Badge variant={bookingPage.isBookable ? 'outline' : 'secondary'}>
										{bookingPage.isBookable ? '予約受付中' : '受付外'}
									</Badge>
								</div>
								<CardDescription>
									{formatJaDateTime(bookingPage.startAt)} - {formatJaDateTime(bookingPage.endAt)}
								</CardDescription>
							</CardHeader>
							<CardContent class="space-y-3">
								<div class="space-y-1 text-sm text-muted-foreground">
									{#if bookingPage.description}
										<p class="line-clamp-3 whitespace-pre-line text-secondary-foreground">
											{bookingPage.description}
										</p>
									{/if}
									<p>残枠: {bookingPage.remainingCount} / {bookingPage.capacity}</p>
									{#if bookingPage.locationLabel}
										<p>場所: {bookingPage.locationLabel}</p>
									{/if}
								</div>
								<Button type="button" onclick={() => openBookingPage(bookingPage)}
									>予約ページへ</Button
								>
							</CardContent>
						</Card>
					{/each}
				</div>
			{/if}
		</section>

		<section class="space-y-3" aria-labelledby="site-ticket-types-heading">
			<div class="space-y-1">
				<h2 id="site-ticket-types-heading" class="text-xl font-semibold text-foreground">回数券</h2>
				<p class="text-sm text-muted-foreground">支払方法: 現地決済 / 銀行振込</p>
			</div>

			{#if publicSitePage.ticketTypes.length === 0}
				<Card class="surface-panel border-border/80 shadow-lg">
					<CardContent class="py-6">
						<p class="text-sm text-muted-foreground">現在購入可能な回数券はありません。</p>
					</CardContent>
				</Card>
			{:else}
				<div class="grid gap-4 md:grid-cols-2">
					{#each publicSitePage.ticketTypes as ticketType (ticketType.id)}
						<Card class="surface-panel border-border/80 shadow-lg">
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
							</CardContent>
						</Card>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</main>
