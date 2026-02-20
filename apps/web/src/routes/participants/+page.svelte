<script lang="ts">
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		actParticipantInvitation,
		createParticipantInvitation,
		loadParticipantFeatureData
	} from '$lib/features/invitations-participant.svelte';
	import {
		createTicketType,
		grantTicketPack,
		loadTicketManagementData,
		toIsoFromDateTimeLocal
	} from '$lib/features/tickets.svelte';
	import {
		getCurrentPathWithSearch,
		loadSession,
		redirectToLoginWithNext
	} from '$lib/features/auth-session.svelte';
	import { loadOrganizations } from '$lib/features/organization-context.svelte';
	import type {
		ParticipantInvitationPayload,
		ParticipantPayload,
		ServicePayload,
		TicketTypePayload
	} from '$lib/rpc-client';
	import { toast } from 'svelte-sonner';

	let loading = $state(true);
	let busy = $state(false);
	let activeOrganizationId = $state<string | null>(null);
	let canManage = $state(false);
	let participants = $state<ParticipantPayload[]>([]);
	let sentInvitations = $state<ParticipantInvitationPayload[]>([]);
	let receivedInvitations = $state<ParticipantInvitationPayload[]>([]);
	let services = $state<ServicePayload[]>([]);
	let ticketTypes = $state<TicketTypePayload[]>([]);
	let participantInvitationForm = $state({ email: '', participantName: '' });
	let ticketTypeForm = $state({
		name: '',
		totalCount: '10',
		expiresInDays: '',
		serviceIds: [] as string[]
	});
	let ticketGrantForm = $state({
		participantId: '',
		ticketTypeId: '',
		count: '',
		expiresAt: ''
	});

	const normalizeToText = (value: string | number): string => String(value).trim();

	const parsePositiveInteger = (value: string | number): number | undefined => {
		const normalized = normalizeToText(value);
		if (!normalized) {
			return undefined;
		}
		const parsed = Number(normalized);
		if (!Number.isInteger(parsed) || parsed <= 0) {
			return undefined;
		}
		return parsed;
	};

	const toggleTicketTypeService = (serviceId: string, checked: boolean) => {
		if (checked) {
			if (!ticketTypeForm.serviceIds.includes(serviceId)) {
				ticketTypeForm.serviceIds = [...ticketTypeForm.serviceIds, serviceId];
			}
			return;
		}
		ticketTypeForm.serviceIds = ticketTypeForm.serviceIds.filter(
			(current) => current !== serviceId
		);
	};

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

	const refresh = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}
		const { activeOrganization } = await loadOrganizations();
		activeOrganizationId = activeOrganization?.id ?? null;
		const participantData = await loadParticipantFeatureData(activeOrganizationId ?? undefined);
		const ticketData = await loadTicketManagementData(activeOrganizationId ?? undefined);
		participants = participantData.participants;
		sentInvitations = participantData.sent;
		receivedInvitations = participantData.received;
		services = ticketData.services;
		ticketTypes = ticketData.ticketTypes;
		canManage = participantData.canManage;
		if (ticketData.errors.length > 0) {
			toast.error(ticketData.errors[0]);
		}
	};

	const submitCreateParticipantInvitation = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!activeOrganizationId || !canManage) return;
		busy = true;
		try {
			const result = await createParticipantInvitation({
				email: participantInvitationForm.email,
				participantName: participantInvitationForm.participantName,
				organizationId: activeOrganizationId
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			participantInvitationForm = { email: '', participantName: '' };
			await refresh();
		} finally {
			busy = false;
		}
	};

	const submitResendParticipantInvitation = async (invitation: ParticipantInvitationPayload) => {
		if (!canManage) return;
		busy = true;
		try {
			const result = await createParticipantInvitation({
				email: invitation.email,
				participantName: invitation.participantName,
				organizationId: invitation.organizationId,
				resend: true
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

	const submitAction = async (type: 'accept' | 'reject' | 'cancel', invitationId: string) => {
		if ((type === 'cancel' || type === 'reject') && !confirm('この操作を実行しますか？')) {
			return;
		}
		busy = true;
		try {
			const result = await actParticipantInvitation(type, invitationId);
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

	const submitCreateTicketType = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!activeOrganizationId || !canManage) return;

		const totalCount = parsePositiveInteger(ticketTypeForm.totalCount);
		if (!totalCount) {
			toast.error('回数は 1 以上の整数で入力してください。');
			return;
		}

		const expiresInDays = parsePositiveInteger(ticketTypeForm.expiresInDays);
		if (normalizeToText(ticketTypeForm.expiresInDays) && !expiresInDays) {
			toast.error('有効日数は 1 以上の整数で入力してください。');
			return;
		}

		busy = true;
		try {
			const result = await createTicketType({
				organizationId: activeOrganizationId,
				name: ticketTypeForm.name,
				totalCount,
				expiresInDays,
				serviceIds: ticketTypeForm.serviceIds
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			ticketTypeForm = {
				name: '',
				totalCount: '10',
				expiresInDays: '',
				serviceIds: []
			};
			await refresh();
		} finally {
			busy = false;
		}
	};

	const submitGrantTicketPack = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!activeOrganizationId || !canManage) return;

		if (!ticketGrantForm.participantId) {
			toast.error('付与対象の参加者を選択してください。');
			return;
		}
		if (!ticketGrantForm.ticketTypeId) {
			toast.error('回数券種別を選択してください。');
			return;
		}

		const count = parsePositiveInteger(ticketGrantForm.count);
		if (normalizeToText(ticketGrantForm.count) && !count) {
			toast.error('付与回数は 1 以上の整数で入力してください。');
			return;
		}

		const expiresAt = toIsoFromDateTimeLocal(ticketGrantForm.expiresAt);
		if (normalizeToText(ticketGrantForm.expiresAt) && !expiresAt) {
			toast.error('有効期限の形式が不正です。');
			return;
		}

		busy = true;
		try {
			const result = await grantTicketPack({
				organizationId: activeOrganizationId,
				participantId: ticketGrantForm.participantId,
				ticketTypeId: ticketGrantForm.ticketTypeId,
				count,
				expiresAt
			});
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			ticketGrantForm = {
				participantId: '',
				ticketTypeId: '',
				count: '',
				expiresAt: ''
			};
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
		<h1 class="text-3xl font-semibold text-slate-900">参加者</h1>
		<p class="text-sm text-slate-600">参加者一覧・参加者招待・回数券管理を行います。</p>
	</header>

	{#if !activeOrganizationId}
		<Card class="surface-panel border-slate-200/80 shadow-lg"
			><CardContent class="py-6"
				><p class="text-sm text-muted-foreground">
					利用中の組織を `/dashboard` で選択してください。
				</p></CardContent
			></Card
		>
	{:else}
		<section class="grid gap-6 xl:grid-cols-[1fr_1fr]">
			<Card class="surface-panel border-slate-200/80 shadow-lg">
				<CardHeader><h2 class="text-xl font-semibold">参加者一覧</h2></CardHeader>
				<CardContent>
					{#if loading}
						<p class="text-sm text-muted-foreground">参加者を読み込み中…</p>
					{:else if participants.length === 0}
						<p class="text-sm text-muted-foreground">参加者はまだ登録されていません。</p>
					{:else}
						<div class="space-y-2">
							{#each participants as participant (participant.id)}
								<div class="rounded-lg border border-slate-200/80 bg-white/80 p-3">
									<p class="text-sm font-semibold">{participant.name}</p>
									<p class="text-xs text-muted-foreground">{participant.email}</p>
								</div>
							{/each}
						</div>
					{/if}
				</CardContent>
			</Card>

			<Card class="surface-panel border-slate-200/80 shadow-lg">
				<CardHeader
					><h2 class="text-xl font-semibold">参加者招待管理</h2>
					<CardDescription>作成・再送・取消・受信招待の処理。</CardDescription></CardHeader
				>
				<CardContent class="space-y-4">
					{#if !canManage}
						<p class="text-sm text-muted-foreground">
							参加者招待の管理には admin または owner 権限が必要です。
						</p>
					{:else}
						<form
							class="space-y-3 rounded-lg border border-slate-200/80 bg-white/80 p-4"
							onsubmit={submitCreateParticipantInvitation}
						>
							<h3 class="text-sm font-semibold">参加者招待を送信</h3>
							<div class="space-y-2">
								<Label for="participant-email">メールアドレス</Label><Input
									id="participant-email"
									name="participant_email"
									type="email"
									bind:value={participantInvitationForm.email}
									required
									spellcheck={false}
								/>
							</div>
							<div class="space-y-2">
								<Label for="participant-name">参加者名</Label><Input
									id="participant-name"
									name="participant_name"
									type="text"
									bind:value={participantInvitationForm.participantName}
									required
								/>
							</div>
							<Button type="submit" disabled={busy}>送信</Button>
						</form>
					{/if}

					<div class="space-y-2">
						<h3 class="text-sm font-semibold">送信済み参加者招待</h3>
						{#if sentInvitations.length === 0}
							<p class="text-sm text-muted-foreground">送信済み参加者招待はありません。</p>
						{:else}
							<div class="space-y-2">
								{#each sentInvitations as invitation (invitation.id)}
									<div
										class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white/80 p-3"
									>
										<div>
											<p class="text-sm font-semibold">{invitation.participantName}</p>
											<p class="text-xs text-muted-foreground">{invitation.email}</p>
										</div>
										<div class="flex items-center gap-2">
											<Badge variant={invitation.status === 'pending' ? 'outline' : 'secondary'}
												>{invitation.status}</Badge
											>
											<Button
												type="button"
												variant="outline"
												onclick={() => submitResendParticipantInvitation(invitation)}
												disabled={busy || invitation.status !== 'pending' || !canManage}
												>再送</Button
											>
											<Button
												type="button"
												variant="destructive"
												onclick={() => submitAction('cancel', invitation.id)}
												disabled={busy || invitation.status !== 'pending' || !canManage}
												>取り消し</Button
											>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>

					<div class="space-y-2">
						<h3 class="text-sm font-semibold">受信した参加者招待</h3>
						{#if receivedInvitations.length === 0}
							<p class="text-sm text-muted-foreground">受信した参加者招待はありません。</p>
						{:else}
							<div class="space-y-2">
								{#each receivedInvitations as invitation (invitation.id)}
									<div
										class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white/80 p-3"
									>
										<div>
											<p class="text-sm font-semibold">{invitation.participantName}</p>
											<p class="text-xs text-muted-foreground">
												{invitation.organizationName ?? invitation.organizationId} / {invitation.status}
											</p>
										</div>
										<div class="flex items-center gap-2">
											<Button
												type="button"
												variant="secondary"
												onclick={() => submitAction('accept', invitation.id)}
												disabled={busy || invitation.status !== 'pending'}>承諾</Button
											><Button
												type="button"
												variant="outline"
												onclick={() => submitAction('reject', invitation.id)}
												disabled={busy || invitation.status !== 'pending'}>辞退</Button
											>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</CardContent>
			</Card>
		</section>

		<section>
			<Card class="surface-panel border-slate-200/80 shadow-lg">
				<CardHeader>
					<h2 class="text-xl font-semibold">回数券管理</h2>
					<CardDescription>回数券種別の作成と参加者への付与を行います。</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if !canManage}
						<p class="text-sm text-muted-foreground">
							回数券管理には admin または owner 権限が必要です。
						</p>
					{:else}
						<section class="grid gap-4 xl:grid-cols-[1fr_1fr]">
							<form
								class="space-y-3 rounded-lg border border-slate-200/80 bg-white/80 p-4"
								onsubmit={submitCreateTicketType}
							>
								<h3 class="text-sm font-semibold">回数券種別作成</h3>
								<div class="space-y-2">
									<Label for="ticket-type-name">券種名</Label>
									<Input
										id="ticket-type-name"
										name="ticket_type_name"
										type="text"
										bind:value={ticketTypeForm.name}
										required
									/>
								</div>
								<div class="space-y-2">
									<Label for="ticket-type-total-count">回数</Label>
									<Input
										id="ticket-type-total-count"
										name="ticket_type_total_count"
										type="number"
										min="1"
										bind:value={ticketTypeForm.totalCount}
										required
									/>
								</div>
								<div class="space-y-2">
									<Label for="ticket-type-expires-in-days">有効日数（任意）</Label>
									<Input
										id="ticket-type-expires-in-days"
										name="ticket_type_expires_in_days"
										type="number"
										min="1"
										bind:value={ticketTypeForm.expiresInDays}
									/>
								</div>
								<div class="space-y-2">
									<p class="text-sm font-medium">対象サービス（任意）</p>
									{#if services.length === 0}
										<p class="text-sm text-muted-foreground">選択可能なサービスがありません。</p>
									{:else}
										<div
											class="max-h-40 space-y-2 overflow-y-auto rounded-md border border-slate-200/80 bg-slate-50/60 p-2"
										>
											{#each services as service (service.id)}
												<label
													class="flex items-center gap-2 text-sm text-slate-700"
													for={`ticket-service-${service.id}`}
												>
													<input
														id={`ticket-service-${service.id}`}
														name={`ticket_service_${service.id}`}
														type="checkbox"
														checked={ticketTypeForm.serviceIds.includes(service.id)}
														onchange={(event) =>
															toggleTicketTypeService(
																service.id,
																(event.currentTarget as HTMLInputElement).checked
															)}
													/>
													<span>{service.name}</span>
												</label>
											{/each}
										</div>
									{/if}
								</div>
								<Button type="submit" disabled={busy}>作成</Button>
							</form>

							<form
								class="space-y-3 rounded-lg border border-slate-200/80 bg-white/80 p-4"
								onsubmit={submitGrantTicketPack}
							>
								<h3 class="text-sm font-semibold">回数券付与</h3>
								<div class="space-y-2">
									<Label for="ticket-grant-participant">付与先参加者</Label>
									<select
										id="ticket-grant-participant"
										name="ticket_grant_participant"
										class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
										bind:value={ticketGrantForm.participantId}
										required
									>
										<option value="" disabled>参加者を選択</option>
										{#each participants as participant (participant.id)}
											<option value={participant.id}
												>{participant.name} / {participant.email}</option
											>
										{/each}
									</select>
								</div>
								<div class="space-y-2">
									<Label for="ticket-grant-type">回数券種別</Label>
									<select
										id="ticket-grant-type"
										name="ticket_grant_type"
										class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
										bind:value={ticketGrantForm.ticketTypeId}
										required
									>
										<option value="" disabled>回数券種別を選択</option>
										{#each ticketTypes as ticketType (ticketType.id)}
											<option value={ticketType.id}
												>{ticketType.name} / {ticketType.totalCount}回</option
											>
										{/each}
									</select>
								</div>
								<div class="space-y-2">
									<Label for="ticket-grant-count">付与回数（任意）</Label>
									<Input
										id="ticket-grant-count"
										name="ticket_grant_count"
										type="number"
										min="1"
										bind:value={ticketGrantForm.count}
									/>
								</div>
								<div class="space-y-2">
									<Label for="ticket-grant-expires-at">有効期限（任意）</Label>
									<Input
										id="ticket-grant-expires-at"
										name="ticket_grant_expires_at"
										type="datetime-local"
										bind:value={ticketGrantForm.expiresAt}
									/>
								</div>
								<Button type="submit" disabled={busy}>付与</Button>
							</form>
						</section>

						<section class="space-y-2">
							<h3 class="text-sm font-semibold">回数券種別一覧</h3>
							{#if ticketTypes.length === 0}
								<p class="text-sm text-muted-foreground">回数券種別はまだ作成されていません。</p>
							{:else}
								<div class="space-y-2">
									{#each ticketTypes as ticketType (ticketType.id)}
										<div
											class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white/80 p-3"
										>
											<div>
												<p class="text-sm font-semibold">{ticketType.name}</p>
												<p class="text-xs text-muted-foreground">
													回数: {ticketType.totalCount} / 有効日数: {ticketType.expiresInDays ??
														'無期限'} / 対象サービス: {ticketType.serviceIds?.length ?? 0}件
												</p>
												<p class="text-xs text-muted-foreground">
													作成: {formatDateTime(ticketType.createdAt)}
												</p>
											</div>
											<Badge variant={ticketType.isActive ? 'outline' : 'secondary'}>
												{ticketType.isActive ? 'active' : 'inactive'}
											</Badge>
										</div>
									{/each}
								</div>
							{/if}
						</section>
					{/if}
				</CardContent>
			</Card>
		</section>
	{/if}
</main>
