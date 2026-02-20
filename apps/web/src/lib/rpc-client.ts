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

export type InvitationPayload = {
	id: string;
	organizationId: string;
	organizationName?: string;
	email: string;
	role: string;
	status: string;
	inviterId: string;
	expiresAt: string;
	createdAt: string;
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

export type ParticipantInvitationPayload = {
	id: string;
	organizationId: string;
	organizationName?: string;
	email: string;
	participantName: string;
	status: string;
	expiresAt: string;
	createdAt: string;
	invitedByUserId: string;
	respondedByUserId?: string | null;
	respondedAt?: string | null;
	[key: string]: unknown;
};

export type ServicePayload = {
	id: string;
	organizationId: string;
	name: string;
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

export type OrganizationRole = 'admin' | 'member';
export type OrganizationLogoUploadPayload = {
	key: string;
	logoUrl: string;
	contentType: string;
	originalContentType: string;
	size: number;
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

type CreateInvitationInput = {
	email: string;
	role: OrganizationRole;
	organizationId?: string;
	resend?: boolean;
};

type InvitationActionInput = {
	invitationId: string;
};

type CreateParticipantInvitationInput = {
	email: string;
	participantName: string;
	organizationId?: string;
	resend?: boolean;
};

type CreateServiceInput = {
	organizationId?: string;
	name: string;
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

type ListServicesQuery = {
	organizationId?: string;
	includeArchived?: boolean;
};

type CreateSlotInput = {
	organizationId?: string;
	serviceId: string;
	startAt: string;
	endAt: string;
	capacity?: number;
	staffLabel?: string;
	locationLabel?: string;
};

type ListSlotsQuery = {
	organizationId?: string;
	serviceId?: string;
	from: string;
	to: string;
	status?: 'open' | 'canceled' | 'completed';
};

type CancelSlotInput = {
	slotId: string;
	reason?: string;
};

type CreateRecurringScheduleInput = {
	organizationId?: string;
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
	serviceId?: string;
	isActive?: boolean;
};

type UpsertRecurringExceptionInput = {
	recurringScheduleId: string;
	date: string;
	action: 'skip' | 'override';
	overrideStartTimeLocal?: string;
	overrideDurationMinutes?: number;
	overrideCapacity?: number;
};

type GenerateRecurringSlotsInput = {
	recurringScheduleId: string;
	from?: string;
	to?: string;
};

type CreateBookingInput = {
	slotId: string;
	participantsCount?: number;
};

type BookingActionInput = {
	bookingId: string;
	reason?: string;
};

type BookingNoShowInput = {
	bookingId: string;
};

type ListBookingsQuery = {
	organizationId?: string;
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
	name: string;
	serviceIds?: string[];
	totalCount: number;
	expiresInDays?: number;
	isActive?: boolean;
};

type ListTicketTypesQuery = {
	organizationId?: string;
	isActive?: boolean;
};

type GrantTicketPackInput = {
	organizationId?: string;
	participantId: string;
	ticketTypeId: string;
	count?: number;
	expiresAt?: string;
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
					full: {
						$get: (args?: { query: OrganizationQuery }) => Promise<Response>;
					};
					'set-active': {
						$post: (args: { json: SetActiveOrganizationInput }) => Promise<Response>;
					};
					invitations: {
						$get: (args?: { query: OrganizationQuery }) => Promise<Response>;
						$post: (args: { json: CreateInvitationInput }) => Promise<Response>;
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
					};
					'ticket-packs': {
						mine: {
							$get: (args?: { query: OrganizationQuery }) => Promise<Response>;
						};
						grant: {
							$post: (args: { json: GrantTicketPackInput }) => Promise<Response>;
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
	getSession: () => rpcClient.api.v1.auth.session.$get(),
	signIn: (json: SignInInput) => rpcClient.api.v1.auth['sign-in'].$post({ json }),
	signUp: (json: SignUpInput) => rpcClient.api.v1.auth['sign-up'].$post({ json }),
	signOut: () => rpcClient.api.v1.auth['sign-out'].$post(),
	listOrganizations: () => rpcClient.api.v1.auth.organizations.$get(),
	createOrganization: (json: CreateOrganizationInput) =>
		rpcClient.api.v1.auth.organizations.$post({ json }),
	setActiveOrganization: (json: SetActiveOrganizationInput) =>
		rpcClient.api.v1.auth.organizations['set-active'].$post({ json }),
	getFullOrganization: (organizationId?: string) =>
		rpcClient.api.v1.auth.organizations.full.$get(
			organizationId ? { query: { organizationId } } : undefined
		),
	listInvitations: (organizationId?: string) =>
		rpcClient.api.v1.auth.organizations.invitations.$get(
			organizationId ? { query: { organizationId } } : undefined
		),
	createInvitation: (json: CreateInvitationInput) =>
		rpcClient.api.v1.auth.organizations.invitations.$post({ json }),
	listUserInvitations: () => rpcClient.api.v1.auth.organizations.invitations.user.$get(),
	getInvitationDetail: (invitationId: string) =>
		rpcClient.api.v1.auth.organizations.invitations.detail.$get({ query: { invitationId } }),
	acceptInvitation: (json: InvitationActionInput) =>
		rpcClient.api.v1.auth.organizations.invitations.accept.$post({ json }),
	rejectInvitation: (json: InvitationActionInput) =>
		rpcClient.api.v1.auth.organizations.invitations.reject.$post({ json }),
	cancelInvitation: (json: InvitationActionInput) =>
		rpcClient.api.v1.auth.organizations.invitations.cancel.$post({ json }),
	listParticipants: (organizationId?: string) =>
		rpcClient.api.v1.auth.organizations.participants.$get(
			organizationId ? { query: { organizationId } } : undefined
		),
	listParticipantInvitations: (organizationId?: string) =>
		rpcClient.api.v1.auth.organizations.participants.invitations.$get(
			organizationId ? { query: { organizationId } } : undefined
		),
	createParticipantInvitation: (json: CreateParticipantInvitationInput) =>
		rpcClient.api.v1.auth.organizations.participants.invitations.$post({ json }),
	listUserParticipantInvitations: () =>
		rpcClient.api.v1.auth.organizations.participants.invitations.user.$get(),
	getParticipantInvitationDetail: (invitationId: string) =>
		rpcClient.api.v1.auth.organizations.participants.invitations.detail.$get({
			query: { invitationId }
		}),
	acceptParticipantInvitation: (json: InvitationActionInput) =>
		rpcClient.api.v1.auth.organizations.participants.invitations.accept.$post({ json }),
	rejectParticipantInvitation: (json: InvitationActionInput) =>
		rpcClient.api.v1.auth.organizations.participants.invitations.reject.$post({ json }),
	cancelParticipantInvitation: (json: InvitationActionInput) =>
		rpcClient.api.v1.auth.organizations.participants.invitations.cancel.$post({ json }),
	listServices: (query?: ListServicesQuery) =>
		rpcClient.api.v1.auth.organizations.services.$get(query ? { query } : undefined),
	createService: (json: CreateServiceInput) => rpcClient.api.v1.auth.organizations.services.$post({ json }),
	updateService: (json: UpdateServiceInput) =>
		rpcClient.api.v1.auth.organizations.services.update.$post({ json }),
	archiveService: (json: ArchiveServiceInput) =>
		rpcClient.api.v1.auth.organizations.services.archive.$post({ json }),
	listSlots: (query: ListSlotsQuery) => rpcClient.api.v1.auth.organizations.slots.$get({ query }),
	createSlot: (json: CreateSlotInput) => rpcClient.api.v1.auth.organizations.slots.$post({ json }),
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
	grantTicketPack: (json: GrantTicketPackInput) =>
		rpcClient.api.v1.auth.organizations['ticket-packs'].grant.$post({ json }),
	listMyTicketPacks: (organizationId?: string) =>
		rpcClient.api.v1.auth.organizations['ticket-packs'].mine.$get(
			organizationId ? { query: { organizationId } } : undefined
		)
};
