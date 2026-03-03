<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { formatJaDateTime } from '$lib/date/format';
	import { loadPublicEventDetail, reservePublicEvent } from '$lib/features/events.svelte';
	import {
		getCurrentPathWithSearch,
		loadSession,
		redirectToLoginWithNext
	} from '$lib/features/auth-session.svelte';
	import type { PublicEventDetailPayload } from '$lib/rpc-client';
	import { toast } from 'svelte-sonner';

	const slotId = $derived(page.params.slotId ?? '');

	let loading = $state(true);
	let busy = $state(false);
	let detail = $state<PublicEventDetailPayload | null>(null);
	let errorMessage = $state<string | null>(null);

	const toExceptionMessage = (error: unknown, fallback: string): string => {
		if (error instanceof Error && error.message) {
			return error.message;
		}
		return fallback;
	};

	const refresh = async () => {
		if (!slotId) {
			detail = null;
			errorMessage = 'イベントIDが指定されていません。';
			return;
		}

		errorMessage = null;
		try {
			detail = await loadPublicEventDetail(slotId);
		} catch (error) {
			detail = null;
			errorMessage = toExceptionMessage(error, '公開イベント詳細の取得に失敗しました。');
		}
	};

	const submitReserve = async () => {
		if (!detail || busy) {
			return;
		}

		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}

		busy = true;
		try {
			const result = await reservePublicEvent({
				organizationId: detail.organizationId,
				slotId: detail.slotId
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			if (result.createdParticipant) {
				toast.success('参加登録が完了しました。');
			}
			toast.success(result.message);
			await refresh();
		} finally {
			busy = false;
		}
	};

	onMount(() => {
		void (async () => {
			loading = true;
			try {
				await refresh();
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold text-slate-900">イベント詳細</h1>
		<p class="text-sm text-slate-600">
			閲覧はログイン不要です。参加登録・予約操作を行う場合はログインが必要です。
		</p>
	</header>

	<Card class="surface-panel border-slate-200/80 shadow-lg">
		<CardHeader class="space-y-2">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h2 class="text-xl font-semibold text-slate-900">
					{detail?.serviceName ?? 'イベント情報'}
				</h2>
				<Badge variant={detail?.isBookable ? 'outline' : 'secondary'}>
					{detail?.isBookable ? '予約受付中' : '受付外'}
				</Badge>
			</div>
			<CardDescription>
				{#if detail}
					{formatJaDateTime(detail.startAt)} - {formatJaDateTime(detail.endAt)}
				{:else}
					日時情報を読み込み中です。
				{/if}
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			{#if detail?.serviceImageUrl}
				<div class="overflow-hidden rounded-md border border-slate-200/80 bg-slate-100/60">
					<img
						src={detail.serviceImageUrl}
						alt={`${detail.serviceName} の画像`}
						class="h-52 w-full object-cover"
						loading="lazy"
					/>
				</div>
			{/if}
			{#if loading}
				<p class="text-sm text-muted-foreground">公開イベント詳細を読み込み中…</p>
			{:else if errorMessage}
				<p class="text-sm text-rose-600">{errorMessage}</p>
			{:else if detail}
				<div class="space-y-1 text-sm text-slate-600">
					{#if detail.serviceDescription}
						<p class="whitespace-pre-line text-slate-700">{detail.serviceDescription}</p>
					{/if}
					<p>残枠: {detail.remainingCount} / {detail.capacity}</p>
					<p>予約受付: {formatJaDateTime(detail.bookingOpenAt)} 〜 {formatJaDateTime(detail.bookingCloseAt)}</p>
					{#if detail.staffLabel}
						<p>担当: {detail.staffLabel}</p>
					{/if}
					{#if detail.locationLabel}
						<p>場所: {detail.locationLabel}</p>
					{/if}
				</div>
			{/if}

			<Button
				type="button"
				onclick={submitReserve}
				disabled={busy || !detail || !detail.isBookable}
			>
				{busy ? '処理中…' : '参加登録して予約する'}
			</Button>
		</CardContent>
	</Card>
</main>
