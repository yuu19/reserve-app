<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { emitAuthSessionUpdated } from '$lib/features/auth-lifecycle';
	import { writeLastAuthPortal } from '$lib/features/auth-portal-preference';
	import { isInviteAcceptancePath, resolveAuthPortalByPath } from '$lib/features/auth-portal';
	import {
		loadPortalAccess,
		loadSession,
		parseResponseBody,
		resolvePortalHomePath,
		toErrorMessage
	} from '$lib/features/auth-session.svelte';
	import { authRpc } from '$lib/rpc-client';
	import { RefreshCw } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	type Mode = 'sign-in' | 'sign-up';
	type SubmittingAction = null | 'sign-in' | 'sign-up' | 'sign-in-google';

	let mode = $state<Mode>('sign-in');
	let loadingSession = $state(true);
	let submittingAction = $state<SubmittingAction>(null);
	let authFeedback = $state<string | null>(null);
	let accessFeedback = $state<string | null>(null);

	let signInForm = $state({ email: '', password: '' });
	let signUpForm = $state({ name: '', email: '', password: '' });

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
	const adminOnboardingPath = resolve('/admin/settings');

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
		if (!homePath) {
			writeLastAuthPortal('admin');
			emitAuthSessionUpdated();
			await goto(adminOnboardingPath);
			return;
		}

		const homePortal = homePath === '/admin/dashboard' ? 'admin' : 'participant';
		const nextPortal = targetNextPath ? resolveAuthPortalByPath(targetNextPath) : null;
		const canUseNextPath =
			!nextPortal ||
			(nextPortal === 'admin'
				? portalAccess.hasOrganizationAdminAccess
				: portalAccess.hasParticipantAccess);

		writeLastAuthPortal(canUseNextPath && nextPortal ? nextPortal : homePortal);
		emitAuthSessionUpdated();
		if (targetNextPath && canUseNextPath) {
			window.location.assign(targetNextPath);
			return;
		}
		await goto(resolve(homePath));
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
		const oidcStartUrl = authRpc.buildGoogleOidcStartURL({ callbackURL, errorCallbackURL: callbackURL });
		window.location.assign(oidcStartUrl);
	};

	onMount(() => {
		void refreshSession();
	});
</script>

<main class="min-h-screen">
	<div class="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
		<header class="surface-panel rounded-2xl border border-slate-200/80 p-5 shadow-lg md:p-6">
			<div class="space-y-3">
				<Badge variant="outline">管理画面</Badge>
				<h1 class="text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">管理画面ログイン</h1>
				<p class="text-sm leading-relaxed text-slate-600 md:text-base">
					管理者向けの予約運用・サービス管理・招待管理にアクセスします。
				</p>
				{#if nextPath}
					<p class="text-xs text-slate-500">ログイン後の遷移先: {nextPath}</p>
				{/if}
			</div>
		</header>

		<Card class="surface-panel border-slate-200/80 shadow-lg">
			<CardHeader class="space-y-2">
				<CardDescription>予約者向け入口を使う場合は下記リンクから移動してください。</CardDescription>
				<Button href={participantLoginHref} variant="outline" class="w-full">予約者ページログインへ</Button>
			</CardHeader>
			<CardContent class="space-y-4">
				{#if loadingSession}
					<p class="text-sm text-muted-foreground" aria-live="polite">セッション情報を確認しています…</p>
				{/if}
				{#if authFeedback}
					<p role="status" aria-live="polite" class="text-sm text-destructive">{authFeedback}</p>
				{/if}
				{#if accessFeedback}
					<p role="status" aria-live="polite" class="text-sm text-destructive">{accessFeedback}</p>
				{/if}

				<Tabs bind:value={mode} class="gap-5">
					<TabsList class="grid h-10 w-full grid-cols-2">
						<TabsTrigger value="sign-in">サインイン</TabsTrigger>
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
							Google で登録/ログインする
						</Button>

						<form class="space-y-4" onsubmit={submitSignIn}>
							<div class="space-y-2">
								<Label for="admin-sign-in-email">メールアドレス</Label>
								<Input
									id="admin-sign-in-email"
									name="admin_sign_in_email"
									type="email"
									bind:value={signInForm.email}
									required
									spellcheck={false}
								/>
							</div>
							<div class="space-y-2">
								<Label for="admin-sign-in-password">パスワード</Label>
								<Input
									id="admin-sign-in-password"
									name="admin_sign_in_password"
									type="password"
									bind:value={signInForm.password}
									required
									minlength={8}
								/>
							</div>
							<Button type="submit" class="w-full" disabled={isBusy}>サインイン</Button>
						</form>
					</TabsContent>

					<TabsContent value="sign-up" class="space-y-4">
						<form class="space-y-4" onsubmit={submitSignUp}>
							<div class="space-y-2">
								<Label for="admin-sign-up-name">表示名</Label>
								<Input
									id="admin-sign-up-name"
									name="admin_sign_up_name"
									type="text"
									bind:value={signUpForm.name}
									required
								/>
							</div>
							<div class="space-y-2">
								<Label for="admin-sign-up-email">メールアドレス</Label>
								<Input
									id="admin-sign-up-email"
									name="admin_sign_up_email"
									type="email"
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
									bind:value={signUpForm.password}
									required
									minlength={8}
								/>
							</div>
							<Button type="submit" class="w-full" disabled={isBusy}>新規登録</Button>
						</form>
					</TabsContent>
				</Tabs>
			</CardContent>
		</Card>
	</div>
</main>
