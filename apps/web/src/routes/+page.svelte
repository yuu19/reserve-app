<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { authRpc } from '$lib/rpc-client';
	import {
		loadSession,
		navigateToNextIfNeeded,
		parseResponseBody,
		toErrorMessage
	} from '$lib/features/auth-session.svelte';
	import { RefreshCw, ShieldCheck, UserPlus } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	type Mode = 'sign-in' | 'sign-up';
	type SubmittingAction = null | 'sign-in' | 'sign-in-google' | 'sign-up';

	let mode = $state<Mode>('sign-in');
	let loadingSession = $state(true);
	let submittingAction = $state<SubmittingAction>(null);
	let authFeedback = $state<string | null>(null);

	let signInForm = $state({ email: '', password: '' });
	let signUpForm = $state({ name: '', email: '', password: '' });

	const isBusy = $derived(submittingAction !== null);

	const refreshSession = async () => {
		loadingSession = true;
		try {
			const { session } = await loadSession();
			if (session) {
				const moved = navigateToNextIfNeeded();
				if (!moved) {
					await goto('/dashboard');
				}
			}
		} finally {
			loadingSession = false;
		}
	};

	const submitSignIn = async (event: SubmitEvent) => {
		event.preventDefault();
		authFeedback = null;
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
		submittingAction = 'sign-in-google';
		const callbackURL = typeof window !== 'undefined' ? window.location.href : undefined;
		const oidcStartUrl = authRpc.buildGoogleOidcStartURL({ callbackURL });
		window.location.assign(oidcStartUrl);
	};

	onMount(() => {
		void refreshSession();
	});
</script>

<a
	href="#main-content"
	class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
>
	メインコンテンツへスキップ
</a>

<main id="main-content" class="min-h-screen">
	<div class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
		<header class="surface-panel rounded-2xl border border-slate-200/80 p-5 shadow-lg md:p-6">
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div class="space-y-3">
					<Badge variant="outline">予約受付・参加者運用</Badge>
					<h1 class="text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">予約管理ダッシュボード</h1>
					<p class="max-w-2xl text-sm leading-relaxed text-slate-600 md:text-base">
						サインイン後はダッシュボードから予約・参加者・招待管理を分離した各画面へ移動できます。
					</p>
				</div>
			</div>
		</header>

		{#if loadingSession}
			<Card class="surface-panel border-slate-200/80 shadow-lg">
				<CardContent class="py-10">
					<p class="text-sm text-muted-foreground" aria-live="polite">セッション情報を確認しています…</p>
				</CardContent>
			</Card>
		{:else}
			<section class="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
				<Card class="surface-panel border-slate-200/80 shadow-lg">
					<CardHeader class="space-y-3">
						<h2 class="text-2xl font-semibold text-slate-900 md:text-3xl">予約業務に必要な導線を、迷わず管理</h2>
						<CardDescription class="text-sm leading-relaxed text-slate-600 md:text-base">
							ログイン後、`/dashboard` `/bookings` `/participants` `/admin-invitations` の4画面で運用できます。
						</CardDescription>
					</CardHeader>
					<CardContent class="space-y-6">
						<div class="grid gap-3 sm:grid-cols-3">
							<div class="rounded-xl border border-slate-200/80 bg-white/80 p-4">
								<h3 class="text-sm font-semibold text-slate-900">予約運用</h3>
								<p class="mt-2 text-xs leading-relaxed text-slate-600">単発枠と定期枠を分けて運用。</p>
							</div>
							<div class="rounded-xl border border-slate-200/80 bg-white/80 p-4">
								<h3 class="text-sm font-semibold text-slate-900">参加者管理</h3>
								<p class="mt-2 text-xs leading-relaxed text-slate-600">参加者一覧と参加者招待を管理。</p>
							</div>
							<div class="rounded-xl border border-slate-200/80 bg-white/80 p-4">
								<h3 class="text-sm font-semibold text-slate-900">管理者招待</h3>
								<p class="mt-2 text-xs leading-relaxed text-slate-600">権限管理を専用画面で整理。</p>
							</div>
						</div>
					</CardContent>
				</Card>

				<Card class="surface-panel border-slate-200/80 shadow-lg">
					<CardHeader class="space-y-2">
						<h2 class="flex items-center gap-2 text-2xl font-semibold text-slate-900">
							<ShieldCheck class="size-5" aria-hidden="true" />
							アカウント認証
						</h2>
					</CardHeader>
					<CardContent>
						<Tabs bind:value={mode} class="gap-5">
							<TabsList class="grid h-10 w-full grid-cols-2">
								<TabsTrigger value="sign-in">サインイン</TabsTrigger>
								<TabsTrigger value="sign-up">新規登録</TabsTrigger>
							</TabsList>
							<TabsContent value="sign-in" class="space-y-4">
								<Button type="button" variant="secondary" class="w-full" onclick={submitSignInWithGoogle} disabled={isBusy}>
									{#if submittingAction === 'sign-in-google'}
										<RefreshCw class="size-4 animate-spin" aria-hidden="true" />
									{/if}
									Google でログイン
								</Button>
								<form class="space-y-4" onsubmit={submitSignIn}>
									<div class="space-y-2">
										<Label for="sign-in-email">メールアドレス</Label>
										<Input id="sign-in-email" name="sign_in_email" type="email" bind:value={signInForm.email} required spellcheck={false} />
									</div>
									<div class="space-y-2">
										<Label for="sign-in-password">パスワード</Label>
										<Input id="sign-in-password" name="sign_in_password" type="password" bind:value={signInForm.password} required minlength={8} />
									</div>
									<Button type="submit" class="w-full" disabled={isBusy}>サインイン</Button>
								</form>
							</TabsContent>
							<TabsContent value="sign-up" class="space-y-4">
								<form class="space-y-4" onsubmit={submitSignUp}>
									<div class="space-y-2">
										<Label for="sign-up-name">ユーザー名</Label>
										<Input id="sign-up-name" name="sign_up_name" type="text" bind:value={signUpForm.name} required />
									</div>
									<div class="space-y-2">
										<Label for="sign-up-email">メールアドレス</Label>
										<Input id="sign-up-email" name="sign_up_email" type="email" bind:value={signUpForm.email} required spellcheck={false} />
									</div>
									<div class="space-y-2">
										<Label for="sign-up-password">パスワード</Label>
										<Input id="sign-up-password" name="sign_up_password" type="password" bind:value={signUpForm.password} required minlength={8} />
									</div>
									<Button type="submit" class="w-full" disabled={isBusy}>
										{#if submittingAction === 'sign-up'}
											<RefreshCw class="size-4 animate-spin" aria-hidden="true" />
										{:else}
											<UserPlus class="size-4" aria-hidden="true" />
										{/if}
										アカウントを作成
									</Button>
								</form>
							</TabsContent>
						</Tabs>
					</CardContent>
					{#if authFeedback}
						<CardFooter class="pt-0">
							<p role="status" aria-live="polite" class="text-sm text-destructive">{authFeedback}</p>
						</CardFooter>
					{/if}
				</Card>
			</section>
		{/if}
	</div>
</main>
