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
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import {
		buildCalendarDays,
		cancelBooking,
		createBooking,
		createRecurringSchedule,
		createService,
		createSlot,
		formatMonthLabel,
		formatTimeLabel,
		getMonthDateRange,
		loadBookingData,
		parseNumberInput,
		toDateKey,
		toDateKeyFromIso,
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
	let bookingAction = $state<{ kind: 'create' | 'cancel'; id: string } | null>(null);
	let tab = $state<'operations' | 'participant'>('operations');
	let participantView = $state<'calendar' | 'schedule'>('calendar');
	let schedulePeriod = $state<'upcoming' | 'past'>('upcoming');
	let canManage = $state(false);
	let canViewParticipantCalendar = $state(false);
	let canUseParticipantBooking = $state(true);
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
	let visibleMonth = $state(new Date());
	const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];
	const maxCellItems = 3;
	const scheduleDateFormatter = new Intl.DateTimeFormat('ja-JP', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});

	const confirmedBookingCount = $derived(
		myBookings.filter((booking) => booking.status === 'confirmed').length
	);
	const calendarDays = $derived(buildCalendarDays(visibleMonth));
	const monthLabel = $derived(formatMonthLabel(visibleMonth));

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

	type CalendarItem = {
		slot: SlotPayload;
		booking?: BookingPayload;
	};
	type ScheduleGroup = {
		dateKey: string;
		dateLabel: string;
		rows: Array<{
			slotId: string;
			startAt: string;
			endAt: string;
			serviceName: string;
			status: SlotPayload['status'];
			statusLabel: string;
			capacity: number;
			pendingCount: number;
			confirmedCount: number;
			remainingCount: number;
		}>;
	};

	const statusLabelMap: Record<SlotPayload['status'], string> = {
		open: '受付中',
		canceled: '停止',
		completed: '終了'
	};

	const isViewOnlyCalendar = $derived(canViewParticipantCalendar && !canUseParticipantBooking);

	const isCurrentMonthDay = (date: Date): boolean =>
		date.getFullYear() === visibleMonth.getFullYear() && date.getMonth() === visibleMonth.getMonth();

	const toMonthRangeIso = () => {
		const { fromDate, toDate } = getMonthDateRange(visibleMonth);
		slotSearchForm.fromDate = fromDate;
		slotSearchForm.toDate = toDate;
		const from = toDayBoundaryIso(fromDate, false);
		const to = toDayBoundaryIso(toDate, true);
		return { from, to };
	};

	const slotMapById = $derived.by(() => {
		const map = new Map<string, SlotPayload>();
		for (const slot of slots) {
			map.set(slot.id, slot);
		}
		return map;
	});

	const calendarItemsByDate = $derived.by(() => {
		const map = new Map<string, CalendarItem[]>();
		const mapBySlotId = new Map<string, CalendarItem>();
		const addItem = (item: CalendarItem) => {
			const key = toDateKeyFromIso(item.slot.startAt);
			if (!key) {
				return;
			}
			const list = map.get(key) ?? [];
			list.push(item);
			map.set(key, list);
			mapBySlotId.set(item.slot.id, item);
		};

		if (isViewOnlyCalendar) {
			for (const slot of slots) {
				addItem({ slot });
			}
		} else if (canUseParticipantBooking) {
			for (const slot of availableSlots) {
				addItem({ slot });
			}

			for (const booking of myBookings) {
				const slot = slotMapById.get(booking.slotId);
				if (!slot) {
					continue;
				}
				const found = mapBySlotId.get(slot.id);
				if (found) {
					found.booking = booking;
					continue;
				}
				addItem({ slot, booking });
			}
		}

		for (const [key, list] of map.entries()) {
			list.sort((a, b) => a.slot.startAt.localeCompare(b.slot.startAt));
			map.set(key, list);
		}
		return map;
	});

	const getItemsForDay = (date: Date): CalendarItem[] => calendarItemsByDate.get(toDateKey(date)) ?? [];
	const isBookingCreateInProgress = (slotId: string): boolean =>
		bookingAction?.kind === 'create' && bookingAction.id === slotId;
	const isBookingCancelInProgress = (bookingId: string | undefined): boolean =>
		typeof bookingId === 'string' && bookingAction?.kind === 'cancel' && bookingAction.id === bookingId;
	const formatScheduleDateLabel = (dateKey: string): string => {
		const parsed = new Date(`${dateKey}T00:00:00`);
		if (Number.isNaN(parsed.getTime())) {
			return dateKey;
		}
		return scheduleDateFormatter.format(parsed);
	};
	const scheduleGroups = $derived.by(() => {
		const nowIso = new Date().toISOString();
		const groups: ScheduleGroup[] = [];

		for (const [dateKey, items] of calendarItemsByDate.entries()) {
			const rows = items
				.filter((item) =>
					schedulePeriod === 'upcoming' ? item.slot.startAt >= nowIso : item.slot.startAt < nowIso
				)
				.map((item) => {
					const confirmedCount = item.slot.reservedCount;
					return {
						slotId: item.slot.id,
						startAt: item.slot.startAt,
						endAt: item.slot.endAt,
						serviceName: getServiceName(item.slot.serviceId),
						status: item.slot.status,
						statusLabel: statusLabelMap[item.slot.status],
						capacity: item.slot.capacity,
						pendingCount: 0,
						confirmedCount,
						remainingCount: Math.max(item.slot.capacity - confirmedCount, 0)
					};
				})
				.sort((a, b) => a.startAt.localeCompare(b.startAt));

			if (rows.length === 0) {
				continue;
			}

			groups.push({
				dateKey,
				dateLabel: formatScheduleDateLabel(dateKey),
				rows
			});
		}

		groups.sort((a, b) =>
			schedulePeriod === 'upcoming'
				? a.dateKey.localeCompare(b.dateKey)
				: b.dateKey.localeCompare(a.dateKey)
		);
		return groups;
	});

	const shiftVisibleMonth = async (delta: number) => {
		visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + delta, 1);
		busy = true;
		try {
			await refresh();
		} finally {
			busy = false;
		}
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
			canViewParticipantCalendar = false;
			canUseParticipantBooking = false;
			return;
		}
		const { from, to } = toMonthRangeIso();

		const [adminData, participantData] = await Promise.all([
			loadAdminInvitations(activeOrganizationId),
			loadParticipantFeatureData(activeOrganizationId)
		]);
		canManage = adminData.canManage || participantData.canManage;

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
		canUseParticipantBooking = !bookingData.participantAccessDenied;
		canViewParticipantCalendar = canUseParticipantBooking || (canManage && bookingData.participantAccessDenied);
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
		if (!recurringForm.serviceId) {
			toast.error('サービスを選択してください。');
			return;
		}
		if (!recurringForm.startDate) {
			toast.error('開始日を選択してください。');
			return;
		}
		if (recurringForm.frequency === 'weekly' && recurringForm.byWeekday.trim()) {
			const parsedWeekday = parseByWeekday(recurringForm.byWeekday);
			if (!parsedWeekday) {
				toast.error('曜日は 1-7 の数値をカンマ区切りで入力してください。');
				return;
			}
		}
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

	const submitCreateBooking = async (slotId: string) => {
		if (bookingAction) {
			return;
		}
		if (!canUseParticipantBooking) {
			toast.error('予約申込には参加者としての所属が必要です。');
			return;
		}
		bookingAction = { kind: 'create', id: slotId };
		try {
			const result = await createBooking(slotId);
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			bookingAction = null;
		}
	};

	const submitCancelBooking = async (bookingId: string) => {
		if (bookingAction) {
			return;
		}
		if (!canUseParticipantBooking) {
			toast.error('予約キャンセルには参加者としての所属が必要です。');
			return;
		}
		if (!confirm('この予約をキャンセルしますか？')) {
			return;
		}
		bookingAction = { kind: 'cancel', id: bookingId };
		try {
			const result = await cancelBooking(bookingId);
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			bookingAction = null;
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
					<CardHeader class="space-y-3">
						<div class="flex flex-wrap items-center justify-between gap-3">
							<div>
								<h2 class="text-lg font-semibold">{participantView === 'calendar' ? '予約カレンダー' : '日程表'}</h2>
								<CardDescription>
									{participantView === 'calendar'
										? '空き枠と自分の予約を月表示で確認できます。'
										: '表示月の予定を日付単位で一覧表示します。'}
								</CardDescription>
							</div>
							<div class="flex items-center gap-2">
								<Button
									type="button"
									variant="outline"
									size="icon"
									aria-label="前月へ移動"
									onclick={() => shiftVisibleMonth(-1)}
									disabled={busy}
								>
									<ChevronLeft class="size-4" />
								</Button>
								<p class="min-w-32 text-center text-lg font-semibold text-slate-900">{monthLabel}</p>
								<Button
									type="button"
									variant="outline"
									size="icon"
									aria-label="次月へ移動"
									onclick={() => shiftVisibleMonth(1)}
									disabled={busy}
								>
									<ChevronRight class="size-4" />
								</Button>
							</div>
						</div>
						{#if isViewOnlyCalendar}
							<p class="text-sm text-muted-foreground">
								管理者として閲覧のみ可能です。予約操作には参加者としての所属が必要です。
							</p>
						{:else if !canViewParticipantCalendar}
							<p class="text-sm text-muted-foreground">
								この組織の予約カレンダー閲覧には参加者としての所属が必要です。
							</p>
						{:else if !canUseParticipantBooking}
							<p class="text-sm text-muted-foreground">
								この組織で予約申込するには、管理者権限に加えて参加者として所属している必要があります。
							</p>
							{/if}
						</CardHeader>
						<CardContent class="space-y-3">
							<Tabs bind:value={participantView} class="space-y-4">
								<TabsList class="grid w-full max-w-sm grid-cols-2">
									<TabsTrigger value="calendar">予約カレンダー</TabsTrigger>
									<TabsTrigger value="schedule">日程表</TabsTrigger>
								</TabsList>

								<TabsContent value="calendar" class="space-y-3">
									<div class="flex flex-wrap items-center gap-2 text-xs text-slate-600">
										<Badge variant="outline">空き枠</Badge>
										<Badge variant="secondary">自分の予約</Badge>
										<span>確定予約: {confirmedBookingCount}件</span>
									</div>

									<div class="grid grid-cols-7 gap-1 rounded-lg border border-slate-200/80 bg-slate-50/60 p-2 text-center text-xs font-semibold text-slate-600">
										{#each weekdayLabels as dayLabel (dayLabel)}
											<div>{dayLabel}</div>
										{/each}
									</div>

									{#if !canViewParticipantCalendar}
										<p class="text-sm text-muted-foreground">表示できる予定がありません。</p>
									{:else}
										<div class="grid grid-cols-7 gap-1">
											{#each calendarDays as day (`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`)}
												{@const dayItems = getItemsForDay(day)}
												{@const visibleItems = dayItems.slice(0, maxCellItems)}
												{@const hiddenCount = Math.max(0, dayItems.length - visibleItems.length)}
												<div
													class={`min-h-40 rounded-lg border p-2 ${
														isCurrentMonthDay(day)
															? 'border-slate-200/80 bg-white'
															: 'border-slate-100 bg-slate-50 text-slate-400'
													}`}
												>
													<p class="mb-2 text-sm font-semibold">{day.getDate()}</p>
													<div class="space-y-2">
														{#each visibleItems as item (item.slot.id)}
															{@const isConfirmed = item.booking?.status === 'confirmed'}
															{@const bookingId = item.booking?.id}
															{@const canApply =
																item.slot.status === 'open' &&
																item.slot.reservedCount < item.slot.capacity &&
																!isConfirmed}
															<div
																class={`rounded-md border p-2 ${
																	isConfirmed
																		? 'border-sky-200 bg-sky-50'
																		: item.slot.status === 'canceled'
																			? 'border-rose-200 bg-rose-50'
																			: item.slot.status === 'completed'
																				? 'border-slate-300 bg-slate-100'
																				: 'border-slate-200 bg-slate-50'
																}`}
															>
																<p class="text-[11px] text-slate-600">
																	{formatTimeLabel(item.slot.startAt)} - {formatTimeLabel(item.slot.endAt)}
																</p>
																<p class="truncate text-xs font-semibold text-slate-900">
																	{getServiceName(item.slot.serviceId)}
																</p>
																<p class="text-[11px] text-slate-600">
																	({item.slot.reservedCount}/{item.slot.capacity})
																</p>
																{#if isViewOnlyCalendar}
																	<p class="mt-1 text-[11px] text-slate-500">
																		{statusLabelMap[item.slot.status]} / 閲覧のみ
																	</p>
																{:else if isConfirmed && item.booking}
																<Button
																	type="button"
																	variant="destructive"
																	size="sm"
																	class="mt-1 h-7 text-[11px]"
																	onclick={() => bookingId && submitCancelBooking(bookingId)}
																	disabled={busy || !bookingId || !canUseParticipantBooking || isBookingCancelInProgress(bookingId)}
																>
																	{isBookingCancelInProgress(bookingId) ? 'キャンセル中…' : 'キャンセル'}
																</Button>
															{:else if canApply}
																<Button
																	type="button"
																	size="sm"
																	class="mt-1 h-7 text-[11px]"
																	onclick={() => submitCreateBooking(item.slot.id)}
																	disabled={busy || !canUseParticipantBooking || isBookingCreateInProgress(item.slot.id)}
																>
																	{isBookingCreateInProgress(item.slot.id) ? '申込中…' : '申し込む'}
																</Button>
															{:else}
																	<p class="mt-1 text-[11px] text-slate-500">受付不可</p>
																{/if}
															</div>
														{/each}
														{#if hiddenCount > 0}
															<p class="text-[11px] text-slate-500">+{hiddenCount}件</p>
														{/if}
													</div>
												</div>
											{/each}
										</div>
									{/if}
								</TabsContent>

								<TabsContent value="schedule" class="space-y-4">
									<div class="flex items-center gap-3 border-b border-slate-200 pb-2">
										<button
											type="button"
											class={`border-b-2 px-1 pb-1 text-base font-semibold transition-colors ${
												schedulePeriod === 'upcoming'
													? 'border-teal-500 text-slate-900'
													: 'border-transparent text-slate-500 hover:text-slate-700'
											}`}
											onclick={() => (schedulePeriod = 'upcoming')}
											aria-pressed={schedulePeriod === 'upcoming'}
										>
											今後の日程
										</button>
										<button
											type="button"
											class={`border-b-2 px-1 pb-1 text-base font-semibold transition-colors ${
												schedulePeriod === 'past'
													? 'border-teal-500 text-slate-900'
													: 'border-transparent text-slate-500 hover:text-slate-700'
											}`}
											onclick={() => (schedulePeriod = 'past')}
											aria-pressed={schedulePeriod === 'past'}
										>
											過去の日程
										</button>
									</div>

									{#if !canViewParticipantCalendar}
										<p class="text-sm text-muted-foreground">表示できる予定がありません。</p>
									{:else if scheduleGroups.length === 0}
										<p class="text-sm text-muted-foreground">該当する日程はありません。</p>
									{:else}
										<div class="space-y-4">
											{#each scheduleGroups as group (group.dateKey)}
												<section class="overflow-hidden rounded-lg border border-slate-200/80 bg-white">
													<div class="bg-cyan-100/70 px-3 py-2 text-sm font-semibold text-slate-800">{group.dateLabel}</div>
													<div class="overflow-x-auto">
														<table class="w-full min-w-[760px] text-sm">
															<thead class="bg-slate-50 text-slate-600">
																<tr>
																	<th class="px-3 py-2 text-left font-medium">時間帯</th>
																	<th class="px-3 py-2 text-left font-medium">サービス</th>
																	<th class="px-3 py-2 text-left font-medium">状態</th>
																	<th class="px-3 py-2 text-right font-medium">定員</th>
																	<th class="px-3 py-2 text-right font-medium">承認待ち</th>
																	<th class="px-3 py-2 text-right font-medium">確定</th>
																	<th class="px-3 py-2 text-right font-medium">残席</th>
																</tr>
															</thead>
															<tbody>
																{#each group.rows as row (row.slotId)}
																	<tr class="border-t border-slate-200/70">
																		<td class="px-3 py-3 font-medium tabular-nums whitespace-nowrap">
																			{formatTimeLabel(row.startAt)} ～ {formatTimeLabel(row.endAt)}
																		</td>
																		<td class="px-3 py-3">{row.serviceName}</td>
																		<td class="px-3 py-3">
																			<Badge
																				variant={row.status === 'canceled'
																					? 'destructive'
																					: row.status === 'completed'
																						? 'secondary'
																						: 'outline'}
																			>
																				{row.statusLabel}
																			</Badge>
																		</td>
																		<td class="px-3 py-3 text-right tabular-nums">{row.capacity}</td>
																		<td class="px-3 py-3 text-right tabular-nums">{row.pendingCount}</td>
																		<td class="px-3 py-3 text-right tabular-nums">{row.confirmedCount}</td>
																		<td class="px-3 py-3 text-right tabular-nums">{row.remainingCount}</td>
																	</tr>
																{/each}
															</tbody>
														</table>
													</div>
												</section>
											{/each}
										</div>
									{/if}
								</TabsContent>
							</Tabs>
						</CardContent>
					</Card>
				</TabsContent>
		</Tabs>
	{/if}
</main>
