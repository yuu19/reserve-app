<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { Toaster, toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { authRpc, type AuthSessionPayload } from '$lib/rpc-client';
	import { loadSession, parseResponseBody, toErrorMessage } from '$lib/features/auth-session.svelte';
	import {
		Building2,
		CalendarDays,
		ChevronDown,
		ChevronRight,
		LayoutDashboard,
		LogOut,
		Menu,
		PanelLeftClose,
		PanelLeftOpen,
		Settings,
		ShieldCheck,
		Users,
		X
	} from '@lucide/svelte';

	let { children } = $props();

	let loadingSession = $state(true);
	let isLoggedIn = $state(false);
	let isLoggingOut = $state(false);
	let mobileMenuOpen = $state(false);
	let desktopSidebarCollapsed = $state(false);
	let session = $state<AuthSessionPayload>(null);
	let sectionOpenState = $state<Record<string, boolean>>({
		bookings: true,
		invitations: true,
		organization: true
	});

	type NavItem = {
		href: '/dashboard' | '/bookings' | '/participants' | '/admin-invitations' | '/settings' | '/contracts';
		label: string;
		icon: typeof LayoutDashboard;
	};

	type NavSection = {
		id: 'bookings' | 'invitations' | 'organization';
		label: string;
		items: NavItem[];
	};

	type SectionTab = {
		href: '/dashboard' | '/settings' | '/contracts';
		label: string;
	};

	const sectionTabs: SectionTab[] = [
		{ href: '/dashboard', label: '管理' },
		{ href: '/settings', label: '設定' },
		{ href: '/contracts', label: '契約' }
	];

	const navSections: NavSection[] = [
		{
			id: 'bookings',
			label: '予約',
			items: [{ href: '/bookings', label: '予約管理', icon: CalendarDays }]
		},
		{
			id: 'invitations',
			label: '招待',
			items: [
				{ href: '/participants', label: '参加者管理', icon: Users },
				{ href: '/admin-invitations', label: '管理者招待', icon: ShieldCheck }
			]
		},
		{
			id: 'organization',
			label: '組織',
			items: [
				{ href: '/dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
				{ href: '/settings', label: '設定', icon: Settings },
				{ href: '/contracts', label: '契約', icon: Building2 }
			]
		}
	];

	const pathname = $derived(page.url.pathname);
	const isPublicRoot = $derived(pathname === '/');
	const showSidebarLayout = $derived(!isPublicRoot && isLoggedIn);
	const sessionUserName = $derived.by(() => {
		const rawName = session?.user?.name;
		if (typeof rawName === 'string' && rawName.length > 0) {
			return rawName;
		}
		const rawEmail = session?.user?.email;
		if (typeof rawEmail === 'string' && rawEmail.length > 0) {
			return rawEmail;
		}
		return 'ユーザー';
	});

	const isActive = (href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);

	const toggleSection = (sectionId: NavSection['id']) => {
		sectionOpenState = {
			...sectionOpenState,
			[sectionId]: !sectionOpenState[sectionId]
		};
	};

	const activeSectionTab = $derived.by(() => {
		if (pathname.startsWith('/settings')) {
			return '/settings';
		}
		if (pathname.startsWith('/contracts')) {
			return '/contracts';
		}
		return '/dashboard';
	});
	const desktopSidebarGridClass = $derived(
		desktopSidebarCollapsed
			? 'md:grid-cols-[88px_1fr] md:transition-[grid-template-columns] md:duration-200 md:ease-out md:motion-reduce:transition-none'
			: 'md:grid-cols-[280px_1fr] md:transition-[grid-template-columns] md:duration-200 md:ease-out md:motion-reduce:transition-none'
	);
	const desktopSidebarWidthClass = $derived(desktopSidebarCollapsed ? 'w-[88px]' : 'w-[280px]');
	const sidebarLabelClass = $derived(
		desktopSidebarCollapsed
			? 'pointer-events-none -translate-x-1 select-none opacity-0'
			: 'translate-x-0 opacity-100'
	);
	const sidebarInlineLabelClass = $derived(
		desktopSidebarCollapsed
			? 'pointer-events-none absolute -translate-x-1 select-none opacity-0'
			: 'relative translate-x-0 opacity-100'
	);
	const navExpandedClass = $derived(
		desktopSidebarCollapsed
			? 'pointer-events-none absolute inset-0 -translate-x-1 opacity-0'
			: 'relative translate-x-0 opacity-100'
	);
	const navCollapsedClass = $derived(
		desktopSidebarCollapsed
			? 'relative translate-x-0 opacity-100'
			: 'pointer-events-none absolute inset-0 translate-x-1 opacity-0'
	);

	const refreshSessionState = async () => {
		loadingSession = true;
		try {
			const loaded = await loadSession();
			session = loaded.session;
			isLoggedIn = !!loaded.session;
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
			session = null;
			mobileMenuOpen = false;
			await goto(resolve('/'));
		} catch {
			toast.error('通信エラーによりログアウトできませんでした。');
		} finally {
			isLoggingOut = false;
		}
	};

	const closeMobileMenu = () => {
		mobileMenuOpen = false;
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

{#if showSidebarLayout}
	<div class={`min-h-screen md:grid ${desktopSidebarGridClass}`}>
		<aside
			class={`hidden overflow-hidden border-r border-slate-200/80 bg-sidebar md:flex md:flex-col md:justify-between md:transition-[width,padding] md:duration-200 md:ease-out md:motion-reduce:transition-none ${desktopSidebarWidthClass}`}
		>
			<div
				class={`space-y-6 py-6 transition-[padding] duration-200 ease-out motion-reduce:transition-none ${desktopSidebarCollapsed ? 'px-3' : 'px-5'}`}
			>
				<div class="space-y-3">
					<div class="flex items-center justify-between gap-2">
						<div class="flex min-w-0 items-center gap-2">
							<p
								class={`text-base font-semibold text-slate-900 transition-[opacity,transform] duration-150 ease-out whitespace-nowrap motion-reduce:transition-none motion-reduce:transform-none ${desktopSidebarCollapsed ? 'absolute pointer-events-none -translate-x-1 select-none opacity-0' : 'relative translate-x-0 opacity-100'}`}
							>
								Reserve App
							</p>
							<p
								class={`text-base font-semibold text-slate-900 transition-[opacity,transform] duration-150 ease-out whitespace-nowrap motion-reduce:transition-none motion-reduce:transform-none ${desktopSidebarCollapsed ? 'relative translate-x-0 opacity-100' : 'absolute pointer-events-none translate-x-1 select-none opacity-0'}`}
							>
								RA
							</p>
							<div
								class={`transition-[opacity,transform] duration-150 ease-out whitespace-nowrap motion-reduce:transition-none motion-reduce:transform-none ${sidebarLabelClass}`}
							>
								{#if loadingSession}
									<Badge variant="secondary">確認中…</Badge>
								{:else}
									<Badge variant="default">ログイン中</Badge>
								{/if}
							</div>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							onclick={() => (desktopSidebarCollapsed = !desktopSidebarCollapsed)}
							aria-label={desktopSidebarCollapsed ? 'サイドメニューを展開' : 'サイドメニューを折りたたむ'}
							title={desktopSidebarCollapsed ? 'サイドメニューを展開' : 'サイドメニューを折りたたむ'}
						>
							<span
								class={`inline-flex transition-transform duration-150 ease-out motion-reduce:transition-none motion-reduce:transform-none ${desktopSidebarCollapsed ? 'rotate-180' : 'rotate-0'}`}
							>
								{#if desktopSidebarCollapsed}
									<PanelLeftOpen class="size-4" aria-hidden="true" />
								{:else}
									<PanelLeftClose class="size-4" aria-hidden="true" />
								{/if}
							</span>
						</Button>
					</div>
					<p
						class={`text-sm font-semibold text-slate-800 transition-[opacity,transform] duration-150 ease-out whitespace-nowrap motion-reduce:transition-none motion-reduce:transform-none ${sidebarLabelClass}`}
					>
						{sessionUserName}
					</p>
				</div>

				<div
					class={`space-y-2 transition-[opacity,transform,max-height] duration-150 ease-out motion-reduce:transition-none motion-reduce:transform-none ${desktopSidebarCollapsed ? 'pointer-events-none -translate-x-1 overflow-hidden opacity-0 max-h-0' : 'translate-x-0 opacity-100 max-h-20'}`}
				>
					<div class="inline-flex rounded-md border border-slate-200 bg-white p-1">
						{#each sectionTabs as tab (tab.href)}
							<a
								href={resolve(tab.href)}
								class={`rounded px-3 py-1.5 text-sm transition-colors ${
									activeSectionTab === tab.href
										? 'font-semibold text-teal-600'
										: 'text-slate-700 hover:text-slate-900'
								}`}
							>
								{tab.label}
							</a>
						{/each}
					</div>
				</div>

				<nav class="relative min-h-[216px]" aria-label="機能メニュー">
					<div
						class={`space-y-2 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none motion-reduce:transform-none ${navExpandedClass}`}
						aria-hidden={desktopSidebarCollapsed}
					>
						{#each navSections as section (section.id)}
							<div class="rounded-lg border border-slate-200/80 bg-white/70">
								<button
									type="button"
									class="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold text-slate-800"
									onclick={() => toggleSection(section.id)}
									aria-expanded={sectionOpenState[section.id]}
									aria-controls={`sidebar-section-${section.id}`}
									disabled={desktopSidebarCollapsed}
								>
									<span>{section.label}</span>
									{#if sectionOpenState[section.id]}
										<ChevronDown class="size-4" aria-hidden="true" />
									{:else}
										<ChevronRight class="size-4" aria-hidden="true" />
									{/if}
								</button>
								{#if sectionOpenState[section.id]}
									<div id={`sidebar-section-${section.id}`} class="space-y-1 border-t border-slate-200/70 p-2">
										{#each section.items as item (item.href)}
											<a
												href={resolve(item.href)}
												class={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
													isActive(item.href)
														? 'bg-sidebar-accent text-sidebar-accent-foreground'
														: 'text-slate-700 hover:bg-slate-100'
												}`}
											>
												<item.icon class="size-4" aria-hidden="true" />
												{item.label}
											</a>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>

					<div
						class={`space-y-1 rounded-lg border border-slate-200/80 bg-white/70 p-2 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none motion-reduce:transform-none ${navCollapsedClass}`}
						aria-hidden={!desktopSidebarCollapsed}
					>
						{#each navSections as section (section.id)}
							{#each section.items as item (item.href)}
								<a
									href={resolve(item.href)}
									class={`flex items-center justify-center rounded-lg px-3 py-2 transition-colors ${
										isActive(item.href)
											? 'bg-sidebar-accent text-sidebar-accent-foreground'
											: 'text-slate-700 hover:bg-slate-100'
									}`}
									aria-label={item.label}
									title={item.label}
								>
									<item.icon class="size-4" aria-hidden="true" />
								</a>
							{/each}
						{/each}
					</div>
				</nav>
			</div>

			<div class={`border-t border-slate-200/70 py-4 ${desktopSidebarCollapsed ? 'px-3' : 'px-5'}`}>
				<Button
					type="button"
					variant="outline"
					class={desktopSidebarCollapsed ? 'w-full justify-center px-0' : 'w-full justify-start'}
					onclick={submitSignOut}
					disabled={isLoggingOut}
					aria-label="ログアウト"
					title="ログアウト"
				>
					<LogOut class="size-4" aria-hidden="true" />
					<span
						class={`ml-2 transition-[opacity,transform] duration-150 ease-out whitespace-nowrap motion-reduce:transition-none motion-reduce:transform-none ${sidebarInlineLabelClass}`}
					>
						ログアウト
					</span>
				</Button>
			</div>
		</aside>

		<div class="min-w-0">
			<header class="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur md:hidden">
				<div class="flex items-center gap-2">
					<Button type="button" variant="ghost" size="icon" onclick={() => (mobileMenuOpen = true)} aria-label="メニューを開く">
						<Menu class="size-5" aria-hidden="true" />
					</Button>
					<p class="text-sm font-semibold text-slate-900">Reserve App</p>
				</div>
				<Badge variant="default">ログイン中</Badge>
			</header>

			{@render children()}
		</div>
	</div>

	{#if mobileMenuOpen}
		<div class="fixed inset-0 z-50 md:hidden">
			<button
				type="button"
				class="absolute inset-0 bg-slate-900/35"
				onclick={closeMobileMenu}
				aria-label="メニューを閉じる"
			></button>
			<aside class="absolute inset-y-0 left-0 w-72 border-r border-slate-200/80 bg-sidebar shadow-xl">
				<div class="flex h-full flex-col justify-between">
					<div class="space-y-5 px-5 py-5">
						<div class="flex items-center justify-between">
							<p class="text-sm font-semibold text-slate-900">{sessionUserName}</p>
							<Button type="button" variant="ghost" size="icon" onclick={closeMobileMenu} aria-label="メニューを閉じる">
								<X class="size-5" aria-hidden="true" />
							</Button>
						</div>

						<div class="inline-flex rounded-md border border-slate-200 bg-white p-1">
							{#each sectionTabs as tab (tab.href)}
								<a
									href={resolve(tab.href)}
									onclick={closeMobileMenu}
									class={`rounded px-3 py-1.5 text-sm transition-colors ${
										activeSectionTab === tab.href
											? 'font-semibold text-teal-600'
											: 'text-slate-700 hover:text-slate-900'
									}`}
								>
									{tab.label}
								</a>
							{/each}
						</div>

						<nav class="space-y-2" aria-label="機能メニュー(モバイル)">
							{#each navSections as section (section.id)}
								<div class="rounded-lg border border-slate-200/80 bg-white/70">
									<button
										type="button"
										class="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold text-slate-800"
										onclick={() => toggleSection(section.id)}
										aria-expanded={sectionOpenState[section.id]}
										aria-controls={`mobile-sidebar-section-${section.id}`}
									>
										<span>{section.label}</span>
										{#if sectionOpenState[section.id]}
											<ChevronDown class="size-4" aria-hidden="true" />
										{:else}
											<ChevronRight class="size-4" aria-hidden="true" />
										{/if}
									</button>
									{#if sectionOpenState[section.id]}
										<div id={`mobile-sidebar-section-${section.id}`} class="space-y-1 border-t border-slate-200/70 p-2">
											{#each section.items as item (item.href)}
												<a
													href={resolve(item.href)}
													onclick={closeMobileMenu}
													class={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
														isActive(item.href)
															? 'bg-sidebar-accent text-sidebar-accent-foreground'
															: 'text-slate-700 hover:bg-slate-100'
													}`}
												>
													<item.icon class="size-4" aria-hidden="true" />
													{item.label}
												</a>
											{/each}
										</div>
									{/if}
								</div>
							{/each}
						</nav>
					</div>
					<div class="border-t border-slate-200/70 px-5 py-4">
						<Button
							type="button"
							variant="outline"
							class="w-full justify-start"
							onclick={submitSignOut}
							disabled={isLoggingOut}
						>
							<LogOut class="size-4" aria-hidden="true" />
							ログアウト
						</Button>
					</div>
				</div>
			</aside>
		</div>
	{/if}
{:else}
	<div class="min-h-screen">
		{@render children()}
	</div>
{/if}
