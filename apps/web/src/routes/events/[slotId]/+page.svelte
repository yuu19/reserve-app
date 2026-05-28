<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { formatJaDateTime } from '$lib/date/format';
	import { buildLoginRedirectHref } from '$lib/features/auth-portal';
	import { loadPublicEventDetail, reservePublicEvent } from '$lib/features/events.svelte';
	import {
		loadSession,
		redirectToLoginWithNext,
		getCurrentPathWithSearch
	} from '$lib/features/auth-session.svelte';
	import type { PublicEventDetailPayload, PublicTicketTypePayload } from '$lib/rpc-client';
	import { toast } from 'svelte-sonner';

	const slotId = $derived(page.params.slotId ?? '');

	let loading = $state(true);
	let busy = $state(false);
	let authenticated = $state(false);
	let detail = $state<PublicEventDetailPayload | null>(null);
	let errorMessage = $state<string | null>(null);

	const participantBookingsPath = '/participant/bookings';
	const applicableTicketTypes = $derived.by(() => {
		const currentDetail = detail;
		if (!currentDetail) {
			return [];
		}
		return currentDetail.ticketTypes.filter(
			(ticketType) =>
				ticketType.serviceScope === 'all' || ticketType.serviceIds.includes(currentDetail.serviceId)
		);
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

	const getTicketPurchaseHref = (): string =>
		authenticated ? participantBookingsPath : buildLoginRedirectHref(participantBookingsPath);

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
				classroomId: detail.classroomId,
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
				const sessionPromise = loadSession().catch(() => ({ session: null, status: 0 }));
				await refresh();
				const sessionResult = await sessionPromise;
				authenticated = Boolean(sessionResult.session);
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold text-foreground">イベント詳細</h1>
		<p class="text-sm text-muted-foreground">
			閲覧はログイン不要です。参加登録・予約操作を行う場合はログインが必要です。
		</p>
	</header>

	<Card class="surface-panel border-border/80 shadow-lg">
		<CardHeader class="space-y-2">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h2 class="text-xl font-semibold text-foreground">
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
		<CardContent class="space-y-5">
			{#if detail?.serviceImageUrl}
				<div class="overflow-hidden rounded-md border border-border/80 bg-secondary/60">
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
				<p class="text-sm text-destructive">{errorMessage}</p>
			{:else if detail}
				<div class="space-y-1 text-sm text-muted-foreground">
					{#if detail.serviceDescription}
						<p class="whitespace-pre-line text-secondary-foreground">{detail.serviceDescription}</p>
					{/if}
					<p>残枠: {detail.remainingCount} / {detail.capacity}</p>
					<p>
						予約受付: {formatJaDateTime(detail.bookingOpenAt)} 〜 {formatJaDateTime(
							detail.bookingCloseAt
						)}
					</p>
					{#if detail.staffLabel}
						<p>担当: {detail.staffLabel}</p>
					{/if}
					{#if detail.locationLabel}
						<p>場所: {detail.locationLabel}</p>
					{/if}
				</div>

				<section class="space-y-3" aria-labelledby="event-ticket-types-heading">
					<div class="space-y-1">
						<h3 id="event-ticket-types-heading" class="text-lg font-semibold text-foreground">
							回数券
						</h3>
						<p class="text-sm text-muted-foreground">支払方法: 現地決済 / 銀行振込</p>
					</div>

					{#if applicableTicketTypes.length === 0}
						<div class="rounded-md border border-border/80 bg-secondary/30 p-4">
							<p class="text-sm text-muted-foreground">現在購入可能な回数券はありません。</p>
						</div>
					{:else}
						<div class="grid gap-3 md:grid-cols-2">
							{#each applicableTicketTypes as ticketType (ticketType.id)}
								<div class="rounded-md border border-border/80 bg-background p-4">
									<div class="flex flex-wrap items-center justify-between gap-2">
										<h4 class="font-semibold text-foreground">{ticketType.name}</h4>
										<Badge variant="outline">{getTicketServiceLabel(ticketType)}</Badge>
									</div>
									<div class="mt-3 space-y-1 text-sm text-muted-foreground">
										<p>
											{ticketType.totalCount}回 / 有効期限 {getTicketExpirationLabel(ticketType)}
										</p>
										<p>対象サービス: {getTicketServiceLabel(ticketType)}</p>
										<p>支払方法: 現地決済 / 銀行振込</p>
									</div>
									<Button class="mt-4" type="button" href={getTicketPurchaseHref()}>
										{authenticated ? '購入申請へ' : 'ログインして購入申請'}
									</Button>
								</div>
							{/each}
						</div>
					{/if}
				</section>
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
