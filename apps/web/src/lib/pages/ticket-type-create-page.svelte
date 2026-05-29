<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import PremiumRestrictionNotice from '$lib/components/premium-restriction-notice.svelte';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { loadOrganizationBilling } from '$lib/features/organization-context.svelte';
	import { loadTicketManagementPageData } from '$lib/features/ticket-management-page.svelte';
	import { createTicketType } from '$lib/features/tickets.svelte';
	import {
		getCurrentPathWithSearch,
		loadSession,
		redirectToLoginWithNext
	} from '$lib/features/auth-session.svelte';
	import type { OrganizationPremiumRestrictionPayload } from '$lib/features/premium-restrictions';
	import type { OrganizationBillingPayload, ServicePayload } from '$lib/rpc-client';
	import { toast } from 'svelte-sonner';

	let loading = $state(true);
	let busy = $state(false);
	let activeOrganizationId = $state<string | null>(null);
	let canManageStore = $state(false);
	let billing = $state<OrganizationBillingPayload | null>(null);
	let premiumRestriction = $state<OrganizationPremiumRestrictionPayload | null>(null);
	let services = $state<ServicePayload[]>([]);
	let ticketTypeForm = $state({
		name: '',
		totalCount: '10',
		expiresInDays: '',
		serviceScope: 'all' as 'all' | 'specific',
		serviceIds: [] as string[],
		isForSale: false
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
	const toExceptionMessage = (error: unknown, fallback: string): string => {
		if (error instanceof Error && error.message) {
			return error.message;
		}
		return fallback;
	};
	const navigateToTicketManagement = () => {
		void goto(resolve('/admin/tickets'));
	};
	const resetTicketTypeCreateViewState = () => {
		activeOrganizationId = null;
		canManageStore = false;
		billing = null;
		premiumRestriction = null;
		services = [];
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

	const refresh = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}
		try {
			const data = await loadTicketManagementPageData();
			if (data.loadError) {
				toast.error(data.loadError);
			}
			if (!data.activeContext) {
				resetTicketTypeCreateViewState();
				return;
			}
			activeOrganizationId = data.organizationId;
			canManageStore = data.canManageStore;
			premiumRestriction = data.premiumRestriction ?? null;
			services = data.services;
			if (data.premiumRestriction && data.organizationId) {
				const billingResult = await loadOrganizationBilling(data.organizationId);
				billing = billingResult.ok ? billingResult.billing : null;
			} else {
				billing = null;
			}
		} catch (error) {
			resetTicketTypeCreateViewState();
			toast.error(toExceptionMessage(error, '回数券種別作成データの取得に失敗しました。'));
		}
	};

	const submitCreateTicketType = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!activeOrganizationId || !canManageStore || premiumRestriction) return;

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
		if (ticketTypeForm.serviceScope === 'specific' && ticketTypeForm.serviceIds.length === 0) {
			toast.error('対象サービスを 1 件以上選択してください。');
			return;
		}

		busy = true;
		try {
			const result = await createTicketType({
				organizationId: activeOrganizationId,
				name: ticketTypeForm.name,
				totalCount,
				expiresInDays,
				serviceScope: ticketTypeForm.serviceScope,
				serviceIds: ticketTypeForm.serviceScope === 'specific' ? ticketTypeForm.serviceIds : [],
				isForSale: ticketTypeForm.isForSale
			});
			if (!result.ok) {
				if (result.premiumRestriction) {
					premiumRestriction = result.premiumRestriction;
				}
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			await goto(resolve('/admin/tickets'));
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
	<header class="flex flex-wrap items-start justify-between gap-3">
		<div class="space-y-2">
			<h1 class="text-3xl font-semibold text-foreground">回数券種別作成</h1>
			<p class="text-sm text-muted-foreground">回数券管理に追加する券種を作成します。</p>
		</div>
		<Button type="button" variant="outline" onclick={navigateToTicketManagement}>
			回数券管理へ戻る
		</Button>
	</header>

	{#if loading}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">回数券種別作成データを読み込み中…</p>
			</CardContent>
		</Card>
	{:else if !activeOrganizationId}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">
					利用中の組織を `/admin/dashboard` で選択してください。
				</p>
			</CardContent>
		</Card>
	{:else}
		{#if premiumRestriction}
			<PremiumRestrictionNotice
				featureLabel="回数券管理"
				restriction={premiumRestriction}
				{billing}
			/>
		{/if}

		<section class="mx-auto w-full max-w-4xl">
			<Card class="surface-panel w-full border-border/80 shadow-lg">
				<CardHeader>
					<h2 class="text-lg font-semibold">回数券種別作成</h2>
					<CardDescription>販売可否と対象サービスを指定します。</CardDescription>
				</CardHeader>
				<CardContent>
					{#if premiumRestriction}
						<p class="text-sm text-muted-foreground">
							回数券管理は Premium 利用開始後に利用できます。
						</p>
					{:else if !canManageStore}
						<p class="text-sm text-muted-foreground">
							回数券種別の作成には店舗管理権限が必要です。
						</p>
					{:else}
						<form class="grid gap-4 md:grid-cols-2" onsubmit={submitCreateTicketType}>
							<div class="space-y-2 md:col-span-2">
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
							<div
								class="flex items-center gap-2 rounded-md border border-border/80 bg-secondary/60 px-3 py-2 md:col-span-2"
							>
								<input
									id="ticket-type-is-for-sale"
									name="ticket_type_is_for_sale"
									type="checkbox"
									bind:checked={ticketTypeForm.isForSale}
								/>
								<Label for="ticket-type-is-for-sale">参加者が購入できるようにする</Label>
							</div>
							<fieldset class="space-y-2 md:col-span-2">
								<legend class="text-sm font-medium">対象サービス</legend>
								<div class="grid gap-2 sm:grid-cols-2">
									<label
										class="flex items-center gap-2 rounded-md border border-border/80 bg-secondary/60 px-3 py-2 text-sm"
										for="ticket-service-scope-all"
									>
										<input
											id="ticket-service-scope-all"
											name="ticket_service_scope"
											type="radio"
											value="all"
											bind:group={ticketTypeForm.serviceScope}
										/>
										<span>すべてのサービス</span>
									</label>
									<label
										class="flex items-center gap-2 rounded-md border border-border/80 bg-secondary/60 px-3 py-2 text-sm"
										for="ticket-service-scope-specific"
									>
										<input
											id="ticket-service-scope-specific"
											name="ticket_service_scope"
											type="radio"
											value="specific"
											bind:group={ticketTypeForm.serviceScope}
										/>
										<span>サービスを個別指定</span>
									</label>
								</div>
								{#if ticketTypeForm.serviceScope === 'specific'}
									{#if services.length === 0}
										<p class="text-sm text-muted-foreground">選択可能なサービスがありません。</p>
									{:else}
										<div
											class="max-h-52 space-y-2 overflow-y-auto rounded-md border border-border/80 bg-secondary/60 p-2"
										>
											{#each services as service (service.id)}
												<label
													class="flex items-center gap-2 text-sm text-secondary-foreground"
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
								{/if}
							</fieldset>
							<div
								class="sticky bottom-2 z-10 rounded-lg border border-border/80 bg-card/95 p-3 shadow-sm backdrop-blur md:col-span-2"
							>
								<Button
									type="submit"
									disabled={busy ||
										(ticketTypeForm.serviceScope === 'specific' &&
											ticketTypeForm.serviceIds.length === 0)}
								>
									作成する
								</Button>
							</div>
						</form>
					{/if}
				</CardContent>
			</Card>
		</section>
	{/if}
</main>
