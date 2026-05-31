<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { formatJaDateTime } from '$lib/date/format';
	import { createGuestPublicBooking, loadPublicEventDetail } from '$lib/features/events.svelte';
	import type { ScopedRouteContext } from '$lib/features/scoped-routing';
	import type {
		PublicEventDetailPayload,
		PublicSiteIntakeFieldPayload,
		PublicTicketTypePayload
	} from '$lib/rpc-client';
	import { toast } from 'svelte-sonner';

	type ResolvablePath = Pathname;

	const slotId = $derived(page.params.slotId ?? '');
	const publicEventsContext = $derived.by((): ScopedRouteContext | undefined => {
		const orgSlug = page.params.orgSlug?.trim();
		const storeSlug = page.params.storeSlug?.trim();
		return orgSlug && storeSlug ? { orgSlug, storeSlug } : undefined;
	});

	let loading = $state(true);
	let busy = $state(false);
	let detail = $state<PublicEventDetailPayload | null>(null);
	let errorMessage = $state<string | null>(null);
	let completedBookingPublicId = $state<string | null>(null);
	let intakeAnswers = $state<Record<string, string | boolean>>({});
	let bookingForm = $state({
		customerName: '',
		customerEmail: '',
		customerPhone: '',
		participantsCount: '1',
		companionNames: '',
		note: ''
	});

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

	const parseParticipantsCount = (): number => {
		const parsed = Number(bookingForm.participantsCount);
		return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
	};

	const updateBookingFormField = (field: keyof typeof bookingForm, event: Event) => {
		bookingForm[field] = (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
	};

	const buildCompanions = () =>
		bookingForm.companionNames
			.split('\n')
			.map((name) => name.trim())
			.filter((name) => name.length > 0)
			.map((name) => ({ name }));

	const getIntakeAnswerId = (field: PublicSiteIntakeFieldPayload): string =>
		`public-booking-intake-${field.fieldId}`;

	const syncIntakeAnswers = (fields: PublicSiteIntakeFieldPayload[]) => {
		const nextAnswers: Record<string, string | boolean> = {};
		for (const field of fields) {
			const currentValue = intakeAnswers[field.fieldId];
			nextAnswers[field.fieldId] =
				currentValue ?? (field.fieldType === 'checkbox' ? false : '');
		}
		intakeAnswers = nextAnswers;
	};

	const updateIntakeTextAnswer = (fieldId: string, event: Event) => {
		intakeAnswers[fieldId] = (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
	};

	const updateIntakeCheckboxAnswer = (fieldId: string, event: Event) => {
		intakeAnswers[fieldId] = (event.currentTarget as HTMLInputElement).checked;
	};

	const getIntakeTextAnswer = (fieldId: string): string => {
		const value = intakeAnswers[fieldId];
		return typeof value === 'string' ? value : '';
	};

	const hasRequiredIntakeValue = (field: PublicSiteIntakeFieldPayload): boolean => {
		const value = intakeAnswers[field.fieldId];
		if (field.fieldType === 'checkbox') {
			return value === true;
		}
		return typeof value === 'string' && value.trim().length > 0;
	};

	const validateIntakeAnswers = (): boolean => {
		for (const field of detail?.intakeFields ?? []) {
			if (field.required && !hasRequiredIntakeValue(field)) {
				toast.error(`${field.label}を入力してください。`);
				return false;
			}
		}
		return true;
	};

	const buildIntakeAnswers = () =>
		(detail?.intakeFields ?? [])
			.map((field) => {
				const rawValue = intakeAnswers[field.fieldId];
				const value =
					field.fieldType === 'checkbox'
						? rawValue === true
						: typeof rawValue === 'string'
							? rawValue.trim()
							: '';
				const hasValue =
					field.fieldType === 'checkbox' ? value === true : typeof value === 'string' && value.length > 0;
				return hasValue
					? {
							fieldId: field.fieldId,
							labelSnapshot: field.label,
							value
						}
					: null;
			})
			.filter(
				(answer): answer is { fieldId: string; labelSnapshot: string; value: string | boolean } =>
					answer !== null
			);

	const refresh = async () => {
		if (!slotId) {
			detail = null;
			errorMessage = 'イベントIDが指定されていません。';
			return;
		}

		errorMessage = null;
		try {
			const nextDetail = await loadPublicEventDetail(slotId, publicEventsContext);
			detail = nextDetail;
			syncIntakeAnswers(nextDetail.intakeFields);
		} catch (error) {
			detail = null;
			intakeAnswers = {};
			errorMessage = toExceptionMessage(error, '公開イベント詳細の取得に失敗しました。');
		}
	};

	const submitReserve = async () => {
		if (!detail || busy || !publicEventsContext) {
			return;
		}
		if (detail.requiresTicket) {
			toast.error('回数券が必要なサービスは、参加者画面から予約してください。');
			return;
		}
		const participantsCount = parseParticipantsCount();
		if (participantsCount > detail.remainingCount) {
			toast.error('人数が残枠を超えています。');
			return;
		}
		if (!validateIntakeAnswers()) {
			return;
		}

		busy = true;
		try {
			const answers = buildIntakeAnswers();
			const result = await createGuestPublicBooking(publicEventsContext, {
				slotId: detail.slotId,
				customerName: bookingForm.customerName,
				customerEmail: bookingForm.customerEmail,
				customerPhone: bookingForm.customerPhone,
				participantsCount,
				companions: buildCompanions(),
				note: bookingForm.note,
				...(answers.length > 0 ? { answers } : {})
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			if (result.booking) {
				completedBookingPublicId = result.booking.bookingPublicId;
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
		<h1 class="text-3xl font-semibold text-foreground">イベント詳細</h1>
		<p class="text-sm text-muted-foreground">公開予約ページから、ログインせずに予約できます。</p>
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
								<a
									class="block rounded-md border border-border/80 bg-background p-4 transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
									href={resolve(ticketType.href as ResolvablePath)}
								>
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
									<p class="mt-3 text-sm font-medium text-primary">詳細を見る</p>
								</a>
							{/each}
						</div>
					{/if}
				</section>
			{/if}

			{#if completedBookingPublicId}
				<div class="rounded-md border border-primary/25 bg-primary/10 p-4">
					<p class="text-sm font-semibold text-foreground">予約を受け付けました。</p>
					<p class="mt-1 text-sm text-muted-foreground">
						予約番号: <span class="font-mono text-foreground">{completedBookingPublicId}</span>
					</p>
				</div>
			{:else if detail?.requiresTicket}
				<div class="rounded-md border border-warning/45 bg-warning/15 p-4">
					<p class="text-sm text-warning-foreground">
						このサービスは回数券が必要です。参加者画面で回数券を確認して予約してください。
					</p>
				</div>
			{:else if detail}
				<form
					class="grid gap-4 md:grid-cols-2"
					onsubmit={(event) => {
						event.preventDefault();
						void submitReserve();
					}}
				>
					<div class="space-y-2">
						<Label for="public-booking-name">氏名</Label>
						<Input
							id="public-booking-name"
							name="customer_name"
							type="text"
							value={bookingForm.customerName}
							oninput={(event) => updateBookingFormField('customerName', event)}
							disabled={busy || !detail.isBookable}
							maxlength={120}
							required
						/>
					</div>
					<div class="space-y-2">
						<Label for="public-booking-email">メールアドレス</Label>
						<Input
							id="public-booking-email"
							name="customer_email"
							type="email"
							value={bookingForm.customerEmail}
							oninput={(event) => updateBookingFormField('customerEmail', event)}
							disabled={busy || !detail.isBookable}
							maxlength={320}
							required
						/>
					</div>
					<div class="space-y-2">
						<Label for="public-booking-phone">電話番号</Label>
						<Input
							id="public-booking-phone"
							name="customer_phone"
							type="tel"
							value={bookingForm.customerPhone}
							oninput={(event) => updateBookingFormField('customerPhone', event)}
							disabled={busy || !detail.isBookable}
							maxlength={80}
						/>
					</div>
					<div class="space-y-2">
						<Label for="public-booking-count">人数</Label>
						<Input
							id="public-booking-count"
							name="participants_count"
							type="number"
							min="1"
							max={Math.max(detail.remainingCount, 1)}
							value={bookingForm.participantsCount}
							oninput={(event) => updateBookingFormField('participantsCount', event)}
							disabled={busy || !detail.isBookable}
							required
						/>
					</div>
					<div class="space-y-2 md:col-span-2">
						<Label for="public-booking-companions">同伴者</Label>
						<textarea
							id="public-booking-companions"
							name="companions"
							class="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
							value={bookingForm.companionNames}
							oninput={(event) => updateBookingFormField('companionNames', event)}
							disabled={busy || !detail.isBookable}
							placeholder="1行に1名ずつ入力"
						></textarea>
					</div>
					<div class="space-y-2 md:col-span-2">
						<Label for="public-booking-note">備考</Label>
						<textarea
							id="public-booking-note"
							name="note"
							class="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
							value={bookingForm.note}
							oninput={(event) => updateBookingFormField('note', event)}
							disabled={busy || !detail.isBookable}
							maxlength={1000}
						></textarea>
					</div>
					{#if detail.intakeFields.length > 0}
						<fieldset class="space-y-4 md:col-span-2">
							<legend class="text-sm font-semibold text-foreground">追加情報</legend>
							<div class="grid gap-4 md:grid-cols-2">
								{#each detail.intakeFields as field (field.fieldId)}
									{@const fieldInputId = getIntakeAnswerId(field)}
									<div
										class={field.fieldType === 'textarea' || field.fieldType === 'checkbox'
											? 'space-y-2 md:col-span-2'
											: 'space-y-2'}
									>
										{#if field.fieldType === 'checkbox'}
											<label
												class="flex items-start gap-3 rounded-md border border-border/80 bg-background p-3 text-sm"
											>
												<input
													id={fieldInputId}
													name={field.fieldId}
													type="checkbox"
													class="mt-1 size-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
													checked={intakeAnswers[field.fieldId] === true}
													onchange={(event) => updateIntakeCheckboxAnswer(field.fieldId, event)}
													disabled={busy || !detail.isBookable}
													required={field.required}
												/>
												<span class="min-w-0 space-y-1">
													<span class="block font-medium text-foreground">
														{field.label}{field.required ? ' *' : ''}
													</span>
													{#if field.helpText}
														<span class="block text-xs text-muted-foreground">{field.helpText}</span>
													{/if}
												</span>
											</label>
										{:else if field.fieldType === 'textarea'}
											<Label for={fieldInputId}>{field.label}{field.required ? ' *' : ''}</Label>
											<textarea
												id={fieldInputId}
												name={field.fieldId}
												class="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
												value={getIntakeTextAnswer(field.fieldId)}
												oninput={(event) => updateIntakeTextAnswer(field.fieldId, event)}
												disabled={busy || !detail.isBookable}
												placeholder={field.placeholder ?? undefined}
												required={field.required}
												maxlength={1000}
											></textarea>
											{#if field.helpText}
												<p class="text-xs text-muted-foreground">{field.helpText}</p>
											{/if}
										{:else if field.fieldType === 'select'}
											<Label for={fieldInputId}>{field.label}{field.required ? ' *' : ''}</Label>
											<select
												id={fieldInputId}
												name={field.fieldId}
												class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
												value={getIntakeTextAnswer(field.fieldId)}
												onchange={(event) => updateIntakeTextAnswer(field.fieldId, event)}
												disabled={busy || !detail.isBookable}
												required={field.required}
											>
												<option value="">{field.placeholder ?? '選択してください'}</option>
												{#each field.options as option (option)}
													<option value={option}>{option}</option>
												{/each}
											</select>
											{#if field.helpText}
												<p class="text-xs text-muted-foreground">{field.helpText}</p>
											{/if}
										{:else}
											<Label for={fieldInputId}>{field.label}{field.required ? ' *' : ''}</Label>
											<Input
												id={fieldInputId}
												name={field.fieldId}
												type="text"
												value={getIntakeTextAnswer(field.fieldId)}
												oninput={(event) => updateIntakeTextAnswer(field.fieldId, event)}
												disabled={busy || !detail.isBookable}
												placeholder={field.placeholder ?? undefined}
												required={field.required}
												maxlength={200}
											/>
											{#if field.helpText}
												<p class="text-xs text-muted-foreground">{field.helpText}</p>
											{/if}
										{/if}
									</div>
								{/each}
							</div>
						</fieldset>
					{/if}
					<div class="md:col-span-2">
						<Button type="submit" disabled={busy || !detail.isBookable}>
							{busy ? '処理中…' : '予約する'}
						</Button>
					</div>
				</form>
			{/if}
		</CardContent>
	</Card>
</main>
