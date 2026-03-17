export type AuthPortal = 'admin' | 'participant';

export const ADMIN_LOGIN_PATH = '/admin/login' as const;
export const PARTICIPANT_LOGIN_PATH = '/participant/login' as const;
export const AUTH_ENTRY_SELECTION_PATH = '/' as const;

const ADMIN_LEGACY_PATH_PREFIXES = [
	'/dashboard',
	'/settings',
	'/contracts',
	'/participants',
	'/admin-invitations',
	'/admin'
] as const;

const PARTICIPANT_ACCESS_PATH_PREFIXES = ['/bookings', '/events', '/participant'] as const;

const PARTICIPANT_INVITATION_ACCEPT_PATH = '/participants/invitations/accept';
const ADMIN_INVITATION_ACCEPT_PATH = '/invitations/accept';

const ensureLeadingSlash = (value: string): string => (value.startsWith('/') ? value : `/${value}`);

const normalizePathname = (value: string): string => {
	const trimmed = value.trim();
	if (!trimmed) {
		return AUTH_ENTRY_SELECTION_PATH;
	}

	const withLeadingSlash = ensureLeadingSlash(trimmed);
	const [pathname] = withLeadingSlash.split(/[?#]/, 1);
	return pathname || AUTH_ENTRY_SELECTION_PATH;
};

const isPathMatch = (pathname: string, basePath: string): boolean =>
	pathname === basePath || pathname.startsWith(`${basePath}/`);

export const isInviteAcceptancePath = (path: string): boolean => {
	const pathname = normalizePathname(path);
	return (
		isPathMatch(pathname, ADMIN_INVITATION_ACCEPT_PATH) ||
		isPathMatch(pathname, PARTICIPANT_INVITATION_ACCEPT_PATH)
	);
};

export const resolveAuthPortalByPath = (path: string): AuthPortal | null => {
	const pathname = normalizePathname(path);

	const scopedPortalMatch = /^\/[^/]+\/[^/]+\/(admin|participant)(?:\/|$)/u.exec(pathname);
	if (scopedPortalMatch?.[1] === 'admin') {
		return 'admin';
	}
	if (scopedPortalMatch?.[1] === 'participant') {
		return 'participant';
	}

	if (isPathMatch(pathname, ADMIN_INVITATION_ACCEPT_PATH)) {
		return 'admin';
	}

	if (isPathMatch(pathname, PARTICIPANT_INVITATION_ACCEPT_PATH)) {
		return 'participant';
	}

	for (const basePath of ADMIN_LEGACY_PATH_PREFIXES) {
		if (isPathMatch(pathname, basePath)) {
			return 'admin';
		}
	}

	for (const basePath of PARTICIPANT_ACCESS_PATH_PREFIXES) {
		if (isPathMatch(pathname, basePath)) {
			return 'participant';
		}
	}

	return null;
};

export const resolveLoginPathForNext = (
	nextPath: string
): typeof ADMIN_LOGIN_PATH | typeof PARTICIPANT_LOGIN_PATH | typeof AUTH_ENTRY_SELECTION_PATH => {
	const portal = resolveAuthPortalByPath(nextPath);
	if (portal === 'admin') {
		return ADMIN_LOGIN_PATH;
	}
	if (portal === 'participant') {
		return PARTICIPANT_LOGIN_PATH;
	}
	return AUTH_ENTRY_SELECTION_PATH;
};

const normalizeNextPath = (value: string): string => {
	const trimmed = value.trim();
	if (!trimmed.startsWith('/')) {
		return AUTH_ENTRY_SELECTION_PATH;
	}
	return trimmed;
};

export const buildLoginRedirectHref = (nextPath: string): string => {
	const normalizedNextPath = normalizeNextPath(nextPath);
	const loginPath = resolveLoginPathForNext(normalizedNextPath);
	return `${loginPath}?next=${encodeURIComponent(normalizedNextPath)}`;
};

export const isPublicAuthEntryPath = (path: string): boolean => {
	const pathname = normalizePathname(path);
	return (
		pathname === AUTH_ENTRY_SELECTION_PATH ||
		pathname === ADMIN_LOGIN_PATH ||
		pathname === PARTICIPANT_LOGIN_PATH
	);
};
