export type ScopedRouteContext = {
	orgSlug: string;
	classroomSlug: string;
};

export type PortalSection = 'admin' | 'participant';

const scopedRouteRoots = new Set(['admin', 'participant', 'events']);

const ensureLeadingSlash = (value: string): string =>
	value.startsWith('/') ? value : `/${value}`;

const normalizePathname = (value: string): string => {
	const trimmed = value.trim();
	if (!trimmed) {
		return '/';
	}
	const [pathname] = ensureLeadingSlash(trimmed).split(/[?#]/, 1);
	return pathname || '/';
};

const splitPathAndSuffix = (value: string): { pathname: string; suffix: string } => {
	const match = /^(?<pathname>[^?#]*)(?<suffix>[?#].*)?$/u.exec(value.trim());
	return {
		pathname: ensureLeadingSlash(match?.groups?.pathname ?? '/'),
		suffix: match?.groups?.suffix ?? ''
	};
};

export const extractScopedRouteContext = (path: string): ScopedRouteContext | null => {
	const pathname = normalizePathname(path);
	const match = /^\/([^/]+)\/([^/]+)\/([^/]+)(?:\/.*)?$/u.exec(pathname);
	if (!match) {
		return null;
	}
	const routeRoot = decodeURIComponent(match[3] ?? '').trim();
	if (!scopedRouteRoots.has(routeRoot)) {
		return null;
	}
	const orgSlug = decodeURIComponent(match[1] ?? '').trim();
	const classroomSlug = decodeURIComponent(match[2] ?? '').trim();
	if (!orgSlug || !classroomSlug) {
		return null;
	}
	return { orgSlug, classroomSlug };
};

export const splitScopedPath = (
	path: string
): {
	context: ScopedRouteContext | null;
	remainderPath: string;
} => {
	const pathname = normalizePathname(path);
	const context = extractScopedRouteContext(pathname);
	if (!context) {
		return {
			context: null,
			remainderPath: pathname
		};
	}
	const prefix = `/${encodeURIComponent(context.orgSlug)}/${encodeURIComponent(context.classroomSlug)}`;
	const remainder = pathname.slice(prefix.length);
	return {
		context,
		remainderPath: remainder.length > 0 ? ensureLeadingSlash(remainder) : '/'
	};
};

export const buildScopedPath = (context: ScopedRouteContext, targetPath: string): string => {
	const { pathname, suffix } = splitPathAndSuffix(targetPath);
	const alreadyScoped = extractScopedRouteContext(pathname);
	if (
		alreadyScoped &&
		alreadyScoped.orgSlug === context.orgSlug &&
		alreadyScoped.classroomSlug === context.classroomSlug
	) {
		return `${pathname}${suffix}`;
	}
	const normalizedPath = normalizePathname(pathname);
	const scopedBase = `/${encodeURIComponent(context.orgSlug)}/${encodeURIComponent(context.classroomSlug)}`;
	if (normalizedPath === '/') {
		return `${scopedBase}${suffix}`;
	}
	return `${scopedBase}${normalizedPath}${suffix}`;
};

export const buildScopedPortalPath = (
	context: ScopedRouteContext,
	portal: PortalSection
): string => buildScopedPath(context, portal === 'admin' ? '/admin/dashboard' : '/participant/home');

export const isPortalPath = (targetPath: string): boolean => {
	const normalizedPath = normalizePathname(targetPath);
	return (
		normalizedPath === '/admin' ||
		normalizedPath.startsWith('/admin/') ||
		normalizedPath === '/participant' ||
		normalizedPath.startsWith('/participant/') ||
		normalizedPath === '/events' ||
		normalizedPath.startsWith('/events/')
	);
};

export const getRoutePathFromUrlPath = (path: string): string => {
	const { context, remainderPath } = splitScopedPath(path);
	return context && isPortalPath(remainderPath) ? remainderPath : normalizePathname(path);
};

export const replacePortalPathWithScopedContext = (
	targetPath: string,
	context: ScopedRouteContext
): string => {
	const { pathname, suffix } = splitPathAndSuffix(targetPath);
	const { context: currentContext, remainderPath } = splitScopedPath(pathname);
	const portalPath = currentContext ? remainderPath : normalizePathname(pathname);
	if (!isPortalPath(portalPath)) {
		return targetPath;
	}
	if (
		currentContext &&
		currentContext.orgSlug === context.orgSlug &&
		currentContext.classroomSlug === context.classroomSlug
	) {
		return `${pathname}${suffix}`;
	}
	return `${buildScopedPath(context, portalPath)}${suffix}`;
};

export const readWindowScopedRouteContext = (): ScopedRouteContext | null => {
	if (typeof window === 'undefined') {
		return null;
	}
	return extractScopedRouteContext(window.location.pathname);
};
