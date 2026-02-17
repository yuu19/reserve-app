<script lang="ts">
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { DatePicker } from '$lib/components/ui/date-picker';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import {
		cancelBooking,
		createBooking,
		createRecurringSchedule,
		createService,
		createSlot,
		defaultDate,
		loadBookingData,
		parseNumberInput,
		toDayBoundaryIso,
		toIsoFromDateTime
	} from '$lib/features/bookings.svelte';
	import { getCurrentPathWithSearch, loadSession, redirectToLoginWithNext } from '$lib/features/auth-session.svelte';
	import { loadOrganizations } from '$lib/features/organization-context.svelte';
	import { loadAdminInvitations } from '$lib/features/invitations-admin.svelte';
	import { loadParticipantFeatureData } from '$lib/features/invitations-participant.svelte';
	import type { BookingPayload, RecurringSchedulePayload, ServicePayload, SlotPayload } from '$lib/rpc-client';
	import { toast } from 'svelte-sonner';

	let loading = $state(true);
	let busy = $state(false);
	let tab = $state<'operations' | 'participant'>('operations');
	let canManage = $state(false);
	let activeOrganizationId = $state<string | null>(null);

	let services = $state<ServicePayload[]>([]);
	let slots = $state<SlotPayload[]>([]);
	let recurringSchedules = $state<RecurringSchedulePayload[]>([]);
	let availableSlots = $state<SlotPayload[]>([]);
	let myBookings = $state<BookingPayload[]>([]);

	let serviceForm = $state({
		name: '',
		kind: 'single' as 'single' | 'recurring',
		durationMinutes: '60',
		capacity: '10',
		requiresTicket: false,
		cancellationDeadlineMinutes: '1440'
	});
	let slotForm = $state({
		serviceId: '',
		startDate: '',
		startTime: '10:00',
		endDate: '',
		endTime: '11:00',
		capacity: '',
		staffLabel: '',
		locationLabel: ''
	});
	let recurringForm = $state({
		serviceId: '',
		frequency: 'weekly' as 'weekly' | 'monthly',
		interval: '1',
		byWeekday: '1',
		byMonthday: '',
		startDate: '',
		endDate: '',
		startTimeLocal: '10:00',
		durationMinutes: '',
		capacityOverride: ''
	});
	let slotSearchForm = $state({ serviceId: '', fromDate: '', toDate: '' });

	const confirmedBookingCount = $derived(
		myBookings.filter((booking) => booking.status === 'confirmed').length
	);

	const parseByWeekday = (value: string): number[] | undefined => {
		if (!value.trim()) {
			return undefined;
		}
		const parsed = value
			.split(',')
			.map((part) => Number(part.trim()))
			.filter((num) => Number.isInteger(num) && num >= 1 && num <= 7);
		if (parsed.length === 0) {
			return undefined;
		}
		return Array.from(new Set(parsed));
	};

	const getServiceName = (serviceId: string): string => {
		const service = services.find((item) => item.id === serviceId);
		return service?.name ?? serviceId;
	};

	const refresh = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}
		const { activeOrganization } = await loadOrganizations();
		activeOrganizationId = activeOrganization?.id ?? null;
		if (!activeOrganizationId) {
			services = [];
			slots = [];
			recurringSchedules = [];
			availableSlots = [];
			myBookings = [];
			return;
		}
		if (!slotSearchForm.fromDate) slotSearchForm.fromDate = defaultDate(0);
		if (!slotSearchForm.toDate) slotSearchForm.toDate = defaultDate(14);

		const [adminData, participantData] = await Promise.all([
			loadAdminInvitations(activeOrganizationId),
			loadParticipantFeatureData(activeOrganizationId)
		]);
		canManage = adminData.canManage || participantData.canManage;

		const from = toDayBoundaryIso(slotSearchForm.fromDate, false);
		const to = toDayBoundaryIso(slotSearchForm.toDate, true);
		if (!from || !to) {
			toast.error('検索期間の日付形式が正しくありません。');
			return;
		}
		const bookingData = await loadBookingData(activeOrganizationId, from, to, slotSearchForm.serviceId || undefined);
		services = bookingData.services;
		slots = bookingData.slots;
		recurringSchedules = bookingData.recurringSchedules;
		availableSlots = bookingData.availableSlots;
		myBookings = bookingData.myBookings;
		if (bookingData.errors.length > 0) {
			toast.error(bookingData.errors[0]);
		}
	};

	const submitCreateService = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!activeOrganizationId || !canManage) return;
		busy = true;
		try {
			const result = await createService({
				organizationId: activeOrganizationId,
				name: serviceForm.name,
				kind: serviceForm.kind,
				durationMinutes: Number(serviceForm.durationMinutes),
				capacity: Number(serviceForm.capacity),
				requiresTicket: serviceForm.requiresTicket,
				cancellationDeadlineMinutes: parseNumberInput(serviceForm.cancellationDeadlineMinutes)
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			serviceForm.name = '';
			await refresh();
		} finally {
			busy = false;
		}
	};

	const submitCreateSlot = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!activeOrganizationId || !canManage) return;
		const startAt = toIsoFromDateTime(slotForm.startDate, slotForm.startTime);
		const endAt = toIsoFromDateTime(slotForm.endDate, slotForm.endTime);
		if (!startAt || !endAt) {
			toast.error('開始・終了日時を正しく入力してください。');
			return;
		}
		busy = true;
		try {
			const result = await createSlot({
				organizationId: activeOrganizationId,
				serviceId: slotForm.serviceId,
				startAt,
				endAt,
				capacity: parseNumberInput(slotForm.capacity),
				staffLabel: slotForm.staffLabel || undefined,
				locationLabel: slotForm.locationLabel || undefined
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			busy = false;
		}
	};

	const submitCreateRecurringSchedule = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!activeOrganizationId || !canManage) return;
		busy = true;
		try {
			const result = await createRecurringSchedule({
				organizationId: activeOrganizationId,
				serviceId: recurringForm.serviceId,
				frequency: recurringForm.frequency,
				interval: Number(recurringForm.interval),
				byWeekday: recurringForm.frequency === 'weekly' ? parseByWeekday(recurringForm.byWeekday) : undefined,
				byMonthday:
					recurringForm.frequency === 'monthly' ? parseNumberInput(recurringForm.byMonthday) : undefined,
				startDate: recurringForm.startDate,
				endDate: recurringForm.endDate || undefined,
				startTimeLocal: recurringForm.startTimeLocal,
				durationMinutes: parseNumberInput(recurringForm.durationMinutes),
				capacityOverride: parseNumberInput(recurringForm.capacityOverride)
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			busy = false;
		}
	};

	const submitSearch = async (event: SubmitEvent) => {
		event.preventDefault();
		busy = true;
		try {
			await refresh();
		} finally {
			busy = false;
		}
	};

	const submitCreateBooking = async (slotId: string) => {
		busy = true;
		try {
			const result = await createBooking(slotId);
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			busy = false;
		}
	};

	const submitCancelBooking = async (bookingId: string) => {
		if (!confirm('この予約をキャンセルしますか？')) {
			return;
		}
		busy = true;
		try {
			const result = await cancelBooking(bookingId);
			if (!result.ok) {
				toast.error(result.message);
				return;
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

<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold text-slate-900">予約</h1>
		<p class="text-sm text-slate-600">運営作業と参加者申込をタブで切り替えて管理します。</p>
	</header>

	{#if !activeOrganizationId}
		<Card class="surface-panel border-slate-200/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">利用中の組織を `/dashboard` で選択してください。</p>
			</CardContent>
		</Card>
	{:else}
		<Tabs bind:value={tab}>
			<TabsList class="grid w-full grid-cols-2">
				<TabsTrigger value="operations">運営</TabsTrigger>
				<TabsTrigger value="participant">参加者</TabsTrigger>
			</TabsList>

			<TabsContent value="operations" class="space-y-4">
				{#if !canManage}
					<Card class="surface-panel border-slate-200/80 shadow-lg">
						<CardContent class="py-6">
							<p class="text-sm text-muted-foreground">この組織の運営操作には admin または owner 権限が必要です。</p>
						</CardContent>
					</Card>
				{:else}
					<section class="grid gap-4 lg:grid-cols-3">
						<Card class="surface-panel border-slate-200/80 shadow-lg">
							<CardHeader><h2 class="text-lg font-semibold">サービス作成</h2></CardHeader>
							<CardContent>
								<form class="space-y-3" onsubmit={submitCreateService}>
									<div class="space-y-2"><Label for="service-name">サービス名</Label><Input id="service-name" name="service_name" bind:value={serviceForm.name} required /></div>
									<div class="space-y-2">
										<Label for="service-kind">種別</Label>
										<Select.Root type="single" bind:value={serviceForm.kind}><Select.Trigger id="service-kind" class="w-full">{serviceForm.kind}</Select.Trigger><Select.Content><Select.Item value="single" label="single" /><Select.Item value="recurring" label="recurring" /></Select.Content></Select.Root>
									</div>
									<div class="space-y-2"><Label for="service-duration">所要時間（分）</Label><Input id="service-duration" name="service_duration" type="number" min="1" bind:value={serviceForm.durationMinutes} required /></div>
									<div class="space-y-2"><Label for="service-capacity">定員</Label><Input id="service-capacity" name="service_capacity" type="number" min="1" bind:value={serviceForm.capacity} required /></div>
									<Button type="submit" disabled={busy}>作成</Button>
								</form>
							</CardContent>
						</Card>
						<Card class="surface-panel border-slate-200/80 shadow-lg">
							<CardHeader><h2 class="text-lg font-semibold">単発Slot作成</h2></CardHeader>
							<CardContent>
								<form class="space-y-3" onsubmit={submitCreateSlot}>
									<div class="space-y-2"><Label for="slot-service">サービス</Label><Select.Root type="single" bind:value={slotForm.serviceId}><Select.Trigger id="slot-service" class="w-full">{slotForm.serviceId ? getServiceName(slotForm.serviceId) : 'サービスを選択'}</Select.Trigger><Select.Content>{#each services as service (service.id)}<Select.Item value={service.id} label={service.name} />{/each}</Select.Content></Select.Root></div>
									<DatePicker id="slot-start-date" name="slot_start_date" label="開始日" required bind:value={slotForm.startDate} />
									<div class="space-y-2"><Label for="slot-start-time">開始時刻</Label><Input id="slot-start-time" name="slot_start_time" type="time" bind:value={slotForm.startTime} required /></div>
									<DatePicker id="slot-end-date" name="slot_end_date" label="終了日" required bind:value={slotForm.endDate} />
									<div class="space-y-2"><Label for="slot-end-time">終了時刻</Label><Input id="slot-end-time" name="slot_end_time" type="time" bind:value={slotForm.endTime} required /></div>
									<Button type="submit" disabled={busy || !slotForm.serviceId}>作成</Button>
								</form>
							</CardContent>
						</Card>
						<Card class="surface-panel border-slate-200/80 shadow-lg">
							<CardHeader><h2 class="text-lg font-semibold">定期Schedule作成</h2></CardHeader>
							<CardContent>
								<form class="space-y-3" onsubmit={submitCreateRecurringSchedule}>
									<div class="space-y-2"><Label for="rec-service">サービス</Label><Select.Root type="single" bind:value={recurringForm.serviceId}><Select.Trigger id="rec-service" class="w-full">{recurringForm.serviceId ? getServiceName(recurringForm.serviceId) : 'サービスを選択'}</Select.Trigger><Select.Content>{#each services as service (service.id)}<Select.Item value={service.id} label={service.name} />{/each}</Select.Content></Select.Root></div>
									<div class="space-y-2"><Label for="rec-frequency">頻度</Label><Select.Root type="single" bind:value={recurringForm.frequency}><Select.Trigger id="rec-frequency" class="w-full">{recurringForm.frequency}</Select.Trigger><Select.Content><Select.Item value="weekly" label="weekly" /><Select.Item value="monthly" label="monthly" /></Select.Content></Select.Root></div>
									<div class="space-y-2"><Label for="rec-interval">間隔</Label><Input id="rec-interval" name="rec_interval" type="number" min="1" bind:value={recurringForm.interval} required /></div>
									{#if recurringForm.frequency === 'weekly'}
										<div class="space-y-2"><Label for="rec-weekday">曜日（1-7）</Label><Input id="rec-weekday" name="rec_weekday" bind:value={recurringForm.byWeekday} /></div>
									{:else}
										<div class="space-y-2"><Label for="rec-monthday">日付（1-31）</Label><Input id="rec-monthday" name="rec_monthday" type="number" min="1" max="31" bind:value={recurringForm.byMonthday} /></div>
									{/if}
									<DatePicker id="rec-start-date" name="rec_start_date" label="開始日" required bind:value={recurringForm.startDate} />
									<DatePicker id="rec-end-date" name="rec_end_date" label="終了日" bind:value={recurringForm.endDate} />
									<div class="space-y-2"><Label for="rec-start-time">開始時刻</Label><Input id="rec-start-time" name="rec_start_time" type="time" bind:value={recurringForm.startTimeLocal} required /></div>
									<Button type="submit" disabled={busy || !recurringForm.serviceId}>作成</Button>
								</form>
							</CardContent>
						</Card>
					</section>
				{/if}

				<section class="grid gap-3 md:grid-cols-3">
					<Card><CardContent class="py-4"><p class="text-xs text-muted-foreground">サービス</p><p class="metric-value text-2xl font-semibold">{services.length}</p></CardContent></Card>
					<Card><CardContent class="py-4"><p class="text-xs text-muted-foreground">期間内の枠</p><p class="metric-value text-2xl font-semibold">{slots.length}</p></CardContent></Card>
					<Card><CardContent class="py-4"><p class="text-xs text-muted-foreground">定期スケジュール</p><p class="metric-value text-2xl font-semibold">{recurringSchedules.length}</p></CardContent></Card>
				</section>
			</TabsContent>

			<TabsContent value="participant" class="space-y-4">
				<Card class="surface-panel border-slate-200/80 shadow-lg">
					<CardHeader><h2 class="text-lg font-semibold">空き枠検索</h2><CardDescription>検索後に申込できます。</CardDescription></CardHeader>
					<CardContent>
						<form class="grid gap-3 md:grid-cols-4" onsubmit={submitSearch}>
							<DatePicker id="available-from" name="available_from" label="検索開始日" required bind:value={slotSearchForm.fromDate} />
							<DatePicker id="available-to" name="available_to" label="検索終了日" required bind:value={slotSearchForm.toDate} />
							<div class="space-y-2"><Label for="available-service">サービス（任意）</Label><Select.Root type="single" bind:value={slotSearchForm.serviceId}><Select.Trigger id="available-service" class="w-full">{slotSearchForm.serviceId ? getServiceName(slotSearchForm.serviceId) : 'すべて'}</Select.Trigger><Select.Content>{#each services as service (service.id)}<Select.Item value={service.id} label={service.name} />{/each}</Select.Content></Select.Root></div>
							<div class="flex items-end"><Button type="submit" class="w-full" disabled={busy}>検索</Button></div>
						</form>
					</CardContent>
				</Card>

				<section class="space-y-2">
					<h2 class="text-lg font-semibold">空き枠一覧</h2>
					{#if availableSlots.length === 0}
						<p class="text-sm text-muted-foreground">空き枠は見つかりませんでした。</p>
					{:else}
						<div class="space-y-2">
							{#each availableSlots as slot (slot.id)}
								<div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white/80 p-3">
									<div>
										<p class="text-sm font-semibold text-slate-900">{getServiceName(slot.serviceId)}</p>
										<p class="text-xs text-muted-foreground">{slot.startAt} 〜 {slot.endAt}</p>
									</div>
									<Button type="button" onclick={() => submitCreateBooking(slot.id)} disabled={busy || slot.status !== 'open'}>申し込む</Button>
								</div>
							{/each}
						</div>
					{/if}
				</section>

				<section class="space-y-2">
					<h2 class="text-lg font-semibold">マイ予約一覧</h2>
					<p class="text-xs text-muted-foreground">確定予約: {confirmedBookingCount}件</p>
					{#if myBookings.length === 0}
						<p class="text-sm text-muted-foreground">予約はまだありません。</p>
					{:else}
						<div class="space-y-2">
							{#each myBookings as booking (booking.id)}
								<div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white/80 p-3">
									<div>
										<p class="text-sm font-semibold text-slate-900">{getServiceName(booking.serviceId)}</p>
										<p class="text-xs text-muted-foreground">status: {booking.status}</p>
									</div>
									<Button type="button" variant="destructive" onclick={() => submitCancelBooking(booking.id)} disabled={busy || booking.status !== 'confirmed'}>キャンセル</Button>
								</div>
							{/each}
						</div>
					{/if}
				</section>
			</TabsContent>
		</Tabs>
	{/if}
</main>
