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

export type OrganizationBillingPayload = {
	organizationId?: string;
	planCode: 'free' | 'premium';
	planState: 'free' | 'premium_trial' | 'premium_paid';
	paidTier?: {
		code: 'premium_default' | 'premium_growth' | 'premium_scale' | 'premium_unknown';
		label: string;
		resolution: 'not_paid' | 'legacy_default' | 'known_price' | 'unknown_price';
		capabilities: Array<'organization_premium_features' | 'advanced_billing_communications'>;
		diagnosticReason: string | null;
	} | null;
	billingInterval: 'month' | 'year' | null;
	paymentMethodStatus: 'not_started' | 'pending' | 'registered';
	subscriptionStatus:
		| 'free'
		| 'trialing'
		| 'active'
		| 'past_due'
		| 'canceled'
		| 'unpaid'
		| 'incomplete'
		| null;
	cancelAtPeriodEnd: boolean;
	trialStartedAt?: string | null;
	currentPeriodEnd: string | null;
	paymentIssueStartedAt?: string | null;
	pastDueGraceEndsAt?: string | null;
	paymentIssueState?:
		| 'none'
		| 'payment_failed'
		| 'payment_action_required'
		| 'past_due_grace_active'
		| 'past_due_grace_expired'
		| 'unpaid'
		| 'incomplete'
		| 'recovered'
		| 'stale_failure_history_only';
	paymentIssueTiming?: {
		issueStartedAt: string | null;
		issueStartedAtSource: 'provider_issue_time' | 'application_receipt_time' | 'none';
		graceEndsAt: string | null;
	};
	nextOwnerAction?: string | null;
	lastReconciledAt?: string | null;
	lastReconciliationReason?: string | null;
	trialEndsAt: string | null;
	premiumEligible?: boolean;
	entitlementState?: 'free_only' | 'premium_enabled';
	entitlementReason?: string;
	capabilities?: string[];
	canViewBilling: boolean;
	canManageBilling: boolean;
	actionAvailability?: {
		canStartTrial: boolean;
		canStartPaidCheckout: boolean;
		canRegisterPaymentMethod: boolean;
		canOpenBillingPortal: boolean;
		trialUsed: boolean;
		availableIntervals: Array<'month' | 'year'>;
		nextOwnerAction: string | null;
		readOnlyReason: string | null;
	};
	billingProfileReadiness?: {
		state: 'complete' | 'incomplete' | 'unavailable' | 'not_required';
		nextAction: string | null;
		checkedAt: string | null;
		gatesCheckout: false;
		gatesPremiumEligibility: false;
	};
	history?: Array<{
		id: string;
		eventType: 'plan_transition' | 'notification' | 'reconciliation' | 'payment_event';
		occurredAt: string | null;
		title: string;
		summary: string;
		billingContext: string | null;
		tone: 'neutral' | 'positive' | 'attention';
	}> | null;
	paymentDocuments?: {
		aggregateRoot: 'billing_account';
		organizationId: string;
		provider: 'stripe';
		stripeCustomerId: string | null;
		stripeSubscriptionId: string | null;
		ownerAccess: 'owner_only';
		persistenceStrategy: 'provider_reference_only';
		documents: Array<{
			documentKind: 'invoice' | 'receipt';
			providerDocumentId: string;
			hostedInvoiceUrl: string | null;
			invoicePdfUrl: string | null;
			receiptUrl: string | null;
			availability: 'available' | 'unavailable' | 'missing' | 'checking';
			ownerFacingStatus: 'available' | 'unavailable' | 'checking';
			providerDerived?: boolean;
		}>;
	} | null;
	invoicePaymentEvents?: Array<{
		id: string;
		organizationId: string;
		stripeEventId: string | null;
		eventType:
			| 'invoice_available'
			| 'payment_succeeded'
			| 'payment_failed'
			| 'payment_action_required';
		stripeCustomerId: string | null;
		stripeSubscriptionId: string | null;
		stripeInvoiceId: string | null;
		stripePaymentIntentId: string | null;
		providerStatus: string | null;
		ownerFacingStatus:
			| 'available'
			| 'checking'
			| 'missing'
			| 'action_required'
			| 'failed'
			| 'succeeded';
		occurredAt: string | null;
		createdAt: string | null;
	}>;
	[key: string]: unknown;
};

export type OrganizationBillingActionEnvelope = {
	status: 'succeeded' | 'processing' | 'conflict' | 'failed';
	message: string | null;
	billing: OrganizationBillingPayload | null;
	url?: string | null;
	handoff: {
		provider: 'stripe';
		purpose: 'trial_start' | 'paid_checkout' | 'payment_method_setup' | 'billing_portal';
		url: string;
		expiresAt: string;
		reused: boolean;
		operationAttemptId?: string;
	} | null;
};

export type StorePayload = {
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

export type InvitationSubjectKind = 'org_operator' | 'store_operator' | 'participant';
export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired';

export type InvitationPayload = {
	id: string;
	organizationId: string;
	organizationSlug: string;
	organizationName: string;
	storeId?: string | null;
	storeSlug?: string | null;
	storeName?: string | null;
	email: string;
	subjectKind: InvitationSubjectKind;
	role: OrganizationInvitationRole | StoreInvitationRole;
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
	storeId: string;
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

export type BookingAnswerPayload = {
	id?: string;
	fieldId: string;
	labelSnapshot: string;
	value: unknown;
	[key: string]: unknown;
};

export type BookingPayload = {
	id: string;
	organizationId: string;
	storeId: string;
	slotId: string;
	serviceId: string;
	participantId: string | null;
	publicId?: string | null;
	source?: 'participant' | 'public_site' | 'admin' | 'phone' | 'line' | 'storefront' | 'other';
	participantsCount: number;
	customerName?: string | null;
	customerEmail?: string | null;
	customerPhone?: string | null;
	note?: string | null;
	createdByUserId?: string | null;
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
	attendanceStatus?: 'not_checked' | 'checked_in' | 'absent' | 'no_show';
	attendanceMarkedAt?: string | null;
	attendanceMarkedByUserId?: string | null;
	ticketPackId?: string | null;
	answers?: BookingAnswerPayload[];
	createdAt: string;
	updatedAt: string;
	[key: string]: unknown;
};

export type TicketTypePayload = {
	id: string;
	organizationId: string;
	name: string;
	serviceScope?: 'all' | 'specific';
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
	storeId: string;
	participantId: string;
	ticketTypeId: string;
	serviceScope?: 'all' | 'specific';
	serviceIds?: string[];
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
	serviceScope?: 'all' | 'specific';
	serviceIds?: string[];
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
	organizationSlug: string;
	storeId: string;
	storeSlug: string;
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

export type PublicTicketTypePayload = {
	id: string;
	name: string;
	totalCount: number;
	expiresInDays?: number | null;
	serviceScope: 'all' | 'specific';
	serviceIds: string[];
	serviceNames: string[];
	href: string;
	[key: string]: unknown;
};

export type PublicEventsPagePayload = {
	events: PublicEventListItemPayload[];
	ticketTypes: PublicTicketTypePayload[];
};

export type PublicSiteIntakeFieldPayload = {
	id?: string;
	fieldId: string;
	label: string;
	fieldType: 'text' | 'textarea' | 'select' | 'checkbox';
	required: boolean;
	options: string[];
	helpText?: string | null;
	placeholder?: string | null;
	visibleOnPublic?: boolean;
	sortOrder?: number;
	[key: string]: unknown;
};

export type PublicEventDetailPayload = PublicEventListItemPayload & {
	ticketTypes: PublicTicketTypePayload[];
	intakeFields: PublicSiteIntakeFieldPayload[];
};

export type PublicSiteProfilePayload = {
	organizationId: string;
	organizationSlug: string;
	organizationName: string;
	storeId: string;
	storeSlug: string;
	storeName: string;
	siteName: string;
	description?: string | null;
	address?: string | null;
	phone?: string | null;
	businessHours?: string | null;
	imageUrl?: string | null;
	status: 'public' | 'private' | 'suspended';
	acceptBookings: boolean;
	noindex: boolean;
	[key: string]: unknown;
};

export type NotificationSettingsPayload = {
	notifyOwner: boolean;
	notifyAdmins: boolean;
	notifyStoreManagers: boolean;
	notifyStaff: boolean;
	additionalEmails: string[];
	[key: string]: unknown;
};

export type ReminderServiceOverridePayload = {
	serviceId: string;
	serviceName: string;
	enabled: boolean;
	timingsMinutes: number[];
	inheritsStoreDefault: boolean;
	[key: string]: unknown;
};

export type ReminderSettingsPayload = {
	enabled: boolean;
	timingsMinutes: number[];
	serviceOverrides: ReminderServiceOverridePayload[];
	[key: string]: unknown;
};

export type PublicSiteIntakeFieldsPayload = {
	fields: PublicSiteIntakeFieldPayload[];
	[key: string]: unknown;
};

export type PublicBookingPagePayload = {
	id: string;
	kind: 'event';
	title: string;
	description?: string | null;
	imageUrl?: string | null;
	href: string;
	serviceId: string;
	slotId: string;
	startAt: string;
	endAt: string;
	remainingCount: number;
	capacity: number;
	isBookable: boolean;
	locationLabel?: string | null;
	[key: string]: unknown;
};

export type PublicSitePagePayload = {
	site: PublicSiteProfilePayload;
	bookingPages: PublicBookingPagePayload[];
	ticketTypes: PublicTicketTypePayload[];
};

export type OrganizationMembershipRole = 'owner' | 'admin' | 'member';
export type OrganizationInvitationRole = 'admin' | 'member';
export type StoreInvitationRole = 'manager' | 'staff' | 'participant';
export type StoreStaffRole = 'manager' | 'staff';
export type StoreRole = 'manager' | 'staff' | 'participant';
export type AccessDisplayRole = 'owner' | 'admin' | 'manager' | 'staff' | 'participant';
export type AccessSource = 'org_role' | 'store_member' | 'participant_record';
export type ScopedApiContext = {
	orgSlug: string;
	storeSlug: string;
};
export type AccessFactsPayload = {
	orgRole: OrganizationMembershipRole | null;
	storeStaffRole: StoreStaffRole | null;
	hasParticipantRecord: boolean;
};
export type AccessEffectivePayload = {
	canManageOrganization: boolean;
	canManageStore: boolean;
	canManageBookings: boolean;
	canManageParticipants: boolean;
	canUseParticipantBooking: boolean;
};
export type AccessSourcesPayload = {
	canManageOrganization: 'org_role' | null;
	canManageStore: 'org_role' | 'store_member' | null;
	canManageBookings: 'org_role' | 'store_member' | null;
	canManageParticipants: 'org_role' | 'store_member' | null;
	canUseParticipantBooking: 'participant_record' | null;
};
export type AccessDisplayPayload = {
	primaryRole: AccessDisplayRole | null;
	badges: AccessDisplayRole[];
};
export type AccessTreeStorePayload = {
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
	stores: AccessTreeStorePayload[];
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

type CreateOrganizationBillingCheckoutInput = {
	organizationId?: string;
	billingInterval: 'month' | 'year';
};

type CreateOrganizationBillingPortalInput = {
	organizationId?: string;
};

type CreateOrganizationBillingTrialInput = {
	organizationId?: string;
};

type CreateStoreInput = {
	name: string;
	slug: string;
};

type UpdateStoreInput = {
	name: string;
	slug: string;
};

export type UpdatePublicSiteSettingsInput = {
	siteName?: string | null;
	description?: string | null;
	address?: string | null;
	phone?: string | null;
	businessHours?: string | null;
	imageUrl?: string | null;
	status?: 'public' | 'private' | 'suspended';
	acceptBookings?: boolean;
	noindex?: boolean;
};

export type UpdatePublicSiteIntakeFieldsInput = {
	fields: Array<{
		fieldId: string;
		label: string;
		fieldType: 'text' | 'textarea' | 'select' | 'checkbox';
		required: boolean;
		options?: string[];
		helpText?: string | null;
		placeholder?: string | null;
		visibleOnPublic: boolean;
	}>;
};

export type UpdateNotificationSettingsInput = {
	notifyOwner: boolean;
	notifyAdmins: boolean;
	notifyStoreManagers: boolean;
	notifyStaff: boolean;
	additionalEmails: string[];
};

export type UpdateReminderSettingsInput = {
	enabled: boolean;
	timingsMinutes: number[];
	serviceOverrides?: Array<{
		serviceId: string;
		enabled: boolean;
		timingsMinutes: number[];
		inheritsStoreDefault: boolean;
	}>;
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

type CreateStoreInvitationInput = {
	email: string;
	role: StoreInvitationRole;
	participantName?: string;
	resend?: boolean;
};

type SelfEnrollParticipantInput = {
	organizationId: string;
	storeId?: string;
};

type CreateServiceInput = {
	organizationId?: string;
	storeId?: string;
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
	storeId?: string;
	fileName?: string;
	contentType: string;
	size: number;
};

type ListServicesQuery = {
	organizationId?: string;
	storeId?: string;
	includeArchived?: boolean;
};

type CreateSlotInput = {
	organizationId?: string;
	storeId?: string;
	serviceId: string;
	startAt: string;
	endAt: string;
	capacity?: number;
	staffLabel?: string;
	locationLabel?: string;
};

type UpdateSlotInput = {
	slotId: string;
	storeId?: string;
	startAt: string;
	endAt: string;
	capacity?: number;
	staffLabel?: string;
	locationLabel?: string;
};

type ListSlotsQuery = {
	organizationId?: string;
	storeId?: string;
	serviceId?: string;
	from: string;
	to: string;
	status?: 'open' | 'canceled' | 'completed';
};

type CancelSlotInput = {
	slotId: string;
	storeId?: string;
	reason?: string;
};

type CreateRecurringScheduleInput = {
	organizationId?: string;
	storeId?: string;
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
	storeId?: string;
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
	storeId?: string;
	serviceId?: string;
	isActive?: boolean;
};

type UpsertRecurringExceptionInput = {
	recurringScheduleId: string;
	storeId?: string;
	date: string;
	action: 'skip' | 'override';
	overrideStartTimeLocal?: string;
	overrideDurationMinutes?: number;
	overrideCapacity?: number;
};

type GenerateRecurringSlotsInput = {
	recurringScheduleId: string;
	storeId?: string;
	from?: string;
	to?: string;
};

type CreateBookingInput = {
	slotId: string;
	storeId?: string;
	participantsCount?: number;
};

export type BookingSource = 'admin' | 'phone' | 'line' | 'storefront' | 'other';

export type BookingCompanionInput = {
	name: string;
	note?: string | null;
};

export type BookingAnswerInput = {
	fieldId: string;
	labelSnapshot: string;
	value: unknown;
};

export type CreatePublicBookingInput = {
	slotId: string;
	customerName: string;
	customerEmail: string;
	customerPhone?: string;
	participantsCount?: number;
	companions?: BookingCompanionInput[];
	note?: string;
	answers?: BookingAnswerInput[];
};

export type PublicBookingResultPayload = {
	bookingId: string;
	bookingPublicId: string;
	status: 'confirmed' | 'pending_approval';
};

export type CancelPublicBookingInput = {
	token: string;
	reason?: string;
};

export type StaffCreateBookingInput = {
	slotId: string;
	participantId?: string;
	customerName?: string;
	customerEmail?: string;
	customerPhone?: string;
	participantsCount?: number;
	source?: BookingSource;
	notifyCustomer?: boolean;
	companions?: BookingCompanionInput[];
	note?: string;
	answers?: BookingAnswerInput[];
};

type BookingActionInput = {
	bookingId: string;
	storeId?: string;
	reason?: string;
};

type BookingNoShowInput = {
	bookingId: string;
	storeId?: string;
};

export type BookingAttendanceStatus = 'not_checked' | 'checked_in' | 'absent';

type BookingAttendanceInput = {
	bookingId: string;
	storeId?: string;
	attendanceStatus: BookingAttendanceStatus;
};

type BookingRescheduleInput = {
	bookingId: string;
	targetSlotId: string;
	storeId?: string;
	reason?: string;
};

type ListBookingsQuery = {
	organizationId?: string;
	storeId?: string;
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
	storeId?: string;
	name: string;
	serviceScope?: 'all' | 'specific';
	serviceIds?: string[];
	totalCount: number;
	expiresInDays?: number;
	isActive?: boolean;
	isForSale?: boolean;
	stripePriceId?: string;
};

type UpdateTicketTypeInput = {
	organizationId?: string;
	storeId?: string;
	ticketTypeId: string;
	name?: string;
	serviceScope?: 'all' | 'specific';
	serviceIds?: string[];
	totalCount?: number;
	expiresInDays?: number | null;
	isActive?: boolean;
	isForSale?: boolean;
};

type ListTicketTypesQuery = {
	organizationId?: string;
	storeId?: string;
	isActive?: boolean;
};

type GrantTicketPackInput = {
	organizationId?: string;
	storeId?: string;
	participantId: string;
	ticketTypeId: string;
	count?: number;
	expiresAt?: string;
};

type ListTicketPacksQuery = {
	organizationId?: string;
	storeId?: string;
	participantId: string;
};

type AdjustTicketPackInput = {
	ticketPackId: string;
	storeId?: string;
	remainingCount?: number;
	expiresAt?: string | null;
	reason: string;
};

type CreateTicketPurchaseInput = {
	organizationId?: string;
	storeId?: string;
	ticketTypeId: string;
	paymentMethod: TicketPurchaseMethod;
};

type ListTicketPurchasesQuery = {
	organizationId?: string;
	storeId?: string;
	participantId?: string;
	paymentMethod?: TicketPurchaseMethod;
	status?: TicketPurchaseStatus;
};

type ListMyTicketPurchasesQuery = {
	organizationId?: string;
	storeId?: string;
	status?: TicketPurchaseStatus;
};

type TicketPurchaseApproveInput = {
	purchaseId: string;
	storeId?: string;
};

type TicketPurchaseRejectInput = {
	purchaseId: string;
	storeId?: string;
	reason?: string;
};

type TicketPurchaseCancelInput = {
	purchaseId: string;
	storeId?: string;
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
						reschedule: {
							$post: (args: { json: BookingRescheduleInput }) => Promise<Response>;
						};
						'no-show': {
							$post: (args: { json: BookingNoShowInput }) => Promise<Response>;
						};
						'check-in': {
							$post: (args: { json: BookingAttendanceInput }) => Promise<Response>;
						};
					};
					'ticket-types': {
						$get: (args?: { query: ListTicketTypesQuery }) => Promise<Response>;
						$post: (args: { json: CreateTicketTypeInput }) => Promise<Response>;
						update: {
							$post: (args: { json: UpdateTicketTypeInput }) => Promise<Response>;
						};
						purchasable: {
							$get: (args?: { query: OrganizationQuery }) => Promise<Response>;
						};
					};
					'ticket-packs': {
						$get: (args?: { query: ListTicketPacksQuery }) => Promise<Response>;
						mine: {
							$get: (args?: { query: OrganizationQuery }) => Promise<Response>;
						};
						grant: {
							$post: (args: { json: GrantTicketPackInput }) => Promise<Response>;
						};
						adjust: {
							$post: (args: { json: AdjustTicketPackInput }) => Promise<Response>;
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
): `/api/v1/auth/orgs/${string}/stores/${string}${string}` =>
	`/api/v1/auth/orgs/${encodeURIComponent(context.orgSlug)}/stores/${encodeURIComponent(context.storeSlug)}${suffix}`;

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
	// Hono RPC で表現しにくい scoped endpoint は、ここで cookie 付き fetch に統一する。
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

const publicFetch = (
	path: string,
	options: {
		method?: 'GET' | 'POST';
		query?: Record<string, QueryValue>;
		json?: unknown;
		headers?: HeadersInit;
	} = {}
) => {
	const headers = new Headers(options.headers);
	const shouldUseJson = options.json !== undefined;
	if (shouldUseJson && !headers.has('content-type')) {
		headers.set('content-type', 'application/json');
	}
	return fetch(buildApiUrl(path, options.query), {
		method: options.method ?? (shouldUseJson ? 'POST' : 'GET'),
		headers,
		body: shouldUseJson ? JSON.stringify(options.json) : undefined,
		credentials: 'omit'
	});
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isAccessEffectivePayload = (value: unknown): value is AccessEffectivePayload =>
	isRecord(value) &&
	typeof value.canManageOrganization === 'boolean' &&
	typeof value.canManageStore === 'boolean' &&
	typeof value.canManageBookings === 'boolean' &&
	typeof value.canManageParticipants === 'boolean' &&
	typeof value.canUseParticipantBooking === 'boolean';

type ScopedIdentifiers = {
	organizationId: string;
	storeId: string;
};

const scopedIdentifiersCache = new Map<string, Promise<ScopedIdentifiers | null>>();

const scopedIdentifiersCacheKey = (context: ScopedApiContext) =>
	`${context.orgSlug}::${context.storeSlug}`;

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
		// access-tree で slug から id を解決できる場合は追加 API を避ける。
		// 旧 payload や部分的な権限だけの user では stores endpoint に fallback する。
		const response = await authFetch('/api/v1/auth/orgs/access-tree');
		const payload = await parseJsonResponse(response);
		if (!response.ok || !isRecord(payload) || !Array.isArray(payload.orgs)) {
			return null;
		}

		let organizationId: string | null = null;

		for (const orgEntry of payload.orgs) {
			if (!isRecord(orgEntry) || !isRecord(orgEntry.org) || !Array.isArray(orgEntry.stores)) {
				continue;
			}
			if (orgEntry.org.slug !== context.orgSlug || typeof orgEntry.org.id !== 'string') {
				continue;
			}
			organizationId = orgEntry.org.id;
			for (const store of orgEntry.stores) {
				if (isRecord(store) && store.slug === context.storeSlug && typeof store.id === 'string') {
					return {
						organizationId: orgEntry.org.id,
						storeId: store.id
					};
				}
			}
		}

		if (!organizationId) {
			return null;
		}

		const storesResponse = await authFetch(
			`/api/v1/auth/orgs/${encodeURIComponent(context.orgSlug)}/stores`
		);
		const storesPayload = await parseJsonResponse(storesResponse);
		if (!storesResponse.ok || !Array.isArray(storesPayload)) {
			return null;
		}

		for (const store of storesPayload) {
			if (
				isRecord(store) &&
				store.slug === context.storeSlug &&
				typeof store.id === 'string' &&
				isAccessEffectivePayload(store.effective)
			) {
				return {
					organizationId,
					storeId: store.id
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
		return createScopedResolutionErrorResponse('組織または店舗コンテキストの解決に失敗しました。');
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
		return createScopedResolutionErrorResponse('組織または店舗コンテキストの解決に失敗しました。');
	}
	return request({
		...json,
		...identifiers
	});
};

/**
 * web UI が backend auth API を呼ぶための集約 client。
 *
 * 型付き Hono RPC で足りるものと、scoped path や file upload のような fetch helper をここで揃える。
 */
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
	listStoresByOrg: (orgSlug: string) => authFetch(buildOrgAuthPath(orgSlug, '/stores')),
	createStoreByOrg: (orgSlug: string, json: CreateStoreInput) =>
		authFetch(buildOrgAuthPath(orgSlug, '/stores'), { json }),
	updateStoreByOrg: (orgSlug: string, storeSlug: string, json: UpdateStoreInput) =>
		authFetch(buildOrgAuthPath(orgSlug, `/stores/${encodeURIComponent(storeSlug)}`), {
			method: 'PATCH',
			json
		}),
	getPublicSiteSettings: (context: ScopedApiContext) =>
		authFetch(buildScopedAuthPath(context, '/public-site')),
	updatePublicSiteSettings: (context: ScopedApiContext, json: UpdatePublicSiteSettingsInput) =>
		authFetch(buildScopedAuthPath(context, '/public-site'), {
			method: 'PATCH',
			json
		}),
	getPublicSiteIntakeFields: (context: ScopedApiContext) =>
		authFetch(buildScopedAuthPath(context, '/intake-fields')),
	updatePublicSiteIntakeFields: (
		context: ScopedApiContext,
		json: UpdatePublicSiteIntakeFieldsInput
	) =>
		authFetch(buildScopedAuthPath(context, '/intake-fields'), {
			method: 'PATCH',
			json
		}),
	getNotificationSettings: (context: ScopedApiContext) =>
		authFetch(buildScopedAuthPath(context, '/notification-settings')),
	updateNotificationSettings: (context: ScopedApiContext, json: UpdateNotificationSettingsInput) =>
		authFetch(buildScopedAuthPath(context, '/notification-settings'), {
			method: 'PATCH',
			json
		}),
	getReminderSettings: (context: ScopedApiContext) =>
		authFetch(buildScopedAuthPath(context, '/reminder-settings')),
	updateReminderSettings: (context: ScopedApiContext, json: UpdateReminderSettingsInput) =>
		authFetch(buildScopedAuthPath(context, '/reminder-settings'), {
			method: 'PATCH',
			json
		}),
	createPublicBooking: (context: ScopedApiContext, json: CreatePublicBookingInput) =>
		publicFetch(
			`/api/v1/public/orgs/${encodeURIComponent(context.orgSlug)}/stores/${encodeURIComponent(
				context.storeSlug
			)}/bookings`,
			{ json }
		),
	cancelPublicBooking: (
		context: ScopedApiContext,
		bookingPublicId: string,
		json: CancelPublicBookingInput
	) =>
		publicFetch(
			`/api/v1/public/orgs/${encodeURIComponent(context.orgSlug)}/stores/${encodeURIComponent(
				context.storeSlug
			)}/bookings/${encodeURIComponent(bookingPublicId)}/cancel`,
			{ json }
		),
	createOrganization: (json: CreateOrganizationInput) =>
		authFetch('/api/v1/auth/organizations', { json }),
	setActiveOrganization: (json: SetActiveOrganizationInput) =>
		rpcClient.api.v1.auth.organizations['set-active'].$post({ json }),
	getOrganizationBilling: (organizationId?: string) =>
		authFetch('/api/v1/auth/organizations/billing', {
			query: organizationId ? { organizationId } : undefined
		}),
	createOrganizationBillingCheckout: (json: CreateOrganizationBillingCheckoutInput) =>
		authFetch('/api/v1/auth/organizations/billing/checkout', { json }),
	createOrganizationBillingPortal: (json: CreateOrganizationBillingPortalInput) =>
		authFetch('/api/v1/auth/organizations/billing/portal', { json }),
	createOrganizationBillingTrial: (json: CreateOrganizationBillingTrialInput) =>
		authFetch('/api/v1/auth/organizations/billing/trial', { json }),
	createOrganizationBillingPaymentMethod: (json: CreateOrganizationBillingPortalInput) =>
		authFetch('/api/v1/auth/organizations/billing/payment-method', { json }),
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
	createService: (json: CreateServiceInput) =>
		rpcClient.api.v1.auth.organizations.services.$post({ json }),
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
	createBooking: (json: CreateBookingInput) =>
		rpcClient.api.v1.auth.organizations.bookings.$post({ json }),
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
	rescheduleBooking: (json: BookingRescheduleInput) =>
		rpcClient.api.v1.auth.organizations.bookings.reschedule.$post({ json }),
	markBookingNoShow: (json: BookingNoShowInput) =>
		rpcClient.api.v1.auth.organizations.bookings['no-show'].$post({ json }),
	markBookingAttendance: (json: BookingAttendanceInput) =>
		rpcClient.api.v1.auth.organizations.bookings['check-in'].$post({ json }),
	createTicketType: (json: CreateTicketTypeInput) =>
		rpcClient.api.v1.auth.organizations['ticket-types'].$post({ json }),
	updateTicketType: (json: UpdateTicketTypeInput) =>
		rpcClient.api.v1.auth.organizations['ticket-types'].update.$post({ json }),
	listTicketTypes: (query?: ListTicketTypesQuery) =>
		rpcClient.api.v1.auth.organizations['ticket-types'].$get(query ? { query } : undefined),
	listPurchasableTicketTypes: (organizationId?: string) =>
		rpcClient.api.v1.auth.organizations['ticket-types'].purchasable.$get(
			organizationId ? { query: { organizationId } } : undefined
		),
	grantTicketPack: (json: GrantTicketPackInput) =>
		rpcClient.api.v1.auth.organizations['ticket-packs'].grant.$post({ json }),
	listTicketPacks: (query: ListTicketPacksQuery) =>
		rpcClient.api.v1.auth.organizations['ticket-packs'].$get({ query }),
	adjustTicketPack: (json: AdjustTicketPackInput) =>
		rpcClient.api.v1.auth.organizations['ticket-packs'].adjust.$post({ json }),
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
	createInvitationScoped: (context: ScopedApiContext, json: CreateStoreInvitationInput) =>
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
	listServicesScoped: (
		context: ScopedApiContext,
		query?: Omit<ListServicesQuery, 'organizationId'>
	) =>
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
	createServiceImageUploadUrlScoped: (
		context: ScopedApiContext,
		json: CreateServiceImageUploadUrlInput
	) =>
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
	rescheduleBookingScoped: (context: ScopedApiContext, json: BookingRescheduleInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/bookings/reschedule', { json: resolvedJson })
		),
	markBookingNoShowScoped: (context: ScopedApiContext, json: BookingNoShowInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/bookings/no-show', { json: resolvedJson })
		),
	markBookingAttendanceScoped: (context: ScopedApiContext, json: BookingAttendanceInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/bookings/check-in', { json: resolvedJson })
		),
	staffCreateBookingScoped: (context: ScopedApiContext, json: StaffCreateBookingInput) =>
		authFetch(buildScopedAuthPath(context, '/bookings/staff-create'), { json }),
	createTicketTypeScoped: (context: ScopedApiContext, json: CreateTicketTypeInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/ticket-types', { json: resolvedJson })
		),
	updateTicketTypeScoped: (context: ScopedApiContext, json: UpdateTicketTypeInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/ticket-types/update', { json: resolvedJson })
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
	listTicketPacksScoped: (
		context: ScopedApiContext,
		query: Omit<ListTicketPacksQuery, 'organizationId'>
	) =>
		withScopedQuery(context, query, (resolvedQuery) =>
			authFetch('/api/v1/auth/organizations/ticket-packs', { query: resolvedQuery })
		),
	adjustTicketPackScoped: (context: ScopedApiContext, json: AdjustTicketPackInput) =>
		withScopedJson(context, json, (resolvedJson) =>
			authFetch('/api/v1/auth/organizations/ticket-packs/adjust', { json: resolvedJson })
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
