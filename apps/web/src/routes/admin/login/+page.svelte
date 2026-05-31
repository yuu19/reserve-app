<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { emitAuthSessionUpdated } from '$lib/features/auth-lifecycle';
	import { writeLastAuthPortal } from '$lib/features/auth-portal-preference';
	import { isInviteAcceptancePath, resolveAuthPortalByPath } from '$lib/features/auth-portal';
	import {
		loadPendingInvitationHomePath,
		loadPortalAccess,
		loadSession,
		parseResponseBody,
		resolvePortalHomePath,
		toErrorMessage
	} from '$lib/features/auth-session.svelte';
	import { authRpc } from '$lib/rpc-client';
	import { ArrowRight, CheckCircle2, RefreshCw, ShieldCheck, Users } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	type Mode = 'sign-in' | 'sign-up';
	type SubmittingAction = null | 'sign-in' | 'sign-up' | 'sign-in-google';
	type ResolvablePath = Pathname;

	let mode = $state<Mode>('sign-in');
	let loadingSession = $state(true);
	let submittingAction = $state<SubmittingAction>(null);
	let authFeedback = $state<string | null>(null);
	let accessFeedback = $state<string | null>(null);

	let signInForm = $state({ email: '', password: '' });
	let signUpForm = $state({ name: '', email: '', password: '' });

	const adminCapabilities = [
		'予約枠、サービス、定期スケジュールの設定',
		'予約の承認、却下、キャンセル対応',
		'管理者招待、参加者管理、契約情報の確認'
	];

	const nextPath = $derived.by(() => {
		const next = page.url.searchParams.get('next');
		if (!next || !next.startsWith('/')) {
			return null;
		}
		return next;
	});

	const participantLoginHref = $derived.by(() => {
		const basePath = resolve('/participant/login');
		if (!nextPath) {
			return basePath;
		}
		return `${basePath}?next=${encodeURIComponent(nextPath)}`;
	});

	const isBusy = $derived(submittingAction !== null);
	const adminOnboardingPath = resolve('/admin/onboarding');

	const completeSignIn = async () => {
		const targetNextPath = nextPath;
		if (targetNextPath && isInviteAcceptancePath(targetNextPath)) {
			writeLastAuthPortal(resolveAuthPortalByPath(targetNextPath) ?? 'admin');
			emitAuthSessionUpdated();
			window.location.assign(targetNextPath);
			return;
		}

		const portalAccess = await loadPortalAccess();
		const homePath = resolvePortalHomePath(portalAccess);
		if (portalAccess.hasAdminPortalAccess && homePath) {
			const homePortal = homePath.startsWith('/admin') ? 'admin' : 'participant';
			const nextPortal = targetNextPath ? resolveAuthPortalByPath(targetNextPath) : null;
			const canUseNextPath =
				!nextPortal ||
				(nextPortal === 'admin'
					? portalAccess.hasAdminPortalAccess
					: portalAccess.hasParticipantAccess);

			writeLastAuthPortal(canUseNextPath && nextPortal ? nextPortal : homePortal);
			emitAuthSessionUpdated();
			if (targetNextPath && canUseNextPath) {
				window.location.assign(targetNextPath);
				return;
			}
			await goto(resolve(homePath));
			return;
		}

		if (portalAccess.hasParticipantAccess || portalAccess.canUseParticipantBooking) {
			writeLastAuthPortal('participant');
			emitAuthSessionUpdated();
			await goto(resolve('/participant/home'));
			return;
		}

		const invitationHomePath = await loadPendingInvitationHomePath();
		if (invitationHomePath) {
			writeLastAuthPortal('participant');
			emitAuthSessionUpdated();
			await goto(resolve(invitationHomePath as ResolvablePath));
			return;
		}

		if (!portalAccess.hasAdminPortalAccess) {
			writeLastAuthPortal('admin');
			emitAuthSessionUpdated();
			await goto(adminOnboardingPath);
			return;
		}
	};

	const refreshSession = async () => {
		loadingSession = true;
		authFeedback = null;
		accessFeedback = null;
		try {
			const { session } = await loadSession();
			if (!session) {
				return;
			}
			await completeSignIn();
		} finally {
			loadingSession = false;
		}
	};

	const submitSignIn = async (event: SubmitEvent) => {
		event.preventDefault();
		authFeedback = null;
		accessFeedback = null;
		submittingAction = 'sign-in';
		try {
			const response = await authRpc.signIn({
				email: signInForm.email,
				password: signInForm.password
			});
			const payload = await parseResponseBody(response);
			if (!response.ok) {
				authFeedback = toErrorMessage(payload, 'サインインに失敗しました。');
				toast.error(authFeedback);
				return;
			}
			await refreshSession();
		} catch {
			authFeedback = '通信に失敗しました。再試行してください。';
			toast.error(authFeedback);
		} finally {
			submittingAction = null;
		}
	};

	const submitSignUp = async (event: SubmitEvent) => {
		event.preventDefault();
		authFeedback = null;
		accessFeedback = null;
		submittingAction = 'sign-up';
		try {
			const response = await authRpc.signUp({
				name: signUpForm.name,
				email: signUpForm.email,
				password: signUpForm.password
			});
			const payload = await parseResponseBody(response);
			if (!response.ok) {
				authFeedback = toErrorMessage(payload, '新規登録に失敗しました。');
				toast.error(authFeedback);
				return;
			}
			await refreshSession();
		} catch {
			authFeedback = '通信に失敗しました。再試行してください。';
			toast.error(authFeedback);
		} finally {
			submittingAction = null;
		}
	};

	const submitSignInWithGoogle = () => {
		authFeedback = null;
		accessFeedback = null;
		submittingAction = 'sign-in-google';
		const callbackURL =
			typeof window !== 'undefined'
				? (() => {
						const url = new URL(window.location.href);
						url.searchParams.delete('error');
						url.searchParams.delete('error_description');
						return url.toString();
					})()
				: undefined;
		const oidcStartUrl = authRpc.buildGoogleOidcStartURL({
			callbackURL,
			errorCallbackURL: callbackURL
		});
		window.location.assign(oidcStartUrl);
	};

	onMount(() => {
		void refreshSession();
	});
</script>

<main class="min-h-screen bg-background">
	<div
		class="mx-auto grid w-full max-w-5xl gap-6 px-4 py-6 md:px-8 md:py-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(380px,0.75fr)] lg:items-start"
	>
		<section class="order-1 lg:col-start-1 lg:row-start-1" aria-labelledby="admin-login-heading">
			<div class="surface-panel rounded-md border border-border/80 p-5 shadow-sm md:p-6">
				<div class="space-y-3">
					<Badge variant="outline" class="w-fit">管理者向け</Badge>
					<div class="space-y-2">
						<h1 id="admin-login-heading" class="text-2xl font-bold text-foreground">
							管理画面ログイン
						</h1>
						<p class="max-w-[36rem] text-sm leading-relaxed text-secondary-foreground">
							予約運用、サービス設定、招待管理を行う管理者向けの入口です。
						</p>
					</div>
					{#if nextPath}
						<p
							class="break-all rounded-md border border-primary/20 bg-stone-01 px-3 py-2 text-sm text-secondary-foreground"
						>
							ログイン後は {nextPath} に移動します。
						</p>
					{/if}
				</div>
			</div>
		</section>

		<Card
			class="surface-panel order-2 rounded-md border-border/80 shadow-sm lg:col-start-2 lg:row-span-2 lg:row-start-1"
		>
			<CardHeader class="space-y-2">
				<CardTitle class="text-xl">ログインまたは新規登録</CardTitle>
				<CardDescription>
					メールアドレスとパスワード、または Google アカウントで利用を開始できます。
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-5">
				{#if loadingSession}
					<p class="text-sm text-muted-foreground" aria-live="polite">
						セッション情報を確認しています…
					</p>
				{/if}
				{#if authFeedback}
					<p role="status" aria-live="polite" class="text-sm text-destructive">{authFeedback}</p>
				{/if}
				{#if accessFeedback}
					<p role="status" aria-live="polite" class="text-sm text-destructive">{accessFeedback}</p>
				{/if}

				<Tabs bind:value={mode} class="gap-5">
					<TabsList class="grid h-10 w-full grid-cols-2">
						<TabsTrigger value="sign-in">ログイン</TabsTrigger>
						<TabsTrigger value="sign-up">新規登録</TabsTrigger>
					</TabsList>
					<TabsContent value="sign-in" class="space-y-4">
						<Button
							type="button"
							variant="outline"
							class="w-full"
							onclick={submitSignInWithGoogle}
							disabled={isBusy}
						>
							{#if submittingAction === 'sign-in-google'}
								<RefreshCw class="size-4 animate-spin" aria-hidden="true" />
							{/if}
							{submittingAction === 'sign-in-google'
								? 'Google に移動中…'
								: 'Google でログイン・登録'}
						</Button>

						<form
							class="space-y-4"
							aria-busy={submittingAction === 'sign-in'}
							onsubmit={submitSignIn}
						>
							<div class="space-y-2">
								<Label for="admin-sign-in-email">メールアドレス</Label>
								<Input
									id="admin-sign-in-email"
									name="admin_sign_in_email"
									type="email"
									autocomplete="email"
									inputmode="email"
									bind:value={signInForm.email}
									required
									spellcheck={false}
									aria-describedby="admin-sign-in-email-help"
								/>
								<p id="admin-sign-in-email-help" class="text-xs text-muted-foreground">
									管理者として登録したメールアドレスを入力してください。
								</p>
							</div>
							<div class="space-y-2">
								<Label for="admin-sign-in-password">パスワード</Label>
								<Input
									id="admin-sign-in-password"
									name="admin_sign_in_password"
									type="password"
									autocomplete="current-password"
									bind:value={signInForm.password}
									required
									minlength={8}
								/>
							</div>
							<Button type="submit" class="w-full" disabled={isBusy}>
								{#if submittingAction === 'sign-in'}
									<RefreshCw class="size-4 animate-spin" aria-hidden="true" />
								{/if}
								{submittingAction === 'sign-in' ? 'ログイン中…' : '管理画面へログイン'}
							</Button>
						</form>
					</TabsContent>

					<TabsContent value="sign-up" class="space-y-4">
						<form
							class="space-y-4"
							aria-busy={submittingAction === 'sign-up'}
							onsubmit={submitSignUp}
						>
							<div class="space-y-2">
								<Label for="admin-sign-up-name">表示名</Label>
								<Input
									id="admin-sign-up-name"
									name="admin_sign_up_name"
									type="text"
									autocomplete="name"
									bind:value={signUpForm.name}
									required
									aria-describedby="admin-sign-up-name-help"
								/>
								<p id="admin-sign-up-name-help" class="text-xs text-muted-foreground">
									管理画面や招待メールで表示される名前です。
								</p>
							</div>
							<div class="space-y-2">
								<Label for="admin-sign-up-email">メールアドレス</Label>
								<Input
									id="admin-sign-up-email"
									name="admin_sign_up_email"
									type="email"
									autocomplete="email"
									inputmode="email"
									bind:value={signUpForm.email}
									required
									spellcheck={false}
								/>
							</div>
							<div class="space-y-2">
								<Label for="admin-sign-up-password">パスワード</Label>
								<Input
									id="admin-sign-up-password"
									name="admin_sign_up_password"
									type="password"
									autocomplete="new-password"
									bind:value={signUpForm.password}
									required
									minlength={8}
									aria-describedby="admin-sign-up-password-help"
								/>
								<p id="admin-sign-up-password-help" class="text-xs text-muted-foreground">
									8文字以上で設定してください。
								</p>
							</div>
							<Button type="submit" class="w-full" disabled={isBusy}>
								{#if submittingAction === 'sign-up'}
									<RefreshCw class="size-4 animate-spin" aria-hidden="true" />
								{/if}
								{submittingAction === 'sign-up' ? '登録中…' : '管理者として新規登録'}
							</Button>
						</form>
					</TabsContent>
				</Tabs>
			</CardContent>
		</Card>

		<section
			class="order-3 space-y-5 lg:col-start-1 lg:row-start-2"
			aria-labelledby="admin-login-capabilities-heading"
		>
			<div class="surface-panel rounded-md border border-border/80 p-5 shadow-sm">
				<h2
					id="admin-login-capabilities-heading"
					class="flex items-center gap-2 text-base font-bold text-foreground"
				>
					<ShieldCheck class="size-4 text-primary" aria-hidden="true" />
					この入口でできること
				</h2>
				<ul class="mt-3 space-y-2 text-sm text-secondary-foreground">
					{#each adminCapabilities as item (item)}
						<li class="flex items-start gap-2">
							<CheckCircle2 class="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
							<span>{item}</span>
						</li>
					{/each}
				</ul>
			</div>

			<div class="rounded-md border border-dashed border-border bg-card p-4">
				<p class="text-sm text-secondary-foreground">
					予約確認や招待対応のみを行う場合は、予約者ページを使用してください。
				</p>
				<Button href={participantLoginHref} variant="outline" class="mt-3 w-full sm:w-auto">
					<Users class="size-4" aria-hidden="true" />
					予約者ページログインへ
					<ArrowRight class="size-4" aria-hidden="true" />
				</Button>
			</div>
		</section>
	</div>
</main>
