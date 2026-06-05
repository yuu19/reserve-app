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

export type ServicePublicStatus = 'public' | 'private' | 'suspended';
export type SlotPublicStatus = 'public' | 'private' | 'suspended';

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
	publicStatus: ServicePublicStatus;
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
	publicStatus: SlotPublicStatus;
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
		| 'pending_approval'
		| 'confirmed'
		| 'rejected'
		| 'cancelled'
		| 'no_show'
		| 'completed'
		| 'pending_payment'
		| 'expired';
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
	slotPublicStatus: SlotPublicStatus;
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

export type PublicEventDetailPayload = PublicEventListItemPayload & {
	ticketTypes: PublicTicketTypePayload[];
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

export type FormType = 'reservation_input' | 'pre_survey' | 'consent';
export type FormFieldType =
	| 'text'
	| 'textarea'
	| 'radio'
	| 'checkbox'
	| 'select'
	| 'date'
	| 'consent';
export type FormTargetType = 'store' | 'service' | 'slot';
export type FormStatus = 'draft' | 'published' | 'archived';

export type FormOptionPayload = {
	value: string;
	label: string;
};

export type FormFieldPayload = {
	id?: string;
	fieldKey: string;
	fieldType: FormFieldType;
	label: string;
	description: string | null;
	placeholder: string | null;
	required: boolean;
	options: FormOptionPayload[];
	sortOrder: number;
};

export type FormAssignmentPayload = {
	id: string;
	formType: FormType;
	targetType: FormTargetType;
	targetId: string;
	formTemplateId: string;
	createdAt: string;
	updatedAt: string;
};

export type FormPayload = {
	id: string;
	organizationId: string;
	storeId: string;
	formType: FormType;
	name: string;
	description: string | null;
	status: FormStatus;
	currentPublishedVersionId: string | null;
	currentPublishedVersion: {
		id: string;
		versionNumber: number;
		publishedAt: string;
	} | null;
	fields: FormFieldPayload[];
	assignments: FormAssignmentPayload[];
	createdAt: string;
	updatedAt: string;
	archivedAt: string | null;
};

export type FormListPayload = {
	forms: FormPayload[];
};

export type RequiredFormPayload = {
	formTemplateId: string;
	formTemplateVersionId: string;
	formType: FormType;
	name: string;
	description: string | null;
	versionNumber: number;
	fields: Omit<FormFieldPayload, 'id'>[];
};

export type RequiredFormsPayload = {
	formContextHash: string;
	forms: RequiredFormPayload[];
};

export type FormAnswerInput = {
	fieldKey: string;
	value: unknown;
};

export type FormSubmissionInput = {
	formTemplateId: string;
	formTemplateVersionId: string;
	answers?: FormAnswerInput[];
};

export type FormSubmissionSummaryPayload = {
	id: string;
	formTemplateId: string;
	formTemplateVersionId: string;
	formType: FormType;
	bookingId: string | null;
	participantId: string | null;
	customerNameSnapshot: string | null;
	customerEmailSnapshot: string | null;
	source: string;
	submittedAt: string;
	answerCount: number;
};

export type FormSubmissionsPayload = {
	submissions: FormSubmissionSummaryPayload[];
};

export type FormSubmissionDetailPayload = Omit<FormSubmissionSummaryPayload, 'answerCount'> & {
	formName: string;
	versionNumber: number;
	answers: Array<{
		id: string;
		fieldKey: string;
		fieldType: FormFieldType;
		labelSnapshot: string;
		value: unknown;
		sortOrder: number;
		createdAt: string;
	}>;
};

export type FormFieldInput = {
	id?: string;
	fieldKey: string;
	fieldType: FormFieldType;
	label: string;
	description?: string | null;
	placeholder?: string | null;
	required: boolean;
	options?: FormOptionPayload[];
	sortOrder?: number;
};

export type CreateFormInput = {
	formType: FormType;
	name: string;
	description?: string | null;
	fields: FormFieldInput[];
};

export type UpdateFormInput = Partial<
	Pick<CreateFormInput, 'formType' | 'name' | 'description'>
> & {
	fields?: FormFieldInput[];
};

export type CreateFormAssignmentInput = {
	targetType: FormTargetType;
	targetId: string;
};

export type ListFormsQuery = {
	formType?: FormType;
	status?: FormStatus;
	targetType?: FormTargetType;
};

export type RequiredFormsQuery = {
	serviceId?: string;
	slotId?: string;
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
	publicStatus?: ServicePublicStatus;
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
	publicStatus?: ServicePublicStatus;
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
	publicStatus?: SlotPublicStatus;
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

type UpdateSlotPublicStatusInput = {
	slotId: string;
	storeId?: string;
	publicStatus: SlotPublicStatus;
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

export type CreatePublicBookingInput = {
	slotId: string;
	serviceId?: string;
	customer: {
		name: string;
		email: string;
		phone?: string;
	};
	participantsCount?: number;
	companions?: BookingCompanionInput[];
	note?: string;
	formContextHash: string;
	formSubmissions?: FormSubmissionInput[];
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
	formSubmissions?: FormSubmissionInput[];
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
		| 'pending_approval'
		| 'confirmed'
		| 'rejected'
		| 'cancelled'
		| 'no_show'
		| 'completed'
		| 'pending_payment'
		| 'expired';
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
		method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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

const createStoreScopeRequiredResponse = () =>
	new Response(JSON.stringify({ message: 'Store scoped route context is required.' }), {
		status: 400,
		headers: {
			'content-type': 'application/json'
		}
	});

const storeScopeRequired = () => Promise.resolve(createStoreScopeRequiredResponse());
const storeScopeRequiredWithArgs =
	<Args extends unknown[]>() =>
	(...args: Args) => {
		void args;
		return storeScopeRequired();
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
	createServiceImageUploadUrl: storeScopeRequiredWithArgs<[CreateServiceImageUploadUrlInput]>(),
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
	listFormsScoped: (context: ScopedApiContext, query?: ListFormsQuery) =>
		authFetch(buildScopedAuthPath(context, '/forms'), { query }),
	createFormScoped: (context: ScopedApiContext, json: CreateFormInput) =>
		authFetch(buildScopedAuthPath(context, '/forms'), { json }),
	getFormScoped: (context: ScopedApiContext, formId: string) =>
		authFetch(buildScopedAuthPath(context, `/forms/${encodeURIComponent(formId)}`)),
	updateFormScoped: (context: ScopedApiContext, formId: string, json: UpdateFormInput) =>
		authFetch(buildScopedAuthPath(context, `/forms/${encodeURIComponent(formId)}`), {
			method: 'PATCH',
			json
		}),
	publishFormScoped: (context: ScopedApiContext, formId: string) =>
		authFetch(buildScopedAuthPath(context, `/forms/${encodeURIComponent(formId)}/publish`), {
			json: {}
		}),
	archiveFormScoped: (context: ScopedApiContext, formId: string) =>
		authFetch(buildScopedAuthPath(context, `/forms/${encodeURIComponent(formId)}/archive`), {
			json: {}
		}),
	listFormAssignmentsScoped: (context: ScopedApiContext, formId: string) =>
		authFetch(buildScopedAuthPath(context, `/forms/${encodeURIComponent(formId)}/assignments`)),
	createFormAssignmentScoped: (
		context: ScopedApiContext,
		formId: string,
		json: CreateFormAssignmentInput
	) =>
		authFetch(buildScopedAuthPath(context, `/forms/${encodeURIComponent(formId)}/assignments`), {
			json
		}),
	deleteFormAssignmentScoped: (context: ScopedApiContext, formId: string, assignmentId: string) =>
		authFetch(
			buildScopedAuthPath(
				context,
				`/forms/${encodeURIComponent(formId)}/assignments/${encodeURIComponent(assignmentId)}`
			),
			{ method: 'DELETE' }
		),
	listFormSubmissionsScoped: (context: ScopedApiContext, formId: string) =>
		authFetch(buildScopedAuthPath(context, `/forms/${encodeURIComponent(formId)}/submissions`)),
	getFormSubmissionScoped: (context: ScopedApiContext, submissionId: string) =>
		authFetch(
			buildScopedAuthPath(context, `/form-submissions/${encodeURIComponent(submissionId)}`)
		),
	getRequiredFormsScoped: (context: ScopedApiContext, query?: RequiredFormsQuery) =>
		authFetch(buildScopedAuthPath(context, '/forms/required'), { query }),
	getPublicRequiredForms: (context: ScopedApiContext, query?: RequiredFormsQuery) =>
		publicFetch(
			`/api/v1/public/orgs/${encodeURIComponent(context.orgSlug)}/stores/${encodeURIComponent(
				context.storeSlug
			)}/forms/required`,
			{ query }
		),
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
	listParticipants: storeScopeRequiredWithArgs<[string?]>(),
	selfEnrollParticipant: storeScopeRequiredWithArgs<[SelfEnrollParticipantInput]>(),
	listUserParticipantInvitations: () => authFetch('/api/v1/auth/invitations/user'),
	getParticipantInvitationDetail: (invitationId: string) =>
		authFetch(`/api/v1/auth/invitations/${encodeURIComponent(invitationId)}`),
	acceptParticipantInvitation: ({ invitationId }: InvitationActionInput) =>
		authFetch(`/api/v1/auth/invitations/${encodeURIComponent(invitationId)}/accept`, { json: {} }),
	rejectParticipantInvitation: ({ invitationId }: InvitationActionInput) =>
		authFetch(`/api/v1/auth/invitations/${encodeURIComponent(invitationId)}/reject`, { json: {} }),
	cancelParticipantInvitation: ({ invitationId }: InvitationActionInput) =>
		authFetch(`/api/v1/auth/invitations/${encodeURIComponent(invitationId)}/cancel`, { json: {} }),
	listServices: storeScopeRequiredWithArgs<[ListServicesQuery?]>(),
	createService: storeScopeRequiredWithArgs<[CreateServiceInput]>(),
	updateService: storeScopeRequiredWithArgs<[UpdateServiceInput]>(),
	archiveService: storeScopeRequiredWithArgs<[ArchiveServiceInput]>(),
	listSlots: storeScopeRequiredWithArgs<[ListSlotsQuery]>(),
	createSlot: storeScopeRequiredWithArgs<[CreateSlotInput]>(),
	updateSlot: storeScopeRequiredWithArgs<[UpdateSlotInput]>(),
	listAvailableSlots: storeScopeRequiredWithArgs<[ListSlotsQuery]>(),
	cancelSlot: storeScopeRequiredWithArgs<[CancelSlotInput]>(),
	listRecurringSchedules: storeScopeRequiredWithArgs<[ListRecurringSchedulesQuery?]>(),
	createRecurringSchedule: storeScopeRequiredWithArgs<[CreateRecurringScheduleInput]>(),
	updateRecurringSchedule: storeScopeRequiredWithArgs<[UpdateRecurringScheduleInput]>(),
	upsertRecurringScheduleException: storeScopeRequiredWithArgs<[UpsertRecurringExceptionInput]>(),
	generateRecurringSlots: storeScopeRequiredWithArgs<[GenerateRecurringSlotsInput]>(),
	createBooking: storeScopeRequiredWithArgs<[CreateBookingInput]>(),
	listMyBookings: storeScopeRequiredWithArgs<[ListBookingsQuery?]>(),
	cancelBooking: storeScopeRequiredWithArgs<[BookingActionInput]>(),
	listBookings: storeScopeRequiredWithArgs<[ListBookingsQuery?]>(),
	cancelBookingByStaff: storeScopeRequiredWithArgs<[BookingActionInput]>(),
	approveBooking: storeScopeRequiredWithArgs<[string]>(),
	rejectBooking: storeScopeRequiredWithArgs<[BookingActionInput]>(),
	rescheduleBooking: storeScopeRequiredWithArgs<[BookingRescheduleInput]>(),
	markBookingNoShow: storeScopeRequiredWithArgs<[BookingNoShowInput]>(),
	markBookingAttendance: storeScopeRequiredWithArgs<[BookingAttendanceInput]>(),
	createTicketType: storeScopeRequiredWithArgs<[CreateTicketTypeInput]>(),
	updateTicketType: storeScopeRequiredWithArgs<[UpdateTicketTypeInput]>(),
	listTicketTypes: storeScopeRequiredWithArgs<[ListTicketTypesQuery?]>(),
	listPurchasableTicketTypes: storeScopeRequiredWithArgs<[string?]>(),
	grantTicketPack: storeScopeRequiredWithArgs<[GrantTicketPackInput]>(),
	listTicketPacks: storeScopeRequiredWithArgs<[ListTicketPacksQuery]>(),
	adjustTicketPack: storeScopeRequiredWithArgs<[AdjustTicketPackInput]>(),
	listMyTicketPacks: storeScopeRequiredWithArgs<[string?]>(),
	createTicketPurchase: storeScopeRequiredWithArgs<[CreateTicketPurchaseInput]>(),
	listMyTicketPurchases: storeScopeRequiredWithArgs<[ListMyTicketPurchasesQuery?]>(),
	listTicketPurchases: storeScopeRequiredWithArgs<[ListTicketPurchasesQuery?]>(),
	approveTicketPurchase: storeScopeRequiredWithArgs<[TicketPurchaseApproveInput]>(),
	rejectTicketPurchase: storeScopeRequiredWithArgs<[TicketPurchaseRejectInput]>(),
	cancelTicketPurchase: storeScopeRequiredWithArgs<[TicketPurchaseCancelInput]>(),
	listInvitationsScoped: (context: ScopedApiContext) =>
		authFetch(buildScopedAuthPath(context, '/invitations')),
	createInvitationScoped: (context: ScopedApiContext, json: CreateStoreInvitationInput) =>
		authFetch(buildScopedAuthPath(context, '/invitations'), { json }),
	listParticipantsScoped: (context: ScopedApiContext) =>
		authFetch(buildScopedAuthPath(context, '/participants')),
	selfEnrollParticipantScoped: (context: ScopedApiContext) =>
		authFetch(buildScopedAuthPath(context, '/participants/self-enroll'), { method: 'POST' }),
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
	) => authFetch(buildScopedAuthPath(context, '/services'), { query }),
	createServiceScoped: (context: ScopedApiContext, json: CreateServiceInput) =>
		authFetch(buildScopedAuthPath(context, '/services'), { json }),
	updateServiceScoped: (context: ScopedApiContext, json: UpdateServiceInput) =>
		authFetch(buildScopedAuthPath(context, '/services/update'), { json }),
	archiveServiceScoped: (context: ScopedApiContext, json: ArchiveServiceInput) =>
		authFetch(buildScopedAuthPath(context, '/services/archive'), { json }),
	createServiceImageUploadUrlScoped: (
		context: ScopedApiContext,
		json: CreateServiceImageUploadUrlInput
	) => authFetch(buildScopedAuthPath(context, '/services/images/upload-url'), { json }),
	listSlotsScoped: (context: ScopedApiContext, query: Omit<ListSlotsQuery, 'organizationId'>) =>
		authFetch(buildScopedAuthPath(context, '/slots'), { query }),
	createSlotScoped: (context: ScopedApiContext, json: CreateSlotInput) =>
		authFetch(buildScopedAuthPath(context, '/slots'), { json }),
	updateSlotScoped: (context: ScopedApiContext, json: UpdateSlotInput) =>
		authFetch(buildScopedAuthPath(context, '/slots/update'), { json }),
	updateSlotPublicStatusScoped: (context: ScopedApiContext, json: UpdateSlotPublicStatusInput) =>
		authFetch(buildScopedAuthPath(context, '/slots/public-status'), { json }),
	listAvailableSlotsScoped: (
		context: ScopedApiContext,
		query: Omit<ListSlotsQuery, 'organizationId'>
	) => authFetch(buildScopedAuthPath(context, '/slots/available'), { query }),
	cancelSlotScoped: (context: ScopedApiContext, json: CancelSlotInput) =>
		authFetch(buildScopedAuthPath(context, '/slots/cancel'), { json }),
	listRecurringSchedulesScoped: (
		context: ScopedApiContext,
		query?: Omit<ListRecurringSchedulesQuery, 'organizationId'>
	) => authFetch(buildScopedAuthPath(context, '/recurring-schedules'), { query }),
	createRecurringScheduleScoped: (context: ScopedApiContext, json: CreateRecurringScheduleInput) =>
		authFetch(buildScopedAuthPath(context, '/recurring-schedules'), { json }),
	updateRecurringScheduleScoped: (context: ScopedApiContext, json: UpdateRecurringScheduleInput) =>
		authFetch(buildScopedAuthPath(context, '/recurring-schedules/update'), { json }),
	upsertRecurringScheduleExceptionScoped: (
		context: ScopedApiContext,
		json: UpsertRecurringExceptionInput
	) => authFetch(buildScopedAuthPath(context, '/recurring-schedules/exceptions'), { json }),
	generateRecurringSlotsScoped: (context: ScopedApiContext, json: GenerateRecurringSlotsInput) =>
		authFetch(buildScopedAuthPath(context, '/recurring-schedules/generate'), { json }),
	createBookingScoped: (context: ScopedApiContext, json: CreateBookingInput) =>
		authFetch(buildScopedAuthPath(context, '/bookings'), { json }),
	listMyBookingsScoped: (
		context: ScopedApiContext,
		query?: Omit<ListBookingsQuery, 'organizationId'>
	) => authFetch(buildScopedAuthPath(context, '/bookings/mine'), { query }),
	cancelBookingScoped: (context: ScopedApiContext, json: BookingActionInput) =>
		authFetch(buildScopedAuthPath(context, '/bookings/cancel'), { json }),
	listBookingsScoped: (
		context: ScopedApiContext,
		query?: Omit<ListBookingsQuery, 'organizationId'>
	) => authFetch(buildScopedAuthPath(context, '/bookings'), { query }),
	cancelBookingByStaffScoped: (context: ScopedApiContext, json: BookingActionInput) =>
		authFetch(buildScopedAuthPath(context, '/bookings/cancel-by-staff'), { json }),
	approveBookingScoped: (context: ScopedApiContext, bookingId: string) =>
		authFetch(buildScopedAuthPath(context, '/bookings/approve'), { json: { bookingId } }),
	rejectBookingScoped: (context: ScopedApiContext, json: BookingActionInput) =>
		authFetch(buildScopedAuthPath(context, '/bookings/reject'), { json }),
	rescheduleBookingScoped: (context: ScopedApiContext, json: BookingRescheduleInput) =>
		authFetch(buildScopedAuthPath(context, '/bookings/reschedule'), { json }),
	markBookingNoShowScoped: (context: ScopedApiContext, json: BookingNoShowInput) =>
		authFetch(buildScopedAuthPath(context, '/bookings/no-show'), { json }),
	markBookingAttendanceScoped: (context: ScopedApiContext, json: BookingAttendanceInput) =>
		authFetch(buildScopedAuthPath(context, '/bookings/check-in'), { json }),
	staffCreateBookingScoped: (context: ScopedApiContext, json: StaffCreateBookingInput) =>
		authFetch(buildScopedAuthPath(context, '/bookings/staff-create'), { json }),
	createTicketTypeScoped: (context: ScopedApiContext, json: CreateTicketTypeInput) =>
		authFetch(buildScopedAuthPath(context, '/ticket-types'), { json }),
	updateTicketTypeScoped: (context: ScopedApiContext, json: UpdateTicketTypeInput) =>
		authFetch(buildScopedAuthPath(context, '/ticket-types/update'), { json }),
	listTicketTypesScoped: (
		context: ScopedApiContext,
		query?: Omit<ListTicketTypesQuery, 'organizationId'>
	) => authFetch(buildScopedAuthPath(context, '/ticket-types'), { query }),
	listPurchasableTicketTypesScoped: (context: ScopedApiContext) =>
		authFetch(buildScopedAuthPath(context, '/ticket-types/purchasable')),
	grantTicketPackScoped: (context: ScopedApiContext, json: GrantTicketPackInput) =>
		authFetch(buildScopedAuthPath(context, '/ticket-packs/grant'), { json }),
	listTicketPacksScoped: (
		context: ScopedApiContext,
		query: Omit<ListTicketPacksQuery, 'organizationId'>
	) => authFetch(buildScopedAuthPath(context, '/ticket-packs'), { query }),
	adjustTicketPackScoped: (context: ScopedApiContext, json: AdjustTicketPackInput) =>
		authFetch(buildScopedAuthPath(context, '/ticket-packs/adjust'), { json }),
	listMyTicketPacksScoped: (context: ScopedApiContext) =>
		authFetch(buildScopedAuthPath(context, '/ticket-packs/mine')),
	createTicketPurchaseScoped: (context: ScopedApiContext, json: CreateTicketPurchaseInput) =>
		authFetch(buildScopedAuthPath(context, '/ticket-purchases'), { json }),
	listMyTicketPurchasesScoped: (
		context: ScopedApiContext,
		query?: Omit<ListMyTicketPurchasesQuery, 'organizationId'>
	) => authFetch(buildScopedAuthPath(context, '/ticket-purchases/mine'), { query }),
	listTicketPurchasesScoped: (
		context: ScopedApiContext,
		query?: Omit<ListTicketPurchasesQuery, 'organizationId'>
	) => authFetch(buildScopedAuthPath(context, '/ticket-purchases'), { query }),
	approveTicketPurchaseScoped: (context: ScopedApiContext, json: TicketPurchaseApproveInput) =>
		authFetch(buildScopedAuthPath(context, '/ticket-purchases/approve'), { json }),
	rejectTicketPurchaseScoped: (context: ScopedApiContext, json: TicketPurchaseRejectInput) =>
		authFetch(buildScopedAuthPath(context, '/ticket-purchases/reject'), { json }),
	cancelTicketPurchaseScoped: (context: ScopedApiContext, json: TicketPurchaseCancelInput) =>
		authFetch(buildScopedAuthPath(context, '/ticket-purchases/cancel'), { json })
};
