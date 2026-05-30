<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { Label } from '$lib/components/ui/label';
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
	import {
		loadNotificationSettings,
		updateNotificationSettings
	} from '$lib/features/notification-settings';
	import type { NotificationSettingsPayload } from '$lib/rpc-client';

	type ResolvablePath = Pathname;
	type FormState = {
		notifyOwner: boolean;
		notifyAdmins: boolean;
		notifyStoreManagers: boolean;
		notifyStaff: boolean;
		additionalEmailsText: string;
	};

	let loading = $state(true);
	let busy = $state(false);
	let errorMessage = $state<string | null>(null);
	let currentContext = $state<ScopedRouteContext | null>(null);
	let settings = $state<NotificationSettingsPayload | null>(null);
	let form = $state<FormState>({
		notifyOwner: true,
		notifyAdmins: true,
		notifyStoreManagers: true,
		notifyStaff: false,
		additionalEmailsText: ''
	});

	const routePathname = $derived(getRoutePathFromUrlPath(page.url.pathname));
	const routeScopedContext = $derived(extractScopedRouteContext(page.url.pathname));
	const publicSiteAdminPath = $derived(
		currentContext ? buildScopedPath(currentContext, '/admin/public-site') : null
	);
	const toScopedRoute = (targetPath: string): ResolvablePath =>
		preserveScopedRouteContext(targetPath, page.url.pathname) as ResolvablePath;

	const roleOptions: Array<{
		key: 'notifyOwner' | 'notifyAdmins' | 'notifyStoreManagers' | 'notifyStaff';
		label: string;
		description: string;
	}> = [
		{
			key: 'notifyOwner',
			label: 'owner に通知',
			description: '組織 owner のメールアドレスを通知先に含めます。'
		},
		{
			key: 'notifyAdmins',
			label: 'admin に通知',
			description: '組織 admin のメールアドレスを通知先に含めます。'
		},
		{
			key: 'notifyStoreManagers',
			label: '店舗 manager に通知',
			description: '対象店舗の manager を通知先に含めます。'
		},
		{
			key: 'notifyStaff',
			label: '店舗 staff に通知',
			description: '対象店舗の staff を通知先に含めます。'
		}
	];

	const applySettingsToForm = (nextSettings: NotificationSettingsPayload) => {
		form = {
			notifyOwner: nextSettings.notifyOwner,
			notifyAdmins: nextSettings.notifyAdmins,
			notifyStoreManagers: nextSettings.notifyStoreManagers,
			notifyStaff: nextSettings.notifyStaff,
			additionalEmailsText: nextSettings.additionalEmails.join('\n')
		};
	};

	const updateRole = (key: (typeof roleOptions)[number]['key'], event: Event) => {
		form[key] = (event.currentTarget as HTMLInputElement).checked;
	};

	const updateAdditionalEmails = (event: Event) => {
		form.additionalEmailsText = (event.currentTarget as HTMLTextAreaElement).value;
	};

	const splitAdditionalEmails = () =>
		form.additionalEmailsText
			.split(/\r?\n/u)
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);

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

		const nextSettings = await loadNotificationSettings(context);
		if (!nextSettings) {
			errorMessage = '通知先設定の取得に失敗しました。';
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

		busy = true;
		try {
			const result = await updateNotificationSettings(currentContext, {
				notifyOwner: form.notifyOwner,
				notifyAdmins: form.notifyAdmins,
				notifyStoreManagers: form.notifyStoreManagers,
				notifyStaff: form.notifyStaff,
				additionalEmails: splitAdditionalEmails()
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
				if (routePathname === '/notification-settings') {
					await goto(resolve(toScopedRoute('/admin/notification-settings')));
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
		<h1 class="text-3xl font-semibold text-foreground">通知先設定</h1>
		<p class="text-sm text-muted-foreground">
			予約作成・承認・キャンセル時に運営側へ送るメール通知の宛先を店舗ごとに管理します。
		</p>
	</header>

	{#if loading}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">通知先設定を読み込み中…</p>
			</CardContent>
		</Card>
	{:else if !currentContext}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardHeader>
				<h2 class="text-xl font-semibold text-foreground">店舗を選択してください</h2>
				<CardDescription>通知先は店舗ごとに管理します。</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<p class="text-sm text-muted-foreground">
					店舗を選択した管理画面から通知先設定を編集できます。
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
		<section class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.6fr)]">
			<Card class="surface-panel border-border/80 shadow-lg">
				<CardHeader class="space-y-2">
					<h2 class="text-xl font-semibold text-foreground">通知ロール</h2>
					<CardDescription>予約通知メールに含める運営ロールを選択します。</CardDescription>
				</CardHeader>
				<CardContent>
					<form class="space-y-5" onsubmit={submit}>
						<fieldset class="space-y-3 rounded-lg border border-border/80 bg-card/80 p-4">
							<legend class="px-1 text-sm font-semibold text-foreground">ロール通知</legend>
							{#each roleOptions as option (option.key)}
								<label
									class="flex items-start gap-3 rounded-md border border-border/70 bg-background/70 p-3"
								>
									<input
										type="checkbox"
										aria-label={option.label}
										class="mt-1 size-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
										checked={form[option.key]}
										onchange={(event) => updateRole(option.key, event)}
										disabled={busy}
									/>
									<span class="min-w-0 space-y-1">
										<span class="block text-sm font-medium text-foreground">{option.label}</span>
										<span class="block text-xs text-muted-foreground">{option.description}</span>
									</span>
								</label>
							{/each}
						</fieldset>

						<div class="space-y-2 rounded-lg border border-border/80 bg-card/80 p-4">
							<Label for="additional-emails">追加メールアドレス</Label>
							<textarea
								id="additional-emails"
								name="additional_emails"
								class="min-h-36 w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground shadow-xs outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-2 focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50"
								value={form.additionalEmailsText}
								oninput={updateAdditionalEmails}
								placeholder="ops@example.com"
								disabled={busy}
							></textarea>
							<p class="text-xs text-muted-foreground">
								1行に1件ずつ入力します。保存時に空行は除外されます。
							</p>
						</div>

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
					<h2 class="text-lg font-semibold text-foreground">現在の追加宛先</h2>
					<CardDescription>保存済みの追加メールアドレスです。</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if settings?.additionalEmails.length}
						<ul class="space-y-2">
							{#each settings.additionalEmails as email (email)}
								<li
									class="rounded-md border border-border/80 bg-card/80 px-3 py-2 text-sm text-foreground"
								>
									{email}
								</li>
							{/each}
						</ul>
					{:else}
						<p
							class="rounded-md border border-border/80 bg-secondary/60 p-3 text-sm text-muted-foreground"
						>
							追加メールアドレスは未設定です。
						</p>
					{/if}

					<Button
						type="button"
						variant="outline"
						href={publicSiteAdminPath ? resolve(publicSiteAdminPath as ResolvablePath) : undefined}
						disabled={!publicSiteAdminPath}
					>
						予約サイト管理へ移動
					</Button>
				</CardContent>
			</Card>
		</section>
	{/if}
</main>
