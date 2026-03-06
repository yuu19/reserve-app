export type ScopedRouteContext = {
	orgSlug: string;
	classroomSlug: string;
};

export type PortalSection = 'admin' | 'participant';

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
	const match = /^\/([^/]+)\/([^/]+)(?:\/.*)?$/u.exec(pathname);
	if (!match) {
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

export const replacePortalPathWithScopedContext = (
	targetPath: string,
	context: ScopedRouteContext
): string => {
	const { pathname, suffix } = splitPathAndSuffix(targetPath);
	const normalizedPath = normalizePathname(pathname);
	const isPortalPath =
		normalizedPath === '/admin' ||
		normalizedPath.startsWith('/admin/') ||
		normalizedPath === '/participant' ||
		normalizedPath.startsWith('/participant/') ||
		normalizedPath === '/events' ||
		normalizedPath.startsWith('/events/');
	if (!isPortalPath) {
		return targetPath;
	}
	return `${buildScopedPath(context, normalizedPath)}${suffix}`;
};

export const readWindowScopedRouteContext = (): ScopedRouteContext | null => {
	if (typeof window === 'undefined') {
		return null;
	}
	return extractScopedRouteContext(window.location.pathname);
};
