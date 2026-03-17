<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { DatePicker } from '$lib/components/ui/date-picker';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import {
		approveBooking,
		archiveServiceByStaff,
		buildCalendarDays,
		cancelBooking,
		cancelBookingByStaff,
		cancelSlotByStaff,
		createBooking,
		createRecurringSchedule,
		createService,
		createSlot,
		formatMonthLabel,
		formatTimeLabel,
		generateRecurringSlotsByStaff,
		getMonthDateRange,
		loadAdminBookingsOperationsData,
		loadAdminRecurringData,
		loadAdminServicesData,
		loadAdminSlotsData,
		loadParticipantBookingsData,
		markBookingNoShow,
		parseNumberInput,
		rejectBooking,
		resumeServiceByStaff,
		toDateKey,
		toDateKeyFromIso,
		toDayBoundaryIso,
		toIsoFromDateTime,
		uploadServiceImage,
		updateRecurringScheduleByStaff,
		updateSlotByStaff,
		updateServiceByStaff,
		upsertRecurringExceptionByStaff
	} from '$lib/features/bookings.svelte';
	import {
		cancelTicketPurchase as cancelTicketPurchaseRequest,
		createTicketPurchase as createTicketPurchaseRequest
	} from '$lib/features/tickets.svelte';
	import {
		getCurrentPathWithSearch,
		loadSession,
		redirectToLoginWithNext
	} from '$lib/features/auth-session.svelte';
	import type {
		BookingPayload,
		ParticipantPayload,
		RecurringSchedulePayload,
		ServicePayload,
		SlotPayload,
		TicketPackPayload,
		TicketPurchasePayload,
		TicketTypePayload
	} from '$lib/rpc-client';
	import { toast } from 'svelte-sonner';

	type BookingPageMode =
		| 'admin-operations'
		| 'admin-services'
		| 'admin-services-new'
		| 'admin-slots'
		| 'admin-slots-new'
		| 'admin-recurring'
		| 'admin-recurring-new'
		| 'participant';

	let { routeMode }: { routeMode: BookingPageMode } = $props();

	let busy = $state(false);
	let loading = $state(true);
	let bookingAction = $state<{ kind: 'create' | 'cancel'; id: string } | null>(null);
	let tab = $state<'operations' | 'participant'>('operations');
	let adminView = $state<'list' | 'calendar'>('list');
	let participantView = $state<'calendar' | 'schedule'>('calendar');
	let schedulePeriod = $state<'upcoming' | 'past'>('upcoming');
	let canManage = $state(false);
	let canViewParticipantCalendar = $state(false);
	let canUseParticipantBooking = $state(true);
	let activeOrganizationId = $state<string | null>(null);
	const bookingPageMode = $derived(routeMode);
	const isParticipantPage = $derived(bookingPageMode === 'participant');
	const isAdminOperationsPage = $derived(bookingPageMode === 'admin-operations');
	const isAdminServicesPage = $derived(bookingPageMode === 'admin-services');
	const isAdminServicesCreatePage = $derived(bookingPageMode === 'admin-services-new');
	const isAdminSlotsPage = $derived(bookingPageMode === 'admin-slots');
	const isAdminSlotsCreatePage = $derived(bookingPageMode === 'admin-slots-new');
	const isAdminRecurringPage = $derived(bookingPageMode === 'admin-recurring');
	const isAdminRecurringCreatePage = $derived(bookingPageMode === 'admin-recurring-new');
	const isAdminPage = $derived(!isParticipantPage);

	let services = $state<ServicePayload[]>([]);
	let slots = $state<SlotPayload[]>([]);
	let recurringSchedules = $state<RecurringSchedulePayload[]>([]);
	let availableSlots = $state<SlotPayload[]>([]);
	let myBookings = $state<BookingPayload[]>([]);
	let myTicketPacks = $state<TicketPackPayload[]>([]);
	let purchasableTicketTypes = $state<TicketTypePayload[]>([]);
	let myTicketPurchases = $state<TicketPurchasePayload[]>([]);
	let staffBookings = $state<BookingPayload[]>([]);
	let staffParticipants = $state<ParticipantPayload[]>([]);
	let staffServices = $state<ServicePayload[]>([]);
	let staffRecurringSchedules = $state<RecurringSchedulePayload[]>([]);
	let staffAction = $state<{
		kind: 'approve' | 'reject' | 'cancel' | 'no_show';
		id: string;
	} | null>(null);
	type ResourceActionKind =
		| 'service_update'
		| 'service_archive'
		| 'service_resume'
		| 'slot_update'
		| 'slot_cancel'
		| 'recurring_update'
		| 'recurring_stop'
		| 'recurring_exception'
		| 'recurring_generate';
	let resourceAction = $state<{ kind: ResourceActionKind; id: string } | null>(null);
	let operationsFilter = $state({
		status: 'all' as 'all' | BookingPayload['status'],
		serviceId: '',
		participantId: '',
		selectedDate: ''
	});

	let serviceForm = $state({
		name: '',
		description: '',
		kind: 'single' as 'single' | 'recurring',
		bookingPolicy: 'instant' as 'instant' | 'approval',
		durationMinutes: '60',
		capacity: '10',
		requiresTicket: false,
		cancellationDeadlineMinutes: '1440'
	});
	let serviceImageFiles = $state<FileList | undefined>(undefined);
	let slotForm = $state({
		serviceId: '',
		date: '',
		useDifferentEndDate: false,
		endDate: '',
		startTime: '10:00',
		endTime: '11:00',
		capacity: '',
		staffLabel: '',
		locationLabel: ''
	});
	let serviceCreateAttempted = $state(false);
	let serviceCreateTouched = $state({
		name: false,
		durationMinutes: false,
		capacity: false
	});
	let slotCreateAttempted = $state(false);
	let slotCreateTouched = $state({
		serviceId: false,
		date: false,
		startTime: false,
		endTime: false,
		endDate: false
	});
	let recurringCreateAttempted = $state(false);
	let recurringCreateTouched = $state({
		serviceId: false,
		interval: false,
		startDate: false,
		startTimeLocal: false
	});
	let slotEndTimeManualEdited = $state(false);
	let recurringForm = $state({
		serviceId: '',
		frequency: 'weekly' as 'weekly' | 'monthly',
		interval: '1',
		byWeekday: '月',
		byMonthday: '',
		startDate: '',
		endDate: '',
		startTimeLocal: '10:00',
		durationMinutes: '',
		capacityOverride: ''
	});
	let serviceEditTargetId = $state('');
	let serviceEditDialogOpen = $state(false);
	let serviceEditForm = $state({
		name: '',
		description: '',
		kind: 'single' as 'single' | 'recurring',
		bookingPolicy: 'instant' as 'instant' | 'approval',
		durationMinutes: '60',
		capacity: '10',
		cancellationDeadlineMinutes: '',
		requiresTicket: false
	});
	let serviceEditImageFiles = $state<FileList | undefined>(undefined);
	let slotEditTargetId = $state('');
	let slotEditDialogOpen = $state(false);
	let slotEditForm = $state({
		startDate: '',
		startTime: '10:00',
		endDate: '',
		endTime: '11:00',
		capacity: '',
		staffLabel: '',
		locationLabel: ''
	});
	let recurringEditTargetId = $state('');
	let recurringEditDialogOpen = $state(false);
	let recurringEditForm = $state({
		frequency: 'weekly' as 'weekly' | 'monthly',
		interval: '1',
		byWeekday: '月',
		byMonthday: '',
		startDate: '',
		endDate: '',
		startTimeLocal: '10:00',
		durationMinutes: '',
		capacityOverride: '',
		isActive: true
	});
	let selectedRecurringScheduleId = $state('');
	let recurringExceptionForm = $state({
		action: 'skip' as 'skip' | 'override',
		date: '',
		overrideStartTimeLocal: '',
		overrideDurationMinutes: '',
		overrideCapacity: ''
	});
	let recurringGenerateForm = $state({
		fromDate: '',
		toDate: ''
	});
	let ticketPurchaseForm = $state({
		ticketTypeId: '',
		paymentMethod: 'stripe' as 'stripe' | 'cash_on_site' | 'bank_transfer'
	});
	let ticketPurchaseAction = $state<{ kind: 'create' | 'cancel'; id: string } | null>(null);
	let slotSearchForm = $state({ serviceId: '', fromDate: '', toDate: '' });
	let visibleMonth = $state(new Date());
	const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];
	const isoWeekdayLabelMap: Record<number, string> = {
		1: '月',
		2: '火',
		3: '水',
		4: '木',
		5: '金',
		6: '土',
		7: '日'
	};
	const weekdayTokenMap: Record<string, number> = {
		'1': 1,
		'2': 2,
		'3': 3,
		'4': 4,
		'5': 5,
		'6': 6,
		'7': 7,
		'月': 1,
		'月曜': 1,
		'月曜日': 1,
		'火': 2,
		'火曜': 2,
		'火曜日': 2,
		'水': 3,
		'水曜': 3,
		'水曜日': 3,
		'木': 4,
		'木曜': 4,
		'木曜日': 4,
		'金': 5,
		'金曜': 5,
		'金曜日': 5,
		'土': 6,
		'土曜': 6,
		'土曜日': 6,
		'日': 7,
		'日曜': 7,
		'日曜日': 7
	};
	const maxCellItems = 3;
	const scheduleDateFormatter = new Intl.DateTimeFormat('ja-JP', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});

	const confirmedBookingCount = $derived(
		myBookings.filter((booking) => booking.status === 'confirmed').length
	);
	const selectedServiceImageFile = $derived(serviceImageFiles?.item(0) ?? null);
	const selectedServiceEditImageFile = $derived(serviceEditImageFiles?.item(0) ?? null);
	const calendarDays = $derived(buildCalendarDays(visibleMonth));
	const monthLabel = $derived(formatMonthLabel(visibleMonth));
	const pageHeading = $derived.by(() => {
		switch (bookingPageMode) {
			case 'participant':
				return '予約確認';
			case 'admin-services':
				return 'サービス一覧';
			case 'admin-services-new':
				return 'サービス作成';
			case 'admin-slots':
				return '単発Slot一覧';
			case 'admin-slots-new':
				return '単発Slot作成';
			case 'admin-recurring':
				return '定期Schedule一覧';
			case 'admin-recurring-new':
				return '定期Schedule作成';
			default:
				return '予約管理';
		}
	});
	const pageDescription = $derived.by(() => {
		switch (bookingPageMode) {
			case 'participant':
				return '参加者向けの予約申込と日程確認を行います。';
			case 'admin-services':
				return 'サービス一覧の確認、編集、停止・再開を行います。';
			case 'admin-services-new':
				return '新しいサービスを作成します。';
			case 'admin-slots':
				return '単発スロット一覧の確認と停止を行います。';
			case 'admin-slots-new':
				return '単発スロットを新規作成します。';
			case 'admin-recurring':
				return '定期スケジュール一覧の更新、例外登録、枠再生成を行います。';
			case 'admin-recurring-new':
				return '定期スケジュールを新規作成します。';
			default:
				return '運営予約の承認、却下、キャンセル、No-show 操作を行います。';
		}
	});
	const createBackLink = $derived.by((): { href: string; label: string } | null => {
		if (isAdminServicesCreatePage) {
			return { href: '/admin/services', label: 'サービス一覧へ戻る' };
		}
		if (isAdminSlotsCreatePage) {
			return { href: '/admin/schedules/slots', label: '単発一覧へ戻る' };
		}
		if (isAdminRecurringCreatePage) {
			return { href: '/admin/schedules/recurring', label: '定期一覧へ戻る' };
		}
		return null;
	});

	const parsePositiveInteger = (value: string): number | null => {
		const parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed <= 0) {
			return null;
		}
		return parsed;
	};

	const getSlotServiceDurationMinutes = (): number | null => {
		if (!slotForm.serviceId) {
			return null;
		}
		const service =
			services.find((item) => item.id === slotForm.serviceId) ??
			staffServices.find((item) => item.id === slotForm.serviceId);
		return typeof service?.durationMinutes === 'number' ? service.durationMinutes : null;
	};

	const resolvedSlotStartDate = $derived(slotForm.date);
	const resolvedSlotEndDate = $derived(
		slotForm.useDifferentEndDate ? slotForm.endDate : slotForm.date
	);
	const slotStartAtCandidate = $derived(
		toIsoFromDateTime(resolvedSlotStartDate, slotForm.startTime)
	);
	const slotEndAtCandidate = $derived(toIsoFromDateTime(resolvedSlotEndDate, slotForm.endTime));
	const slotDateTimeRangeInvalid = $derived.by(() => {
		if (!slotStartAtCandidate || !slotEndAtCandidate) {
			return false;
		}
		return new Date(slotStartAtCandidate).getTime() >= new Date(slotEndAtCandidate).getTime();
	});

	const serviceCreateDisabledReason = $derived.by(() => {
		if (busy) {
			return '処理中です。完了までお待ちください。';
		}
		if (!serviceForm.name.trim()) {
			return 'サービス名を入力してください。';
		}
		if (!parsePositiveInteger(serviceForm.durationMinutes)) {
			return '所要時間（分）は 1 以上の整数で入力してください。';
		}
		if (!parsePositiveInteger(serviceForm.capacity)) {
			return '定員は 1 以上の整数で入力してください。';
		}
		return null;
	});

	const slotCreateDisabledReason = $derived.by(() => {
		if (busy) {
			return '処理中です。完了までお待ちください。';
		}
		if (!slotForm.serviceId) {
			return 'サービスを選択してください。';
		}
		if (!slotForm.date) {
			return '日付を選択してください。';
		}
		if (!slotForm.startTime) {
			return '開始時刻を入力してください。';
		}
		if (!slotForm.endTime) {
			return '終了時刻を入力してください。';
		}
		if (slotForm.useDifferentEndDate && !slotForm.endDate) {
			return '終了日を選択してください。';
		}
		if (!slotStartAtCandidate || !slotEndAtCandidate) {
			return '開始・終了日時を正しく入力してください。';
		}
		if (slotDateTimeRangeInvalid) {
			return '終了日時は開始日時より後にしてください。';
		}
		return null;
	});

	const recurringCreateDisabledReason = $derived.by(() => {
		if (busy) {
			return '処理中です。完了までお待ちください。';
		}
		if (!recurringForm.serviceId) {
			return 'サービスを選択してください。';
		}
		if (!parsePositiveInteger(recurringForm.interval)) {
			return '間隔は 1 以上の整数で入力してください。';
		}
		if (!recurringForm.startDate) {
			return '開始日を選択してください。';
		}
		if (!recurringForm.startTimeLocal) {
			return '開始時刻を入力してください。';
		}
		if (recurringForm.frequency === 'weekly' && recurringForm.byWeekday.trim()) {
			const parsedWeekday = parseByWeekday(recurringForm.byWeekday);
			if (!parsedWeekday) {
				return '曜日は「月,火」のように入力してください。';
			}
		}
		if (recurringForm.frequency === 'monthly' && recurringForm.byMonthday.trim()) {
			const monthday = parseNumberInput(recurringForm.byMonthday);
			if (!monthday || monthday < 1 || monthday > 31) {
				return '日付（1-31）を正しく入力してください。';
			}
		}
		return null;
	});

	const showServiceNameError = $derived(
		(serviceCreateAttempted || serviceCreateTouched.name) && !serviceForm.name.trim()
	);
	const showServiceDurationError = $derived(
		(serviceCreateAttempted || serviceCreateTouched.durationMinutes) &&
			!parsePositiveInteger(serviceForm.durationMinutes)
	);
	const showServiceCapacityError = $derived(
		(serviceCreateAttempted || serviceCreateTouched.capacity) &&
			!parsePositiveInteger(serviceForm.capacity)
	);

	const showSlotServiceError = $derived(
		(slotCreateAttempted || slotCreateTouched.serviceId) && !slotForm.serviceId
	);
	const showSlotDateError = $derived(
		(slotCreateAttempted || slotCreateTouched.date) && !slotForm.date
	);
	const showSlotStartTimeError = $derived(
		(slotCreateAttempted || slotCreateTouched.startTime) && !slotForm.startTime
	);
	const showSlotEndTimeError = $derived(
		(slotCreateAttempted || slotCreateTouched.endTime) && !slotForm.endTime
	);
	const showSlotEndDateError = $derived(
		(slotCreateAttempted || slotCreateTouched.endDate) &&
			slotForm.useDifferentEndDate &&
			!slotForm.endDate
	);
	const showSlotDateTimeRangeError = $derived(
		(slotCreateAttempted ||
			slotCreateTouched.date ||
			slotCreateTouched.endDate ||
			slotCreateTouched.startTime ||
			slotCreateTouched.endTime) &&
			slotDateTimeRangeInvalid
	);

	const showRecurringServiceError = $derived(
		(recurringCreateAttempted || recurringCreateTouched.serviceId) && !recurringForm.serviceId
	);
	const showRecurringIntervalError = $derived(
		(recurringCreateAttempted || recurringCreateTouched.interval) &&
			!parsePositiveInteger(recurringForm.interval)
	);
	const showRecurringStartDateError = $derived(
		(recurringCreateAttempted || recurringCreateTouched.startDate) && !recurringForm.startDate
	);
	const showRecurringStartTimeError = $derived(
		(recurringCreateAttempted || recurringCreateTouched.startTimeLocal) &&
			!recurringForm.startTimeLocal
	);

	$effect(() => {
		if (isAdminPage) {
			tab = 'operations';
			return;
		}
		if (isParticipantPage) {
			tab = 'participant';
		}
	});

	$effect(() => {
		if (!slotForm.useDifferentEndDate) {
			slotForm.endDate = slotForm.date;
		}
	});

	$effect(() => {
		const durationMinutes = getSlotServiceDurationMinutes();
		if (
			slotEndTimeManualEdited ||
			!slotForm.serviceId ||
			!slotForm.date ||
			!slotForm.startTime ||
			!durationMinutes
		) {
			return;
		}
		const parsed = new Date(`2000-01-01T${slotForm.startTime}:00`);
		if (Number.isNaN(parsed.getTime())) {
			return;
		}
		parsed.setMinutes(parsed.getMinutes() + durationMinutes);
		const hour = String(parsed.getHours()).padStart(2, '0');
		const minute = String(parsed.getMinutes()).padStart(2, '0');
		slotForm.endTime = `${hour}:${minute}`;
	});

	$effect(() => {
		if (slotForm.serviceId) {
			slotCreateTouched.serviceId = true;
		}
		if (slotForm.date) {
			slotCreateTouched.date = true;
		}
		if (slotForm.useDifferentEndDate && slotForm.endDate) {
			slotCreateTouched.endDate = true;
		}
		if (recurringForm.serviceId) {
			recurringCreateTouched.serviceId = true;
		}
		if (recurringForm.startDate) {
			recurringCreateTouched.startDate = true;
		}
	});

	const parseByWeekday = (value: string): number[] | undefined => {
		if (!value.trim()) {
			return undefined;
		}
		const parsed = value
			.split(/[\s,、]+/)
			.map((part) => part.trim())
			.filter(Boolean)
			.map((part) => weekdayTokenMap[part] ?? Number.NaN)
			.filter((num) => Number.isInteger(num) && num >= 1 && num <= 7);
		if (parsed.length === 0) {
			return undefined;
		}
		return Array.from(new Set(parsed));
	};
	const formatWeekdayFromIsoNumber = (value: number): string =>
		isoWeekdayLabelMap[value] ?? String(value);
	const formatByWeekday = (value: number[] | undefined): string => {
		if (!value || value.length === 0) {
			return '-';
		}
		return value.map((weekday) => formatWeekdayFromIsoNumber(weekday)).join(',');
	};
	const toWeekdayInputValue = (value: number[] | undefined): string =>
		value && value.length > 0
			? value.map((weekday) => formatWeekdayFromIsoNumber(weekday)).join(',')
			: '';

	const getServiceName = (serviceId: string): string => {
		const service =
			staffServices.find((item) => item.id === serviceId) ??
			services.find((item) => item.id === serviceId);
		return service?.name ?? serviceId;
	};
	const getServiceKindLabel = (kind: 'single' | 'recurring'): string =>
		kind === 'single' ? '単発' : '定期';
	const formatServiceKind = (kind: ServicePayload['kind']): string =>
		kind === 'single' ? '単発' : '定期';
	const formatBookingPolicy = (bookingPolicy: ServicePayload['bookingPolicy']): string =>
		bookingPolicy === 'approval' ? '承認制' : '先着確定';
	const formatRecurringPattern = (schedule: RecurringSchedulePayload): string => {
		if (schedule.frequency === 'weekly') {
			const byWeekday = formatByWeekday(schedule.byWeekday);
			return `weekly / ${byWeekday || '-'}`;
		}
		return `monthly / ${schedule.byMonthday ?? '-'}`;
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
	type OperationRow = {
		booking: BookingPayload;
		slot?: SlotPayload;
		participant?: ParticipantPayload;
	};
	type AdminCalendarSummary = {
		slotCount: number;
		openSlotCount: number;
		canceledSlotCount: number;
		completedSlotCount: number;
		bookingCount: number;
		pendingCount: number;
		confirmedCount: number;
		otherBookingCount: number;
	};

	const statusLabelMap: Record<SlotPayload['status'], string> = {
		open: '受付中',
		canceled: '停止',
		completed: '終了'
	};
	const bookingStatusLabelMap: Record<BookingPayload['status'], string> = {
		confirmed: '予約確定',
		pending_approval: '承認待ち',
		rejected_by_staff: '運営却下',
		cancelled_by_participant: 'キャンセル済み',
		cancelled_by_staff: '運営キャンセル',
		no_show: '不参加'
	};
	const ticketPackStatusLabelMap: Record<TicketPackPayload['status'], string> = {
		active: '有効',
		exhausted: '使い切り',
		expired: '期限切れ'
	};
	const ticketPurchaseStatusLabelMap: Record<TicketPurchasePayload['status'], string> = {
		pending_payment: '決済待ち',
		pending_approval: '承認待ち',
		approved: '承認済み',
		rejected: '却下',
		cancelled_by_participant: '取り下げ'
	};
	const ticketPurchaseMethodLabelMap: Record<TicketPurchasePayload['paymentMethod'], string> = {
		stripe: 'Stripe',
		cash_on_site: '現地決済',
		bank_transfer: '銀行振込'
	};

	const isViewOnlyCalendar = $derived(canViewParticipantCalendar && !canUseParticipantBooking);

	const isCurrentMonthDay = (date: Date): boolean =>
		date.getFullYear() === visibleMonth.getFullYear() &&
		date.getMonth() === visibleMonth.getMonth();

	const toMonthRangeIso = () => {
		const { fromDate, toDate } = getMonthDateRange(visibleMonth);
		slotSearchForm.fromDate = fromDate;
		slotSearchForm.toDate = toDate;
		const from = toDayBoundaryIso(fromDate, false);
		const to = toDayBoundaryIso(toDate, true);
		return { from, to };
	};

	const slotMapById = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const map = new Map<string, SlotPayload>();
		for (const slot of slots) {
			map.set(slot.id, slot);
		}
		return map;
	});
	const participantMapById = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const map = new Map<string, ParticipantPayload>();
		for (const participant of staffParticipants) {
			map.set(participant.id, participant);
		}
		return map;
	});
	const currentMonthSlotIds = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const set = new Set<string>();
		for (const slot of slots) {
			set.add(slot.id);
		}
		return set;
	});
	const operationRows = $derived.by(() => {
		const rows: OperationRow[] = [];
		for (const booking of staffBookings) {
			if (!currentMonthSlotIds.has(booking.slotId)) {
				continue;
			}
			rows.push({
				booking,
				slot: slotMapById.get(booking.slotId),
				participant: participantMapById.get(booking.participantId)
			});
		}
		rows.sort((left, right) => {
			const leftValue = left.slot?.startAt ?? left.booking.createdAt;
			const rightValue = right.slot?.startAt ?? right.booking.createdAt;
			return leftValue.localeCompare(rightValue);
		});
		return rows;
	});
	const filteredOperationRows = $derived.by(() => {
		return operationRows.filter((row) => {
			if (operationsFilter.selectedDate) {
				const slotDateKey = row.slot ? toDateKeyFromIso(row.slot.startAt) : null;
				if (slotDateKey !== operationsFilter.selectedDate) {
					return false;
				}
			}
			if (operationsFilter.status !== 'all' && row.booking.status !== operationsFilter.status) {
				return false;
			}
			if (operationsFilter.serviceId && row.booking.serviceId !== operationsFilter.serviceId) {
				return false;
			}
			if (
				operationsFilter.participantId &&
				row.booking.participantId !== operationsFilter.participantId
			) {
				return false;
			}
			return true;
		});
	});
	const operationServiceOptions = $derived.by(() => {
		const source = staffServices.length > 0 ? staffServices : services;
		return [...source].sort((left, right) => left.name.localeCompare(right.name));
	});
	const staffServiceRows = $derived.by(() =>
		[...staffServices].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
	);
	const slotManagementRows = $derived.by(() =>
		[...slots].sort((left, right) => left.startAt.localeCompare(right.startAt))
	);
	const staffRecurringRows = $derived.by(() =>
		[...staffRecurringSchedules].sort((left, right) =>
			right.updatedAt.localeCompare(left.updatedAt)
		)
	);
	const purchasableTicketTypeRows = $derived.by(() =>
		[...purchasableTicketTypes].sort((left, right) => left.name.localeCompare(right.name))
	);
	const myTicketPurchaseRows = $derived.by(() =>
		[...myTicketPurchases].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
	);
	const adminCalendarSummaryByDate = $derived.by(() => {
		const map = new Map<string, AdminCalendarSummary>();
		const ensureSummary = (dateKey: string): AdminCalendarSummary => {
			const existing = map.get(dateKey);
			if (existing) {
				return existing;
			}
			const created: AdminCalendarSummary = {
				slotCount: 0,
				openSlotCount: 0,
				canceledSlotCount: 0,
				completedSlotCount: 0,
				bookingCount: 0,
				pendingCount: 0,
				confirmedCount: 0,
				otherBookingCount: 0
			};
			map.set(dateKey, created);
			return created;
		};

		for (const slot of slots) {
			const dateKey = toDateKeyFromIso(slot.startAt);
			if (!dateKey) {
				continue;
			}
			const summary = ensureSummary(dateKey);
			summary.slotCount += 1;
			if (slot.status === 'open') {
				summary.openSlotCount += 1;
			} else if (slot.status === 'canceled') {
				summary.canceledSlotCount += 1;
			} else {
				summary.completedSlotCount += 1;
			}
		}

		for (const booking of staffBookings) {
			const slot = slotMapById.get(booking.slotId);
			if (!slot) {
				continue;
			}
			const dateKey = toDateKeyFromIso(slot.startAt);
			if (!dateKey) {
				continue;
			}
			const summary = ensureSummary(dateKey);
			summary.bookingCount += 1;
			if (booking.status === 'pending_approval') {
				summary.pendingCount += 1;
			} else if (booking.status === 'confirmed') {
				summary.confirmedCount += 1;
			} else {
				summary.otherBookingCount += 1;
			}
		}

		return map;
	});

	const calendarItemsByDate = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const map = new Map<string, CalendarItem[]>();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
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

	const getItemsForDay = (date: Date): CalendarItem[] =>
		calendarItemsByDate.get(toDateKey(date)) ?? [];
	const getAdminCalendarSummary = (date: Date): AdminCalendarSummary =>
		adminCalendarSummaryByDate.get(toDateKey(date)) ?? {
			slotCount: 0,
			openSlotCount: 0,
			canceledSlotCount: 0,
			completedSlotCount: 0,
			bookingCount: 0,
			pendingCount: 0,
			confirmedCount: 0,
			otherBookingCount: 0
		};
	const isBookingCreateInProgress = (slotId: string): boolean =>
		bookingAction?.kind === 'create' && bookingAction.id === slotId;
	const isBookingCancelInProgress = (bookingId: string | undefined): boolean =>
		typeof bookingId === 'string' &&
		bookingAction?.kind === 'cancel' &&
		bookingAction.id === bookingId;
	const isTicketPurchaseCreateInProgress = (): boolean => ticketPurchaseAction?.kind === 'create';
	const isTicketPurchaseCancelInProgress = (purchaseId: string): boolean =>
		ticketPurchaseAction?.kind === 'cancel' && ticketPurchaseAction.id === purchaseId;
	const formatScheduleDateLabel = (dateKey: string): string => {
		const parsed = new Date(`${dateKey}T00:00:00`);
		if (Number.isNaN(parsed.getTime())) {
			return dateKey;
		}
		return scheduleDateFormatter.format(parsed);
	};
	const selectedOperationDateLabel = $derived(
		operationsFilter.selectedDate ? formatScheduleDateLabel(operationsFilter.selectedDate) : ''
	);
	const formatDateTime = (value: string): string => {
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) {
			return value;
		}
		return parsed.toLocaleString('ja-JP', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	};
	const pad2 = (value: number): string => value.toString().padStart(2, '0');
	const toDateInputValue = (value: string): string => {
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) {
			return '';
		}
		return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
	};
	const toTimeInputValue = (value: string): string => {
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) {
			return '';
		}
		return `${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}`;
	};
	const toExceptionMessage = (error: unknown, fallback: string): string => {
		if (error instanceof Error && error.message) {
			return error.message;
		}
		return fallback;
	};
	const resetBookingViewState = () => {
		activeOrganizationId = null;
		canManage = false;
		services = [];
		slots = [];
		recurringSchedules = [];
		availableSlots = [];
		myBookings = [];
		myTicketPacks = [];
		purchasableTicketTypes = [];
		myTicketPurchases = [];
		staffBookings = [];
		staffParticipants = [];
		staffServices = [];
		staffRecurringSchedules = [];
		serviceEditTargetId = '';
		serviceEditDialogOpen = false;
		serviceImageFiles = undefined;
		serviceEditImageFiles = undefined;
		slotEditTargetId = '';
		slotEditDialogOpen = false;
		recurringEditTargetId = '';
		recurringEditDialogOpen = false;
		selectedRecurringScheduleId = '';
		canViewParticipantCalendar = false;
		canUseParticipantBooking = false;
		ticketPurchaseForm.ticketTypeId = '';
	};
	const formatBookingIdShort = (bookingId: string): string => bookingId.slice(0, 8);
	const getParticipantLabel = (row: OperationRow): string =>
		row.participant
			? `${row.participant.name} / ${row.participant.email}`
			: row.booking.participantId;
	const isStaffActionInProgress = (
		kind: 'approve' | 'reject' | 'cancel' | 'no_show',
		bookingId: string
	): boolean => staffAction?.kind === kind && staffAction.id === bookingId;
	const formatTicketTypeShort = (ticketTypeId: string): string => ticketTypeId.slice(0, 8);
	const formatTicketPurchaseIdShort = (purchaseId: string): string => purchaseId.slice(0, 8);
	const formatSlotIdShort = (slotId: string): string => slotId.slice(0, 8);
	const formatRecurringIdShort = (recurringScheduleId: string): string =>
		recurringScheduleId.slice(0, 8);
	const formatOptionalDateTime = (value?: string | null): string => {
		if (!value) {
			return '無期限';
		}
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) {
			return value;
		}
		return parsed.toLocaleString('ja-JP', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	};
	const isResourceActionInProgress = (kind: ResourceActionKind, id: string): boolean =>
		resourceAction?.kind === kind && resourceAction.id === id;
	const selectOperationDate = (date: Date) => {
		if (!isCurrentMonthDay(date)) {
			return;
		}
		const dateKey = toDateKey(date);
		operationsFilter.selectedDate = operationsFilter.selectedDate === dateKey ? '' : dateKey;
	};
	const clearSelectedOperationDate = () => {
		operationsFilter.selectedDate = '';
	};
	const selectServiceForEdit = (service: ServicePayload) => {
		serviceEditTargetId = service.id;
		serviceEditDialogOpen = true;
		serviceEditForm.name = service.name;
		serviceEditForm.description = service.description ?? '';
		serviceEditForm.kind = service.kind;
		serviceEditForm.bookingPolicy = service.bookingPolicy;
		serviceEditForm.durationMinutes = String(service.durationMinutes);
		serviceEditForm.capacity = String(service.capacity);
		serviceEditForm.cancellationDeadlineMinutes =
			typeof service.cancellationDeadlineMinutes === 'number'
				? String(service.cancellationDeadlineMinutes)
				: '';
		serviceEditForm.requiresTicket = service.requiresTicket;
		serviceEditImageFiles = undefined;
	};
	const isSlotEditable = (slot: SlotPayload): boolean =>
		slot.status === 'open' && slot.reservedCount === 0 && new Date(slot.startAt).getTime() > Date.now();
	const selectSlotForEdit = (slot: SlotPayload) => {
		if (!isSlotEditable(slot)) {
			toast.error('この単発枠は編集できません。');
			return;
		}
		slotEditTargetId = slot.id;
		slotEditDialogOpen = true;
		slotEditForm.startDate = toDateInputValue(slot.startAt);
		slotEditForm.startTime = toTimeInputValue(slot.startAt);
		slotEditForm.endDate = toDateInputValue(slot.endAt);
		slotEditForm.endTime = toTimeInputValue(slot.endAt);
		slotEditForm.capacity = String(slot.capacity);
		slotEditForm.staffLabel = slot.staffLabel ?? '';
		slotEditForm.locationLabel = slot.locationLabel ?? '';
	};
	const selectRecurringForEdit = (schedule: RecurringSchedulePayload) => {
		recurringEditTargetId = schedule.id;
		recurringEditDialogOpen = true;
		selectedRecurringScheduleId = schedule.id;
		recurringEditForm.frequency = schedule.frequency;
		recurringEditForm.interval = String(schedule.interval);
		recurringEditForm.byWeekday = toWeekdayInputValue(schedule.byWeekday);
		recurringEditForm.byMonthday =
			typeof schedule.byMonthday === 'number' ? String(schedule.byMonthday) : '';
		recurringEditForm.startDate = schedule.startDate;
		recurringEditForm.endDate = schedule.endDate ?? '';
		recurringEditForm.startTimeLocal = schedule.startTimeLocal;
		recurringEditForm.durationMinutes =
			typeof schedule.durationMinutes === 'number' ? String(schedule.durationMinutes) : '';
		recurringEditForm.capacityOverride =
			typeof schedule.capacityOverride === 'number' ? String(schedule.capacityOverride) : '';
		recurringEditForm.isActive = schedule.isActive;
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
					const pendingCount =
						item.booking?.status === 'pending_approval' ? item.booking.participantsCount : 0;
					return {
						slotId: item.slot.id,
						startAt: item.slot.startAt,
						endAt: item.slot.endAt,
						serviceName: getServiceName(item.slot.serviceId),
						status: item.slot.status,
						statusLabel: statusLabelMap[item.slot.status],
						capacity: item.slot.capacity,
						pendingCount,
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
		operationsFilter.selectedDate = '';
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

		const { from, to } = toMonthRangeIso();
		if (!from || !to) {
			toast.error('検索期間の日付形式が正しくありません。');
			return;
		}

		try {
			resetBookingViewState();

			if (isParticipantPage) {
				const bookingData = await loadParticipantBookingsData(
					from,
					to,
					slotSearchForm.serviceId || undefined
				);
				if (!bookingData.activeContext) {
					return;
				}
				activeOrganizationId = bookingData.activeContext.orgSlug;
				canManage = bookingData.canManage;
				services = bookingData.services;
				slots = bookingData.slots;
				availableSlots = bookingData.availableSlots;
				myBookings = bookingData.myBookings;
				myTicketPacks = bookingData.myTicketPacks;
				purchasableTicketTypes = bookingData.purchasableTicketTypes;
				myTicketPurchases = bookingData.myTicketPurchases;
				canUseParticipantBooking = !bookingData.participantAccessDenied;
				canViewParticipantCalendar =
					canUseParticipantBooking || (canManage && bookingData.participantAccessDenied);
				if (
					ticketPurchaseForm.ticketTypeId &&
					!purchasableTicketTypes.some((ticketType) => ticketType.id === ticketPurchaseForm.ticketTypeId)
				) {
					ticketPurchaseForm.ticketTypeId = '';
				}
				return;
			}

			if (isAdminOperationsPage) {
				const bookingData = await loadAdminBookingsOperationsData(
					from,
					to,
					slotSearchForm.serviceId || undefined
				);
				if (!bookingData.activeContext) {
					return;
				}
				activeOrganizationId = bookingData.activeContext.orgSlug;
				canManage = bookingData.canManage;
				services = bookingData.services;
				slots = bookingData.slots;
				staffBookings = bookingData.staffBookings;
				staffParticipants = bookingData.staffParticipants;
				return;
			}

			if (isAdminServicesPage || isAdminServicesCreatePage) {
				const bookingData = await loadAdminServicesData(from, to);
				if (!bookingData.activeContext) {
					return;
				}
				activeOrganizationId = bookingData.activeContext.orgSlug;
				canManage = bookingData.canManage;
				services = bookingData.services;
				staffServices = bookingData.staffServices;
				if (
					serviceEditTargetId &&
					!staffServices.some((service) => service.id === serviceEditTargetId)
				) {
					serviceEditTargetId = '';
					serviceEditDialogOpen = false;
				}
				return;
			}

			if (isAdminSlotsPage || isAdminSlotsCreatePage) {
				const bookingData = await loadAdminSlotsData(from, to, slotSearchForm.serviceId || undefined);
				if (!bookingData.activeContext) {
					return;
				}
				activeOrganizationId = bookingData.activeContext.orgSlug;
				canManage = bookingData.canManage;
				services = bookingData.services;
				slots = bookingData.slots;
				if (slotEditTargetId && !slots.some((slot) => slot.id === slotEditTargetId)) {
					slotEditTargetId = '';
					slotEditDialogOpen = false;
				}
				return;
			}

			if (isAdminRecurringPage || isAdminRecurringCreatePage) {
				const bookingData = await loadAdminRecurringData(from, to);
				if (!bookingData.activeContext) {
					return;
				}
				activeOrganizationId = bookingData.activeContext.orgSlug;
				canManage = bookingData.canManage;
				services = bookingData.services;
				recurringSchedules = bookingData.recurringSchedules;
				staffRecurringSchedules = bookingData.staffRecurringSchedules;
				if (
					recurringEditTargetId &&
					!staffRecurringSchedules.some((schedule) => schedule.id === recurringEditTargetId)
				) {
					recurringEditTargetId = '';
					recurringEditDialogOpen = false;
				}
				if (
					staffRecurringSchedules.length > 0 &&
					!staffRecurringSchedules.some((item) => item.id === selectedRecurringScheduleId)
				) {
					selectedRecurringScheduleId = staffRecurringSchedules[0].id;
				}
				if (staffRecurringSchedules.length === 0) {
					selectedRecurringScheduleId = '';
					recurringEditTargetId = '';
					recurringEditDialogOpen = false;
				}
				return;
			}
		} catch (error) {
			resetBookingViewState();
			toast.error(toExceptionMessage(error, '予約データの取得に失敗しました。'));
		}
	};

	const submitCreateService = async (event: SubmitEvent) => {
		event.preventDefault();
		serviceCreateAttempted = true;
		if (serviceCreateDisabledReason) {
			toast.error(serviceCreateDisabledReason);
			return;
		}
		if (!activeOrganizationId || !canManage) return;
		busy = true;
		try {
			let imageUrl: string | null | undefined;
			const imageFile = serviceImageFiles?.item(0) ?? null;
			if (imageFile) {
				const uploaded = await uploadServiceImage({
					organizationId: activeOrganizationId,
					file: imageFile
				});
				if (!uploaded.ok || !uploaded.imageUrl) {
					toast.error(uploaded.message);
					return;
				}
				imageUrl = uploaded.imageUrl;
			}
			const result = await createService({
				organizationId: activeOrganizationId,
				name: serviceForm.name,
				description: serviceForm.description,
				imageUrl,
				kind: serviceForm.kind,
				bookingPolicy: serviceForm.bookingPolicy,
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
			serviceForm.description = '';
			serviceForm.bookingPolicy = 'instant';
			serviceForm.requiresTicket = false;
			serviceImageFiles = undefined;
			serviceCreateAttempted = false;
			serviceCreateTouched = { name: false, durationMinutes: false, capacity: false };
			if (isAdminServicesCreatePage) {
				await goto(resolve('/admin/services'));
			} else {
				await refresh();
			}
		} finally {
			busy = false;
		}
	};

	const submitCreateSlot = async (event: SubmitEvent) => {
		event.preventDefault();
		slotCreateAttempted = true;
		if (slotCreateDisabledReason) {
			toast.error(slotCreateDisabledReason);
			return;
		}
		if (!activeOrganizationId || !canManage) return;
		const startAt = slotStartAtCandidate;
		const endAt = slotEndAtCandidate;
		if (!startAt || !endAt || new Date(startAt).getTime() >= new Date(endAt).getTime()) {
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
			slotCreateAttempted = false;
			slotCreateTouched = {
				serviceId: false,
				date: false,
				startTime: false,
				endTime: false,
				endDate: false
			};
			if (isAdminSlotsCreatePage) {
				await goto(resolve('/admin/schedules/slots'));
			} else {
				await refresh();
			}
		} finally {
			busy = false;
		}
	};

	const submitCreateRecurringSchedule = async (event: SubmitEvent) => {
		event.preventDefault();
		recurringCreateAttempted = true;
		if (recurringCreateDisabledReason) {
			toast.error(recurringCreateDisabledReason);
			return;
		}
		if (!activeOrganizationId || !canManage) return;
		const interval = parsePositiveInteger(recurringForm.interval);
		if (!interval) {
			toast.error('間隔は 1 以上の整数で入力してください。');
			return;
		}
		busy = true;
		try {
			const result = await createRecurringSchedule({
				organizationId: activeOrganizationId,
				serviceId: recurringForm.serviceId,
				frequency: recurringForm.frequency,
				interval,
				byWeekday:
					recurringForm.frequency === 'weekly'
						? parseByWeekday(recurringForm.byWeekday)
						: undefined,
				byMonthday:
					recurringForm.frequency === 'monthly'
						? parseNumberInput(recurringForm.byMonthday)
						: undefined,
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
			recurringCreateAttempted = false;
			recurringCreateTouched = {
				serviceId: false,
				interval: false,
				startDate: false,
				startTimeLocal: false
			};
			if (isAdminRecurringCreatePage) {
				await goto(resolve('/admin/schedules/recurring'));
			} else {
				await refresh();
			}
		} finally {
			busy = false;
		}
	};
	const submitUpdateServiceByStaff = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!canManage || !serviceEditTargetId || resourceAction) {
			return;
		}
		const durationMinutes = parseNumberInput(serviceEditForm.durationMinutes);
		const capacity = parseNumberInput(serviceEditForm.capacity);
		if (!durationMinutes || !capacity) {
			toast.error('所要時間と定員を正しく入力してください。');
			return;
		}
		resourceAction = { kind: 'service_update', id: serviceEditTargetId };
		try {
			let imageUrl: string | null | undefined = undefined;
			const imageFile = serviceEditImageFiles?.item(0) ?? null;
			if (imageFile && activeOrganizationId) {
				const uploaded = await uploadServiceImage({
					organizationId: activeOrganizationId,
					file: imageFile
				});
				if (!uploaded.ok || !uploaded.imageUrl) {
					toast.error(uploaded.message);
					return;
				}
				imageUrl = uploaded.imageUrl;
			}
			const result = await updateServiceByStaff({
				serviceId: serviceEditTargetId,
				name: serviceEditForm.name,
				description: serviceEditForm.description,
				imageUrl,
				kind: serviceEditForm.kind,
				bookingPolicy: serviceEditForm.bookingPolicy,
				durationMinutes,
				capacity,
				cancellationDeadlineMinutes: parseNumberInput(serviceEditForm.cancellationDeadlineMinutes),
				requiresTicket: serviceEditForm.requiresTicket
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			serviceEditDialogOpen = false;
			await refresh();
			serviceEditImageFiles = undefined;
		} finally {
			resourceAction = null;
		}
	};
	const submitArchiveServiceByStaff = async (serviceId: string) => {
		if (!canManage || resourceAction) {
			return;
		}
		if (!confirm('このサービスを停止しますか？')) {
			return;
		}
		resourceAction = { kind: 'service_archive', id: serviceId };
		try {
			const result = await archiveServiceByStaff(serviceId);
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			if (serviceEditTargetId === serviceId) {
				serviceEditTargetId = '';
				serviceEditDialogOpen = false;
			}
			await refresh();
		} finally {
			resourceAction = null;
		}
	};
	const submitResumeServiceByStaff = async (serviceId: string) => {
		if (!canManage || resourceAction) {
			return;
		}
		if (!confirm('このサービスを再開しますか？')) {
			return;
		}
		resourceAction = { kind: 'service_resume', id: serviceId };
		try {
			const result = await resumeServiceByStaff(serviceId);
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			resourceAction = null;
		}
	};
	const submitCancelSlotByStaff = async (slotId: string) => {
		if (!canManage || resourceAction) {
			return;
		}
		if (!confirm('この単発枠を停止しますか？')) {
			return;
		}
		const reasonInput = prompt('停止理由を入力してください（任意）', '');
		if (reasonInput === null) {
			return;
		}
		resourceAction = { kind: 'slot_cancel', id: slotId };
		try {
			const result = await cancelSlotByStaff(slotId, reasonInput);
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			resourceAction = null;
		}
	};
	const submitUpdateSlotByStaff = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!canManage || !slotEditTargetId || resourceAction) {
			return;
		}
		const editingSlot = slotManagementRows.find((slot) => slot.id === slotEditTargetId);
		if (!editingSlot || !isSlotEditable(editingSlot)) {
			toast.error('この単発枠は編集できません。');
			slotEditDialogOpen = false;
			return;
		}
		const startAt = toIsoFromDateTime(slotEditForm.startDate, slotEditForm.startTime);
		const endAt = toIsoFromDateTime(slotEditForm.endDate, slotEditForm.endTime);
		if (!startAt || !endAt) {
			toast.error('開始・終了日時を正しく入力してください。');
			return;
		}
		resourceAction = { kind: 'slot_update', id: slotEditTargetId };
		try {
			const result = await updateSlotByStaff({
				slotId: slotEditTargetId,
				startAt,
				endAt,
				capacity: parseNumberInput(slotEditForm.capacity),
				staffLabel: slotEditForm.staffLabel || undefined,
				locationLabel: slotEditForm.locationLabel || undefined
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			slotEditDialogOpen = false;
			await refresh();
		} finally {
			resourceAction = null;
		}
	};
	const submitUpdateRecurringScheduleByStaff = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!canManage || !recurringEditTargetId || resourceAction) {
			return;
		}
		const interval = parseNumberInput(recurringEditForm.interval);
		if (!interval) {
			toast.error('間隔を正しく入力してください。');
			return;
		}
		if (recurringEditForm.frequency === 'weekly' && recurringEditForm.byWeekday.trim()) {
			const parsedWeekday = parseByWeekday(recurringEditForm.byWeekday);
			if (!parsedWeekday) {
				toast.error('曜日は「月,火」のように入力してください。');
				return;
			}
		}
		resourceAction = { kind: 'recurring_update', id: recurringEditTargetId };
		try {
			const result = await updateRecurringScheduleByStaff({
				recurringScheduleId: recurringEditTargetId,
				frequency: recurringEditForm.frequency,
				interval,
				byWeekday:
					recurringEditForm.frequency === 'weekly'
						? parseByWeekday(recurringEditForm.byWeekday)
						: undefined,
				byMonthday:
					recurringEditForm.frequency === 'monthly'
						? parseNumberInput(recurringEditForm.byMonthday)
						: undefined,
				startDate: recurringEditForm.startDate || undefined,
				endDate: recurringEditForm.endDate || undefined,
				startTimeLocal: recurringEditForm.startTimeLocal || undefined,
				durationMinutes: parseNumberInput(recurringEditForm.durationMinutes),
				capacityOverride: parseNumberInput(recurringEditForm.capacityOverride),
				isActive: recurringEditForm.isActive
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			recurringEditDialogOpen = false;
			await refresh();
		} finally {
			resourceAction = null;
		}
	};
	const submitStopRecurringScheduleByStaff = async (recurringScheduleId: string) => {
		if (!canManage || resourceAction) {
			return;
		}
		if (!confirm('この定期スケジュールを停止しますか？')) {
			return;
		}
		resourceAction = { kind: 'recurring_stop', id: recurringScheduleId };
		try {
			const result = await updateRecurringScheduleByStaff({
				recurringScheduleId,
				isActive: false
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			resourceAction = null;
		}
	};
	const submitUpsertRecurringExceptionByStaff = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!canManage || !selectedRecurringScheduleId || resourceAction) {
			return;
		}
		if (!recurringExceptionForm.date) {
			toast.error('例外対象日を選択してください。');
			return;
		}
		const isOverride = recurringExceptionForm.action === 'override';
		const overrideDurationMinutes = parseNumberInput(
			recurringExceptionForm.overrideDurationMinutes
		);
		const overrideCapacity = parseNumberInput(recurringExceptionForm.overrideCapacity);
		if (
			isOverride &&
			!recurringExceptionForm.overrideStartTimeLocal &&
			overrideDurationMinutes === undefined &&
			overrideCapacity === undefined
		) {
			toast.error('override を選択した場合は上書き項目を1つ以上入力してください。');
			return;
		}

		resourceAction = { kind: 'recurring_exception', id: selectedRecurringScheduleId };
		try {
			const result = await upsertRecurringExceptionByStaff({
				recurringScheduleId: selectedRecurringScheduleId,
				date: recurringExceptionForm.date,
				action: recurringExceptionForm.action,
				overrideStartTimeLocal:
					isOverride && recurringExceptionForm.overrideStartTimeLocal
						? recurringExceptionForm.overrideStartTimeLocal
						: undefined,
				overrideDurationMinutes: isOverride ? overrideDurationMinutes : undefined,
				overrideCapacity: isOverride ? overrideCapacity : undefined
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			resourceAction = null;
		}
	};
	const submitGenerateRecurringSlotsByStaff = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!canManage || !selectedRecurringScheduleId || resourceAction) {
			return;
		}
		const from = recurringGenerateForm.fromDate
			? toDayBoundaryIso(recurringGenerateForm.fromDate, false)
			: null;
		const to = recurringGenerateForm.toDate
			? toDayBoundaryIso(recurringGenerateForm.toDate, true)
			: null;
		if (recurringGenerateForm.fromDate && !from) {
			toast.error('生成開始日を正しく入力してください。');
			return;
		}
		if (recurringGenerateForm.toDate && !to) {
			toast.error('生成終了日を正しく入力してください。');
			return;
		}
		if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
			toast.error('生成開始日は生成終了日以前にしてください。');
			return;
		}

		resourceAction = { kind: 'recurring_generate', id: selectedRecurringScheduleId };
		try {
			const result = await generateRecurringSlotsByStaff({
				recurringScheduleId: selectedRecurringScheduleId,
				from: from ?? undefined,
				to: to ?? undefined
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			resourceAction = null;
		}
	};

	const submitCreateTicketPurchase = async (event: SubmitEvent) => {
		event.preventDefault();
		if (ticketPurchaseAction) {
			return;
		}
		if (!activeOrganizationId || !canUseParticipantBooking) {
			toast.error('回数券購入には参加者としての所属が必要です。');
			return;
		}
		if (!ticketPurchaseForm.ticketTypeId) {
			toast.error('購入する回数券種別を選択してください。');
			return;
		}

		ticketPurchaseAction = { kind: 'create', id: ticketPurchaseForm.ticketTypeId };
		try {
			const result = await createTicketPurchaseRequest({
				organizationId: activeOrganizationId,
				ticketTypeId: ticketPurchaseForm.ticketTypeId,
				paymentMethod: ticketPurchaseForm.paymentMethod
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}

			if (ticketPurchaseForm.paymentMethod === 'stripe' && result.checkoutUrl) {
				window.location.href = result.checkoutUrl;
				return;
			}

			toast.success(result.message);
			await refresh();
		} finally {
			ticketPurchaseAction = null;
		}
	};

	const submitCancelTicketPurchase = async (purchaseId: string) => {
		if (ticketPurchaseAction) {
			return;
		}
		if (!canUseParticipantBooking) {
			toast.error('購入申請の取り下げには参加者としての所属が必要です。');
			return;
		}
		if (!confirm('この回数券購入申請を取り下げますか？')) {
			return;
		}

		ticketPurchaseAction = { kind: 'cancel', id: purchaseId };
		try {
			const result = await cancelTicketPurchaseRequest(purchaseId);
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			ticketPurchaseAction = null;
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
	const submitCancelBookingByStaff = async (bookingId: string) => {
		if (!canManage || staffAction) {
			return;
		}
		if (!confirm('この予約を運営キャンセルしますか？')) {
			return;
		}
		const reasonInput = prompt('キャンセル理由を入力してください（任意）', '');
		if (reasonInput === null) {
			return;
		}
		staffAction = { kind: 'cancel', id: bookingId };
		try {
			const result = await cancelBookingByStaff(bookingId, reasonInput);
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			staffAction = null;
		}
	};
	const submitApproveBookingByStaff = async (bookingId: string) => {
		if (!canManage || staffAction) {
			return;
		}
		if (!confirm('この承認待ち予約を承認しますか？')) {
			return;
		}
		staffAction = { kind: 'approve', id: bookingId };
		try {
			const result = await approveBooking(bookingId);
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			staffAction = null;
		}
	};
	const submitRejectBookingByStaff = async (bookingId: string) => {
		if (!canManage || staffAction) {
			return;
		}
		if (!confirm('この承認待ち予約を却下しますか？')) {
			return;
		}
		const reasonInput = prompt('却下理由を入力してください（任意）', '');
		if (reasonInput === null) {
			return;
		}
		staffAction = { kind: 'reject', id: bookingId };
		try {
			const result = await rejectBooking(bookingId, reasonInput);
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			staffAction = null;
		}
	};
	const submitMarkBookingNoShow = async (bookingId: string) => {
		if (!canManage || staffAction) {
			return;
		}
		if (!confirm('この予約を No-show に更新しますか？')) {
			return;
		}
		staffAction = { kind: 'no_show', id: bookingId };
		try {
			const result = await markBookingNoShow(bookingId);
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await refresh();
		} finally {
			staffAction = null;
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
		<h1 class="text-3xl font-semibold text-slate-900">{pageHeading}</h1>
		<p class="text-sm text-slate-600">{pageDescription}</p>
		{#if isAdminPage}
			<div class="flex flex-wrap items-center justify-between gap-2 pt-1">
				<div class="flex flex-wrap gap-2">
					<Button
						type="button"
						variant={isAdminOperationsPage ? 'default' : 'outline'}
						onclick={() => goto(resolve('/admin/bookings'))}
					>
						予約運用
					</Button>
					<Button
						type="button"
						variant={isAdminServicesPage || isAdminServicesCreatePage ? 'default' : 'outline'}
						onclick={() => goto(resolve('/admin/services'))}
					>
						サービス一覧
					</Button>
					<Button
						type="button"
						variant={isAdminSlotsPage || isAdminSlotsCreatePage ? 'default' : 'outline'}
						onclick={() => goto(resolve('/admin/schedules/slots'))}
					>
						単発一覧
					</Button>
					<Button
						type="button"
						variant={isAdminRecurringPage || isAdminRecurringCreatePage ? 'default' : 'outline'}
						onclick={() => goto(resolve('/admin/schedules/recurring'))}
					>
						定期一覧
					</Button>
					{#if isAdminServicesPage}
						<Button type="button" variant="outline" onclick={() => goto(resolve('/admin/services/new'))}
							>サービス作成へ</Button
						>
					{/if}
					{#if isAdminSlotsPage}
						<Button
							type="button"
							variant="outline"
							onclick={() => goto(resolve('/admin/schedules/slots/new'))}>単発作成へ</Button
						>
					{/if}
					{#if isAdminRecurringPage}
						<Button
							type="button"
							variant="outline"
							onclick={() => goto(resolve('/admin/schedules/recurring/new'))}>定期作成へ</Button
						>
					{/if}
				</div>
				{#if createBackLink}
					<Button type="button" variant="outline" onclick={() => goto(createBackLink.href)}
						>{createBackLink.label}</Button
					>
				{/if}
			</div>
		{/if}
	</header>

	{#if loading}
		<Card class="surface-panel border-slate-200/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">予約データを読み込み中…</p>
			</CardContent>
		</Card>
	{:else if !activeOrganizationId}
		<Card class="surface-panel border-slate-200/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">
					利用中の組織を `/admin/dashboard` で選択してください。
				</p>
			</CardContent>
		</Card>
	{:else}
		<Tabs bind:value={tab}>
			{#if isAdminPage}
				<TabsContent value="operations" class="space-y-4">
				{#if !canManage}
					<Card class="surface-panel border-slate-200/80 shadow-lg">
						<CardContent class="py-6">
							<p class="text-sm text-muted-foreground">
								この組織の運営操作には admin または owner 権限が必要です。
							</p>
						</CardContent>
					</Card>
				{:else}
					{#if isAdminServicesCreatePage || isAdminSlotsCreatePage || isAdminRecurringCreatePage}
					<section class="mx-auto w-full max-w-4xl">
						{#if isAdminServicesCreatePage}
						<Card class="surface-panel w-full border-slate-200/80 shadow-lg">
							<CardHeader><h2 class="text-lg font-semibold">サービス作成</h2></CardHeader>
								<CardContent>
									<form class="grid gap-4 md:grid-cols-2" onsubmit={submitCreateService}>
										<div class="space-y-2 md:col-span-2">
											<Label for="service-name">サービス名*</Label><Input
												id="service-name"
												name="service_name"
												bind:value={serviceForm.name}
												maxlength={120}
												onblur={() => (serviceCreateTouched.name = true)}
												required
											/>
											{#if showServiceNameError}
												<p class="text-xs text-destructive">サービス名を入力してください。</p>
											{/if}
										</div>
										<div class="space-y-2 md:col-span-2">
											<Label for="service-description">サービス説明</Label>
										<textarea
											id="service-description"
											name="service_description"
											class="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
											maxlength={500}
											bind:value={serviceForm.description}
										></textarea>
									</div>
									<div class="space-y-2 md:col-span-2">
										<Label for="service-image">サービス画像（任意）</Label>
										<Input
											id="service-image"
											name="service_image"
											type="file"
											accept="image/jpeg,image/png,image/webp,image/avif"
											bind:files={serviceImageFiles}
											disabled={busy}
										/>
										{#if selectedServiceImageFile}
											<p class="text-xs text-slate-600">選択中: {selectedServiceImageFile.name}</p>
										{/if}
									</div>
									<div class="space-y-2">
										<Label for="service-kind">種別</Label>
										<Select.Root type="single" bind:value={serviceForm.kind}
											><Select.Trigger id="service-kind" class="w-full"
												>{getServiceKindLabel(serviceForm.kind)}</Select.Trigger
											><Select.Content
												><Select.Item value="single" label="単発" /><Select.Item
													value="recurring"
													label="定期"
												/></Select.Content
											></Select.Root
										>
									</div>
									<div class="space-y-2">
										<Label for="service-booking-policy">予約方式</Label>
										<Select.Root type="single" bind:value={serviceForm.bookingPolicy}
											><Select.Trigger id="service-booking-policy" class="w-full"
												>{serviceForm.bookingPolicy === 'approval'
													? '承認制'
													: '先着確定'}</Select.Trigger
											><Select.Content
												><Select.Item value="instant" label="先着確定" /><Select.Item
													value="approval"
													label="承認制"
												/></Select.Content
											></Select.Root
											>
										</div>
										<div class="space-y-2">
											<Label for="service-duration">所要時間（分）*</Label><Input
												id="service-duration"
												name="service_duration"
												type="number"
												min="1"
												bind:value={serviceForm.durationMinutes}
												onblur={() => (serviceCreateTouched.durationMinutes = true)}
												required
											/>
											{#if showServiceDurationError}
												<p class="text-xs text-destructive">
													所要時間（分）は 1 以上の整数で入力してください。
												</p>
											{/if}
										</div>
										<div class="space-y-2">
											<Label for="service-capacity">定員*</Label><Input
												id="service-capacity"
												name="service_capacity"
												type="number"
												min="1"
												bind:value={serviceForm.capacity}
												onblur={() => (serviceCreateTouched.capacity = true)}
												required
											/>
											{#if showServiceCapacityError}
												<p class="text-xs text-destructive">
													定員は 1 以上の整数で入力してください。
												</p>
											{/if}
										</div>
									<div class="space-y-2">
										<Label for="service-cancellation-deadline">キャンセル期限（分）</Label>
										<Input
											id="service-cancellation-deadline"
											name="service_cancellation_deadline"
											type="number"
											min="0"
											max="525600"
											bind:value={serviceForm.cancellationDeadlineMinutes}
										/>
									</div>
									<div
										class="flex items-center gap-2 rounded-md border border-slate-200/80 bg-slate-50/60 px-3 py-2 md:col-span-2"
									>
										<input
											id="service-requires-ticket"
											name="service_requires_ticket"
											type="checkbox"
											bind:checked={serviceForm.requiresTicket}
										/>
										<Label for="service-requires-ticket">回数券必須サービスにする</Label>
									</div>
										<div
											class="md:col-span-2 sticky bottom-2 z-10 rounded-lg border border-slate-200/80 bg-white/95 p-3 shadow-sm backdrop-blur"
										>
											{#if serviceCreateDisabledReason}
												<p class="mb-2 text-xs text-muted-foreground">{serviceCreateDisabledReason}</p>
											{/if}
											<Button type="submit" disabled={!!serviceCreateDisabledReason}
												>サービスを作成</Button
											>
										</div>
									</form>
								</CardContent>
						</Card>
						{/if}
						{#if isAdminSlotsCreatePage}
							<Card class="surface-panel w-full border-slate-200/80 shadow-lg">
								<CardHeader><h2 class="text-lg font-semibold">単発Slot作成</h2></CardHeader>
								<CardContent>
									<form class="grid gap-4 md:grid-cols-2" onsubmit={submitCreateSlot}>
										<div class="space-y-2 md:col-span-2">
											<Label for="slot-service">サービス*</Label><Select.Root
												type="single"
												bind:value={slotForm.serviceId}
												><Select.Trigger id="slot-service" class="w-full"
													>{slotForm.serviceId
														? getServiceName(slotForm.serviceId)
														: 'サービスを選択'}</Select.Trigger
												><Select.Content
													>{#each services as service (service.id)}<Select.Item
															value={service.id}
															label={service.name}
														/>{/each}</Select.Content
												></Select.Root
											>
											{#if showSlotServiceError}
												<p class="text-xs text-destructive">サービスを選択してください。</p>
											{/if}
										</div>
										<DatePicker
											id="slot-date"
											name="slot_date"
											label="日付"
											required
											bind:value={slotForm.date}
											/>
											{#if showSlotDateError}
												<p class="text-xs text-destructive md:col-span-2">
													日付を選択してください。
												</p>
											{/if}
										<div class="space-y-2">
											<Label for="slot-start-time">開始時刻*</Label><Input
												id="slot-start-time"
												name="slot_start_time"
												type="time"
												step="900"
												bind:value={slotForm.startTime}
												disabled={!slotForm.date}
												onblur={() => (slotCreateTouched.startTime = true)}
												required
											/>
											{#if !slotForm.date}
												<p class="text-xs text-muted-foreground">
													日付を選ぶと時刻が編集できます。
												</p>
											{:else if showSlotStartTimeError}
												<p class="text-xs text-destructive">開始時刻を入力してください。</p>
											{/if}
										</div>
										<div class="space-y-2">
											<Label for="slot-end-time">終了時刻*</Label><Input
												id="slot-end-time"
												name="slot_end_time"
												type="time"
												step="900"
												bind:value={slotForm.endTime}
												disabled={!slotForm.date}
												oninput={() => {
													slotEndTimeManualEdited = true;
												}}
												onblur={() => (slotCreateTouched.endTime = true)}
												required
											/>
											{#if !slotForm.date}
												<p class="text-xs text-muted-foreground">
													日付を選ぶと時刻が編集できます。
												</p>
											{:else if showSlotEndTimeError}
												<p class="text-xs text-destructive">終了時刻を入力してください。</p>
											{/if}
										</div>
										<div
											class="flex items-center gap-2 rounded-md border border-slate-200/80 bg-slate-50/60 px-3 py-2 md:col-span-2"
										>
											<input
												id="slot-use-different-end-date"
												name="slot_use_different_end_date"
												type="checkbox"
												checked={slotForm.useDifferentEndDate}
												onchange={(event) => {
													slotForm.useDifferentEndDate = (
														event.currentTarget as HTMLInputElement
													).checked;
													slotCreateTouched.endDate = true;
													if (slotForm.useDifferentEndDate && !slotForm.endDate) {
														slotForm.endDate = slotForm.date;
													}
												}}
											/>
											<Label for="slot-use-different-end-date">終了日を別日にする</Label>
										</div>
										{#if slotForm.useDifferentEndDate}
											<DatePicker
												id="slot-end-date"
												name="slot_end_date"
												label="終了日"
												required
												bind:value={slotForm.endDate}
												/>
												{#if showSlotEndDateError}
													<p class="text-xs text-destructive md:col-span-2">
														終了日を選択してください。
													</p>
												{/if}
											{/if}
										{#if showSlotDateTimeRangeError}
											<p class="text-xs text-destructive md:col-span-2">
												終了日時は開始日時より後にしてください。
											</p>
										{/if}
										<div
											class="md:col-span-2 sticky bottom-2 z-10 rounded-lg border border-slate-200/80 bg-white/95 p-3 shadow-sm backdrop-blur"
										>
											{#if slotCreateDisabledReason}
												<p class="mb-2 text-xs text-muted-foreground">{slotCreateDisabledReason}</p>
											{/if}
											<Button type="submit" disabled={!!slotCreateDisabledReason}
												>単発スロットを作成</Button
											>
										</div>
									</form>
								</CardContent>
							</Card>
						{/if}
						{#if isAdminRecurringCreatePage}
							<Card class="surface-panel w-full border-slate-200/80 shadow-lg">
								<CardHeader><h2 class="text-lg font-semibold">定期Schedule作成</h2></CardHeader>
								<CardContent>
									<form class="grid gap-4 md:grid-cols-2" onsubmit={submitCreateRecurringSchedule}>
										<div class="space-y-2 md:col-span-2">
											<Label for="rec-service">サービス*</Label><Select.Root
												type="single"
												bind:value={recurringForm.serviceId}
												><Select.Trigger id="rec-service" class="w-full"
													>{recurringForm.serviceId
														? getServiceName(recurringForm.serviceId)
													: 'サービスを選択'}</Select.Trigger
											><Select.Content
												>{#each services as service (service.id)}<Select.Item
														value={service.id}
														label={service.name}
														/>{/each}</Select.Content
												></Select.Root
											>
											{#if showRecurringServiceError}
												<p class="text-xs text-destructive">サービスを選択してください。</p>
											{/if}
										</div>
										<div class="space-y-2">
											<Label for="rec-frequency">頻度</Label><Select.Root
											type="single"
											bind:value={recurringForm.frequency}
											><Select.Trigger id="rec-frequency" class="w-full"
												>{recurringForm.frequency}</Select.Trigger
											><Select.Content
												><Select.Item value="weekly" label="weekly" /><Select.Item
													value="monthly"
													label="monthly"
												/></Select.Content
											></Select.Root
											>
										</div>
										<div class="space-y-2">
											<Label for="rec-interval">間隔*</Label><Input
												id="rec-interval"
												name="rec_interval"
												type="number"
												min="1"
												bind:value={recurringForm.interval}
												onblur={() => (recurringCreateTouched.interval = true)}
												required
											/>
											{#if showRecurringIntervalError}
												<p class="text-xs text-destructive">
													間隔は 1 以上の整数で入力してください。
												</p>
											{/if}
										</div>
									{#if recurringForm.frequency === 'weekly'}
										<div class="space-y-2 md:col-span-2">
											<Label for="rec-weekday">曜日（例: 月,水）</Label><Input
												id="rec-weekday"
												name="rec_weekday"
												bind:value={recurringForm.byWeekday}
											/>
										</div>
									{:else}
										<div class="space-y-2 md:col-span-2">
											<Label for="rec-monthday">日付（1-31）</Label><Input
												id="rec-monthday"
												name="rec_monthday"
												type="number"
												min="1"
												max="31"
												bind:value={recurringForm.byMonthday}
											/>
										</div>
									{/if}
										<DatePicker
											id="rec-start-date"
											name="rec_start_date"
											label="開始日"
											required
											bind:value={recurringForm.startDate}
										/>
										{#if showRecurringStartDateError}
											<p class="text-xs text-destructive md:col-span-2">開始日を選択してください。</p>
										{/if}
										<DatePicker
											id="rec-end-date"
											name="rec_end_date"
											label="終了日"
											bind:value={recurringForm.endDate}
										/>
										<div class="space-y-2 md:col-span-2">
											<Label for="rec-start-time">開始時刻*</Label><Input
												id="rec-start-time"
												name="rec_start_time"
												type="time"
												step="900"
												bind:value={recurringForm.startTimeLocal}
												onblur={() => (recurringCreateTouched.startTimeLocal = true)}
												required
											/>
											{#if showRecurringStartTimeError}
												<p class="text-xs text-destructive">開始時刻を入力してください。</p>
											{/if}
										</div>
										<div
											class="md:col-span-2 sticky bottom-2 z-10 rounded-lg border border-slate-200/80 bg-white/95 p-3 shadow-sm backdrop-blur"
										>
											{#if recurringCreateDisabledReason}
												<p class="mb-2 text-xs text-muted-foreground">{recurringCreateDisabledReason}</p>
											{/if}
											<Button type="submit" disabled={!!recurringCreateDisabledReason}
												>定期スケジュールを作成</Button
											>
										</div>
									</form>
								</CardContent>
						</Card>
						{/if}
					</section>
					{/if}
				{/if}

				{#if canManage}
					{#if isAdminOperationsPage}
						<section>
							<Card class="surface-panel border-slate-200/80 shadow-lg">
								<CardHeader class="space-y-3">
									<div class="flex flex-wrap items-center justify-between gap-3">
										<div>
											<h2 class="text-lg font-semibold">予約運用ビュー</h2>
											<CardDescription>
												月間カレンダーから日別に運営予約一覧を絞り込みできます。
											</CardDescription>
										</div>
										<div class="flex items-center gap-2">
											<Button
												type="button"
												variant={adminView === 'list' ? 'default' : 'outline'}
												onclick={() => (adminView = 'list')}
											>
												一覧
											</Button>
											<Button
												type="button"
												variant={adminView === 'calendar' ? 'default' : 'outline'}
												onclick={() => (adminView = 'calendar')}
											>
												月間カレンダー
											</Button>
										</div>
									</div>
								</CardHeader>
								{#if adminView === 'calendar'}
									<CardContent class="space-y-4">
										<div class="flex flex-wrap items-center justify-between gap-3">
											<div class="flex flex-wrap items-center gap-2 text-xs text-slate-600">
												<Badge variant="outline">枠数</Badge>
												<Badge variant="secondary">承認待ち</Badge>
												<Badge variant="secondary">確定</Badge>
												<span>
													セルを選択すると下の運営予約一覧を日別で絞り込みます。
												</span>
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
												<p class="min-w-32 text-center text-lg font-semibold text-slate-900">
													{monthLabel}
												</p>
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

										{#if operationsFilter.selectedDate}
											<div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-200 bg-cyan-50/80 px-3 py-2 text-sm text-slate-700">
												<p>絞り込み日: {selectedOperationDateLabel}</p>
												<Button type="button" variant="outline" size="sm" onclick={clearSelectedOperationDate}>
													絞り込み解除
												</Button>
											</div>
										{/if}

										<div class="grid grid-cols-7 gap-1 rounded-lg border border-slate-200/80 bg-slate-50/60 p-2 text-center text-xs font-semibold text-slate-600">
											{#each weekdayLabels as dayLabel (dayLabel)}
												<div>{dayLabel}</div>
											{/each}
										</div>

										<div class="grid grid-cols-7 gap-1">
											{#each calendarDays as day (`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`)}
												{@const summary = getAdminCalendarSummary(day)}
												{@const isSelectedDate = operationsFilter.selectedDate === toDateKey(day)}
												{@const hasActivity = summary.slotCount > 0 || summary.bookingCount > 0}
												<button
													type="button"
													class={`min-h-36 rounded-lg border p-3 text-left transition-colors ${
														isCurrentMonthDay(day)
															? isSelectedDate
																? 'border-cyan-400 bg-cyan-50'
																: 'border-slate-200/80 bg-white hover:border-cyan-300 hover:bg-cyan-50/40'
															: 'border-slate-100 bg-slate-50 text-slate-400'
													}`}
													disabled={!isCurrentMonthDay(day)}
													onclick={() => selectOperationDate(day)}
												>
													<p class="mb-3 text-sm font-semibold">{day.getDate()}</p>
													<div class="space-y-2 text-xs">
														{#if hasActivity}
															<div class="rounded-md border border-slate-200/80 bg-slate-50/80 px-2 py-1">
																<p class="text-slate-500">枠</p>
																<p class="font-semibold text-slate-900">
																	{summary.slotCount}
																	<span class="font-normal text-slate-500">
																		(open {summary.openSlotCount})
																	</span>
																</p>
															</div>
															<div class="grid gap-2">
																<div class="rounded-md border border-amber-200/80 bg-amber-50 px-2 py-1">
																	<p class="text-amber-700">承認待ち</p>
																	<p class="font-semibold text-slate-900">{summary.pendingCount}</p>
																</div>
																<div class="rounded-md border border-sky-200/80 bg-sky-50 px-2 py-1">
																	<p class="text-sky-700">確定</p>
																	<p class="font-semibold text-slate-900">{summary.confirmedCount}</p>
																</div>
															</div>
															{#if summary.canceledSlotCount > 0 || summary.otherBookingCount > 0}
																<p class="text-[11px] text-slate-500">
																	{#if summary.canceledSlotCount > 0}
																		停止枠 {summary.canceledSlotCount}
																	{/if}
																	{#if summary.canceledSlotCount > 0 && summary.otherBookingCount > 0}
																		/
																	{/if}
																	{#if summary.otherBookingCount > 0}
																		その他予約 {summary.otherBookingCount}
																	{/if}
																</p>
															{/if}
														{:else}
															<p class="text-slate-500">予定なし</p>
														{/if}
													</div>
												</button>
											{/each}
										</div>
									</CardContent>
								{/if}
							</Card>
						</section>
					{/if}

					{#if isAdminOperationsPage}
					<section>
						<Card class="surface-panel border-slate-200/80 shadow-lg">
							<CardHeader>
								<h2 class="text-lg font-semibold">運営予約一覧</h2>
								<CardDescription>
									表示月の枠に紐づく予約を一覧表示し、承認・却下・運営キャンセル・No-show
									を実行できます。
									{#if operationsFilter.selectedDate}
										現在は {selectedOperationDateLabel} のみ表示しています。
									{/if}
								</CardDescription>
							</CardHeader>
							<CardContent class="space-y-4">
								{#if !canManage}
									<p class="text-sm text-muted-foreground">
										予約一覧の閲覧と運営操作には admin または owner 権限が必要です。
									</p>
								{:else}
									<div class="grid gap-3 md:grid-cols-3">
										<div class="space-y-2">
											<Label for="operations-filter-status">ステータス</Label>
											<select
												id="operations-filter-status"
												name="operations_filter_status"
												class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
												bind:value={operationsFilter.status}
											>
												<option value="all">all</option>
												<option value="confirmed">confirmed</option>
												<option value="pending_approval">pending_approval</option>
												<option value="rejected_by_staff">rejected_by_staff</option>
												<option value="cancelled_by_participant"> cancelled_by_participant </option>
												<option value="cancelled_by_staff">cancelled_by_staff</option>
												<option value="no_show">no_show</option>
											</select>
										</div>
										<div class="space-y-2">
											<Label for="operations-filter-service">サービス</Label>
											<select
												id="operations-filter-service"
												name="operations_filter_service"
												class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
												bind:value={operationsFilter.serviceId}
											>
												<option value="">すべて</option>
												{#each operationServiceOptions as service (service.id)}
													<option value={service.id}>{service.name}</option>
												{/each}
											</select>
										</div>
										<div class="space-y-2">
											<Label for="operations-filter-participant">参加者</Label>
											<select
												id="operations-filter-participant"
												name="operations_filter_participant"
												class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
												bind:value={operationsFilter.participantId}
											>
												<option value="">すべて</option>
												{#each staffParticipants as participant (participant.id)}
													<option value={participant.id}
														>{participant.name} / {participant.email}</option
													>
												{/each}
											</select>
										</div>
									</div>
									{#if operationsFilter.selectedDate}
										<div class="flex flex-wrap items-center gap-2">
											<Badge variant="outline">日付: {selectedOperationDateLabel}</Badge>
											<Button type="button" variant="outline" size="sm" onclick={clearSelectedOperationDate}>
												日付絞り込み解除
											</Button>
										</div>
									{/if}
									<p class="text-xs text-slate-600">
										承認待ちは「承認 / 却下」、予約確定は「運営キャンセル /
										No-show」を実行できます。
									</p>

									{#if filteredOperationRows.length === 0}
										<p class="text-sm text-muted-foreground">表示月に該当する予約はありません。</p>
									{:else}
										<div class="overflow-x-auto rounded-lg border border-slate-200/80 bg-white/80">
											<table class="w-full min-w-[1040px] text-sm">
												<thead class="bg-slate-50 text-slate-600">
													<tr>
														<th class="px-3 py-2 text-left font-medium">予約ID</th>
														<th class="px-3 py-2 text-left font-medium">日時</th>
														<th class="px-3 py-2 text-left font-medium">サービス</th>
														<th class="px-3 py-2 text-left font-medium">参加者</th>
														<th class="px-3 py-2 text-right font-medium">人数</th>
														<th class="px-3 py-2 text-left font-medium">ステータス</th>
														<th class="px-3 py-2 text-left font-medium">予約作成日時</th>
														<th class="px-3 py-2 text-left font-medium">操作</th>
													</tr>
												</thead>
												<tbody>
													{#each filteredOperationRows as row (row.booking.id)}
														{@const isConfirmed = row.booking.status === 'confirmed'}
														{@const isPendingApproval = row.booking.status === 'pending_approval'}
														<tr class="border-t border-slate-200/70 align-top">
															<td class="px-3 py-3">
																<span class="font-mono text-xs text-slate-700">
																	{formatBookingIdShort(row.booking.id)}
																</span>
															</td>
															<td class="px-3 py-3">
																{#if row.slot}
																	<p class="font-medium text-slate-900">
																		{formatDateTime(row.slot.startAt)}
																	</p>
																	<p class="text-xs text-slate-600">
																		〜 {formatTimeLabel(row.slot.endAt)}
																	</p>
																{:else}
																	<p class="text-xs text-slate-600">slot: {row.booking.slotId}</p>
																{/if}
															</td>
															<td class="px-3 py-3">{getServiceName(row.booking.serviceId)}</td>
															<td class="px-3 py-3">{getParticipantLabel(row)}</td>
															<td class="px-3 py-3 text-right tabular-nums">
																{row.booking.participantsCount}
															</td>
															<td class="px-3 py-3">
																<Badge
																	variant={row.booking.status === 'confirmed'
																		? 'outline'
																		: row.booking.status === 'cancelled_by_staff' ||
																			  row.booking.status === 'rejected_by_staff'
																			? 'destructive'
																			: 'secondary'}
																>
																	{bookingStatusLabelMap[row.booking.status]}
																</Badge>
															</td>
															<td class="px-3 py-3">{formatDateTime(row.booking.createdAt)}</td>
															<td class="px-3 py-3">
																{#if isPendingApproval}
																	<div class="flex flex-wrap items-center gap-2">
																		<Button
																			type="button"
																			size="sm"
																			onclick={() => submitApproveBookingByStaff(row.booking.id)}
																			disabled={busy || !!staffAction}
																		>
																			{isStaffActionInProgress('approve', row.booking.id)
																				? '処理中…'
																				: '承認'}
																		</Button>
																		<Button
																			type="button"
																			variant="outline"
																			size="sm"
																			onclick={() => submitRejectBookingByStaff(row.booking.id)}
																			disabled={busy || !!staffAction}
																		>
																			{isStaffActionInProgress('reject', row.booking.id)
																				? '処理中…'
																				: '却下'}
																		</Button>
																	</div>
																{:else if isConfirmed}
																	<div class="flex flex-wrap items-center gap-2">
																		<Button
																			type="button"
																			variant="destructive"
																			size="sm"
																			onclick={() => submitCancelBookingByStaff(row.booking.id)}
																			disabled={busy || !!staffAction}
																		>
																			{isStaffActionInProgress('cancel', row.booking.id)
																				? '処理中…'
																				: '運営キャンセル'}
																		</Button>
																		<Button
																			type="button"
																			variant="outline"
																			size="sm"
																			onclick={() => submitMarkBookingNoShow(row.booking.id)}
																			disabled={busy || !!staffAction}
																		>
																			{isStaffActionInProgress('no_show', row.booking.id)
																				? '処理中…'
																				: 'No-show'}
																		</Button>
																	</div>
																{:else}
																	<span class="text-xs text-slate-500">操作不可</span>
																{/if}
															</td>
														</tr>
													{/each}
												</tbody>
											</table>
										</div>
									{/if}
								{/if}
							</CardContent>
						</Card>
					</section>
					{/if}

					{#if isAdminServicesPage}
					<section>
						<Card class="surface-panel border-slate-200/80 shadow-lg">
							<CardHeader>
								<h2 class="text-lg font-semibold">サービス管理</h2>
								<CardDescription>サービス一覧から編集・停止・再開を実行できます。</CardDescription>
							</CardHeader>
							<CardContent class="space-y-4">
								{#if staffServiceRows.length === 0}
									<p class="text-sm text-muted-foreground">管理対象のサービスがありません。</p>
								{:else}
									<div class="overflow-x-auto rounded-lg border border-slate-200/80 bg-white/80">
										<table class="w-full min-w-[980px] text-sm">
											<thead class="bg-slate-50 text-slate-600">
												<tr>
													<th class="px-3 py-2 text-left font-medium">サービス名</th>
													<th class="px-3 py-2 text-left font-medium">画像</th>
													<th class="px-3 py-2 text-left font-medium">種別</th>
													<th class="px-3 py-2 text-left font-medium">予約方式</th>
													<th class="px-3 py-2 text-right font-medium">所要時間</th>
													<th class="px-3 py-2 text-right font-medium">定員</th>
													<th class="px-3 py-2 text-left font-medium">回数券必須</th>
													<th class="px-3 py-2 text-left font-medium">状態</th>
													<th class="px-3 py-2 text-left font-medium">更新日時</th>
													<th class="px-3 py-2 text-left font-medium">操作</th>
												</tr>
											</thead>
											<tbody>
												{#each staffServiceRows as service (service.id)}
													<tr class="border-t border-slate-200/70 align-top">
														<td class="px-3 py-3">{service.name}</td>
														<td class="px-3 py-3">
															{#if service.imageUrl}
																<img
																	src={service.imageUrl}
																	alt={`${service.name} の画像`}
																	class="h-12 w-16 rounded border border-slate-200/80 object-cover"
																	loading="lazy"
																/>
															{:else}
																<span class="text-xs text-slate-500">なし</span>
															{/if}
														</td>
														<td class="px-3 py-3">{formatServiceKind(service.kind)}</td>
														<td class="px-3 py-3">{formatBookingPolicy(service.bookingPolicy)}</td>
														<td class="px-3 py-3 text-right tabular-nums"
															>{service.durationMinutes}</td
														>
														<td class="px-3 py-3 text-right tabular-nums">{service.capacity}</td>
														<td class="px-3 py-3">
															{service.requiresTicket ? 'あり' : 'なし'}
														</td>
														<td class="px-3 py-3">
															<Badge variant={service.isActive ? 'outline' : 'secondary'}>
																{service.isActive ? '稼働中' : '停止'}
															</Badge>
														</td>
														<td class="px-3 py-3">{formatDateTime(service.updatedAt)}</td>
														<td class="px-3 py-3">
															<div class="flex flex-wrap gap-2">
																<Button
																	type="button"
																	variant="outline"
																	size="sm"
																	disabled={busy || !!resourceAction}
																	onclick={() => selectServiceForEdit(service)}
																>
																	編集
																</Button>
																{#if service.isActive}
																	<Button
																		type="button"
																		size="sm"
																		variant="destructive"
																		disabled={busy || !!resourceAction}
																		onclick={() => submitArchiveServiceByStaff(service.id)}
																	>
																		{isResourceActionInProgress('service_archive', service.id)
																			? '停止中…'
																			: '停止'}
																	</Button>
																{:else}
																	<Button
																		type="button"
																		size="sm"
																		variant="outline"
																		disabled={busy || !!resourceAction}
																		onclick={() => submitResumeServiceByStaff(service.id)}
																	>
																		{isResourceActionInProgress('service_resume', service.id)
																			? '再開中…'
																			: '再開'}
																	</Button>
																{/if}
															</div>
														</td>
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
								{/if}
								<p class="text-sm text-muted-foreground">
									一覧の「編集」ボタンからモーダルで更新できます。
								</p>
							</CardContent>
						</Card>
					</section>
					{/if}

					{#if isAdminSlotsPage}
					<section>
						<Card class="surface-panel border-slate-200/80 shadow-lg">
							<CardHeader>
								<h2 class="text-lg font-semibold">単発Slot管理</h2>
								<CardDescription>
									表示月に含まれる枠を表示します。open 状態の枠のみ停止できます。
								</CardDescription>
							</CardHeader>
							<CardContent>
								{#if slotManagementRows.length === 0}
									<p class="text-sm text-muted-foreground">表示月に管理対象の枠はありません。</p>
								{:else}
									<div class="overflow-x-auto rounded-lg border border-slate-200/80 bg-white/80">
										<table class="w-full min-w-[1080px] text-sm">
											<thead class="bg-slate-50 text-slate-600">
												<tr>
													<th class="px-3 py-2 text-left font-medium">枠ID</th>
													<th class="px-3 py-2 text-left font-medium">日時</th>
													<th class="px-3 py-2 text-left font-medium">サービス</th>
													<th class="px-3 py-2 text-right font-medium">定員</th>
													<th class="px-3 py-2 text-right font-medium">予約済</th>
													<th class="px-3 py-2 text-left font-medium">ステータス</th>
													<th class="px-3 py-2 text-left font-medium">担当</th>
													<th class="px-3 py-2 text-left font-medium">場所</th>
													<th class="px-3 py-2 text-left font-medium">操作</th>
												</tr>
											</thead>
											<tbody>
												{#each slotManagementRows as slot (slot.id)}
													<tr class="border-t border-slate-200/70 align-top">
														<td class="px-3 py-3 font-mono text-xs">{formatSlotIdShort(slot.id)}</td
														>
														<td class="px-3 py-3">
															<p class="font-medium text-slate-900">
																{formatDateTime(slot.startAt)}
															</p>
															<p class="text-xs text-slate-600">
																〜 {formatTimeLabel(slot.endAt)}
															</p>
														</td>
														<td class="px-3 py-3">{getServiceName(slot.serviceId)}</td>
														<td class="px-3 py-3 text-right tabular-nums">{slot.capacity}</td>
														<td class="px-3 py-3 text-right tabular-nums">{slot.reservedCount}</td>
														<td class="px-3 py-3">
															<Badge variant={slot.status === 'open' ? 'outline' : 'secondary'}>
																{statusLabelMap[slot.status]}
															</Badge>
														</td>
														<td class="px-3 py-3">{slot.staffLabel || '-'}</td>
														<td class="px-3 py-3">{slot.locationLabel || '-'}</td>
														<td class="px-3 py-3">
															{#if slot.status === 'completed' && !isSlotEditable(slot)}
																<span class="text-xs text-slate-500">編集不可</span>
															{:else}
																<div class="flex flex-wrap items-center gap-2">
																	<Button
																		type="button"
																		size="sm"
																		variant="outline"
																		disabled={busy || !!resourceAction || !isSlotEditable(slot)}
																		onclick={() => selectSlotForEdit(slot)}
																	>
																		編集
																	</Button>
																	{#if !isSlotEditable(slot)}
																		<span class="text-xs text-slate-500">編集不可</span>
																	{/if}
																	<Button
																		type="button"
																		size="sm"
																		variant="destructive"
																		disabled={busy || !!resourceAction || slot.status !== 'open'}
																		onclick={() => submitCancelSlotByStaff(slot.id)}
																	>
																		{isResourceActionInProgress('slot_cancel', slot.id)
																			? '停止中…'
																			: '停止'}
																	</Button>
																</div>
															{/if}
														</td>
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
								{/if}
							</CardContent>
						</Card>
					</section>
					{/if}
				{/if}

				{#if isAdminRecurringPage}
				<section>
					<Card class="surface-panel border-slate-200/80 shadow-lg">
						<CardHeader>
							<h2 class="text-lg font-semibold">定期Schedule管理</h2>
							<CardDescription>
								定期スケジュールの更新・停止、例外登録、枠再生成を実行できます。
							</CardDescription>
						</CardHeader>
						<CardContent class="space-y-4">
							{#if staffRecurringRows.length === 0}
								<p class="text-sm text-muted-foreground">
									管理対象の定期スケジュールがありません。
								</p>
							{:else}
								<div class="overflow-x-auto rounded-lg border border-slate-200/80 bg-white/80">
									<table class="w-full min-w-[1120px] text-sm">
										<thead class="bg-slate-50 text-slate-600">
											<tr>
												<th class="px-3 py-2 text-left font-medium">Schedule ID</th>
												<th class="px-3 py-2 text-left font-medium">サービス</th>
												<th class="px-3 py-2 text-left font-medium">パターン</th>
												<th class="px-3 py-2 text-left font-medium">期間</th>
												<th class="px-3 py-2 text-left font-medium">開始時刻</th>
												<th class="px-3 py-2 text-left font-medium">状態</th>
												<th class="px-3 py-2 text-left font-medium">更新日時</th>
												<th class="px-3 py-2 text-left font-medium">操作</th>
											</tr>
										</thead>
										<tbody>
											{#each staffRecurringRows as schedule (schedule.id)}
												<tr class="border-t border-slate-200/70 align-top">
													<td class="px-3 py-3 font-mono text-xs">
														{formatRecurringIdShort(schedule.id)}
													</td>
													<td class="px-3 py-3">{getServiceName(schedule.serviceId)}</td>
													<td class="px-3 py-3">{formatRecurringPattern(schedule)}</td>
													<td class="px-3 py-3">
														{schedule.startDate} 〜 {schedule.endDate || '無期限'}
													</td>
													<td class="px-3 py-3">{schedule.startTimeLocal}</td>
													<td class="px-3 py-3">
														<Badge variant={schedule.isActive ? 'outline' : 'secondary'}>
															{schedule.isActive ? '稼働中' : '停止'}
														</Badge>
													</td>
													<td class="px-3 py-3">{formatDateTime(schedule.updatedAt)}</td>
													<td class="px-3 py-3">
														<div class="flex flex-wrap gap-2">
															<Button
																type="button"
																size="sm"
																variant="outline"
																disabled={busy || !!resourceAction}
																onclick={() => selectRecurringForEdit(schedule)}
															>
																編集
															</Button>
															<Button
																type="button"
																size="sm"
																variant="destructive"
																disabled={busy || !!resourceAction || !schedule.isActive}
																onclick={() => submitStopRecurringScheduleByStaff(schedule.id)}
															>
																{isResourceActionInProgress('recurring_stop', schedule.id)
																	? '停止中…'
																	: '停止'}
															</Button>
														</div>
													</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/if}

							<div class="space-y-4 rounded-lg border border-slate-200/80 bg-slate-50/60 p-4">
									<div class="space-y-2">
										<Label for="recurring-target-select">対象定期スケジュール</Label>
										<select
											id="recurring-target-select"
											name="recurring_target_select"
											class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
											bind:value={selectedRecurringScheduleId}
										>
											<option value="">選択してください</option>
											{#each staffRecurringRows as schedule (schedule.id)}
												<option value={schedule.id}
													>{formatRecurringIdShort(schedule.id)} / {getServiceName(
														schedule.serviceId
													)}</option
												>
											{/each}
										</select>
									</div>
									<div class="space-y-3">
										<h3 class="text-base font-semibold text-slate-900">例外登録</h3>
										<form
											class="grid gap-3 md:grid-cols-2"
											onsubmit={submitUpsertRecurringExceptionByStaff}
										>
											<div class="space-y-2">
												<Label for="recurring-exception-date">対象日</Label>
												<Input
													id="recurring-exception-date"
													name="recurring_exception_date"
													type="date"
													bind:value={recurringExceptionForm.date}
													required
												/>
											</div>
											<div class="space-y-2">
												<Label for="recurring-exception-action">アクション</Label>
												<select
													id="recurring-exception-action"
													name="recurring_exception_action"
													class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
													bind:value={recurringExceptionForm.action}
												>
													<option value="skip">skip</option>
													<option value="override">override</option>
												</select>
											</div>
											{#if recurringExceptionForm.action === 'override'}
												<div class="space-y-2">
													<Label for="recurring-exception-start-time">開始時刻上書き</Label>
													<Input
														id="recurring-exception-start-time"
														name="recurring_exception_start_time"
														type="time"
														bind:value={recurringExceptionForm.overrideStartTimeLocal}
													/>
												</div>
												<div class="space-y-2">
													<Label for="recurring-exception-duration">所要時間上書き（分）</Label>
													<Input
														id="recurring-exception-duration"
														name="recurring_exception_duration"
														type="number"
														min="1"
														bind:value={recurringExceptionForm.overrideDurationMinutes}
													/>
												</div>
												<div class="space-y-2 md:col-span-2">
													<Label for="recurring-exception-capacity">定員上書き</Label>
													<Input
														id="recurring-exception-capacity"
														name="recurring_exception_capacity"
														type="number"
														min="1"
														bind:value={recurringExceptionForm.overrideCapacity}
													/>
												</div>
											{/if}
											<div class="md:col-span-2">
												<Button
													type="submit"
													disabled={busy || !!resourceAction || !selectedRecurringScheduleId}
												>
													{isResourceActionInProgress(
														'recurring_exception',
														selectedRecurringScheduleId
													)
														? '登録中…'
														: '登録'}
												</Button>
											</div>
										</form>
									</div>
									<div class="space-y-3">
										<h3 class="text-base font-semibold text-slate-900">枠を再生成</h3>
										<form
											class="grid gap-3 md:grid-cols-2"
											onsubmit={submitGenerateRecurringSlotsByStaff}
										>
											<div class="space-y-2">
												<Label for="recurring-generate-from">開始日（任意）</Label>
												<Input
													id="recurring-generate-from"
													name="recurring_generate_from"
													type="date"
													bind:value={recurringGenerateForm.fromDate}
												/>
											</div>
											<div class="space-y-2">
												<Label for="recurring-generate-to">終了日（任意）</Label>
												<Input
													id="recurring-generate-to"
													name="recurring_generate_to"
													type="date"
													bind:value={recurringGenerateForm.toDate}
												/>
											</div>
											<div class="md:col-span-2">
												<Button
													type="submit"
													disabled={busy || !!resourceAction || !selectedRecurringScheduleId}
												>
													{isResourceActionInProgress(
														'recurring_generate',
														selectedRecurringScheduleId
													)
														? '再生成中…'
														: '実行'}
												</Button>
											</div>
										</form>
									</div>
							</div>
						</CardContent>
					</Card>
				</section>
				{/if}

				{#if isAdminOperationsPage}
				<section class="grid gap-3 md:grid-cols-3">
					<Card
						><CardContent class="py-4"
							><p class="text-xs text-muted-foreground">サービス</p>
							<p class="metric-value text-2xl font-semibold">{services.length}</p></CardContent
						></Card
					>
					<Card
						><CardContent class="py-4"
							><p class="text-xs text-muted-foreground">期間内の枠</p>
							<p class="metric-value text-2xl font-semibold">{slots.length}</p></CardContent
						></Card
					>
					<Card
						><CardContent class="py-4"
							><p class="text-xs text-muted-foreground">定期スケジュール</p>
							<p class="metric-value text-2xl font-semibold">
								{recurringSchedules.length}
							</p></CardContent
						></Card
					>
				</section>
				{/if}
				</TabsContent>
			{/if}

			{#if isParticipantPage}
				<TabsContent value="participant" class="space-y-4">
				<Card class="surface-panel border-slate-200/80 shadow-lg">
					<CardHeader class="space-y-3">
						<div class="flex flex-wrap items-center justify-between gap-3">
							<div>
								<h2 class="text-lg font-semibold">
									{participantView === 'calendar' ? '予約カレンダー' : '日程表'}
								</h2>
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
								<p class="min-w-32 text-center text-lg font-semibold text-slate-900">
									{monthLabel}
								</p>
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
						<div class="rounded-lg border border-slate-200/80 bg-slate-50/60 p-4">
							<div class="mb-2 flex items-center justify-between gap-2">
								<h3 class="text-sm font-semibold text-slate-900">回数券購入</h3>
								<Badge variant="outline">{myTicketPurchaseRows.length}件</Badge>
							</div>
							{#if !canUseParticipantBooking}
								<p class="text-sm text-muted-foreground">
									回数券購入には参加者としての所属が必要です。
								</p>
							{:else}
								<form class="grid gap-3 md:grid-cols-[1fr_200px_auto]" onsubmit={submitCreateTicketPurchase}>
									<div class="space-y-2">
										<Label for="ticket-purchase-type">回数券種別</Label>
										<select
											id="ticket-purchase-type"
											name="ticket_purchase_type"
											class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
											bind:value={ticketPurchaseForm.ticketTypeId}
											required
										>
											<option value="" disabled>購入する回数券種別を選択</option>
											{#each purchasableTicketTypeRows as ticketType (ticketType.id)}
												<option value={ticketType.id}
													>{ticketType.name} / {ticketType.totalCount}回</option
												>
											{/each}
										</select>
									</div>
									<div class="space-y-2">
										<Label for="ticket-purchase-method">支払方法</Label>
										<select
											id="ticket-purchase-method"
											name="ticket_purchase_method"
											class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
											bind:value={ticketPurchaseForm.paymentMethod}
										>
											<option value="stripe">Stripe</option>
											<option value="cash_on_site">現地決済</option>
											<option value="bank_transfer">銀行振込</option>
										</select>
									</div>
									<div class="md:self-end">
										<Button
											type="submit"
											disabled={busy ||
												!!ticketPurchaseAction ||
												purchasableTicketTypeRows.length === 0 ||
												!ticketPurchaseForm.ticketTypeId}
										>
											{isTicketPurchaseCreateInProgress() ? '処理中…' : '購入申請'}
										</Button>
									</div>
								</form>
								{#if purchasableTicketTypeRows.length === 0}
									<p class="mt-2 text-sm text-muted-foreground">
										現在購入可能な回数券種別はありません。
									</p>
								{/if}
								<div class="mt-3 space-y-2">
									<h4 class="text-xs font-semibold text-slate-700">購入申請履歴</h4>
									{#if myTicketPurchaseRows.length === 0}
										<p class="text-sm text-muted-foreground">購入申請履歴はありません。</p>
									{:else}
										<div class="space-y-2">
											{#each myTicketPurchaseRows as purchase (purchase.id)}
												<div
													class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3"
												>
													<div class="space-y-1">
														<p class="text-xs text-slate-600">
															申請ID:
															<span class="font-mono text-slate-800"
																>{formatTicketPurchaseIdShort(purchase.id)}</span
															>
														</p>
														<p class="text-sm font-semibold text-slate-900">
															券種ID: {formatTicketTypeShort(purchase.ticketTypeId)}
														</p>
														<p class="text-xs text-slate-600">
															支払方法: {ticketPurchaseMethodLabelMap[purchase.paymentMethod]} /
															申請日時: {formatDateTime(purchase.createdAt)}
														</p>
														{#if purchase.rejectReason}
															<p class="text-xs text-rose-600">却下理由: {purchase.rejectReason}</p>
														{/if}
													</div>
													<div class="flex items-center gap-2">
														<Badge
															variant={purchase.status === 'approved'
																? 'outline'
																: purchase.status === 'rejected'
																	? 'destructive'
																	: purchase.status === 'cancelled_by_participant'
																		? 'secondary'
																		: 'secondary'}
														>
															{ticketPurchaseStatusLabelMap[purchase.status]}
														</Badge>
														{#if purchase.status === 'pending_payment' || purchase.status === 'pending_approval'}
															<Button
																type="button"
																variant="outline"
																size="sm"
																onclick={() => submitCancelTicketPurchase(purchase.id)}
																disabled={busy || !!ticketPurchaseAction}
															>
																{isTicketPurchaseCancelInProgress(purchase.id)
																	? '処理中…'
																	: '取り下げ'}
															</Button>
														{/if}
													</div>
												</div>
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						</div>

						<div class="rounded-lg border border-slate-200/80 bg-slate-50/60 p-4">
							<div class="mb-2 flex items-center justify-between gap-2">
								<h3 class="text-sm font-semibold text-slate-900">マイ回数券</h3>
								<Badge variant="outline">{myTicketPacks.length}件</Badge>
							</div>
							{#if !canUseParticipantBooking}
								<p class="text-sm text-muted-foreground">
									回数券の表示には参加者としての所属が必要です。
								</p>
							{:else if myTicketPacks.length === 0}
								<p class="text-sm text-muted-foreground">利用中の回数券はありません。</p>
							{:else}
								<div class="space-y-2">
									{#each myTicketPacks as pack (pack.id)}
										<div
											class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3"
										>
											<div class="space-y-1">
												<p class="text-xs text-slate-600">
													券種ID: <span class="font-mono text-slate-800"
														>{formatTicketTypeShort(pack.ticketTypeId)}</span
													>
												</p>
												<p class="text-sm font-semibold text-slate-900">
													残数 {pack.remainingCount} / {pack.initialCount}
												</p>
												<p class="text-xs text-slate-600">
													有効期限: {formatOptionalDateTime(pack.expiresAt)}
												</p>
											</div>
											<Badge
												variant={pack.status === 'expired'
													? 'destructive'
													: pack.status === 'exhausted'
														? 'secondary'
														: 'outline'}
											>
												{ticketPackStatusLabelMap[pack.status]}
											</Badge>
										</div>
									{/each}
								</div>
							{/if}
						</div>

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

								<div
									class="grid grid-cols-7 gap-1 rounded-lg border border-slate-200/80 bg-slate-50/60 p-2 text-center text-xs font-semibold text-slate-600"
								>
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
														{@const isPendingApproval = item.booking?.status === 'pending_approval'}
														{@const bookingId = item.booking?.id}
														{@const canApply =
															item.slot.status === 'open' &&
															item.slot.reservedCount < item.slot.capacity &&
															!item.booking}
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
																{formatTimeLabel(item.slot.startAt)} - {formatTimeLabel(
																	item.slot.endAt
																)}
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
															{:else if (isConfirmed || isPendingApproval) && item.booking}
																<Button
																	type="button"
																	variant={isPendingApproval ? 'outline' : 'destructive'}
																	size="sm"
																	class="mt-1 h-7 text-[11px]"
																	onclick={() => bookingId && submitCancelBooking(bookingId)}
																	disabled={busy ||
																		!bookingId ||
																		!canUseParticipantBooking ||
																		isBookingCancelInProgress(bookingId)}
																>
																	{isBookingCancelInProgress(bookingId)
																		? '処理中…'
																		: isPendingApproval
																			? '取下げ'
																			: 'キャンセル'}
																</Button>
															{:else if item.booking}
																<p class="mt-1 text-[11px] text-slate-500">
																	{bookingStatusLabelMap[item.booking.status]}
																</p>
															{:else if canApply}
																<Button
																	type="button"
																	size="sm"
																	class="mt-1 h-7 text-[11px]"
																	onclick={() => submitCreateBooking(item.slot.id)}
																	disabled={busy ||
																		!canUseParticipantBooking ||
																		isBookingCreateInProgress(item.slot.id)}
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
											<section
												class="overflow-hidden rounded-lg border border-slate-200/80 bg-white"
											>
												<div class="bg-cyan-100/70 px-3 py-2 text-sm font-semibold text-slate-800">
													{group.dateLabel}
												</div>
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
																	<td class="px-3 py-3 text-right tabular-nums"
																		>{row.pendingCount}</td
																	>
																	<td class="px-3 py-3 text-right tabular-nums"
																		>{row.confirmedCount}</td
																	>
																	<td class="px-3 py-3 text-right tabular-nums"
																		>{row.remainingCount}</td
																	>
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
			{/if}
		</Tabs>
	{/if}

	{#if canManage}
		<Dialog bind:open={serviceEditDialogOpen}>
			<DialogContent aria-describedby="service-edit-dialog-description" class="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>サービスを編集</DialogTitle>
					<DialogDescription id="service-edit-dialog-description">
						保存後は一覧を再読込して最新状態を反映します。
					</DialogDescription>
				</DialogHeader>
				{#if serviceEditTargetId}
					<form class="grid gap-3 md:grid-cols-2" onsubmit={submitUpdateServiceByStaff}>
						<div class="space-y-2">
							<Label for="service-edit-name">サービス名</Label>
							<Input
								id="service-edit-name"
								name="service_edit_name"
								bind:value={serviceEditForm.name}
								maxlength={120}
								required
							/>
						</div>
						<div class="space-y-2 md:col-span-2">
							<Label for="service-edit-description">サービス説明</Label>
							<textarea
								id="service-edit-description"
								name="service_edit_description"
								class="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
								maxlength={500}
								bind:value={serviceEditForm.description}
							></textarea>
						</div>
						<div class="space-y-2">
							<Label for="service-edit-image">サービス画像（任意）</Label>
							<Input
								id="service-edit-image"
								name="service_edit_image"
								type="file"
								accept="image/jpeg,image/png,image/webp,image/avif"
								bind:files={serviceEditImageFiles}
								disabled={busy || !!resourceAction}
							/>
							{#if selectedServiceEditImageFile}
								<p class="text-xs text-slate-600">選択中: {selectedServiceEditImageFile.name}</p>
							{/if}
						</div>
						{#if serviceEditTargetId}
							{@const editingService = staffServices.find((service) => service.id === serviceEditTargetId)}
							{#if editingService?.imageUrl}
								<div class="space-y-2 md:col-span-2">
									<Label>現在の画像</Label>
									<img
										src={editingService.imageUrl}
										alt={`${editingService.name} のサービス画像`}
										class="h-28 w-auto rounded-md border border-slate-200/80 object-cover"
										loading="lazy"
									/>
								</div>
							{/if}
						{/if}
						<div class="space-y-2">
							<Label for="service-edit-kind">種別</Label>
							<select
								id="service-edit-kind"
								name="service_edit_kind"
								class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
								bind:value={serviceEditForm.kind}
							>
								<option value="single">単発</option>
								<option value="recurring">定期</option>
							</select>
						</div>
						<div class="space-y-2">
							<Label for="service-edit-booking-policy">予約方式</Label>
							<select
								id="service-edit-booking-policy"
								name="service_edit_booking_policy"
								class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
								bind:value={serviceEditForm.bookingPolicy}
							>
								<option value="instant">先着確定</option>
								<option value="approval">承認制</option>
							</select>
						</div>
						<div class="space-y-2">
							<Label for="service-edit-duration">所要時間（分）</Label>
							<Input
								id="service-edit-duration"
								name="service_edit_duration"
								type="number"
								min="1"
								bind:value={serviceEditForm.durationMinutes}
								required
							/>
						</div>
						<div class="space-y-2">
							<Label for="service-edit-capacity">定員</Label>
							<Input
								id="service-edit-capacity"
								name="service_edit_capacity"
								type="number"
								min="1"
								bind:value={serviceEditForm.capacity}
								required
							/>
						</div>
						<div class="space-y-2">
							<Label for="service-edit-deadline">キャンセル期限（分）</Label>
							<Input
								id="service-edit-deadline"
								name="service_edit_deadline"
								type="number"
								min="0"
								max="525600"
								bind:value={serviceEditForm.cancellationDeadlineMinutes}
							/>
						</div>
						<div class="flex items-center gap-2 rounded-md border border-slate-200/80 bg-white px-3 py-2">
							<input
								id="service-edit-requires-ticket"
								name="service_edit_requires_ticket"
								type="checkbox"
								bind:checked={serviceEditForm.requiresTicket}
							/>
							<Label for="service-edit-requires-ticket">回数券必須</Label>
						</div>
						<DialogFooter class="md:col-span-2">
							<Button
								type="button"
								variant="outline"
								disabled={busy || !!resourceAction}
								onclick={() => {
									serviceEditDialogOpen = false;
									serviceEditImageFiles = undefined;
								}}
							>
								キャンセル
							</Button>
							<Button type="submit" disabled={busy || !!resourceAction || !serviceEditTargetId}>
								{isResourceActionInProgress('service_update', serviceEditTargetId)
									? '更新中…'
									: '更新'}
							</Button>
						</DialogFooter>
					</form>
				{:else}
					<p class="text-sm text-muted-foreground">編集対象のサービスが見つかりません。</p>
				{/if}
			</DialogContent>
		</Dialog>

		<Dialog bind:open={slotEditDialogOpen}>
			<DialogContent aria-describedby="slot-edit-dialog-description">
				<DialogHeader>
					<DialogTitle>単発枠を編集</DialogTitle>
					<DialogDescription id="slot-edit-dialog-description">
						未予約かつ開始前の open 枠のみ編集できます。
					</DialogDescription>
				</DialogHeader>
				{#if slotEditTargetId}
					{@const editingSlot = slotManagementRows.find((slot) => slot.id === slotEditTargetId)}
					{@const canEditSlot = editingSlot ? isSlotEditable(editingSlot) : false}
					<form class="grid gap-3 md:grid-cols-2" onsubmit={submitUpdateSlotByStaff}>
						<div class="space-y-2">
							<Label for="slot-edit-start-date">開始日</Label>
							<Input
								id="slot-edit-start-date"
								name="slot_edit_start_date"
								type="date"
								bind:value={slotEditForm.startDate}
								required
							/>
						</div>
						<div class="space-y-2">
							<Label for="slot-edit-start-time">開始時刻</Label>
							<Input
								id="slot-edit-start-time"
								name="slot_edit_start_time"
								type="time"
								bind:value={slotEditForm.startTime}
								required
							/>
						</div>
						<div class="space-y-2">
							<Label for="slot-edit-end-date">終了日</Label>
							<Input
								id="slot-edit-end-date"
								name="slot_edit_end_date"
								type="date"
								bind:value={slotEditForm.endDate}
								required
							/>
						</div>
						<div class="space-y-2">
							<Label for="slot-edit-end-time">終了時刻</Label>
							<Input
								id="slot-edit-end-time"
								name="slot_edit_end_time"
								type="time"
								bind:value={slotEditForm.endTime}
								required
							/>
						</div>
						<div class="space-y-2">
							<Label for="slot-edit-capacity">定員</Label>
							<Input
								id="slot-edit-capacity"
								name="slot_edit_capacity"
								type="number"
								min="1"
								max="500"
								bind:value={slotEditForm.capacity}
							/>
						</div>
						<div class="space-y-2">
							<Label for="slot-edit-staff-label">担当（任意）</Label>
							<Input
								id="slot-edit-staff-label"
								name="slot_edit_staff_label"
								maxlength={120}
								bind:value={slotEditForm.staffLabel}
							/>
						</div>
						<div class="space-y-2 md:col-span-2">
							<Label for="slot-edit-location-label">場所（任意）</Label>
							<Input
								id="slot-edit-location-label"
								name="slot_edit_location_label"
								maxlength={120}
								bind:value={slotEditForm.locationLabel}
							/>
						</div>
						{#if !canEditSlot}
							<p class="text-sm text-destructive md:col-span-2">
								この単発枠は編集条件（open / 未予約 / 開始前）を満たしていません。
							</p>
						{/if}
						<DialogFooter class="md:col-span-2">
							<Button
								type="button"
								variant="outline"
								disabled={busy || !!resourceAction}
								onclick={() => {
									slotEditDialogOpen = false;
								}}
							>
								キャンセル
							</Button>
							<Button
								type="submit"
								disabled={busy || !!resourceAction || !slotEditTargetId || !canEditSlot}
							>
								{isResourceActionInProgress('slot_update', slotEditTargetId)
									? '更新中…'
									: '更新'}
							</Button>
						</DialogFooter>
					</form>
				{:else}
					<p class="text-sm text-muted-foreground">編集対象の単発枠が見つかりません。</p>
				{/if}
			</DialogContent>
		</Dialog>

		<Dialog bind:open={recurringEditDialogOpen}>
			<DialogContent aria-describedby="recurring-edit-dialog-description" class="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>定期スケジュールを編集</DialogTitle>
					<DialogDescription id="recurring-edit-dialog-description">
						更新後は一覧を再読込して最新状態を反映します。
					</DialogDescription>
				</DialogHeader>
				{#if recurringEditTargetId}
					<form class="grid gap-3 md:grid-cols-2" onsubmit={submitUpdateRecurringScheduleByStaff}>
						<div class="space-y-2">
							<Label for="recurring-edit-frequency">頻度</Label>
							<select
								id="recurring-edit-frequency"
								name="recurring_edit_frequency"
								class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
								bind:value={recurringEditForm.frequency}
							>
								<option value="weekly">weekly</option>
								<option value="monthly">monthly</option>
							</select>
						</div>
						<div class="space-y-2">
							<Label for="recurring-edit-interval">間隔</Label>
							<Input
								id="recurring-edit-interval"
								name="recurring_edit_interval"
								type="number"
								min="1"
								bind:value={recurringEditForm.interval}
								required
							/>
						</div>
						{#if recurringEditForm.frequency === 'weekly'}
							<div class="space-y-2 md:col-span-2">
								<Label for="recurring-edit-weekday">曜日（例: 月,水）</Label>
								<Input
									id="recurring-edit-weekday"
									name="recurring_edit_weekday"
									bind:value={recurringEditForm.byWeekday}
								/>
							</div>
						{:else}
							<div class="space-y-2 md:col-span-2">
								<Label for="recurring-edit-monthday">日付（1-31）</Label>
								<Input
									id="recurring-edit-monthday"
									name="recurring_edit_monthday"
									type="number"
									min="1"
									max="31"
									bind:value={recurringEditForm.byMonthday}
								/>
							</div>
						{/if}
						<div class="space-y-2">
							<Label for="recurring-edit-start-date">開始日</Label>
							<Input
								id="recurring-edit-start-date"
								name="recurring_edit_start_date"
								type="date"
								bind:value={recurringEditForm.startDate}
							/>
						</div>
						<div class="space-y-2">
							<Label for="recurring-edit-end-date">終了日</Label>
							<Input
								id="recurring-edit-end-date"
								name="recurring_edit_end_date"
								type="date"
								bind:value={recurringEditForm.endDate}
							/>
						</div>
						<div class="space-y-2">
							<Label for="recurring-edit-start-time">開始時刻</Label>
							<Input
								id="recurring-edit-start-time"
								name="recurring_edit_start_time"
								type="time"
								bind:value={recurringEditForm.startTimeLocal}
								required
							/>
						</div>
						<div class="space-y-2">
							<Label for="recurring-edit-duration">所要時間（分）</Label>
							<Input
								id="recurring-edit-duration"
								name="recurring_edit_duration"
								type="number"
								min="1"
								bind:value={recurringEditForm.durationMinutes}
							/>
						</div>
						<div class="space-y-2">
							<Label for="recurring-edit-capacity-override">定員上書き</Label>
							<Input
								id="recurring-edit-capacity-override"
								name="recurring_edit_capacity_override"
								type="number"
								min="1"
								bind:value={recurringEditForm.capacityOverride}
							/>
						</div>
						<div class="flex items-center gap-2 rounded-md border border-slate-200/80 bg-white px-3 py-2">
							<input
								id="recurring-edit-is-active"
								name="recurring_edit_is_active"
								type="checkbox"
								bind:checked={recurringEditForm.isActive}
							/>
							<Label for="recurring-edit-is-active">稼働中にする</Label>
						</div>
						<DialogFooter class="md:col-span-2">
							<Button
								type="button"
								variant="outline"
								disabled={busy || !!resourceAction}
								onclick={() => {
									recurringEditDialogOpen = false;
								}}
							>
								キャンセル
							</Button>
							<Button type="submit" disabled={busy || !!resourceAction || !recurringEditTargetId}>
								{isResourceActionInProgress('recurring_update', recurringEditTargetId)
									? '更新中…'
									: '更新'}
							</Button>
						</DialogFooter>
					</form>
				{:else}
					<p class="text-sm text-muted-foreground">編集対象の定期スケジュールが見つかりません。</p>
				{/if}
			</DialogContent>
		</Dialog>
	{/if}
</main>
