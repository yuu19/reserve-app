<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { Toaster, toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { authRpc } from '$lib/rpc-client';
	import { loadSession, parseResponseBody, toErrorMessage } from '$lib/features/auth-session.svelte';

	let { children } = $props();

	let loadingSession = $state(true);
	let isLoggedIn = $state(false);
	let isLoggingOut = $state(false);

	const navItems = [
		{ href: '/dashboard', label: 'ダッシュボード' },
		{ href: '/bookings', label: '予約' },
		{ href: '/participants', label: '参加者' },
		{ href: '/admin-invitations', label: '管理者招待' }
	];

	const pathname = $derived(page.url.pathname);
	const isPublicRoot = $derived(pathname === '/');

	const isActive = (href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);

	const refreshSessionState = async () => {
		loadingSession = true;
		try {
			const { session } = await loadSession();
			isLoggedIn = !!session;
		} finally {
			loadingSession = false;
		}
	};

	const submitSignOut = async () => {
		isLoggingOut = true;
		try {
			const response = await authRpc.signOut();
			const payload = await parseResponseBody(response);
			if (!response.ok && response.status !== 401) {
				toast.error(toErrorMessage(payload, 'ログアウトに失敗しました。'));
				return;
			}
			toast.success('ログアウトしました。');
			isLoggedIn = false;
			await goto('/');
		} catch {
			toast.error('通信エラーによりログアウトできませんでした。');
		} finally {
			isLoggingOut = false;
		}
	};

	onMount(() => {
		void refreshSessionState();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&family=Zen+Kaku+Gothic+New:wght@500;700&display=swap"
		rel="stylesheet"
	/>
	<meta name="theme-color" content="#eef4ff" />
</svelte:head>

<Toaster richColors position="top-right" />

<div class="min-h-screen">
	<header class="sticky top-0 z-40 border-b border-slate-200/70 bg-white/90 backdrop-blur">
		<div class="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-8">
			<div class="flex items-center gap-2">
				<p class="text-sm font-semibold text-slate-900">Reserve App</p>
				{#if loadingSession}
					<Badge variant="secondary">確認中…</Badge>
				{:else}
					<Badge variant={isLoggedIn ? 'default' : 'secondary'}>{isLoggedIn ? 'ログイン中' : '未ログイン'}</Badge>
				{/if}
			</div>

			{#if !isPublicRoot && isLoggedIn}
				<nav class="-mx-2 flex gap-1 overflow-x-auto px-2" aria-label="主要ナビゲーション">
					{#each navItems as item (item.href)}
						<a
							href={item.href}
							class={`rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap ${
								isActive(item.href)
									? 'bg-slate-900 text-white'
									: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
							}`}
						>
							{item.label}
						</a>
					{/each}
				</nav>
			{/if}

			<div class="flex items-center gap-2">
				{#if isLoggedIn && !isPublicRoot}
					<Button type="button" variant="secondary" onclick={submitSignOut} disabled={isLoggingOut}>
						ログアウト
					</Button>
				{/if}
			</div>
		</div>
	</header>

	{@render children()}
</div>
