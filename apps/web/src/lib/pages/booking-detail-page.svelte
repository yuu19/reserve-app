<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import { ArrowLeft } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { loadFormSubmissionDetail, loadFormSubmissions, loadForms } from '$lib/features/forms';
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
		parseResponseBody,
		redirectToLoginWithNext,
		resolvePortalHomePath,
		toErrorMessage
	} from '$lib/features/auth-session.svelte';
	import { authRpc, type BookingPayload, type FormSubmissionDetailPayload } from '$lib/rpc-client';

	type ResolvablePath = Pathname;

	let loading = $state(true);
	let errorMessage = $state<string | null>(null);
	let currentContext = $state<ScopedRouteContext | null>(null);
	let booking = $state<BookingPayload | null>(null);
	let submissions = $state<FormSubmissionDetailPayload[]>([]);

	const bookingId = $derived(page.params.bookingId ?? '');
	const routeScopedContext = $derived(extractScopedRouteContext(page.url.pathname));
	const bookingsPath = $derived(
		(currentContext ?? routeScopedContext)
			? buildScopedPath((currentContext ?? routeScopedContext)!, '/admin/bookings')
			: '/admin/bookings'
	);

	const formatDateTime = (value: string | null | undefined): string =>
		value ? new Date(value).toLocaleString('ja-JP') : '-';

	const renderAnswerValue = (value: unknown): string => {
		if (Array.isArray(value)) {
			return value.join('、');
		}
		if (typeof value === 'boolean') {
			return value ? '同意済み' : '未同意';
		}
		if (value === null || value === undefined || value === '') {
			return '-';
		}
		return String(value);
	};

	const loadBooking = async (context: ScopedRouteContext) => {
		const response = await authRpc.listBookingsScoped(context);
		const payload = await parseResponseBody(response);
		if (!response.ok || !Array.isArray(payload)) {
			throw new Error(toErrorMessage(payload, '予約詳細の取得に失敗しました。'));
		}
		booking =
			payload.find(
				(item): item is BookingPayload =>
					typeof item === 'object' &&
					item !== null &&
					'id' in item &&
					(item as { id?: unknown }).id === bookingId
			) ?? null;
	};

	const loadSubmissions = async (context: ScopedRouteContext) => {
		const formsPayload = await loadForms(context);
		const details: FormSubmissionDetailPayload[] = [];
		for (const form of formsPayload.forms) {
			const summary = await loadFormSubmissions(context, form.id);
			for (const submission of summary.submissions) {
				if (submission.bookingId !== bookingId) {
					continue;
				}
				const detail = await loadFormSubmissionDetail(context, submission.id);
				if (detail) {
					details.push(detail);
				}
			}
		}
		submissions = details.sort((left, right) => left.submittedAt.localeCompare(right.submittedAt));
	};

	const refresh = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}

		const portalAccess = await loadPortalAccess(routeScopedContext);
		if (!portalAccess.canManageBookings) {
			await goto(resolve(resolvePortalHomePath(portalAccess) ?? '/participant/home'));
			return;
		}

		const context = routeScopedContext ?? portalAccess.activeContext ?? null;
		currentContext = context;
		if (!context) {
			booking = null;
			submissions = [];
			return;
		}

		await loadBooking(context);
		await loadSubmissions(context);
		if (!booking) {
			errorMessage = '予約が見つかりません。';
		}
	};

	onMount(() => {
		void (async () => {
			loading = true;
			errorMessage = null;
			try {
				await refresh();
			} catch (error) {
				errorMessage =
					error instanceof Error ? error.message : '予約詳細の読み込みに失敗しました。';
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-3">
		<Button
			type="button"
			variant="ghost"
			href={resolve(preserveScopedRouteContext(bookingsPath, page.url.pathname) as ResolvablePath)}
		>
			<ArrowLeft class="size-4" />
			予約一覧へ戻る
		</Button>
		<div class="space-y-2">
			<h1 class="text-3xl font-semibold text-foreground">予約詳細</h1>
			<p class="text-sm text-muted-foreground">予約情報と回答時点のフォーム回答を確認します。</p>
		</div>
	</header>

	{#if loading}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">予約詳細を読み込み中…</p>
			</CardContent>
		</Card>
	{:else if errorMessage}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-destructive">{errorMessage}</p>
			</CardContent>
		</Card>
	{:else if booking}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardHeader class="space-y-2">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h2 class="text-xl font-semibold text-foreground">
						{booking.customerName ?? booking.participantId ?? booking.id}
					</h2>
					<Badge variant="outline">{booking.status}</Badge>
				</div>
				<CardDescription>{booking.customerEmail ?? '-'}</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="grid gap-3 text-sm md:grid-cols-2">
					<p><span class="text-muted-foreground">予約ID:</span> {booking.id}</p>
					<p><span class="text-muted-foreground">公開ID:</span> {booking.publicId ?? '-'}</p>
					<p><span class="text-muted-foreground">人数:</span> {booking.participantsCount}</p>
					<p><span class="text-muted-foreground">電話:</span> {booking.customerPhone ?? '-'}</p>
					<p>
						<span class="text-muted-foreground">作成日時:</span>
						{formatDateTime(booking.createdAt)}
					</p>
					<p>
						<span class="text-muted-foreground">更新日時:</span>
						{formatDateTime(booking.updatedAt)}
					</p>
					{#if booking.note}
						<p class="md:col-span-2">
							<span class="text-muted-foreground">備考:</span>
							{booking.note}
						</p>
					{/if}
				</div>
			</CardContent>
		</Card>

		<Card class="surface-panel border-border/80 shadow-lg">
			<CardHeader>
				<h2 class="text-xl font-semibold text-foreground">フォーム回答</h2>
				<CardDescription>回答時点のフォーム名、公開版、項目ラベルで表示します。</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				{#if submissions.length === 0}
					<div class="rounded-md border border-border/80 bg-secondary/40 p-4">
						<p class="text-sm text-muted-foreground">フォーム回答はありません。</p>
					</div>
				{:else}
					{#each submissions as submission (submission.id)}
						<section class="space-y-3 rounded-md border border-border/80 bg-background p-4">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<div>
									<h3 class="font-semibold text-foreground">
										{submission.formName} v{submission.versionNumber}
									</h3>
									<p class="text-xs text-muted-foreground">
										送信日時: {formatDateTime(submission.submittedAt)} / 送信元: {submission.source}
									</p>
								</div>
								<Badge variant="secondary">{submission.formType}</Badge>
							</div>
							<div class="grid gap-3 md:grid-cols-2">
								{#each submission.answers as answer (answer.id)}
									<div class="rounded-md border border-border/80 bg-secondary/30 p-3">
										<p class="text-sm font-medium text-foreground">{answer.labelSnapshot}</p>
										<p class="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
											{renderAnswerValue(answer.value)}
										</p>
										{#if answer.fieldType === 'consent'}
											<p class="mt-1 text-xs text-muted-foreground">
												同意日時: {formatDateTime(answer.createdAt)}
											</p>
										{/if}
									</div>
								{/each}
							</div>
						</section>
					{/each}
				{/if}
			</CardContent>
		</Card>
	{/if}
</main>
