import { env } from '$env/dynamic/public';
import { hc } from 'hono/client';

const backendUrl = env.PUBLIC_BACKEND_URL || 'http://localhost:3000';

type JsonRecord = Record<string, unknown>;

export type AuthSessionPayload = {
	user: JsonRecord;
	session: JsonRecord;
} | null;

export type OrganizationPayload = {
	id: string;
	name: string;
	slug: string;
	logo?: string | null;
	metadata?: unknown;
	[key: string]: unknown;
};

export type ClassroomPayload = {
	id: string;
	slug: string;
	name: string;
	logo?: string | null;
	facts: AccessFactsPayload;
	effective: AccessEffectivePayload;
	sources: AccessSourcesPayload;
	display: AccessDisplayPayload;
	[key: string]: unknown;
};

export type InvitationSubjectKind = 'org_operator' | 'classroom_operator' | 'participant';
export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired';

export type InvitationPayload = {
	id: string;
	organizationId: string;
	organizationSlug: string;
	organizationName: string;
	classroomId?: string | null;
	classroomSlug?: string | null;
	classroomName?: string | null;
	email: string;
	subjectKind: InvitationSubjectKind;
	role: OrganizationInvitationRole | ClassroomInvitationRole;
	participantName?: string | null;
	status: InvitationStatus;
	expiresAt: string | null;
	createdAt: string | null;
	invitedByUserId?: string | null;
	respondedByUserId?: string | null;
	respondedAt?: string | null;
	[key: string]: unknown;
};

export type ParticipantPayload = {
	id: string;
	organizationId: string;
	userId: string;
	email: string;
	name: string;
	createdAt: string;
	updatedAt: string;
	[key: string]: unknown;
};

export type ParticipantInvitationPayload = InvitationPayload;

export type ServicePayload = {
	id: string;
	organizationId: string;
	name: string;
	description?: string | null;
	imageUrl?: string | null;
	kind: 'single' | 'recurring';
	bookingPolicy: 'instant' | 'approval';
	durationMinutes: number;
	capacity: number;
	bookingOpenMinutesBefore?: number | null;
	bookingCloseMinutesBefore?: number | null;
	cancellationDeadlineMinutes?: number | null;
	timezone: string;
	requiresTicket: boolean;
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
	[key: string]: unknown;
};

export type SlotPayload = {
	id: string;
	organizationId: string;
	serviceId: string;
	recurringScheduleId?: string | null;
	startAt: string;
	endAt: string;
	capacity: number;
	reservedCount: number;
	status: 'open' | 'canceled' | 'completed';
	staffLabel?: string | null;
	locationLabel?: string | null;
	bookingOpenAt: string;
	bookingCloseAt: string;
	createdAt: string;
	updatedAt: string;
	[key: string]: unknown;
};

export type RecurringSchedulePayload = {
	id: string;
	organizationId: string;
	serviceId: string;
	timezone: string;
	frequency: 'weekly' | 'monthly';
	interval: number;
	byWeekday?: number[];
	byMonthday?: number | null;
	startDate: string;
	endDate?: string | null;
	startTimeLocal: string;
	durationMinutes?: number | null;
	capacityOverride?: number | null;
	isActive: boolean;
	lastGeneratedAt?: string | null;
	createdAt: string;
	updatedAt: string;
	[key: string]: unknown;
};

export type BookingPayload = {
	id: string;
	organizationId: string;
	slotId: string;
	serviceId: string;
	participantId: string;
	participantsCount: number;
	status:
		| 'confirmed'
		| 'pending_approval'
		| 'rejected_by_staff'
		| 'cancelled_by_participant'
		| 'cancelled_by_staff'
		| 'no_show';
	cancelReason?: string | null;
	cancelledAt?: string | null;
	cancelledByUserId?: string | null;
	noShowMarkedAt?: string | null;
	ticketPackId?: string | null;
	createdAt: string;
	updatedAt: string;
	[key: string]: unknown;
};

export type TicketTypePayload = {
	id: string;
	organizationId: string;
	name: string;
	serviceIds?: string[];
	totalCount: number;
	expiresInDays?: number | null;
	isActive: boolean;
	isForSale: boolean;
	stripePriceId?: string | null;
	createdAt: string;
	updatedAt: string;
	[key: string]: unknown;
};

export type TicketPackPayload = {
	id: string;
	organizationId: string;
	participantId: string;
	ticketTypeId: string;
	initialCount: number;
	remainingCount: number;
	expiresAt?: string | null;
	status: 'active' | 'exhausted' | 'expired';
	createdAt: string;
	updatedAt: string;
	[key: string]: unknown;
};

export type TicketPurchaseMethod = 'stripe' | 'cash_on_site' | 'bank_transfer';

export type TicketPurchaseStatus =
	| 'pending_payment'
	| 'pending_approval'
	| 'approved'
	| 'rejected'
	| 'cancelled_by_participant';

export type TicketPurchasePayload = {
	id: string;
	organizationId: string;
	participantId: string;
	ticketTypeId: string;
	paymentMethod: TicketPurchaseMethod;
	status: TicketPurchaseStatus;
	ticketPackId?: string | null;
	stripeCheckoutSessionId?: string | null;
	approvedByUserId?: string | null;
	approvedAt?: string | null;
	rejectedByUserId?: string | null;
	rejectedAt?: string | null;
	rejectReason?: string | null;
	createdAt: string;
	updatedAt: string;
	checkoutUrl?: string | null;
	[key: string]: unknown;
};

export type PublicEventListItemPayload = {
	organizationId: string;
	serviceId: string;
	serviceName: string;
	serviceDescription?: string | null;
	serviceImageUrl?: string | null;
	serviceKind: 'single' | 'recurring';
	bookingPolicy: 'instant' | 'approval';
	requiresTicket: boolean;
	slotId: string;
	startAt: string;
	endAt: string;
	slotStatus: 'open' | 'canceled' | 'completed';
	capacity: number;
	reservedCount: number;
	remainingCount: number;
	bookingOpenAt: string;
	bookingCloseAt: string;
	isBookable: boolean;
	staffLabel?: string | null;
	locationLabel?: string | null;
	[key: string]: unknown;
};

export type PublicEventDetailPayload = PublicEventListItemPayload;

export type OrganizationMembershipRole = 'owner' | 'admin' | 'member';
export type OrganizationInvitationRole = 'admin' | 'member';
export type ClassroomInvitationRole = 'manager' | 'staff' | 'participant';
export type ClassroomStaffRole = 'manager' | 'staff';
export type ClassroomRole = 'manager' | 'staff' | 'participant';
export type AccessDisplayRole = 'owner' | 'admin' | 'manager' | 'staff' | 'participant';
export type AccessSource = 'org_role' | 'classroom_member' | 'participant_record';
export type ScopedApiContext = {
	orgSlug: string;
	classroomSlug: string;
};
export type AccessFactsPayload = {
	orgRole: OrganizationMembershipRole | null;
	classroomStaffRole: ClassroomStaffRole | null;
	hasParticipantRecord: boolean;
};
export type AccessEffectivePayload = {
	canManageOrganization: boolean;
	canManageClassroom: boolean;
	canManageBookings: boolean;
	canManageParticipants: boolean;
	canUseParticipantBooking: boolean;
};
export type AccessSourcesPayload = {
	canManageOrganization: 'org_role' | null;
	canManageClassroom: 'org_role' | 'classroom_member' | null;
	canManageBookings: 'org_role' | 'classroom_member' | null;
	canManageParticipants: 'org_role' | 'classroom_member' | null;
	canUseParticipantBooking: 'participant_record' | null;
};
export type AccessDisplayPayload = {
	primaryRole: AccessDisplayRole | null;
	badges: AccessDisplayRole[];
};
export type AccessTreeClassroomPayload = {
	id: string;
	slug: string;
	name: string;
	logo?: string | null;
	facts: AccessFactsPayload;
	effective: AccessEffectivePayload;
	sources: AccessSourcesPayload;
	display: AccessDisplayPayload;
	[key: string]: unknown;
};

export type AccessTreeOrganizationPayload = {
	org: {
		id: string;
		slug: string;
		name: string;
		logo?: string | null;
		[key: string]: unknown;
	};
	classrooms: AccessTreeClassroomPayload[];
	[key: string]: unknown;
};

export type AccessTreePayload = {
	orgs: AccessTreeOrganizationPayload[];
	[key: string]: unknown;
};
export type OrganizationLogoUploadPayload = {
	key: string;
	logoUrl: string;
	contentType: string;
	originalContentType: string;
	size: number;
};

export type ServiceImageUploadUrlPayload = {
	key: string;
	uploadUrl: string;
	imageUrl: string;
	expiresAt: string;
	contentType: string;
	maxUploadBytes: number;
};

type SignInInput = {
	email: string;
	password: string;
};

type SignUpInput = {
	name: string;
	email: string;
	password: string;
};

type CreateOrganizationInput = {
	name: string;
	slug: string;
	logo?: string;
	keepCurrentActiveOrganization?: boolean;
};

type SetActiveOrganizationInput = {
	organizationId?: string | null;
	organizationSlug?: string;
};

type CreateClassroomInput = {
	name: string;
	slug: string;
};

type UpdateClassroomInput = {
	name: string;
	slug: string;
};

type CreateOrganizationInvitationInput = {
	email: string;
	role: OrganizationInvitationRole;
	resend?: boolean;
};

type InvitationActionInput = {
	invitationId: string;
};

type CreateParticipantInvitationInput = {
	email: string;
	participantName: string;
	resend?: boolean;
};

type CreateClassroomInvitationInput = {
	email: string;
	role: ClassroomInvitationRole;
	participantName?: string;
	resend?: boolean;
};

type SelfEnrollParticipantInput = {
	organizationId: string;
	classroomId?: string;
};

type CreateServiceInput = {
	organizationId?: string;
	classroomId?: string;
	name: string;
	description?: string | null;
	imageUrl?: string | null;
	kind: 'single' | 'recurring';
	bookingPolicy?: 'instant' | 'approval';
	durationMinutes: number;
	capacity: number;
	bookingOpenMinutesBefore?: number;
	bookingCloseMinutesBefore?: number;
	cancellationDeadlineMinutes?: number;
	timezone?: string;
	requiresTicket?: boolean;
	isActive?: boolean;
};

type UpdateServiceInput = {
	serviceId: string;
	name?: string;
	description?: string | null;
	imageUrl?: string | null;
	kind?: 'single' | 'recurring';
	bookingPolicy?: 'instant' | 'approval';
	durationMinutes?: number;
	capacity?: number;
	bookingOpenMinutesBefore?: number;
	bookingCloseMinutesBefore?: number;
	cancellationDeadlineMinutes?: number;
	timezone?: string;
	requiresTicket?: boolean;
	isActive?: boolean;
};

type ArchiveServiceInput = {
	serviceId: string;
};

type CreateServiceImageUploadUrlInput = {
	organizationId?: string;
	classroomId?: string;
	fileName?: string;
	contentType: string;
	size: number;
};

type ListServicesQuery = {
	organizationId?: string;
	classroomId?: string;
	includeArchived?: boolean;
};

type CreateSlotInput = {
	organizationId?: string;
	classroomId?: string;
	serviceId: string;
	startAt: string;
	endAt: string;
	capacity?: number;
	staffLabel?: string;
	locationLabel?: string;
};

type UpdateSlotInput = {
	slotId: string;
	classroomId?: string;
	startAt: string;
	endAt: string;
	capacity?: number;
	staffLabel?: string;
	locationLabel?: string;
};

type ListSlotsQuery = {
	organizationId?: string;
	classroomId?: string;
	serviceId?: string;
	from: string;
	to: string;
	status?: 'open' | 'canceled' | 'completed';
};

type CancelSlotInput = {
	slotId: string;
	classroomId?: string;
	reason?: string;
};

type CreateRecurringScheduleInput = {
	organizationId?: string;
	classroomId?: string;
	serviceId: string;
	timezone?: string;
	frequency: 'weekly' | 'monthly';
	interval: number;
	byWeekday?: number[];
	byMonthday?: number;
	startDate: string;
	endDate?: string;
	startTimeLocal: string;
	durationMinutes?: number;
	capacityOverride?: number;
};

type UpdateRecurringScheduleInput = {
	recurringScheduleId: string;
	classroomId?: string;
	timezone?: string;
	frequency?: 'weekly' | 'monthly';
	interval?: number;
	byWeekday?: number[];
	byMonthday?: number;
	startDate?: string;
	endDate?: string;
	startTimeLocal?: string;
	durationMinutes?: number;
	capacityOverride?: number;
	isActive?: boolean;
};

type ListRecurringSchedulesQuery = {
	organizationId?: string;
	classroomId?: string;
	serviceId?: string;
	isActive?: boolean;
};

type UpsertRecurringExceptionInput = {
	recurringScheduleId: string;
	classroomId?: string;
	date: string;
	action: 'skip' | 'override';
	overrideStartTimeLocal?: string;
	overrideDurationMinutes?: number;
	overrideCapacity?: number;
};

type GenerateRecurringSlotsInput = {
	recurringScheduleId: string;
	classroomId?: string;
	from?: string;
	to?: string;
};

type CreateBookingInput = {
	slotId: string;
	classroomId?: string;
	participantsCount?: number;
};

type BookingActionInput = {
	bookingId: string;
	classroomId?: string;
	reason?: string;
};

type BookingNoShowInput = {
	bookingId: string;
	classroomId?: string;
};

type ListBookingsQuery = {
	organizationId?: string;
	classroomId?: string;
	serviceId?: string;
	from?: string;
	to?: string;
	participantId?: string;
	status?:
		| 'confirmed'
		| 'pending_approval'
		| 'rejected_by_staff'
		| 'cancelled_by_participant'
		| 'cancelled_by_staff'
		| 'no_show';
};

type CreateTicketTypeInput = {
	organizationId?: string;
	classroomId?: string;
	name: string;
	serviceIds?: string[];
	totalCount: number;
	expiresInDays?: number;
	isActive?: boolean;
	isForSale?: boolean;
	stripePriceId?: string;
};

type ListTicketTypesQuery = {
	organizationId?: string;
	classroomId?: string;
	isActive?: boolean;
};

type GrantTicketPackInput = {
	organizationId?: string;
	classroomId?: string;
	participantId: string;
	ticketTypeId: string;
	count?: number;
	expiresAt?: string;
};

type CreateTicketPurchaseInput = {
	organizationId?: string;
	classroomId?: string;
	ticketTypeId: string;
	paymentMethod: TicketPurchaseMethod;
};

type ListTicketPurchasesQuery = {
	organizationId?: string;
	classroomId?: string;
	participantId?: string;
	paymentMethod?: TicketPurchaseMethod;
	status?: TicketPurchaseStatus;
};

type ListMyTicketPurchasesQuery = {
	organizationId?: string;
	classroomId?: string;
	status?: TicketPurchaseStatus;
};

type TicketPurchaseApproveInput = {
	purchaseId: string;
	classroomId?: string;
};

type TicketPurchaseRejectInput = {
	purchaseId: string;
	classroomId?: string;
	reason?: string;
};

type TicketPurchaseCancelInput = {
	purchaseId: string;
	classroomId?: string;
};

type OrganizationQuery = {
	organizationId?: string;
};

type InvitationDetailQuery = {
	invitationId: string;
};

type GoogleOidcQuery = {
	callbackURL?: string;
	errorCallbackURL?: string;
	newUserCallbackURL?: string;
	disableRedirect?: boolean;
};

type AuthRpcClient = {
	api: {
		v1: {
			auth: {
				session: {
					$get: () => Promise<Response>;
				};
				'sign-in': {
					$post: (args: { json: SignInInput }) => Promise<Response>;
				};
				'sign-up': {
					$post: (args: { json: SignUpInput }) => Promise<Response>;
				};
				'sign-out': {
					$post: () => Promise<Response>;
				};
				organizations: {
					$get: () => Promise<Response>;
					$post: (args: { json: CreateOrganizationInput }) => Promise<Response>;
					access: {
						$get: () => Promise<Response>;
					};
					full: {
						$get: (args?: { query: OrganizationQuery }) => Promise<Response>;
					};
					'set-active': {
						$post: (args: { json: SetActiveOrganizationInput }) => Promise<Response>;
					};
					invitations: {
						$get: (args?: { query: OrganizationQuery }) => Promise<Response>;
						$post: (args: { json: CreateOrganizationInvitationInput }) => Promise<Response>;
						detail: {
							$get: (args: { query: InvitationDetailQuery }) => Promise<Response>;
						};
						accept: {
							$post: (args: { json: InvitationActionInput }) => Promise<Response>;
						};
						reject: {
							$post: (args: { json: InvitationActionInput }) => Promise<Response>;
						};
						cancel: {
							$post: (args: { json: InvitationActionInput }) => Promise<Response>;
						};
						user: {
							$get: () => Promise<Response>;
						};
					};
					participants: {
						$get: (args?: { query: OrganizationQuery }) => Promise<Response>;
						'self-enroll': {
							$post: (args: { json: SelfEnrollParticipantInput }) => Promise<Response>;
						};
						invitations: {
							$get: (args?: { query: OrganizationQuery }) => Promise<Response>;
							$post: (args: { json: CreateParticipantInvitationInput }) => Promise<Response>;
							user: {
								$get: () => Promise<Response>;
							};
							detail: {
								$get: (args: { query: InvitationDetailQuery }) => Promise<Response>;
							};
							accept: {
								$post: (args: { json: InvitationActionInput }) => Promise<Response>;
							};
							reject: {
								$post: (args: { json: InvitationActionInput }) => Promise<Response>;
							};
							cancel: {
								$post: (args: { json: InvitationActionInput }) => Promise<Response>;
							};
						};
					};
					services: {
						$get: (args?: { query: ListServicesQuery }) => Promise<Response>;
						$post: (args: { json: CreateServiceInput }) => Promise<Response>;
						update: {
							$post: (args: { json: UpdateServiceInput }) => Promise<Response>;
						};
						archive: {
							$post: (args: { json: ArchiveServiceInput }) => Promise<Response>;
						};
					};
					slots: {
						$get: (args: { query: ListSlotsQuery }) => Promise<Response>;
						$post: (args: { json: CreateSlotInput }) => Promise<Response>;
						update: {
							$post: (args: { json: UpdateSlotInput }) => Promise<Response>;
						};
						available: {
							$get: (args: { query: ListSlotsQuery }) => Promise<Response>;
						};
						cancel: {
							$post: (args: { json: CancelSlotInput }) => Promise<Response>;
						};
					};
					'recurring-schedules': {
						$get: (args?: { query: ListRecurringSchedulesQuery }) => Promise<Response>;
						$post: (args: { json: CreateRecurringScheduleInput }) => Promise<Response>;
						update: {
							$post: (args: { json: UpdateRecurringScheduleInput }) => Promise<Response>;
						};
						exceptions: {
							$post: (args: { json: UpsertRecurringExceptionInput }) => Promise<Response>;
						};
						generate: {
							$post: (args: { json: GenerateRecurringSlotsInput }) => Promise<Response>;
						};
					};
					bookings: {
						$get: (args?: { query: ListBookingsQuery }) => Promise<Response>;
						$post: (args: { json: CreateBookingInput }) => Promise<Response>;
						mine: {
							$get: (args?: { query: ListBookingsQuery }) => Promise<Response>;
						};
						cancel: {
							$post: (args: { json: BookingActionInput }) => Promise<Response>;
						};
						'cancel-by-staff': {
							$post: (args: { json: BookingActionInput }) => Promise<Response>;
						};
						approve: {
							$post: (args: { json: { bookingId: string } }) => Promise<Response>;
						};
						reject: {
							$post: (args: { json: BookingActionInput }) => Promise<Response>;
						};
						'no-show': {
							$post: (args: { json: BookingNoShowInput }) => Promise<Response>;
						};
					};
					'ticket-types': {
						$get: (args?: { query: ListTicketTypesQuery }) => Promise<Response>;
						$post: (args: { json: CreateTicketTypeInput }) => Promise<Response>;
						purchasable: {
							$get: (args?: { query: OrganizationQuery }) => Promise<Response>;
						};
					};
					'ticket-packs': {
						mine: {
							$get: (args?: { query: OrganizationQuery }) => Promise<Response>;
						};
						grant: {
							$post: (args: { json: GrantTicketPackInput }) => Promise<Response>;
						};
					};
					'ticket-purchases': {
						$get: (args?: { query: ListTicketPurchasesQuery }) => Promise<Response>;
						$post: (args: { json: CreateTicketPurchaseInput }) => Promise<Response>;
						mine: {
							$get: (args?: { query: ListMyTicketPurchasesQuery }) => Promise<Response>;
						};
						approve: {
							$post: (args: { json: TicketPurchaseApproveInput }) => Promise<Response>;
						};
						reject: {
							$post: (args: { json: TicketPurchaseRejectInput }) => Promise<Response>;
						};
						cancel: {
							$post: (args: { json: TicketPurchaseCancelInput }) => Promise<Response>;
						};
					};
				};
			};
		};
	};
};

const rpcClient = hc(backendUrl, {
	init: {
		credentials: 'include'
	}
}) as unknown as AuthRpcClient;

type QueryValue = string | number | boolean | null | undefined;

const buildApiUrl = (path: string, query?: Record<string, QueryValue>): URL => {
	const url = new URL(path, backendUrl);
	if (query) {
		for (const [key, value] of Object.entries(query)) {
			if (value === undefined || value === null) {
				continue;
			}
			url.searchParams.set(key, String(value));
		}
	}
	return url;
};

const buildScopedAuthPath = (
	context: ScopedApiContext,
	suffix: string
): `/api/v1/auth/orgs/${string}/classrooms/${string}${string}` =>
	`/api/v1/auth/orgs/${encodeURIComponent(context.orgSlug)}/classrooms/${encodeURIComponent(context.classroomSlug)}${suffix}`;

const buildOrgAuthPath = (orgSlug: string, suffix = ''): `/api/v1/auth/orgs/${string}${string}` =>
	`/api/v1/auth/orgs/${encodeURIComponent(orgSlug)}${suffix}`;

const authFetch = (
	path: string,
	options: {
		method?: 'GET' | 'POST' | 'PATCH';
		query?: Record<string, QueryValue>;
		json?: unknown;
		body?: BodyInit;
		headers?: HeadersInit;
	} = {}
) => {
	const headers = new Headers(options.headers);
	const shouldUseJson = options.json !== undefined;
	if (shouldUseJson && !headers.has('content-type')) {
		headers.set('content-type', 'application/json');
	}
	return fetch(buildApiUrl(path, options.query), {
		method: options.method ?? (shouldUseJson || options.body ? 'POST' : 'GET'),
		headers,
		body: shouldUseJson ? JSON.stringify(options.json) : options.body,
		credentials: 'include'
	});
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isAccessEffectivePayload = (value: unknown): value is AccessEffectivePayload =>
	isRecord(value) &&
	typeof value.canManageOrganization === 'boolean' &&
	typeof value.canManageClassroom === 'boolean' &&
	typeof value.canManageBookings === 'boolean' &&
	typeof value.canManageParticipants === 'boolean' &&
	typeof value.canUseParticipantBooking === 'boolean';

type ScopedIdentifiers = {
	organizationId: string;
	classroomId: string;
};

const scopedIdentifiersCache = new Map<string, Promise<ScopedIdentifiers | null>>();

const scopedIdentifiersCacheKey = (context: ScopedApiContext) =>
	`${context.orgSlug}::${context.classroomSlug}`;

const parseJsonResponse = async (response: Response): Promise<unknown> => {
	const contentType = response.headers.get('content-type') ?? '';
	if (contentType.includes('application/json')) {
		return response.json();
	}
	const text = await response.text();
	if (!text) {
		return null;
	}
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
};

const createScopedResolutionErrorResponse = (message: string, status = 404) =>
	new Response(JSON.stringify({ message }), {
		status,
		headers: {
			'content-type': 'application/json'
		}
	});

const resolveScopedIdentifiers = async (
	context: ScopedApiContext
): Promise<ScopedIdentifiers | null> => {
	const cacheKey = scopedIdentifiersCacheKey(context);
	const cached = scopedIdentifiersCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const pending = (async () => {
		const response = await authFetch('/api/v1/auth/orgs/access-tree');
		const payload = await parseJsonResponse(response);
		if (!response.ok || !isRecord(payload) || !Array.isArray(payload.orgs)) {
			return null;
		}

		let organizationId: string | null = null;

		for (const orgEntry of payload.orgs) {
			if (!isRecord(orgEntry) || !isRecord(orgEntry.org) || !Array.isArray(orgEntry.classrooms)) {
				continue;
			}
			if (
				orgEntry.org.slug !== context.orgSlug ||
				typeof orgEntry.org.id !== 'string'
			) {
				continue;
			}
			organizationId = orgEntry.org.id;
			for (const classroom of orgEntry.classrooms) {
				if (
					isRecord(classroom) &&
					classroom.slug === context.classroomSlug &&
					typeof classroom.id === 'string'
				) {
					return {
						organizationId: orgEntry.org.id,
						classroomId: classroom.id
					};
				}
			}
		}

		if (!organizationId) {
			return null;
		}

		const classroomsResponse = await authFetch(
			`/api/v1/auth/orgs/${encodeURIComponent(context.orgSlug)}/classrooms`
		);
		const classroomsPayload = await parseJsonResponse(classroomsResponse);
		if (!classroomsResponse.ok || !Array.isArray(classroomsPayload)) {
			return null;
		}

		for (const classroom of classroomsPayload) {
			if (
				isRecord(classroom) &&
				classroom.slug === context.classroomSlug &&
				typeof classroom.id === 'string' &&
				isAccessEffectivePayload(classroom.effective)
			) {
				return {
					organizationId,
					classroomId: classroom.id
				};
			}
		}

		return null;
	})();

	scopedIdentifiersCache.set(cacheKey, pending);
	const resolved = await pending;
	if (!resolved) {
		scopedIdentifiersCache.delete(cacheKey);
	}
	return resolved;
};

const withScopedQuery = async <TQuery extends Record<string, QueryValue>>(
	context: ScopedApiContext,
	query: TQuery | undefined,
	request: (resolvedQuery: TQuery & ScopedIdentifiers) => Promise<Response>
) => {
	const identifiers = await resolveScopedIdentifiers(context);
	if (!identifiers) {
		return createScopedResolutionErrorResponse('組織または教室コンテキストの解決に失敗しました。');
	}
	return request({
		...(query ?? ({} as TQuery)),
		...identifiers
	});
};

const withScopedJson = async <TJson extends Record<string, unknown>>(
	context: ScopedApiContext,
	json: TJson,
	request: (resolvedJson: TJson & ScopedIdentifiers) => Promise<Response>
) => {
	const identifiers = await resolveScopedIdentifiers(context);
	if (!identifiers) {
		return createScopedResolutionErrorResponse('組織または教室コンテキストの解決に失敗しました。');
	}
	return request({
		...json,
		...identifiers
	});
};

export const authRpc = {
	backendUrl,
	buildGoogleOidcStartURL: (query?: GoogleOidcQuery) => {
		const url = new URL('/api/v1/auth/oidc/google', backendUrl);
		if (query?.callbackURL) {
			url.searchParams.set('callbackURL', query.callbackURL);
		}
		if (query?.errorCallbackURL) {
			url.searchParams.set('errorCallbackURL', query.errorCallbackURL);
		}
		if (query?.newUserCallbackURL) {
			url.searchParams.set('newUserCallbackURL', query.newUserCallbackURL);
		}
		if (query?.disableRedirect !== undefined) {
			url.searchParams.set('disableRedirect', query.disableRedirect ? 'true' : 'false');
		}
		return url.toString();
	},
	uploadOrganizationLogo: (file: File) => {
		const formData = new FormData();
		formData.set('file', file);

		return fetch(new URL('/api/v1/auth/organizations/logo', backendUrl), {
			method: 'POST',
			body: formData,
			credentials: 'include'
		});
	},
	createServiceImageUploadUrl: (json: CreateServiceImageUploadUrlInput) =>
		fetch(new URL('/api/v1/auth/organizations/services/images/upload-url', backendUrl), {
			method: 'POST',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify(json),
			credentials: 'include'
		}),
	uploadServiceImageBySignedUrl: (uploadUrl: string, file: File, contentType: string) =>
		fetch(uploadUrl, {
			method: 'PUT',
			headers: {
				'content-type': contentType
			},
			body: file,
			credentials: 'omit'
		}),
	getSession: () => rpcClient.api.v1.auth.session.$get(),
	signIn: (json: SignInInput) => rpcClient.api.v1.auth['sign-in'].$post({ json }),
	signUp: (json: SignUpInput) => rpcClient.api.v1.auth['sign-up'].$post({ json }),
	signOut: () => rpcClient.api.v1.auth['sign-out'].$post(),
	listOrganizations: () => authFetch('/api/v1/auth/organizations'),
	getAccessTree: () => authFetch('/api/v1/auth/orgs/access-tree'),
	listClassroomsByOrg: (orgSlug: string) => authFetch(buildOrgAuthPath(orgSlug, '/classrooms')),
	createClassroomByOrg: (orgSlug: string, json: CreateClassroomInput) =>
		authFetch(buildOrgAuthPath(orgSlug, '/classrooms'), { json }),
	updateClassroomByOrg: (orgSlug: string, classroomSlug: string, json: UpdateClassroomInput) =>
		authFetch(buildOrgAuthPath(orgSlug, `/classrooms/${encodeURIComponent(classroomSlug)}`), {
			method: 'PATCH',
			json
		}),
	createOrganization: (json: CreateOrganizationInput) =>
		authFetch('/api/v1/auth/organizations', { json }),
	setActiveOrganization: (json: SetActiveOrganizationInput) =>
		rpcClient.api.v1.auth.organizations['set-active'].$post({ json }),
	getFullOrganization: (organizationId?: string) =>
		rpcClient.api.v1.auth.organizations.full.$get(
			organizationId ? { query: { organizationId } } : undefined
		),
	listOrganizationInvitationsByOrg: (orgSlug: string) =>
		authFetch(buildOrgAuthPath(orgSlug, '/invitations')),
	createOrganizationInvitationByOrg: (orgSlug: string, json: CreateOrganizationInvitationInput) =>
		authFetch(buildOrgAuthPath(orgSlug, '/invitations'), { json }),
	listUserInvitations: () => authFetch('/api/v1/auth/invitations/user'),
	getInvitationDetail: (invitationId: string) =>
		authFetch(`/api/v1/auth/invitations/${encodeURIComponent(invitationId)}`),
	acceptInvitation: ({ invitationId }: InvitationActionInput) =>
		authFetch(`/api/v1/auth/invitations/${encodeURIComponent(invitationId)}/accept`, { json: {} }),
	rejectInvitation: ({ invitationId }: InvitationActionInput) =>
		authFetch(`/api/v1/auth/invitations/${encodeURIComponent(invitationId)}/reject`, { json: {} }),
	cancelInvitation: ({ invitationId }: InvitationActionInput) =>
		authFetch(`/api/v1/auth/invitations/${encodeURIComponent(invitationId)}/cancel`, { json: {} }),
	listParticipants: (organizationId?: string) =>
		rpcClient.api.v1.auth.organizations.participants.$get(
			organizationId ? { query: { organizationId } } : undefined
		),
	selfEnrollParticipant: (json: SelfEnrollParticipantInput) =>
		rpcClient.api.v1.auth.organizations.participants['self-enroll'].$post({ json }),
	listUserParticipantInvitations: () => authFetch('/api/v1/auth/invitations/user'),
	getParticipantInvitationDetail: (invitationId: string) =>
		authFetch(`/api/v1/auth/invitations/${encodeURIComponent(invitationId)}`),
	acceptParticipantInvitation: ({ invitationId }: InvitationActionInput) =>
		authFetch(`/api/v1/auth/invitations/${encodeURIComponent(invitationId)}/accept`, { json: {} }),
	rejectParticipantInvitation: ({ invitationId }: InvitationActionInput) =>
		authFetch(`/api/v1/auth/invitations/${encodeURIComponent(invitationId)}/reject`, { json: {} }),
	cancelParticipantInvitation: ({ invitationId }: InvitationActionInput) =>
		authFetch(`/api/v1/auth/invitations/${encodeURIComponent(invitationId)}/cancel`, { json: {} }),
	listServices: (query?: ListServicesQuery) =>
		rpcClient.api.v1.auth.organizations.services.$get(query ? { query } : undefined),
	createService: (json: CreateServiceInput) => rpcClient.api.v1.auth.organizations.services.$post({ json }),
	updateService: (json: UpdateServiceInput) =>
		rpcClient.api.v1.auth.organizations.services.update.$post({ json }),
	archiveService: (json: ArchiveServiceInput) =>
		rpcClient.api.v1.auth.organizations.services.archive.$post({ json }),
	listSlots: (query: ListSlotsQuery) => rpcClient.api.v1.auth.organizations.slots.$get({ query }),
	createSlot: (json: CreateSlotInput) => rpcClient.api.v1.auth.organizations.slots.$post({ json }),
	updateSlot: (json: UpdateSlotInput) =>
		rpcClient.api.v1.auth.organizations.slots.update.$post({ json }),
	listAvailableSlots: (query: ListSlotsQuery) =>
		rpcClient.api.v1.auth.organizations.slots.available.$get({ query }),
	cancelSlot: (json: CancelSlotInput) =>
		rpcClient.api.v1.auth.organizations.slots.cancel.$post({ json }),
	listRecurringSchedules: (query?: ListRecurringSchedulesQuery) =>
		rpcClient.api.v1.auth.organizations['recurring-schedules'].$get(query ? { query } : undefined),
	createRecurringSchedule: (json: CreateRecurringScheduleInput) =>
		rpcClient.api.v1.auth.organizations['recurring-schedules'].$post({ json }),
	updateRecurringSchedule: (json: UpdateRecurringScheduleInput) =>
		rpcClient.api.v1.auth.organizations['recurring-schedules'].update.$post({ json }),
	upsertRecurringScheduleException: (json: UpsertRecurringExceptionInput) =>
		rpcClient.api.v1.auth.organizations['recurring-schedules'].exceptions.$post({ json }),
	generateRecurringSlots: (json: GenerateRecurringSlotsInput) =>
		rpcClient.api.v1.auth.organizations['recurring-schedules'].generate.$post({ json }),
	createBooking: (json: CreateBookingInput) => rpcClient.api.v1.auth.organizations.bookings.$post({ json }),
	listMyBookings: (query?: ListBookingsQuery) =>
		rpcClient.api.v1.auth.organizations.bookings.mine.$get(query ? { query } : undefined),
	cancelBooking: (json: BookingActionInput) =>
		rpcClient.api.v1.auth.organizations.bookings.cancel.$post({ json }),
	listBookings: (query?: ListBookingsQuery) =>
		rpcClient.api.v1.auth.organizations.bookings.$get(query ? { query } : undefined),
	cancelBookingByStaff: (json: BookingActionInput) =>
		rpcClient.api.v1.auth.organizations.bookings['cancel-by-staff'].$post({ json }),
	approveBooking: (bookingId: string) =>
		rpcClient.api.v1.auth.organizations.bookings.approve.$post({ json: { bookingId } }),
	rejectBooking: (json: BookingActionInput) =>
		rpcClient.api.v1.auth.organizations.bookings.reject.$post({ json }),
	markBookingNoShow: (json: BookingNoShowInput) =>
		rpcClient.api.v1.auth.organizations.bookings['no-show'].$post({ json }),
	createTicketType: (json: CreateTicketTypeInput) =>
		rpcClient.api.v1.auth.organizations['ticket-types'].$post({ json }),
	listTicketTypes: (query?: ListTicketTypesQuery) =>
		rpcClient.api.v1.auth.organizations['ticket-types'].$get(query ? { query } : undefined),
	listPurchasableTicketTypes: (organizationId?: string) =>
		rpcClient.api.v1.auth.organizations['ticket-types'].purchasable.$get(
			organizationId ? { query: { organizationId } } : undefined
		),
	grantTicketPack: (json: GrantTicketPackInput) =>
		rpcClient.api.v1.auth.organizations['ticket-packs'].grant.$post({ json }),
	listMyTicketPacks: (organizationId?: string) =>
		rpcClient.api.v1.auth.organizations['ticket-packs'].mine.$get(
			organizationId ? { query: { organizationId } } : undefined
		),
	createTicketPurchase: (json: CreateTicketPurchaseInput) =>
		rpcClient.api.v1.auth.organizations['ticket-purchases'].$post({ json }),
	listMyTicketPurchases: (query?: ListMyTicketPurchasesQuery) =>
		rpcClient.api.v1.auth.organizations['ticket-purchases'].mine.$get(
			query ? { query } : undefined
		),
	listTicketPurchases: (query?: ListTicketPurchasesQuery) =>
		rpcClient.api.v1.auth.organizations['ticket-purchases'].$get(query ? { query } : undefined),
	approveTicketPurchase: (json: TicketPurchaseApproveInput) =>
		rpcClient.api.v1.auth.organizations['ticket-purchases'].approve.$post({ json }),
	rejectTicketPurchase: (json: TicketPurchaseRejectInput) =>
		rpcClient.api.v1.auth.organizations['ticket-purchases'].reject.$post({ json }),
	cancelTicketPurchase: (json: TicketPurchaseCancelInput) =>
		rpcClient.api.v1.auth.organizations['ticket-purchases'].cancel.$post({ json }),
	listInvitationsScoped: (context: ScopedApiContext) =>
		authFetch(buildScopedAuthPath(context, '/invitations')),
	createInvitationScoped: (context: ScopedApiContext, json: CreateClassroomInvitationInput) =>
		authFetch(buildScopedAuthPath(context, '/invitations'), { json }),
	listParticipantsScoped: (context: ScopedApiContext) =>
		withScopedQuery(context, undefined, (query) =>
			authFetch('/api/v1/auth/organizations/participants', { query })
		),
	selfEnrollParticipantScoped: (context: ScopedApiContext) =>
		withScopedJson(context, {} as Record<string, never>, (json) =>
			authFetch('/api/v1/auth/organizations/participants/self-enroll', { json })
		),
	listParticipantInvitationsScoped: (context: ScopedApiContext) =>
		authFetch(buildScopedAuthPath(context, '/invitations')),
	createParticipantInvitationScoped: (
		context: ScopedApiContext,
		json: CreateParticipantInvitationInput
	) =>
		authFetch(buildScopedAuthPath(context, '/invitations'), {
			json: {
				email: json.email,
				role: 'participant',
				participantName: json.participantName,
				resend: json.resend
			}
		}),
	listServicesScoped: (context: ScopedApiContext, query?: Omit<ListServicesQuery, 'organizationId'>) =>
		withScopedQuery(context, query, (resolvedQuery) =>
			authFetch('/api/v1/auth/organizations/services', { query: resolvedQuery })
		),
	createServiceScoped: (context: ScopedApiContext, json: CreateServiceInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/services', { json: resolvedJson })
		),
	updateServiceScoped: (context: ScopedApiContext, json: UpdateServiceInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/services/update', { json: resolvedJson })
		),
	archiveServiceScoped: (context: ScopedApiContext, json: ArchiveServiceInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/services/archive', { json: resolvedJson })
		),
	createServiceImageUploadUrlScoped: (context: ScopedApiContext, json: CreateServiceImageUploadUrlInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/services/images/upload-url', { json: resolvedJson })
		),
	listSlotsScoped: (context: ScopedApiContext, query: Omit<ListSlotsQuery, 'organizationId'>) =>
		withScopedQuery(context, query, (resolvedQuery) =>
			authFetch('/api/v1/auth/organizations/slots', { query: resolvedQuery })
		),
	createSlotScoped: (context: ScopedApiContext, json: CreateSlotInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/slots', { json: resolvedJson })
		),
	updateSlotScoped: (context: ScopedApiContext, json: UpdateSlotInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/slots/update', { json: resolvedJson })
		),
	listAvailableSlotsScoped: (
		context: ScopedApiContext,
		query: Omit<ListSlotsQuery, 'organizationId'>
	) =>
		withScopedQuery(context, query, (resolvedQuery) =>
			authFetch('/api/v1/auth/organizations/slots/available', { query: resolvedQuery })
		),
	cancelSlotScoped: (context: ScopedApiContext, json: CancelSlotInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/slots/cancel', { json: resolvedJson })
		),
	listRecurringSchedulesScoped: (
		context: ScopedApiContext,
		query?: Omit<ListRecurringSchedulesQuery, 'organizationId'>
	) =>
		withScopedQuery(context, query, (resolvedQuery) =>
			authFetch('/api/v1/auth/organizations/recurring-schedules', { query: resolvedQuery })
		),
	createRecurringScheduleScoped: (context: ScopedApiContext, json: CreateRecurringScheduleInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/recurring-schedules', { json: resolvedJson })
		),
	updateRecurringScheduleScoped: (context: ScopedApiContext, json: UpdateRecurringScheduleInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/recurring-schedules/update', { json: resolvedJson })
		),
	upsertRecurringScheduleExceptionScoped: (
		context: ScopedApiContext,
		json: UpsertRecurringExceptionInput
	) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/recurring-schedules/exceptions', { json: resolvedJson })
		),
	generateRecurringSlotsScoped: (context: ScopedApiContext, json: GenerateRecurringSlotsInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/recurring-schedules/generate', { json: resolvedJson })
		),
	createBookingScoped: (context: ScopedApiContext, json: CreateBookingInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/bookings', { json: resolvedJson })
		),
	listMyBookingsScoped: (
		context: ScopedApiContext,
		query?: Omit<ListBookingsQuery, 'organizationId'>
	) =>
		withScopedQuery(context, query, (resolvedQuery) =>
			authFetch('/api/v1/auth/organizations/bookings/mine', { query: resolvedQuery })
		),
	cancelBookingScoped: (context: ScopedApiContext, json: BookingActionInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/bookings/cancel', { json: resolvedJson })
		),
	listBookingsScoped: (
		context: ScopedApiContext,
		query?: Omit<ListBookingsQuery, 'organizationId'>
	) =>
		withScopedQuery(context, query, (resolvedQuery) =>
			authFetch('/api/v1/auth/organizations/bookings', { query: resolvedQuery })
		),
	cancelBookingByStaffScoped: (context: ScopedApiContext, json: BookingActionInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/bookings/cancel-by-staff', { json: resolvedJson })
		),
	approveBookingScoped: (context: ScopedApiContext, bookingId: string) =>
		withScopedJson(context, { bookingId }, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/bookings/approve', { json: resolvedJson })
		),
	rejectBookingScoped: (context: ScopedApiContext, json: BookingActionInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/bookings/reject', { json: resolvedJson })
		),
	markBookingNoShowScoped: (context: ScopedApiContext, json: BookingNoShowInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/bookings/no-show', { json: resolvedJson })
		),
	createTicketTypeScoped: (context: ScopedApiContext, json: CreateTicketTypeInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/ticket-types', { json: resolvedJson })
		),
	listTicketTypesScoped: (
		context: ScopedApiContext,
		query?: Omit<ListTicketTypesQuery, 'organizationId'>
	) =>
		withScopedQuery(context, query, (resolvedQuery) =>
			authFetch('/api/v1/auth/organizations/ticket-types', { query: resolvedQuery })
		),
	listPurchasableTicketTypesScoped: (context: ScopedApiContext) =>
		withScopedQuery(context, undefined, (resolvedQuery) =>
			authFetch('/api/v1/auth/organizations/ticket-types/purchasable', { query: resolvedQuery })
		),
	grantTicketPackScoped: (context: ScopedApiContext, json: GrantTicketPackInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/ticket-packs/grant', { json: resolvedJson })
		),
	listMyTicketPacksScoped: (context: ScopedApiContext) =>
		withScopedQuery(context, undefined, (resolvedQuery) =>
			authFetch('/api/v1/auth/organizations/ticket-packs/mine', { query: resolvedQuery })
		),
	createTicketPurchaseScoped: (context: ScopedApiContext, json: CreateTicketPurchaseInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/ticket-purchases', { json: resolvedJson })
		),
	listMyTicketPurchasesScoped: (
		context: ScopedApiContext,
		query?: Omit<ListMyTicketPurchasesQuery, 'organizationId'>
	) =>
		withScopedQuery(context, query, (resolvedQuery) =>
			authFetch('/api/v1/auth/organizations/ticket-purchases/mine', { query: resolvedQuery })
		),
	listTicketPurchasesScoped: (
		context: ScopedApiContext,
		query?: Omit<ListTicketPurchasesQuery, 'organizationId'>
	) =>
		withScopedQuery(context, query, (resolvedQuery) =>
			authFetch('/api/v1/auth/organizations/ticket-purchases', { query: resolvedQuery })
		),
	approveTicketPurchaseScoped: (context: ScopedApiContext, json: TicketPurchaseApproveInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/ticket-purchases/approve', { json: resolvedJson })
		),
	rejectTicketPurchaseScoped: (context: ScopedApiContext, json: TicketPurchaseRejectInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/ticket-purchases/reject', { json: resolvedJson })
		),
	cancelTicketPurchaseScoped: (context: ScopedApiContext, json: TicketPurchaseCancelInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/ticket-purchases/cancel', { json: resolvedJson })
		)
};
