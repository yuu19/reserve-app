<script lang="ts">
	import '../app.css';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import type { Pathname } from '$app/types';
	import { onDestroy, onMount } from 'svelte';
	import { AiChatWidget } from '$lib/components/ai';
	import ClassroomSwitcher from '$lib/components/classroom-switcher.svelte';
	import OrganizationSwitcher from '$lib/components/organization-switcher.svelte';
	import { Toaster, toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { onAuthSessionUpdated } from '$lib/features/auth-lifecycle';
	import { readLastAuthPortal, writeLastAuthPortal } from '$lib/features/auth-portal-preference';
	import {
		isPublicAuthEntryPath,
		resolveAuthPortalByPath,
		type AuthPortal
	} from '$lib/features/auth-portal';
	import {
		listClassroomsByOrgSlug,
		loadOrganizations,
		setActiveOrganization,
		type ClassroomContextPayload
	} from '$lib/features/organization-context.svelte';
	import {
		authRpc,
		type AuthSessionPayload,
		type OrganizationPayload,
		type ScopedApiContext
	} from '$lib/rpc-client';
	import {
		getScopedContextFromUrlPath,
		loadPortalAccess,
		loadSession,
		parseResponseBody,
		toErrorMessage,
		type PortalAccess
	} from '$lib/features/auth-session.svelte';
	import {
		buildScopedPortalPath,
		getRoutePathFromUrlPath,
		replacePortalPathWithScopedContext
	} from '$lib/features/scoped-routing';
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

	type ResolvablePath = Pathname;

	let { children } = $props();

	const brandName = 'WakuReserve';
	const brandTagline = '予約管理プラットフォーム';
	const brandMarkHref = '/brand/reservation-logo-44x44.svg';
	const brandIcon16Href = '/brand/reservation-logo-16x16.svg';
	const brandIcon32Href = '/brand/reservation-logo-32x32.svg';
	const brandAppleTouchHref = '/brand/reservation-logo-180x180.svg';

	let loadingSession = $state(true);
	let isLoggedIn = $state(false);
	let isLoggingOut = $state(false);
	let mobileMenuOpen = $state(false);
	let desktopSidebarCollapsed = $state(false);
	let session = $state<AuthSessionPayload>(null);
	let organizations = $state<OrganizationPayload[]>([]);
	let classrooms = $state<ClassroomContextPayload[]>([]);
	let activeOrganization = $state<OrganizationPayload | null>(null);
	let activeClassroom = $state<ClassroomContextPayload | null>(null);
	let portalAccess = $state<PortalAccess>({
		hasOrganizationAdminAccess: false,
		hasAdminPortalAccess: false,
		hasParticipantAccess: false,
		canManage: false,
		canManageClassroom: false,
		canManageBookings: false,
		canManageParticipants: false,
		canUseParticipantBooking: false,
		activeOrganizationRole: null,
		activeFacts: null,
		activeSources: null,
		activeDisplay: null,
		activeDisplayRole: null,
		hasActiveOrganization: false
	});
	let activePortal = $state<AuthPortal | null>(readLastAuthPortal());
	let switchingOrganization = $state(false);
	let switchingClassroom = $state(false);
	let refreshSessionStatePromise: Promise<void> | null = null;
	let queuedRefreshContext: ScopedApiContext | null = null;
	let fallbackRefreshPath = '';
	let canonicalizingPath = '';
	let syncingPathContext = '';
	let sectionOpenState = $state<Record<string, boolean>>({
		admin: true,
		participant: true
	});
	let showNavigationProgress = $state(false);
	let navigationProgressValue = $state(0);
	let prefersReducedMotion = $state(false);
	let progressDelayTimer: ReturnType<typeof setTimeout> | null = null;
	let progressAdvanceTimer: ReturnType<typeof setInterval> | null = null;
	let progressHideTimer: ReturnType<typeof setTimeout> | null = null;

	type NavItem = {
		href:
			| '/admin/dashboard'
			| '/admin/bookings'
			| '/admin/classrooms'
			| '/admin/services'
			| '/admin/schedules/slots'
			| '/admin/schedules/recurring'
			| '/admin/participants'
			| '/admin/invitations'
			| '/admin/settings'
			| '/admin/contracts'
			| '/participant/home'
			| '/participant/bookings'
			| '/participant/invitations'
			| '/participant/admin-invitations'
			| '/events';
		label: string;
		icon: typeof LayoutDashboard;
	};

	type NavSection = {
		id: 'admin' | 'participant';
		label: string;
		items: NavItem[];
	};

	type SectionTab = {
		href: '/admin/dashboard' | '/admin/settings' | '/admin/contracts';
		label: string;
	};

	const sectionTabs: SectionTab[] = [
		{ href: '/admin/dashboard', label: '管理' },
		{ href: '/admin/settings', label: '設定' },
		{ href: '/admin/contracts', label: '契約' }
	];

	const navSectionsByPortal: Record<AuthPortal, NavSection> = {
		admin: {
			id: 'admin',
			label: '管理者',
			items: [
				{ href: '/admin/dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
				{ href: '/admin/bookings', label: '予約運用', icon: CalendarDays },
				{ href: '/admin/classrooms', label: '教室管理', icon: Building2 },
				{ href: '/admin/services', label: 'サービス一覧', icon: CalendarDays },
				{ href: '/admin/schedules/slots', label: '単発一覧', icon: CalendarDays },
				{ href: '/admin/schedules/recurring', label: '定期一覧', icon: CalendarDays },
				{ href: '/admin/participants', label: '参加者管理', icon: Users },
				{ href: '/admin/invitations', label: '管理者招待', icon: ShieldCheck },
				{ href: '/admin/settings', label: '設定', icon: Settings },
				{ href: '/admin/contracts', label: '契約', icon: Building2 }
			]
		},
		participant: {
			id: 'participant',
			label: '参加者',
			items: [
				{ href: '/participant/home', label: 'ホーム', icon: LayoutDashboard },
				{ href: '/events', label: 'イベント一覧', icon: CalendarDays },
				{ href: '/participant/bookings', label: '予約確認', icon: CalendarDays },
				{ href: '/participant/invitations', label: '参加者招待', icon: Users },
				{ href: '/participant/admin-invitations', label: '管理者招待', icon: ShieldCheck }
			]
		}
	};

	const rawPathname = $derived(page.url.pathname);
	const pathname = $derived(getRoutePathFromUrlPath(rawPathname));
	const isPublicAuthRoute = $derived(isPublicAuthEntryPath(pathname));
	const showSidebarLayout = $derived(
		!isPublicAuthRoute && pathname !== '/admin/onboarding' && isLoggedIn
	);
	const showAdminSectionTabs = $derived(
		activePortal === 'admin' && portalAccess.hasOrganizationAdminAccess
	);
	const canAccessAdminRoute = (href: NavItem['href'] | SectionTab['href']) => {
		switch (href) {
			case '/admin/dashboard':
			case '/admin/classrooms':
			case '/admin/invitations':
			case '/admin/settings':
			case '/admin/contracts':
				return portalAccess.hasOrganizationAdminAccess;
			case '/admin/bookings':
				return portalAccess.hasOrganizationAdminAccess || portalAccess.canManageBookings;
			case '/admin/services':
			case '/admin/schedules/slots':
			case '/admin/schedules/recurring':
				return portalAccess.hasOrganizationAdminAccess || portalAccess.canManageClassroom;
			case '/admin/participants':
				return portalAccess.hasOrganizationAdminAccess || portalAccess.canManageParticipants;
			default:
				return false;
		}
	};
	const visibleNavSections = $derived.by(() => {
		if (!activePortal) {
			return [] as NavSection[];
		}
		if (activePortal === 'admin') {
			if (!portalAccess.hasAdminPortalAccess) {
				return [] as NavSection[];
			}
			const adminItems = navSectionsByPortal.admin.items
				.filter((item) => canAccessAdminRoute(item.href))
				.map((item) =>
					item.href === '/admin/invitations' && getCurrentScopedContext()
						? { ...item, label: '教室招待' }
						: item
				);
			return adminItems.length > 0 ? [{ ...navSectionsByPortal.admin, items: adminItems }] : [];
		}
		if (!portalAccess.hasParticipantAccess) {
			return [];
		}
		return [
			{
				...navSectionsByPortal.participant,
				items: navSectionsByPortal.participant.items.map((item) =>
					item.href === '/participant/admin-invitations' ? { ...item, label: '運営招待' } : item
				)
			}
		];
	});
	const canSwitchToAdmin = $derived(activePortal !== 'admin' && portalAccess.hasAdminPortalAccess);
	const canSwitchToParticipant = $derived(
		activePortal !== 'participant' && portalAccess.hasParticipantAccess
	);
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
	const activeOrganizationName = $derived(activeOrganization?.name ?? '組織未選択');
	const activeClassroomName = $derived(activeClassroom?.name ?? '教室未選択');
	const navigationProgressStyle = $derived(
		`transform: scaleX(${navigationProgressValue}); opacity: ${
			navigationProgressValue >= 1 ? 0.9 : 1
		};`
	);

	const isActive = (href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);
	const resolveInitialActivePortal = (
		currentPath: string,
		nextPortalAccess: PortalAccess
	): AuthPortal => {
		const storedPortal = readLastAuthPortal();
		if (storedPortal === 'admin' && nextPortalAccess.hasAdminPortalAccess) {
			return storedPortal;
		}
		if (storedPortal === 'participant' && nextPortalAccess.hasParticipantAccess) {
			return storedPortal;
		}

		const pathPortal = resolveAuthPortalByPath(currentPath);
		if (pathPortal === 'admin' && nextPortalAccess.hasAdminPortalAccess) {
			return pathPortal;
		}
		if (pathPortal === 'participant' && nextPortalAccess.hasParticipantAccess) {
			return pathPortal;
		}

		if (nextPortalAccess.hasAdminPortalAccess) {
			return 'admin';
		}

		if (nextPortalAccess.hasParticipantAccess) {
			return 'participant';
		}

		return 'participant';
	};

	const toggleSection = (sectionId: NavSection['id']) => {
		sectionOpenState = {
			...sectionOpenState,
			[sectionId]: !sectionOpenState[sectionId]
		};
	};
	const clearProgressDelayTimer = () => {
		if (!progressDelayTimer) {
			return;
		}
		clearTimeout(progressDelayTimer);
		progressDelayTimer = null;
	};
	const clearProgressAdvanceTimer = () => {
		if (!progressAdvanceTimer) {
			return;
		}
		clearInterval(progressAdvanceTimer);
		progressAdvanceTimer = null;
	};
	const clearProgressHideTimer = () => {
		if (!progressHideTimer) {
			return;
		}
		clearTimeout(progressHideTimer);
		progressHideTimer = null;
	};
	const resetNavigationProgress = () => {
		clearProgressDelayTimer();
		clearProgressAdvanceTimer();
		clearProgressHideTimer();
		showNavigationProgress = false;
		navigationProgressValue = 0;
	};
	const beginProgressAdvance = () => {
		if (prefersReducedMotion || progressAdvanceTimer) {
			return;
		}
		progressAdvanceTimer = setInterval(() => {
			navigationProgressValue = Math.min(
				0.89,
				navigationProgressValue + Math.max((0.89 - navigationProgressValue) * 0.26, 0.02)
			);
			if (navigationProgressValue >= 0.89) {
				clearProgressAdvanceTimer();
			}
		}, 220);
	};
	const beginNavigationProgress = () => {
		clearProgressHideTimer();
		clearProgressDelayTimer();
		progressDelayTimer = setTimeout(() => {
			showNavigationProgress = true;
			navigationProgressValue = prefersReducedMotion ? 0.82 : 0.14;
			beginProgressAdvance();
		}, 120);
	};
	const completeNavigationProgress = () => {
		clearProgressDelayTimer();
		if (!showNavigationProgress) {
			navigationProgressValue = 0;
			return;
		}
		clearProgressAdvanceTimer();
		navigationProgressValue = 1;
		clearProgressHideTimer();
		progressHideTimer = setTimeout(
			() => {
				showNavigationProgress = false;
				navigationProgressValue = 0;
				progressHideTimer = null;
			},
			prefersReducedMotion ? 120 : 180
		);
	};
	const isHashOnlyNavigation = (fromUrl: URL | null | undefined, toUrl: URL | null | undefined) => {
		if (!fromUrl || !toUrl) {
			return false;
		}
		return (
			fromUrl.origin === toUrl.origin &&
			fromUrl.pathname === toUrl.pathname &&
			fromUrl.search === toUrl.search &&
			fromUrl.hash !== toUrl.hash
		);
	};
	const shouldTrackNavigation = (navigation: {
		willUnload?: boolean;
		from?: { url: URL | null } | null;
		to?: { url: URL | null } | null;
	}) => {
		if (navigation.willUnload) {
			return false;
		}

		const fromUrl = navigation.from?.url ?? null;
		const toUrl = navigation.to?.url ?? null;
		if (!toUrl) {
			return false;
		}
		if (fromUrl?.href === toUrl.href) {
			return false;
		}
		if (isHashOnlyNavigation(fromUrl, toUrl)) {
			return false;
		}
		return true;
	};

	const activeSectionTab = $derived.by(() => {
		if (pathname.startsWith('/admin/settings')) {
			return '/admin/settings';
		}
		if (pathname.startsWith('/admin/contracts')) {
			return '/admin/contracts';
		}
		return '/admin/dashboard';
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

	const refreshSessionState = async (preferredContext: ScopedApiContext | null = null) => {
		if (refreshSessionStatePromise) {
			if (preferredContext) {
				queuedRefreshContext = preferredContext;
			}
			return refreshSessionStatePromise;
		}

		const run = async () => {
			loadingSession = true;
			try {
				const loaded = await loadSession();
				session = loaded.session;
				isLoggedIn = !!loaded.session;
				if (!loaded.session) {
					organizations = [];
					classrooms = [];
					activeOrganization = null;
					activeClassroom = null;
					portalAccess = {
						hasOrganizationAdminAccess: false,
						hasAdminPortalAccess: false,
						hasParticipantAccess: false,
						canManage: false,
						canManageClassroom: false,
						canManageBookings: false,
						canManageParticipants: false,
						canUseParticipantBooking: false,
						activeOrganizationRole: null,
						activeFacts: null,
						activeSources: null,
						activeDisplay: null,
						activeDisplayRole: null,
						hasActiveOrganization: false
					};
					return;
				}
				const [
					{
						organizations: nextOrganizations,
						classrooms: nextClassrooms,
						activeOrganization: nextActiveOrganization,
						activeClassroom: nextActiveClassroom
					},
					nextPortalAccess
				] = await Promise.all([
					loadOrganizations(preferredContext),
					loadPortalAccess(preferredContext)
				]);
				organizations = nextOrganizations;
				classrooms = nextClassrooms;
				activeOrganization = nextActiveOrganization;
				activeClassroom = nextActiveClassroom;
				portalAccess = nextPortalAccess;
				if (
					!activePortal ||
					(activePortal === 'admin' && !nextPortalAccess.hasAdminPortalAccess) ||
					(activePortal === 'participant' && !nextPortalAccess.hasParticipantAccess)
				) {
					activePortal = resolveInitialActivePortal(rawPathname, nextPortalAccess);
				}
			} finally {
				loadingSession = false;
			}
		};

		refreshSessionStatePromise = run();
		try {
			await refreshSessionStatePromise;
		} finally {
			refreshSessionStatePromise = null;
		}

		const nextQueuedContext = queuedRefreshContext;
		queuedRefreshContext = null;
		if (
			nextQueuedContext &&
			!(
				getActiveStateScopedContext()?.orgSlug === nextQueuedContext.orgSlug &&
				getActiveStateScopedContext()?.classroomSlug === nextQueuedContext.classroomSlug
			)
		) {
			await refreshSessionState(nextQueuedContext);
		}
	};

	const pickPreferredClassroom = (
		candidates: ClassroomContextPayload[]
	): ClassroomContextPayload | null =>
		candidates.find((classroom) => classroom.canManageClassroom) ??
		candidates.find((classroom) => classroom.canManageBookings) ??
		candidates.find((classroom) => classroom.canManageParticipants) ??
		candidates.find((classroom) => classroom.canUseParticipantBooking) ??
		candidates[0] ??
		null;

	const getActiveStateScopedContext = (): ScopedApiContext | null =>
		activeOrganization && activeClassroom
			? {
					orgSlug: activeOrganization.slug,
					classroomSlug: activeClassroom.slug
				}
			: null;

	const getCurrentScopedContext = (): ScopedApiContext | null =>
		getScopedContextFromUrlPath(portalAccess.accessTree, rawPathname) ??
		getActiveStateScopedContext();

	const resolveScopedNavigationTarget = (context: { orgSlug: string; classroomSlug: string }) => {
		const portal =
			activePortal === 'admin' || activePortal === 'participant' ? activePortal : 'participant';
		if (typeof window === 'undefined') {
			return buildScopedPortalPath(context, portal);
		}

		const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
		const nextPath = replacePortalPathWithScopedContext(currentPath, context);
		if (nextPath !== currentPath) {
			return nextPath;
		}
		return buildScopedPortalPath(context, portal);
	};

	const resolvePortalHref = (href: NavItem['href'] | SectionTab['href']) => {
		const context = getCurrentScopedContext();
		return context ? replacePortalPathWithScopedContext(href, context) : href;
	};

	const submitSetActiveOrganizationFromHeader = async (organizationId: string | null) => {
		if (switchingOrganization || switchingClassroom) {
			return;
		}

		const currentOrganizationId = activeOrganization?.id ?? null;
		if (organizationId === currentOrganizationId) {
			return;
		}

		switchingOrganization = true;
		try {
			const result = await setActiveOrganization(organizationId);
			if (!result.ok) {
				toast.error(result.message);
				return;
			}

			if (!organizationId) {
				await refreshSessionState();
				return;
			}

			const nextOrganization =
				organizations.find((organization) => organization.id === organizationId) ?? null;
			if (!nextOrganization) {
				await refreshSessionState();
				return;
			}

			const nextClassrooms = await listClassroomsByOrgSlug(nextOrganization.slug);
			const nextClassroom = pickPreferredClassroom(nextClassrooms);
			if (!nextClassroom) {
				toast.error('切り替え先の教室が見つかりません。');
				await refreshSessionState();
				return;
			}

			await goto(
				resolve(
					resolveScopedNavigationTarget({
						orgSlug: nextOrganization.slug,
						classroomSlug: nextClassroom.slug
					}) as ResolvablePath
				),
				{ invalidateAll: true }
			);
		} catch {
			toast.error('組織の切り替えに失敗しました。');
		} finally {
			switchingOrganization = false;
		}
	};

	const submitSetActiveClassroomFromHeader = async (classroomSlug: string) => {
		if (switchingOrganization || switchingClassroom || !activeOrganization) {
			return;
		}
		if (classroomSlug === activeClassroom?.slug) {
			return;
		}

		switchingClassroom = true;
		try {
			await goto(
				resolve(
					resolveScopedNavigationTarget({
						orgSlug: activeOrganization.slug,
						classroomSlug
					}) as ResolvablePath
				),
				{ invalidateAll: true }
			);
		} catch {
			toast.error('教室の切り替えに失敗しました。');
		} finally {
			switchingClassroom = false;
		}
	};

	const switchPortal = async (nextPortal: AuthPortal) => {
		if (activePortal === nextPortal) {
			return;
		}
		writeLastAuthPortal(nextPortal);
		activePortal = nextPortal;
		mobileMenuOpen = false;
		await goto(
			resolve(
				resolvePortalHref(
					nextPortal === 'admin' ? '/admin/dashboard' : '/participant/home'
				) as ResolvablePath
			)
		);
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
			organizations = [];
			classrooms = [];
			activeOrganization = null;
			activeClassroom = null;
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

	const redirectToCanonicalWebDomain = (): boolean => {
		if (typeof window === 'undefined') {
			return false;
		}
		if (!window.location.hostname.endsWith('.workers.dev')) {
			return false;
		}

		let backendHost: string;
		try {
			backendHost = new URL(authRpc.backendUrl).hostname;
		} catch {
			return false;
		}

		if (!backendHost.startsWith('api.')) {
			return false;
		}

		const canonicalHost = backendHost.replace(/^api\./, 'web.');
		if (canonicalHost === window.location.hostname) {
			return false;
		}

		const nextUrl = new URL(window.location.href);
		nextUrl.protocol = 'https:';
		nextUrl.host = canonicalHost;
		window.location.replace(nextUrl.toString());
		return true;
	};

	onMount(() => {
		if (redirectToCanonicalWebDomain()) {
			return;
		}
		const mediaQuery =
			typeof window !== 'undefined' && typeof window.matchMedia === 'function'
				? window.matchMedia('(prefers-reduced-motion: reduce)')
				: null;
		const syncMotionPreference = () => {
			prefersReducedMotion = mediaQuery?.matches ?? false;
		};
		syncMotionPreference();
		mediaQuery?.addEventListener('change', syncMotionPreference);
		const stopListeningAuthSession = onAuthSessionUpdated(() => {
			void refreshSessionState();
		});
		void refreshSessionState();
		return () => {
			mediaQuery?.removeEventListener('change', syncMotionPreference);
			resetNavigationProgress();
			stopListeningAuthSession();
		};
	});

	onDestroy(() => {
		resetNavigationProgress();
	});

	beforeNavigate((navigation) => {
		if (!shouldTrackNavigation(navigation)) {
			return;
		}
		beginNavigationProgress();
	});

	afterNavigate(() => {
		completeNavigationProgress();
	});

	$effect(() => {
		if (loadingSession || !isLoggedIn || isPublicAuthRoute) {
			syncingPathContext = '';
			return;
		}
		const pathContext = getScopedContextFromUrlPath(portalAccess.accessTree, rawPathname);
		const activeStateContext = getActiveStateScopedContext();
		if (
			!pathContext ||
			(activeStateContext &&
				activeStateContext.orgSlug === pathContext.orgSlug &&
				activeStateContext.classroomSlug === pathContext.classroomSlug)
		) {
			syncingPathContext = '';
			return;
		}
		const syncKey = `${pathContext.orgSlug}/${pathContext.classroomSlug}`;
		if (syncingPathContext === syncKey) {
			return;
		}
		syncingPathContext = syncKey;
		void refreshSessionState(pathContext).finally(() => {
			if (syncingPathContext === syncKey) {
				syncingPathContext = '';
			}
		});
	});

	$effect(() => {
		if (loadingSession || !isLoggedIn || isPublicAuthRoute) {
			canonicalizingPath = '';
			return;
		}
		const context = getCurrentScopedContext();
		if (!context) {
			canonicalizingPath = '';
			return;
		}
		const currentPath = `${page.url.pathname}${page.url.search}${page.url.hash}`;
		const nextPath = replacePortalPathWithScopedContext(currentPath, context);
		if (nextPath === currentPath) {
			canonicalizingPath = '';
			return;
		}
		if (canonicalizingPath === currentPath) {
			return;
		}
		canonicalizingPath = currentPath;
		void goto(resolve(nextPath as ResolvablePath), {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		}).finally(() => {
			if (canonicalizingPath === currentPath) {
				canonicalizingPath = '';
			}
		});
	});

	$effect(() => {
		if (isPublicAuthRoute || isLoggedIn || loadingSession) {
			fallbackRefreshPath = '';
			return;
		}
		if (fallbackRefreshPath === pathname) {
			return;
		}
		fallbackRefreshPath = pathname;
		void refreshSessionState();
	});
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" sizes="32x32" href={brandIcon32Href} />
	<link rel="icon" type="image/svg+xml" sizes="16x16" href={brandIcon16Href} />
	<link rel="apple-touch-icon" href={brandAppleTouchHref} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&family=Zen+Kaku+Gothic+New:wght@500;700&display=swap"
		rel="stylesheet"
	/>
	<meta name="theme-color" content="#eef4ff" />
</svelte:head>

<Toaster richColors position="top-right" />

{#if showNavigationProgress}
	<div
		aria-hidden="true"
		data-testid="navigation-progress"
		class="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden"
	>
		<div class="absolute inset-0 bg-card/25"></div>
		<div
			data-testid="navigation-progress-bar"
			class="h-full origin-left bg-primary shadow-[0_0_14px_color-mix(in_oklch,var(--color-primary)_42%,transparent)] transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-opacity"
			style={navigationProgressStyle}
		></div>
	</div>
{/if}

{#if showSidebarLayout}
	<div class={`min-h-screen md:grid ${desktopSidebarGridClass}`}>
		<aside
			class={`hidden overflow-hidden border-r border-border/80 bg-sidebar md:flex md:flex-col md:justify-between md:transition-[width,padding] md:duration-200 md:ease-out md:motion-reduce:transition-none ${desktopSidebarWidthClass}`}
		>
			<div
				class={`space-y-6 py-6 transition-[padding] duration-200 ease-out motion-reduce:transition-none ${desktopSidebarCollapsed ? 'px-3' : 'px-5'}`}
			>
				<div class="space-y-3">
					<div class="flex items-center justify-between gap-2">
						<div class="flex min-w-0 items-center gap-3">
							<img
								alt=""
								aria-hidden="true"
								class="size-11 shrink-0 rounded-2xl border border-border/80 bg-white shadow-sm"
								height="44"
								src={brandMarkHref}
								width="44"
							/>
							<div
								class={`min-w-0 transition-[opacity,transform,max-width] duration-150 ease-out motion-reduce:transition-none motion-reduce:transform-none ${desktopSidebarCollapsed ? 'pointer-events-none -translate-x-1 overflow-hidden opacity-0 max-w-0' : 'translate-x-0 opacity-100 max-w-[11rem]'}`}
							>
								<p class="truncate text-base font-semibold text-foreground">{brandName}</p>
								<p class="truncate text-xs font-medium text-secondary-foreground/80">
									{brandTagline}
								</p>
							</div>
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
							aria-label={desktopSidebarCollapsed
								? 'サイドメニューを展開'
								: 'サイドメニューを折りたたむ'}
							title={desktopSidebarCollapsed
								? 'サイドメニューを展開'
								: 'サイドメニューを折りたたむ'}
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
						class={`text-sm font-semibold text-secondary-foreground transition-[opacity,transform] duration-150 ease-out whitespace-nowrap motion-reduce:transition-none motion-reduce:transform-none ${sidebarLabelClass}`}
					>
						{sessionUserName}
					</p>
				</div>

				<div
					class={`space-y-2 transition-[opacity,transform,max-height] duration-150 ease-out motion-reduce:transition-none motion-reduce:transform-none ${desktopSidebarCollapsed ? 'pointer-events-none -translate-x-1 overflow-hidden opacity-0 max-h-0' : 'translate-x-0 opacity-100 max-h-20'}`}
				>
					{#if showAdminSectionTabs}
						<div class="inline-flex rounded-md border border-border bg-card p-1">
							{#each sectionTabs as tab (tab.href)}
								<a
									href={resolve(resolvePortalHref(tab.href) as ResolvablePath)}
									class={`rounded px-3 py-1.5 text-sm transition-colors ${
										activeSectionTab === tab.href
											? 'font-semibold text-primary'
											: 'text-secondary-foreground hover:text-foreground'
									}`}
								>
									{tab.label}
								</a>
							{/each}
						</div>
					{/if}
				</div>

				<nav class="relative min-h-[216px]" aria-label="機能メニュー">
					<div
						class={`space-y-2 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none motion-reduce:transform-none ${navExpandedClass}`}
						aria-hidden={desktopSidebarCollapsed}
					>
						{#each visibleNavSections as section (section.id)}
							<div class="rounded-lg border border-border/80 bg-card/70">
								<button
									type="button"
									class="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold text-secondary-foreground"
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
									<div
										id={`sidebar-section-${section.id}`}
										class="space-y-1 border-t border-border/70 p-2"
									>
										{#each section.items as item (item.href)}
											<a
												href={resolve(resolvePortalHref(item.href) as ResolvablePath)}
												class={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
													isActive(item.href)
														? 'bg-sidebar-accent text-sidebar-accent-foreground'
														: 'text-secondary-foreground hover:bg-secondary'
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
						class={`space-y-1 rounded-lg border border-border/80 bg-card/70 p-2 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none motion-reduce:transform-none ${navCollapsedClass}`}
						aria-hidden={!desktopSidebarCollapsed}
					>
						{#each visibleNavSections as section (section.id)}
							{#each section.items as item (item.href)}
								<a
									href={resolve(resolvePortalHref(item.href) as ResolvablePath)}
									class={`flex items-center justify-center rounded-lg px-3 py-2 transition-colors ${
										isActive(item.href)
											? 'bg-sidebar-accent text-sidebar-accent-foreground'
											: 'text-secondary-foreground hover:bg-secondary'
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

			<div class={`border-t border-border/70 py-4 ${desktopSidebarCollapsed ? 'px-3' : 'px-5'}`}>
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
			<header
				class="sticky top-0 z-30 hidden items-center justify-between gap-3 border-b border-border/80 bg-card/90 px-4 py-3 backdrop-blur md:flex"
			>
				<div class="flex items-center gap-2">
					{#if canSwitchToAdmin}
						<Button type="button" variant="outline" size="sm" onclick={() => switchPortal('admin')}
							>管理者へ切替</Button
						>
					{/if}
					{#if canSwitchToParticipant}
						<Button
							type="button"
							variant="outline"
							size="sm"
							onclick={() => switchPortal('participant')}>参加者へ切替</Button
						>
					{/if}
				</div>
				<div class="flex items-center gap-2">
					<OrganizationSwitcher
						{organizations}
						activeOrganizationId={activeOrganization?.id ?? null}
						{activeOrganizationName}
						loading={loadingSession}
						busy={switchingOrganization || switchingClassroom}
						onSelect={submitSetActiveOrganizationFromHeader}
					/>
					{#if activeOrganization && classrooms.length > 0}
						<ClassroomSwitcher
							{classrooms}
							activeClassroomId={activeClassroom?.id ?? null}
							{activeClassroomName}
							loading={loadingSession}
							busy={switchingOrganization || switchingClassroom}
							onSelect={submitSetActiveClassroomFromHeader}
						/>
					{/if}
				</div>
			</header>

			<header
				class="sticky top-0 z-40 flex items-center justify-between border-b border-border/80 bg-card/90 px-4 py-3 backdrop-blur md:hidden"
			>
				<div class="flex items-center gap-3">
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onclick={() => (mobileMenuOpen = true)}
						aria-label="メニューを開く"
					>
						<Menu class="size-5" aria-hidden="true" />
					</Button>
					<img
						alt=""
						aria-hidden="true"
						class="size-9 shrink-0 rounded-xl border border-border/80 bg-white shadow-sm"
						height="36"
						src={brandMarkHref}
						width="36"
					/>
					<div class="min-w-0">
						<p class="truncate text-sm font-semibold text-foreground">{brandName}</p>
						<p class="truncate text-[11px] text-muted-foreground">{brandTagline}</p>
					</div>
				</div>
				<div class="flex items-center gap-2">
					<OrganizationSwitcher
						{organizations}
						activeOrganizationId={activeOrganization?.id ?? null}
						{activeOrganizationName}
						loading={loadingSession}
						busy={switchingOrganization || switchingClassroom}
						compact={true}
						onSelect={submitSetActiveOrganizationFromHeader}
					/>
					{#if activeOrganization && classrooms.length > 0}
						<ClassroomSwitcher
							{classrooms}
							activeClassroomId={activeClassroom?.id ?? null}
							{activeClassroomName}
							loading={loadingSession}
							busy={switchingOrganization || switchingClassroom}
							compact={true}
							onSelect={submitSetActiveClassroomFromHeader}
						/>
					{/if}
				</div>
			</header>

			{@render children()}
		</div>
	</div>

	{#if mobileMenuOpen}
		<div class="fixed inset-0 z-50 md:hidden">
			<button
				type="button"
				class="absolute inset-0 bg-stone-04/35"
				onclick={closeMobileMenu}
				aria-label="メニューを閉じる"
			></button>
			<aside class="absolute inset-y-0 left-0 w-72 border-r border-border/80 bg-sidebar shadow-xl">
				<div class="flex h-full flex-col justify-between">
					<div class="space-y-5 px-5 py-5">
						<div class="flex items-start justify-between gap-3">
							<div class="flex min-w-0 items-center gap-3">
								<img
									alt=""
									aria-hidden="true"
									class="size-10 shrink-0 rounded-2xl border border-border/80 bg-white shadow-sm"
									height="40"
									src={brandMarkHref}
									width="40"
								/>
								<div class="min-w-0">
									<p class="truncate text-sm font-semibold text-foreground">{brandName}</p>
									<p class="truncate text-xs text-muted-foreground">{brandTagline}</p>
								</div>
							</div>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								onclick={closeMobileMenu}
								aria-label="メニューを閉じる"
							>
								<X class="size-5" aria-hidden="true" />
							</Button>
						</div>
						<p class="text-sm font-semibold text-foreground">{sessionUserName}</p>

						{#if canSwitchToAdmin || canSwitchToParticipant}
							<div class="grid grid-cols-1 gap-2">
								{#if canSwitchToAdmin}
									<Button
										type="button"
										variant="outline"
										class="w-full justify-start"
										onclick={() => switchPortal('admin')}>管理者へ切替</Button
									>
								{/if}
								{#if canSwitchToParticipant}
									<Button
										type="button"
										variant="outline"
										class="w-full justify-start"
										onclick={() => switchPortal('participant')}>参加者へ切替</Button
									>
								{/if}
							</div>
						{/if}

						{#if showAdminSectionTabs}
							<div class="inline-flex rounded-md border border-border bg-card p-1">
								{#each sectionTabs as tab (tab.href)}
									<a
										href={resolve(resolvePortalHref(tab.href) as ResolvablePath)}
										onclick={closeMobileMenu}
										class={`rounded px-3 py-1.5 text-sm transition-colors ${
											activeSectionTab === tab.href
												? 'font-semibold text-primary'
												: 'text-secondary-foreground hover:text-foreground'
										}`}
									>
										{tab.label}
									</a>
								{/each}
							</div>
						{/if}

						<nav class="space-y-2" aria-label="機能メニュー(モバイル)">
							{#each visibleNavSections as section (section.id)}
								<div class="rounded-lg border border-border/80 bg-card/70">
									<button
										type="button"
										class="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold text-secondary-foreground"
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
										<div
											id={`mobile-sidebar-section-${section.id}`}
											class="space-y-1 border-t border-border/70 p-2"
										>
											{#each section.items as item (item.href)}
												<a
													href={resolve(resolvePortalHref(item.href) as ResolvablePath)}
													onclick={closeMobileMenu}
													class={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
														isActive(item.href)
															? 'bg-sidebar-accent text-sidebar-accent-foreground'
															: 'text-secondary-foreground hover:bg-secondary'
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
					<div class="border-t border-border/70 px-5 py-4">
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
	<AiChatWidget
		active={isLoggedIn}
		organizationId={activeOrganization?.id ?? null}
		classroomId={activeClassroom?.id ?? null}
		currentPage={pathname}
	/>
{:else}
	<div class="min-h-screen bg-background">
		<header class="border-b border-border/70 bg-card/90 backdrop-blur">
			<div class="mx-auto flex w-full max-w-7xl items-center px-4 py-3 md:px-8">
				<a
					href={resolve('/' as ResolvablePath)}
					class="inline-flex items-center gap-3 text-foreground no-underline hover:no-underline"
				>
					<img
						alt=""
						aria-hidden="true"
						class="size-11 shrink-0 rounded-2xl border border-border/80 bg-white shadow-sm"
						height="44"
						src={brandMarkHref}
						width="44"
					/>
					<span class="flex min-w-0 flex-col">
						<span class="truncate text-sm font-semibold md:text-base">{brandName}</span>
						<span class="truncate text-xs text-muted-foreground md:text-sm">{brandTagline}</span>
					</span>
				</a>
			</div>
		</header>
		{@render children()}
	</div>
{/if}
