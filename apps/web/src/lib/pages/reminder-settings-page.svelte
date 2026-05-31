<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import {
		buildScopedPath,
		extractScopedRouteContext,
		getRoutePathFromUrlPath,
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
	import { loadReminderSettings, updateReminderSettings } from '$lib/features/reminder-settings';
	import type { ReminderSettingsPayload } from '$lib/rpc-client';

	type ResolvablePath = Pathname;
	type TimingMinutes = 1440 | 180;
	type FormState = {
		enabled: boolean;
		timings: Record<TimingMinutes, boolean>;
	};

	const timingOptions: Array<{
		value: TimingMinutes;
		label: string;
		description: string;
	}> = [
		{
			value: 1440,
			label: '開始24時間前',
			description: '前日に予約日時を知らせるメールを送ります。'
		},
		{
			value: 180,
			label: '開始3時間前',
			description: '当日に近づいた予約だけへ直前確認メールを送ります。'
		}
	];

	let loading = $state(true);
	let busy = $state(false);
	let errorMessage = $state<string | null>(null);
	let currentContext = $state<ScopedRouteContext | null>(null);
	let settings = $state<ReminderSettingsPayload | null>(null);
	let form = $state<FormState>({
		enabled: true,
		timings: {
			1440: true,
			180: false
		}
	});

	const routePathname = $derived(getRoutePathFromUrlPath(page.url.pathname));
	const routeScopedContext = $derived(extractScopedRouteContext(page.url.pathname));
	const notificationSettingsPath = $derived(
		currentContext ? buildScopedPath(currentContext, '/admin/notification-settings') : null
	);
	const toScopedRoute = (targetPath: string): ResolvablePath =>
		preserveScopedRouteContext(targetPath, page.url.pathname) as ResolvablePath;

	const applySettingsToForm = (nextSettings: ReminderSettingsPayload) => {
		const timings = new Set(nextSettings.timingsMinutes);
		form = {
			enabled: nextSettings.enabled,
			timings: {
				1440: timings.has(1440),
				180: timings.has(180)
			}
		};
	};

	const updateEnabled = (event: Event) => {
		form.enabled = (event.currentTarget as HTMLInputElement).checked;
	};

	const updateTiming = (value: TimingMinutes, event: Event) => {
		form.timings = {
			...form.timings,
			[value]: (event.currentTarget as HTMLInputElement).checked
		};
	};

	const selectedTimings = () =>
		timingOptions.filter((option) => form.timings[option.value]).map((option) => option.value);

	const formatTiming = (value: number) => {
		const option = timingOptions.find((entry) => entry.value === value);
		return option?.label ?? `${value}分前`;
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
			settings = null;
			return;
		}

		const nextSettings = await loadReminderSettings(context);
		if (!nextSettings) {
			errorMessage = 'リマインド設定の取得に失敗しました。';
			settings = null;
			return;
		}

		settings = nextSettings;
		applySettingsToForm(nextSettings);
	};

	const submit = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!currentContext) {
			return;
		}

		const timingsMinutes = selectedTimings();
		if (timingsMinutes.length === 0) {
			toast.error('送信タイミングを1つ以上選択してください。');
			return;
		}

		busy = true;
		try {
			const result = await updateReminderSettings(currentContext, {
				enabled: form.enabled,
				timingsMinutes
			});
			if (!result.ok || !result.settings) {
				toast.error(result.message);
				return;
			}

			settings = result.settings;
			applySettingsToForm(result.settings);
			toast.success(result.message);
		} finally {
			busy = false;
		}
	};

	onMount(() => {
		void (async () => {
			loading = true;
			errorMessage = null;
			try {
				if (routePathname === '/reminder-settings') {
					await goto(resolve(toScopedRoute('/admin/reminder-settings')));
					return;
				}
				await refresh();
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold text-foreground">リマインド設定</h1>
		<p class="text-sm text-muted-foreground">
			予約開始前に予約者へ送るリマインドメールの有効状態と送信タイミングを店舗ごとに管理します。
		</p>
	</header>

	{#if loading}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">リマインド設定を読み込み中…</p>
			</CardContent>
		</Card>
	{:else if !currentContext}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardHeader>
				<h2 class="text-xl font-semibold text-foreground">店舗を選択してください</h2>
				<CardDescription>リマインド設定は店舗ごとに管理します。</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<p class="text-sm text-muted-foreground">
					店舗を選択した管理画面からリマインド設定を編集できます。
				</p>
				<Button type="button" variant="outline" href={resolve(toScopedRoute('/admin/stores'))}>
					店舗管理へ移動
				</Button>
			</CardContent>
		</Card>
	{:else if errorMessage}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-destructive">{errorMessage}</p>
			</CardContent>
		</Card>
	{:else}
		<section class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)]">
			<Card class="surface-panel border-border/80 shadow-lg">
				<CardHeader class="space-y-2">
					<h2 class="text-xl font-semibold text-foreground">予約者向けリマインド</h2>
					<CardDescription>保存した送信タイミングは停止中でも保持されます。</CardDescription>
				</CardHeader>
				<CardContent>
					<form class="space-y-5" onsubmit={submit}>
						<fieldset class="space-y-3 rounded-lg border border-border/80 bg-card/80 p-4">
							<legend class="px-1 text-sm font-semibold text-foreground">有効状態</legend>
							<label class="flex items-start gap-3 rounded-md border border-border/70 bg-background/70 p-3">
								<input
									type="checkbox"
									aria-label="リマインドメールを送信する"
									class="mt-1 size-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
									checked={form.enabled}
									onchange={updateEnabled}
									disabled={busy}
								/>
								<span class="min-w-0 space-y-1">
									<span class="block text-sm font-medium text-foreground">
										リマインドメールを送信する
									</span>
									<span class="block text-xs text-muted-foreground">
										停止中は選択済みの送信タイミングを保持したまま送信対象から外します。
									</span>
								</span>
							</label>
						</fieldset>

						<fieldset class="space-y-3 rounded-lg border border-border/80 bg-card/80 p-4">
							<legend class="px-1 text-sm font-semibold text-foreground">送信タイミング</legend>
							{#each timingOptions as option (option.value)}
								<label
									class="flex items-start gap-3 rounded-md border border-border/70 bg-background/70 p-3"
								>
									<input
										type="checkbox"
										aria-label={option.label}
										class="mt-1 size-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
										checked={form.timings[option.value]}
										onchange={(event) => updateTiming(option.value, event)}
										disabled={busy}
									/>
									<span class="min-w-0 space-y-1">
										<span class="block text-sm font-medium text-foreground">{option.label}</span>
										<span class="block text-xs text-muted-foreground">{option.description}</span>
									</span>
								</label>
							{/each}
						</fieldset>

						<div class="flex flex-wrap gap-2">
							<Button type="submit" disabled={busy}>保存</Button>
							<Button type="button" variant="outline" onclick={refresh} disabled={busy}>
								最新化
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>

			<Card class="surface-panel border-border/80 shadow-lg">
				<CardHeader class="space-y-2">
					<h2 class="text-lg font-semibold text-foreground">現在の設定</h2>
					<CardDescription>予約者へ送るメールリマインドの保存状態です。</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<div class="space-y-2 rounded-lg border border-border/80 bg-card/80 p-4">
						<p class="text-sm font-medium text-foreground">
							{settings?.enabled ? '送信中' : '停止中'}
						</p>
						<p class="text-xs text-muted-foreground">
							{settings?.enabled
								? '予約開始前の対象予約へメールを送ります。'
								: '予約者へのリマインドメールは送信されません。'}
						</p>
					</div>

					<div class="space-y-2 rounded-lg border border-border/80 bg-card/80 p-4">
						<h3 class="text-sm font-semibold text-foreground">送信タイミング</h3>
						{#if settings?.timingsMinutes.length}
							<ul class="space-y-2">
								{#each settings.timingsMinutes as timing (timing)}
									<li class="rounded-md border border-border/80 bg-background/70 px-3 py-2 text-sm">
										{formatTiming(timing)}
									</li>
								{/each}
							</ul>
						{:else}
							<p class="text-sm text-muted-foreground">送信タイミングは未設定です。</p>
						{/if}
					</div>

					<Button
						type="button"
						variant="outline"
						href={notificationSettingsPath
							? resolve(notificationSettingsPath as ResolvablePath)
							: undefined}
						disabled={!notificationSettingsPath}
					>
						通知先設定へ移動
					</Button>
				</CardContent>
			</Card>
		</section>
	{/if}
</main>
