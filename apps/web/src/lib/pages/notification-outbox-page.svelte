<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Button, type ButtonVariant } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { Label } from '$lib/components/ui/label';
	import {
		buildScopedPath,
		extractScopedRouteContext,
		preserveScopedRouteContext,
		type ScopedRouteContext
	} from '$lib/features/scoped-routing';
	import {
		getCurrentPathWithSearch,
		loadPortalAccess,
		loadSession,
		redirectToLoginWithNext,
		resolvePortalHomePath
	} from '$lib/features/auth-session.svelte';
	import {
		applyNotificationOutboxAction,
		loadNotificationOutboxDetail,
		loadNotificationOutboxList
	} from '$lib/features/notification-outbox';
	import type {
		ListNotificationOutboxQuery,
		NotificationOutboxAction,
		NotificationOutboxDetailPayload,
		NotificationOutboxPayload,
		NotificationOutboxStatus
	} from '$lib/rpc-client';
	import { Ban, CheckCircle2, CopyCheck, Eye, RefreshCw, RotateCcw, Search } from '@lucide/svelte';

	type ResolvablePath = Pathname;
	type StatusFilter = NotificationOutboxStatus | 'all';
	type FilterState = {
		status: StatusFilter;
		eventType: string;
		bookingId: string;
		recipientEmail: string;
	};

	const statusOptions: Array<{ value: StatusFilter; label: string }> = [
		{ value: 'all', label: 'すべて' },
		{ value: 'pending', label: '送信待ち' },
		{ value: 'retry', label: '再送待ち' },
		{ value: 'processing', label: '送信中' },
		{ value: 'sent', label: '送信済み' },
		{ value: 'dead', label: '送信失敗' },
		{ value: 'cancelled', label: 'キャンセル済み' },
		{ value: 'skipped', label: 'スキップ' },
		{ value: 'ambiguous', label: '要確認' }
	];

	const eventOptions: Array<{ value: string; label: string }> = [
		{ value: '', label: 'すべて' },
		{ value: 'booking.confirmed', label: '予約確定' },
		{ value: 'booking.application_received', label: '申込受付' },
		{ value: 'booking.cancelled_by_participant', label: '参加者キャンセル' },
		{ value: 'booking.cancelled_by_staff', label: '運営キャンセル' },
		{ value: 'booking.rescheduled', label: '日程変更' },
		{ value: 'booking.no_show', label: 'No-show' },
		{ value: 'booking.reminder', label: 'リマインド' },
		{ value: 'booking.rejected', label: '予約却下' }
	];
	const manualActions: NotificationOutboxAction[] = [
		'retry',
		'cancel',
		'mark_sent',
		'mark_duplicate'
	];

	const statusLabel: Record<NotificationOutboxStatus, string> = {
		pending: '送信待ち',
		processing: '送信中',
		sent: '送信済み',
		retry: '再送待ち',
		cancelled: 'キャンセル済み',
		dead: '送信失敗',
		skipped: 'スキップ',
		ambiguous: '要確認'
	};

	const statusVariant: Record<NotificationOutboxStatus, BadgeVariant> = {
		pending: 'outline',
		processing: 'secondary',
		sent: 'default',
		retry: 'outline',
		cancelled: 'secondary',
		dead: 'destructive',
		skipped: 'secondary',
		ambiguous: 'destructive'
	};

	const eventLabel = (eventType: string): string =>
		eventOptions.find((option) => option.value === eventType)?.label ?? eventType;
	const rowClass = (notificationId: string): string =>
		selectedNotificationId === notificationId
			? 'border-b border-border/60 bg-accent/50 align-top'
			: 'border-b border-border/60 align-top';

	let loading = $state(true);
	let listLoading = $state(false);
	let detailLoadingId = $state<string | null>(null);
	let busyAction = $state<string | null>(null);
	let errorMessage = $state<string | null>(null);
	let currentContext = $state<ScopedRouteContext | null>(null);
	let notifications = $state<NotificationOutboxPayload[]>([]);
	let selectedDetail = $state<NotificationOutboxDetailPayload | null>(null);
	let filters = $state<FilterState>({
		status: 'all',
		eventType: '',
		bookingId: '',
		recipientEmail: ''
	});

	const routeScopedContext = $derived(extractScopedRouteContext(page.url.pathname));
	const selectedNotificationId = $derived(selectedDetail?.notification.id ?? null);

	const toScopedRoute = (targetPath: string): ResolvablePath =>
		preserveScopedRouteContext(targetPath, page.url.pathname) as ResolvablePath;

	const buildQuery = (): ListNotificationOutboxQuery => {
		const query: ListNotificationOutboxQuery = {
			limit: 50
		};
		if (filters.status !== 'all') {
			query.status = filters.status;
		}
		const eventType = filters.eventType.trim();
		if (eventType) {
			query.eventType = eventType;
		}
		const bookingId = filters.bookingId.trim();
		if (bookingId) {
			query.bookingId = bookingId;
		}
		const recipientEmail = filters.recipientEmail.trim();
		if (recipientEmail) {
			query.recipientEmail = recipientEmail;
		}
		return query;
	};

	const formatDateTime = (value: string | null): string => {
		if (!value) {
			return '-';
		}
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return '-';
		}
		return new Intl.DateTimeFormat('ja-JP', {
			timeZone: 'Asia/Tokyo',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		}).format(date);
	};

	const actionButtonLabel = (action: NotificationOutboxAction): string => {
		switch (action) {
			case 'retry':
				return '再送待ちに戻す';
			case 'cancel':
				return 'キャンセル';
			case 'mark_sent':
				return '送信済み';
			case 'mark_duplicate':
				return '重複記録';
		}
	};

	const actionButtonVariant = (action: NotificationOutboxAction): ButtonVariant => {
		switch (action) {
			case 'cancel':
				return 'destructive';
			case 'mark_sent':
				return 'default';
			default:
				return 'outline';
		}
	};

	const actionConfirmation = (action: NotificationOutboxAction): string => {
		switch (action) {
			case 'retry':
				return 'この通知を再送待ちに戻しますか？';
			case 'cancel':
				return 'この通知をキャンセルしますか？';
			case 'mark_sent':
				return 'この通知を手動で送信済みにしますか？';
			case 'mark_duplicate':
				return 'この通知に重複送信の記録を追加しますか？';
		}
	};

	const canApplyAction = (
		notification: NotificationOutboxPayload,
		action: NotificationOutboxAction
	): boolean => {
		switch (action) {
			case 'retry':
				return notification.status === 'dead' || notification.status === 'retry';
			case 'cancel':
				return notification.status === 'pending' || notification.status === 'retry';
			case 'mark_sent':
			case 'mark_duplicate':
				return true;
		}
	};

	const refreshList = async () => {
		if (!currentContext) {
			return;
		}
		listLoading = true;
		errorMessage = null;
		try {
			const result = await loadNotificationOutboxList(currentContext, buildQuery());
			if (!result) {
				errorMessage = '通知一覧の取得に失敗しました。';
				notifications = [];
				selectedDetail = null;
				return;
			}
			notifications = result.notifications;
			if (
				selectedDetail &&
				!result.notifications.some(
					(notification) => notification.id === selectedDetail?.notification.id
				)
			) {
				selectedDetail = null;
			}
		} finally {
			listLoading = false;
		}
	};

	const refresh = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}

		const portalAccess = await loadPortalAccess(routeScopedContext);
		if (!portalAccess.canManageStore) {
			await goto(resolve(resolvePortalHomePath(portalAccess) ?? '/participant/home'));
			return;
		}

		const context = routeScopedContext ?? portalAccess.activeContext ?? null;
		currentContext = context;
		if (!context) {
			notifications = [];
			selectedDetail = null;
			return;
		}

		await refreshList();
	};

	const submitFilters = async (event: SubmitEvent) => {
		event.preventDefault();
		await refreshList();
	};

	const resetFilters = async () => {
		filters = {
			status: 'all',
			eventType: '',
			bookingId: '',
			recipientEmail: ''
		};
		await refreshList();
	};

	const selectNotification = async (notification: NotificationOutboxPayload) => {
		if (!currentContext) {
			return;
		}
		detailLoadingId = notification.id;
		try {
			const detail = await loadNotificationOutboxDetail(currentContext, notification.id);
			if (!detail) {
				toast.error('通知詳細の取得に失敗しました。');
				return;
			}
			selectedDetail = detail;
		} finally {
			detailLoadingId = null;
		}
	};

	const applyAction = async (
		notification: NotificationOutboxPayload,
		action: NotificationOutboxAction
	) => {
		if (!currentContext || !canApplyAction(notification, action)) {
			return;
		}
		if (typeof window !== 'undefined' && !window.confirm(actionConfirmation(action))) {
			return;
		}
		const busyKey = `${notification.id}:${action}`;
		busyAction = busyKey;
		try {
			const result = await applyNotificationOutboxAction(currentContext, notification.id, action);
			if (!result.ok || !result.detail) {
				toast.error(result.message);
				return;
			}
			selectedDetail = result.detail;
			await refreshList();
			toast.success(result.message);
		} finally {
			busyAction = null;
		}
	};

	onMount(() => {
		void (async () => {
			loading = true;
			errorMessage = null;
			try {
				await refresh();
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
		<div class="space-y-2">
			<h1 class="text-3xl font-semibold text-foreground">通知一覧</h1>
			<p class="text-sm text-muted-foreground">
				予約通知メールの送信状況と送信履歴を確認します。
			</p>
		</div>
		<Button type="button" variant="outline" onclick={refresh} disabled={loading || listLoading}>
			<RefreshCw class="size-4" />
			最新化
		</Button>
	</header>

	{#if loading}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">通知一覧を読み込み中…</p>
			</CardContent>
		</Card>
	{:else if !currentContext}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardHeader>
				<h2 class="text-xl font-semibold text-foreground">店舗を選択してください</h2>
				<CardDescription>通知一覧は店舗ごとに表示します。</CardDescription>
			</CardHeader>
			<CardContent>
				<Button type="button" variant="outline" href={resolve(toScopedRoute('/admin/stores'))}>
					店舗管理へ移動
				</Button>
			</CardContent>
		</Card>
	{:else}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardHeader>
				<h2 class="text-xl font-semibold text-foreground">絞り込み</h2>
			</CardHeader>
			<CardContent>
				<form
					class="grid gap-4 md:grid-cols-[160px_220px_minmax(0,1fr)_minmax(0,1fr)_auto]"
					onsubmit={submitFilters}
				>
					<div class="space-y-2">
						<Label for="notification-status-filter">送信状況</Label>
						<select
							id="notification-status-filter"
							class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
							bind:value={filters.status}
							disabled={listLoading}
						>
							{#each statusOptions as option (option.value)}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>
					</div>
					<div class="space-y-2">
						<Label for="notification-event-filter">通知種別</Label>
						<select
							id="notification-event-filter"
							class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
							bind:value={filters.eventType}
							disabled={listLoading}
						>
							{#each eventOptions as option (option.value)}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>
					</div>
					<div class="space-y-2">
						<Label for="notification-booking-filter">予約ID</Label>
						<input
							id="notification-booking-filter"
							class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
							bind:value={filters.bookingId}
							disabled={listLoading}
						/>
					</div>
					<div class="space-y-2">
						<Label for="notification-recipient-filter">宛先メール</Label>
						<input
							id="notification-recipient-filter"
							type="email"
							class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
							bind:value={filters.recipientEmail}
							disabled={listLoading}
						/>
					</div>
					<div class="flex items-end gap-2">
						<Button type="submit" disabled={listLoading}>
							<Search class="size-4" />
							検索
						</Button>
						<Button type="button" variant="outline" onclick={resetFilters} disabled={listLoading}>
							解除
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>

		{#if errorMessage}
			<Card class="surface-panel border-border/80 shadow-lg">
				<CardContent class="py-6">
					<p class="text-sm text-destructive">{errorMessage}</p>
				</CardContent>
			</Card>
		{:else}
			<section class="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
				<Card class="surface-panel min-w-0 border-border/80 shadow-lg">
					<CardHeader class="flex flex-row items-center justify-between gap-3">
						<div>
							<h2 class="text-xl font-semibold text-foreground">通知の送信状況</h2>
							<CardDescription>{notifications.length}件</CardDescription>
						</div>
						{#if listLoading}
							<Badge variant="secondary">更新中</Badge>
						{/if}
					</CardHeader>
					<CardContent>
						<div class="overflow-x-auto">
							<table class="w-full min-w-[980px] text-sm">
								<thead>
									<tr class="border-b border-border/80 text-left text-xs text-muted-foreground">
										<th class="px-3 py-2 font-medium">通知種別</th>
										<th class="px-3 py-2 font-medium">宛先</th>
										<th class="px-3 py-2 font-medium">送信状況</th>
										<th class="px-3 py-2 font-medium">試行</th>
										<th class="px-3 py-2 font-medium">次回試行</th>
										<th class="px-3 py-2 font-medium">送信時刻</th>
										<th class="px-3 py-2 font-medium">最終エラー</th>
										<th class="px-3 py-2 font-medium">操作</th>
									</tr>
								</thead>
								<tbody>
									{#each notifications as notification (notification.id)}
										<tr class={rowClass(notification.id)}>
											<td class="px-3 py-3">
												<div class="space-y-1">
													<p class="font-medium text-foreground">
														{eventLabel(notification.eventType)}
													</p>
													<p class="text-xs text-muted-foreground">{notification.templateKey}</p>
												</div>
											</td>
											<td class="px-3 py-3">
												<div class="max-w-64 space-y-1">
													<p class="truncate font-medium text-foreground">
														{notification.recipientEmail}
													</p>
													<p class="text-xs text-muted-foreground">{notification.recipientType}</p>
												</div>
											</td>
											<td class="px-3 py-3">
												<Badge variant={statusVariant[notification.status]}>
													{statusLabel[notification.status]}
												</Badge>
											</td>
											<td class="px-3 py-3 text-foreground">
												{notification.attemptCount}/{notification.maxAttempts}
											</td>
											<td class="px-3 py-3 text-muted-foreground">
												{formatDateTime(notification.nextAttemptAt)}
											</td>
											<td class="px-3 py-3 text-muted-foreground">
												{formatDateTime(notification.sentAt)}
											</td>
											<td class="px-3 py-3">
												<p class="line-clamp-2 max-w-56 text-xs text-muted-foreground">
													{notification.lastError ?? '-'}
												</p>
											</td>
											<td class="px-3 py-3">
												<div class="flex flex-wrap gap-2">
													<Button
														type="button"
														size="sm"
														variant="outline"
														onclick={() => selectNotification(notification)}
														disabled={detailLoadingId === notification.id}
													>
														<Eye class="size-4" />
														詳細
													</Button>
													{#each manualActions as action (action)}
														<Button
															type="button"
															size="sm"
															variant={actionButtonVariant(action)}
															onclick={() => applyAction(notification, action)}
															disabled={!canApplyAction(notification, action) ||
																busyAction === `${notification.id}:${action}`}
														>
															{#if action === 'retry'}
																<RotateCcw class="size-4" />
															{:else if action === 'cancel'}
																<Ban class="size-4" />
															{:else if action === 'mark_sent'}
																<CheckCircle2 class="size-4" />
															{:else}
																<CopyCheck class="size-4" />
															{/if}
															{actionButtonLabel(action)}
														</Button>
													{/each}
												</div>
											</td>
										</tr>
									{:else}
										<tr>
											<td colspan="8" class="px-3 py-8 text-center text-sm text-muted-foreground">
												通知の送信状況はありません。
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</CardContent>
				</Card>

				<Card class="surface-panel min-w-0 border-border/80 shadow-lg">
					<CardHeader>
						<h2 class="text-xl font-semibold text-foreground">通知詳細</h2>
						<CardDescription>選択中の通知の送信状況と送信履歴です。</CardDescription>
					</CardHeader>
					<CardContent>
						{#if selectedDetail}
							<div class="space-y-5">
								<div class="space-y-3 rounded-lg border border-border/80 bg-card/80 p-4">
									<div class="flex flex-wrap items-center gap-2">
										<Badge variant={statusVariant[selectedDetail.notification.status]}>
											{statusLabel[selectedDetail.notification.status]}
										</Badge>
										<Badge variant="secondary">{selectedDetail.notification.channel}</Badge>
									</div>
									<dl class="grid gap-3 text-sm">
										<div>
											<dt class="text-xs text-muted-foreground">通知ID</dt>
											<dd class="break-all text-foreground">{selectedDetail.notification.id}</dd>
										</div>
										<div>
											<dt class="text-xs text-muted-foreground">宛先</dt>
											<dd class="break-all text-foreground">
												{selectedDetail.notification.recipientEmail}
											</dd>
										</div>
										<div>
											<dt class="text-xs text-muted-foreground">予約ID</dt>
											<dd class="break-all text-foreground">
												{selectedDetail.notification.bookingId ?? '-'}
											</dd>
										</div>
										<div>
											<dt class="text-xs text-muted-foreground">provider_message_id</dt>
											<dd class="break-all text-foreground">
												{selectedDetail.notification.providerMessageId ?? '-'}
											</dd>
										</div>
									</dl>
									{#if selectedDetail.notification.bookingId}
										<Button
											type="button"
											variant="outline"
											href={resolve(
												buildScopedPath(
													currentContext,
													`/admin/bookings/${selectedDetail.notification.bookingId}`
												) as ResolvablePath
											)}
										>
											予約詳細へ移動
										</Button>
									{/if}
								</div>

								<div class="space-y-3">
									<h3 class="text-sm font-semibold text-foreground">送信履歴</h3>
									{#each selectedDetail.logs as log (log.id)}
										<div class="rounded-md border border-border/80 bg-background/70 p-3 text-sm">
											<div class="flex flex-wrap items-center justify-between gap-2">
												<Badge variant="secondary">{log.status}</Badge>
												<span class="text-xs text-muted-foreground">
													{formatDateTime(log.createdAt)}
												</span>
											</div>
											<dl class="mt-3 grid gap-2 text-xs text-muted-foreground">
												<div class="flex justify-between gap-3">
													<dt>attempt</dt>
													<dd>{log.attemptNumber ?? '-'}</dd>
												</div>
												<div class="flex justify-between gap-3">
													<dt>provider</dt>
													<dd>{log.provider ?? '-'}</dd>
												</div>
												<div class="flex justify-between gap-3">
													<dt>message</dt>
													<dd class="max-w-48 break-words text-right">{log.errorMessage ?? '-'}</dd>
												</div>
											</dl>
										</div>
									{:else}
										<p class="rounded-md border border-border/80 p-3 text-sm text-muted-foreground">
											送信履歴はありません。
										</p>
									{/each}
								</div>
							</div>
						{:else}
							<p class="rounded-md border border-border/80 p-3 text-sm text-muted-foreground">
								一覧から通知を選択してください。
							</p>
						{/if}
					</CardContent>
				</Card>
			</section>
		{/if}
	{/if}
</main>
