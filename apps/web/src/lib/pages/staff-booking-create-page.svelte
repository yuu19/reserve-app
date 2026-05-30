<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { formatJaDateTime } from '$lib/date/format';
	import {
		createStaffBooking,
		formatTimeLabel,
		getMonthDateRange,
		loadAdminBookingsOperationsData,
		toDayBoundaryIso
	} from '$lib/features/bookings.svelte';
	import { preserveScopedRouteContext } from '$lib/features/scoped-routing';
	import type {
		BookingSource,
		ParticipantPayload,
		ServicePayload,
		SlotPayload
	} from '$lib/rpc-client';
	import { toast } from 'svelte-sonner';

	type ResolvablePath = Pathname;

	let loading = $state(true);
	let busy = $state(false);
	let canManage = $state(false);
	let errorMessage = $state<string | null>(null);
	let services = $state<ServicePayload[]>([]);
	let slots = $state<SlotPayload[]>([]);
	let participants = $state<ParticipantPayload[]>([]);
	let form = $state({
		slotId: '',
		participantId: '',
		customerName: '',
		customerEmail: '',
		customerPhone: '',
		participantsCount: '1',
		source: 'phone' as BookingSource,
		notifyCustomer: false,
		companionNames: '',
		note: ''
	});

	const bookingsPath = $derived(
		preserveScopedRouteContext('/admin/bookings', page.url.pathname) as ResolvablePath
	);
	const serviceNameById = $derived.by(() => {
		const names: Record<string, string> = {};
		for (const service of services) {
			names[service.id] = service.name;
		}
		return names;
	});
	const availableSlots = $derived.by(() =>
		slots
			.filter(
				(slot) =>
					slot.status === 'open' &&
					slot.reservedCount < slot.capacity &&
					new Date(slot.startAt).getTime() > Date.now()
			)
			.sort((left, right) => left.startAt.localeCompare(right.startAt))
	);

	const updateField = (field: keyof typeof form, event: Event) => {
		const target = event.currentTarget as
			| HTMLInputElement
			| HTMLSelectElement
			| HTMLTextAreaElement;
		if (field === 'notifyCustomer') {
			form.notifyCustomer = (target as HTMLInputElement).checked;
			return;
		}
		form[field] = target.value as never;
	};

	const buildCompanions = () =>
		form.companionNames
			.split('\n')
			.map((name) => name.trim())
			.filter((name) => name.length > 0)
			.map((name) => ({ name }));

	const refresh = async () => {
		const { fromDate, toDate } = getMonthDateRange(new Date());
		const from = toDayBoundaryIso(fromDate, false);
		const to = toDayBoundaryIso(toDate, true);
		if (!from || !to) {
			throw new Error('検索期間の日付形式が正しくありません。');
		}

		const data = await loadAdminBookingsOperationsData(from, to);
		canManage = data.canManage;
		services = data.services;
		slots = data.slots;
		participants = data.staffParticipants;
		if (!form.slotId && availableSlots[0]) {
			form.slotId = availableSlots[0].id;
		}
	};

	const submit = async () => {
		if (busy) {
			return;
		}
		const participantsCount = Number(form.participantsCount);
		if (!Number.isInteger(participantsCount) || participantsCount <= 0) {
			toast.error('人数は1以上の整数で入力してください。');
			return;
		}
		if (!form.participantId && (!form.customerName.trim() || !form.customerEmail.trim())) {
			toast.error('既存参加者を選ばない場合は氏名とメールアドレスが必要です。');
			return;
		}

		busy = true;
		try {
			const result = await createStaffBooking({
				slotId: form.slotId,
				participantId: form.participantId || undefined,
				customerName: form.customerName || undefined,
				customerEmail: form.customerEmail || undefined,
				customerPhone: form.customerPhone || undefined,
				participantsCount,
				source: form.source,
				notifyCustomer: form.notifyCustomer,
				companions: buildCompanions(),
				note: form.note || undefined
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await goto(resolve(bookingsPath));
		} finally {
			busy = false;
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
					error instanceof Error ? error.message : '代理予約ページの読み込みに失敗しました。';
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-3">
		<Button type="button" variant="ghost" href={resolve(bookingsPath)}>予約管理へ戻る</Button>
		<div class="space-y-2">
			<h1 class="text-3xl font-semibold text-foreground">代理予約</h1>
			<p class="text-sm text-muted-foreground">
				電話、LINE、店頭で受けた予約をスタッフが登録します。
			</p>
		</div>
	</header>

	<Card class="surface-panel border-border/80 shadow-lg">
		<CardHeader>
			<h2 class="text-xl font-semibold text-foreground">予約内容</h2>
			<CardDescription>作成した予約は確定予約として登録されます。</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			{#if loading}
				<p class="text-sm text-muted-foreground">予約枠を読み込み中…</p>
			{:else if errorMessage}
				<p class="text-sm text-destructive">{errorMessage}</p>
			{:else if !canManage}
				<p class="text-sm text-muted-foreground">代理予約には予約管理権限が必要です。</p>
			{:else}
				<form
					class="grid gap-4 md:grid-cols-2"
					onsubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<div class="space-y-2 md:col-span-2">
						<Label for="staff-booking-slot">予約枠</Label>
						<select
							id="staff-booking-slot"
							name="slot_id"
							class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
							value={form.slotId}
							onchange={(event) => updateField('slotId', event)}
							disabled={busy}
							required
						>
							<option value="">選択してください</option>
							{#each availableSlots as slot (slot.id)}
								<option value={slot.id}>
									{formatJaDateTime(slot.startAt)} - {formatTimeLabel(slot.endAt)} /
									{serviceNameById[slot.serviceId] ?? slot.serviceId} / 残
									{slot.capacity - slot.reservedCount}
								</option>
							{/each}
						</select>
					</div>
					<div class="space-y-2">
						<Label for="staff-booking-participant">既存参加者</Label>
						<select
							id="staff-booking-participant"
							name="participant_id"
							class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
							value={form.participantId}
							onchange={(event) => updateField('participantId', event)}
							disabled={busy}
						>
							<option value="">顧客情報を直接入力</option>
							{#each participants as participant (participant.id)}
								<option value={participant.id}>{participant.name} / {participant.email}</option>
							{/each}
						</select>
					</div>
					<div class="space-y-2">
						<Label for="staff-booking-source">流入元</Label>
						<select
							id="staff-booking-source"
							name="source"
							class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
							value={form.source}
							onchange={(event) => updateField('source', event)}
							disabled={busy}
						>
							<option value="phone">電話</option>
							<option value="line">LINE</option>
							<option value="storefront">店頭</option>
							<option value="admin">管理画面</option>
							<option value="other">その他</option>
						</select>
					</div>
					<div class="space-y-2">
						<Label for="staff-booking-name">氏名</Label>
						<Input
							id="staff-booking-name"
							name="customer_name"
							type="text"
							value={form.customerName}
							oninput={(event) => updateField('customerName', event)}
							disabled={busy}
							maxlength={120}
						/>
					</div>
					<div class="space-y-2">
						<Label for="staff-booking-email">メールアドレス</Label>
						<Input
							id="staff-booking-email"
							name="customer_email"
							type="email"
							value={form.customerEmail}
							oninput={(event) => updateField('customerEmail', event)}
							disabled={busy}
							maxlength={320}
						/>
					</div>
					<div class="space-y-2">
						<Label for="staff-booking-phone">電話番号</Label>
						<Input
							id="staff-booking-phone"
							name="customer_phone"
							type="tel"
							value={form.customerPhone}
							oninput={(event) => updateField('customerPhone', event)}
							disabled={busy}
							maxlength={80}
						/>
					</div>
					<div class="space-y-2">
						<Label for="staff-booking-count">人数</Label>
						<Input
							id="staff-booking-count"
							name="participants_count"
							type="number"
							min="1"
							value={form.participantsCount}
							oninput={(event) => updateField('participantsCount', event)}
							disabled={busy}
							required
						/>
					</div>
					<div class="space-y-2 md:col-span-2">
						<Label for="staff-booking-companions">同伴者</Label>
						<textarea
							id="staff-booking-companions"
							name="companions"
							class="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
							value={form.companionNames}
							oninput={(event) => updateField('companionNames', event)}
							disabled={busy}
						></textarea>
					</div>
					<div class="space-y-2 md:col-span-2">
						<Label for="staff-booking-note">備考</Label>
						<textarea
							id="staff-booking-note"
							name="note"
							class="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
							value={form.note}
							oninput={(event) => updateField('note', event)}
							disabled={busy}
							maxlength={1000}
						></textarea>
					</div>
					<label class="flex items-center gap-2 text-sm text-foreground md:col-span-2">
						<input
							type="checkbox"
							checked={form.notifyCustomer}
							onchange={(event) => updateField('notifyCustomer', event)}
							disabled={busy}
						/>
						予約確認メールを送る
					</label>
					<div class="flex flex-wrap gap-2 md:col-span-2">
						<Button type="submit" disabled={busy || !form.slotId}>
							{busy ? '作成中…' : '代理予約を作成'}
						</Button>
					</div>
				</form>
			{/if}
		</CardContent>
	</Card>
</main>
