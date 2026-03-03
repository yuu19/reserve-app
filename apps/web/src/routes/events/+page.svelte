<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { formatJaDateTime } from '$lib/date/format';
	import { loadPublicEvents } from '$lib/features/events.svelte';
	import type { PublicEventListItemPayload } from '$lib/rpc-client';

	let loading = $state(true);
	let events = $state<PublicEventListItemPayload[]>([]);
	let errorMessage = $state<string | null>(null);

	const toExceptionMessage = (error: unknown, fallback: string): string => {
		if (error instanceof Error && error.message) {
			return error.message;
		}
		return fallback;
	};

	const goToEventDetail = async (slotId: string) => {
		await goto(resolve(`/events/${slotId}`));
	};

	onMount(() => {
		void (async () => {
			loading = true;
			errorMessage = null;
			try {
				events = await loadPublicEvents();
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
		<h1 class="text-3xl font-semibold text-slate-900">公開イベント</h1>
		<p class="text-sm text-slate-600">
			イベント閲覧はログイン不要です。参加登録・予約操作はログイン後に行えます。
		</p>
	</header>

	{#if loading}
		<Card class="surface-panel border-slate-200/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">公開イベントを読み込み中…</p>
			</CardContent>
		</Card>
	{:else if errorMessage}
		<Card class="surface-panel border-slate-200/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-rose-600">{errorMessage}</p>
			</CardContent>
		</Card>
	{:else if events.length === 0}
		<Card class="surface-panel border-slate-200/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">現在公開中のイベントはありません。</p>
			</CardContent>
		</Card>
	{:else}
		<section class="grid gap-4 md:grid-cols-2">
			{#each events as event (event.slotId)}
				<Card class="surface-panel border-slate-200/80 shadow-lg">
					<CardHeader class="space-y-2">
						{#if event.serviceImageUrl}
							<div class="overflow-hidden rounded-md border border-slate-200/80 bg-slate-100/60">
								<img
									src={event.serviceImageUrl}
									alt={`${event.serviceName} の画像`}
									class="h-44 w-full object-cover"
									loading="lazy"
								/>
							</div>
						{/if}
						<div class="flex items-center justify-between gap-2">
							<h2 class="text-lg font-semibold text-slate-900">{event.serviceName}</h2>
							<Badge variant={event.isBookable ? 'outline' : 'secondary'}>
								{event.isBookable ? '予約受付中' : '受付外'}
							</Badge>
						</div>
						<CardDescription>
							{formatJaDateTime(event.startAt)} - {formatJaDateTime(event.endAt)}
						</CardDescription>
					</CardHeader>
					<CardContent class="space-y-3">
						<div class="space-y-1 text-sm text-slate-600">
							{#if event.serviceDescription}
								<p class="whitespace-pre-line text-slate-700">{event.serviceDescription}</p>
							{/if}
							<p>残枠: {event.remainingCount} / {event.capacity}</p>
							<p>予約受付: {formatJaDateTime(event.bookingOpenAt)} 〜 {formatJaDateTime(event.bookingCloseAt)}</p>
							{#if event.locationLabel}
								<p>場所: {event.locationLabel}</p>
							{/if}
						</div>
						<Button type="button" onclick={() => goToEventDetail(event.slotId)}>イベント詳細へ</Button>
					</CardContent>
				</Card>
			{/each}
		</section>
	{/if}
</main>
