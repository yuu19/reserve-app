import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import {
  canManageParticipantsByRole,
  listOrganizationStoreContexts,
  readOrganizationEntitlementGate,
  resolveOrganizationStoreAccess,
  resolveOrganizationStoreContext,
} from '../domain/booking/authorization.js';
import {
  resolvePublicEventsStoreSlug,
  resolvePublicEventsOrganizationSlug,
  type AuthInstance,
  type AuthRuntimeDatabase,
  type AuthRuntimeEnv,
} from '../auth-runtime.js';
import { syncReserveAppBillingV2DerivedState } from '../infra/billing/reserve-app-billing-v2-source.js';
import { RESERVE_APP_ENTITLEMENTS } from '../features/billing/policies/reserve-app-billing-policy.js';
import { registerBillingRoutes } from '../features/billing/billing.routes.js';
import * as dbSchema from '../infra/db/schema.js';
import {
  sendOrganizationInvitationEmail,
  sendParticipantInvitationEmail,
} from '../infra/email/resend.js';
import type { OrganizationLogoService } from '../infra/storage/organization-logo-service.js';
import type { ServiceImageUploadService } from '../infra/storage/service-image-upload-service.js';
import { registerBookingRoutes } from './booking-routes.js';

export { resolveE2eStripeTestClockId } from '../features/billing/billing.routes.js';

type AuthRouteBindings = {
  Variables: {
    user: Record<string, unknown> | null;
    session: Record<string, unknown> | null;
  };
};

type CreateAuthRoutesOptions = {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
  organizationLogoService?: OrganizationLogoService | null;
  serviceImageUploadService?: ServiceImageUploadService | null;
};

const LOGO_KEY_PATTERN = /^[a-zA-Z0-9._-]+$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_VALIDATION_MESSAGE =
  'Slug must contain only lowercase letters, numbers, and single hyphen separators.';

const slugSchema = z.string().trim().min(1).max(120).regex(SLUG_PATTERN, SLUG_VALIDATION_MESSAGE);

const isFileEntry = (value: FormDataEntryValue | null): value is File => {
  return typeof File !== 'undefined' && value instanceof File;
};

const getIpAddress = (headers: Headers): string | null => {
  const cfConnectingIp = headers.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  const forwarded = headers.get('x-forwarded-for');
  if (!forwarded) {
    return null;
  }

  const [first] = forwarded.split(',');
  return first?.trim() ?? null;
};

const getActiveOrganizationId = (session: unknown): string | null => {
  if (typeof session !== 'object' || session === null) {
    return null;
  }

  const currentSession = session as Record<string, unknown>;
  const activeOrganizationId = currentSession.activeOrganizationId;
  return typeof activeOrganizationId === 'string' ? activeOrganizationId : null;
};

const getStringValue = (value: unknown): string | null => {
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const authSessionSchema = z.union([
  z.null(),
  z.object({
    user: z.record(z.string(), z.unknown()),
    session: z.record(z.string(), z.unknown()),
  }),
]);

const signUpBodySchema = z.object({
  name: z.string().min(1).max(120),
  email: z.email(),
  password: z.string().min(8).max(128),
});

const signInBodySchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
});

const googleOidcQuerySchema = z.object({
  callbackURL: z.string().optional(),
  errorCallbackURL: z.string().optional(),
  newUserCallbackURL: z.string().optional(),
  disableRedirect: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});

const createOrganizationBodySchema = z.object({
  name: z.string().min(1).max(120),
  slug: slugSchema,
  logo: z.string().max(2048).optional(),
  keepCurrentActiveOrganization: z.boolean().optional(),
});

const setActiveOrganizationBodySchema = z.object({
  organizationId: z.string().min(1).nullable().optional(),
  organizationSlug: z.string().min(1).optional(),
});

const getFullOrganizationQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

const listParticipantsQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  storeId: z.string().min(1).optional(),
});

const selfEnrollParticipantBodySchema = z.object({
  organizationId: z.string().min(1),
  storeId: z.string().min(1).optional(),
});

const signUpRoute = createRoute({
  method: 'post',
  path: '/sign-up',
  tags: ['Auth'],
  summary: 'Sign up with email and password',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: signUpBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Signed up',
    },
    400: {
      description: 'Auth error',
    },
  },
});

const signInRoute = createRoute({
  method: 'post',
  path: '/sign-in',
  tags: ['Auth'],
  summary: 'Sign in with email and password',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: signInBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Signed in',
    },
    400: {
      description: 'Auth error',
    },
  },
});

const signOutRoute = createRoute({
  method: 'post',
  path: '/sign-out',
  tags: ['Auth'],
  summary: 'Sign out current session',
  responses: {
    200: {
      description: 'Signed out',
    },
    401: {
      description: 'Not signed in',
    },
  },
});

const googleOidcRoute = createRoute({
  method: 'get',
  path: '/oidc/google',
  tags: ['Auth'],
  summary: 'Start Google OIDC login flow',
  request: {
    query: googleOidcQuerySchema,
  },
  responses: {
    200: {
      description: 'OIDC login initiated',
    },
    302: {
      description: 'Redirect to Google OIDC consent page',
    },
    400: {
      description: 'Validation or auth error',
    },
  },
});

const sessionRoute = createRoute({
  method: 'get',
  path: '/session',
  tags: ['Auth'],
  summary: 'Get current session',
  responses: {
    200: {
      description: 'Session payload',
      content: {
        'application/json': {
          schema: authSessionSchema,
        },
      },
    },
  },
});

const createOrganizationRoute = createRoute({
  method: 'post',
  path: '/organizations',
  tags: ['Organization'],
  summary: 'Create an organization',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: createOrganizationBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Organization created',
    },
    401: {
      description: 'Unauthorized',
    },
    400: {
      description: 'Validation or auth error',
    },
  },
});

const listOrganizationsRoute = createRoute({
  method: 'get',
  path: '/organizations',
  tags: ['Organization'],
  summary: 'List organizations for current user',
  responses: {
    200: {
      description: 'Organization list',
    },
    401: {
      description: 'Unauthorized',
    },
  },
});

const setActiveOrganizationRoute = createRoute({
  method: 'post',
  path: '/organizations/set-active',
  tags: ['Organization'],
  summary: 'Set active organization for current session',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: setActiveOrganizationBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Active organization updated',
    },
    401: {
      description: 'Unauthorized',
    },
    400: {
      description: 'Validation or auth error',
    },
  },
});

const getFullOrganizationRoute = createRoute({
  method: 'get',
  path: '/organizations/full',
  tags: ['Organization'],
  summary: 'Get active organization details',
  request: {
    query: getFullOrganizationQuerySchema,
  },
  responses: {
    200: {
      description: 'Organization details',
    },
    401: {
      description: 'Unauthorized',
    },
    400: {
      description: 'Validation or auth error',
    },
  },
});

const organizationMembershipRoleSchema = z.enum(['owner', 'admin', 'member']);
const storeStaffRoleSchema = z.enum(['manager', 'staff']);
const accessDisplayRoleSchema = z.enum(['owner', 'admin', 'manager', 'staff', 'participant']);
const accessSourceSchema = z.enum(['org_role', 'store_member', 'participant_record']);
const messageResponseSchema = z.object({
  message: z.string().min(1),
});
const invitationStatusSchema = z.enum(['pending', 'accepted', 'rejected', 'cancelled', 'expired']);

const messageResponse = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: messageResponseSchema,
    },
  },
});

const accessFactsSchema = z.object({
  orgRole: organizationMembershipRoleSchema.nullable(),
  storeStaffRole: storeStaffRoleSchema.nullable(),
  hasParticipantRecord: z.boolean(),
});

const accessEffectiveSchema = z.object({
  canManageOrganization: z.boolean(),
  canManageStore: z.boolean(),
  canManageBookings: z.boolean(),
  canManageParticipants: z.boolean(),
  canUseParticipantBooking: z.boolean(),
});

const accessSourcesSchema = z.object({
  canManageOrganization: accessSourceSchema.extract(['org_role']).nullable(),
  canManageStore: accessSourceSchema.extract(['org_role', 'store_member']).nullable(),
  canManageBookings: accessSourceSchema.extract(['org_role', 'store_member']).nullable(),
  canManageParticipants: accessSourceSchema.extract(['org_role', 'store_member']).nullable(),
  canUseParticipantBooking: accessSourceSchema.extract(['participant_record']).nullable(),
});

const accessDisplaySchema = z.object({
  primaryRole: accessDisplayRoleSchema.nullable(),
  badges: z.array(accessDisplayRoleSchema),
});

const storeAccessSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  logo: z.string().min(1).nullable().optional(),
  facts: accessFactsSchema,
  effective: accessEffectiveSchema,
  sources: accessSourcesSchema,
  display: accessDisplaySchema,
});

const accessTreeOrganizationSchema = z.object({
  org: z.object({
    id: z.string().min(1),
    slug: z.string().min(1),
    name: z.string().min(1),
    logo: z.string().min(1).nullable().optional(),
  }),
  facts: z.object({
    orgRole: organizationMembershipRoleSchema.nullable(),
  }),
  stores: z.array(storeAccessSchema),
});

const accessTreeResponseSchema = z.object({
  orgs: z.array(accessTreeOrganizationSchema),
});

const organizationStoresRouteParamsSchema = z.object({
  orgSlug: z.string().min(1),
});

const organizationStoreRouteParamsSchema = z.object({
  orgSlug: z.string().min(1),
  storeSlug: z.string().min(1),
});

const storeManagementSchema = storeAccessSchema;

const createStoreBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema,
});

const updateStoreBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema,
});

const publicSiteSettingSchema = z.object({
  organizationId: z.string().min(1),
  organizationSlug: z.string().min(1),
  organizationName: z.string().min(1),
  storeId: z.string().min(1),
  storeSlug: z.string().min(1),
  storeName: z.string().min(1),
  siteName: z.string().min(1),
  description: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  businessHours: z.string().nullable(),
  imageUrl: z.string().nullable(),
  status: z.enum(['public', 'private', 'suspended']),
  acceptBookings: z.boolean(),
  noindex: z.boolean(),
});

const publicSiteSettingBodySchema = z.object({
  siteName: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  businessHours: z.string().trim().max(1000).nullable().optional(),
  imageUrl: z.string().trim().max(2048).nullable().optional(),
  status: z.enum(['public', 'private', 'suspended']).optional(),
  acceptBookings: z.boolean().optional(),
  noindex: z.boolean().optional(),
});

const listOrganizationAccessTreeRoute = createRoute({
  method: 'get',
  path: '/orgs/access-tree',
  tags: ['Organization'],
  summary: 'List organization and store access tree for current user',
  responses: {
    200: {
      description: 'Organization access tree',
      content: {
        'application/json': {
          schema: accessTreeResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
    },
  },
});

const listOrganizationStoresRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/stores',
  tags: ['Store'],
  summary: 'List accessible stores in an organization',
  request: {
    params: organizationStoresRouteParamsSchema,
  },
  responses: {
    200: {
      description: 'Accessible store list',
      content: {
        'application/json': {
          schema: z.array(storeManagementSchema),
        },
      },
    },
    401: {
      description: 'Unauthorized',
    },
    403: {
      description: 'Forbidden',
    },
    404: {
      description: 'Organization not found',
    },
  },
});

const createStoreRoute = createRoute({
  method: 'post',
  path: '/orgs/{orgSlug}/stores',
  tags: ['Store'],
  summary: 'Create a store in an organization',
  request: {
    params: organizationStoresRouteParamsSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: createStoreBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Created store',
      content: {
        'application/json': {
          schema: storeManagementSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
    },
    403: {
      description: 'Forbidden',
    },
    404: {
      description: 'Organization not found',
    },
    409: {
      description: 'Store slug already exists',
    },
  },
});

const updateStoreRoute = createRoute({
  method: 'patch',
  path: '/orgs/{orgSlug}/stores/{storeSlug}',
  tags: ['Store'],
  summary: 'Update a store in an organization',
  request: {
    params: organizationStoreRouteParamsSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: updateStoreBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated store',
      content: {
        'application/json': {
          schema: storeManagementSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
    },
    403: {
      description: 'Forbidden',
    },
    404: {
      description: 'Organization or store not found',
    },
    409: {
      description: 'Store slug already exists',
    },
  },
});

const getPublicSiteSettingRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/public-site',
  tags: ['Public Site'],
  summary: 'Get public reservation site settings for a store',
  request: {
    params: organizationStoreRouteParamsSchema,
  },
  responses: {
    200: {
      description: 'Public site settings',
      content: {
        'application/json': {
          schema: publicSiteSettingSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
    },
    403: {
      description: 'Forbidden',
    },
    404: {
      description: 'Organization or store not found',
    },
  },
});

const updatePublicSiteSettingRoute = createRoute({
  method: 'patch',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/public-site',
  tags: ['Public Site'],
  summary: 'Update public reservation site settings for a store',
  request: {
    params: organizationStoreRouteParamsSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: publicSiteSettingBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated public site settings',
      content: {
        'application/json': {
          schema: publicSiteSettingSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
    },
    403: {
      description: 'Forbidden',
    },
    404: {
      description: 'Organization or store not found',
    },
  },
});

const orgInvitationRoleSchema = z.enum(['admin', 'member']);
const storeInvitationRoleSchema = z.enum(['manager', 'staff', 'participant']);
const unifiedInvitationRoleSchema = z.enum(['admin', 'member', 'manager', 'staff', 'participant']);
const invitationSubjectKindSchema = z.enum(['org_operator', 'store_operator', 'participant']);

const organizationInvitationRouteParamsSchema = z.object({
  orgSlug: z.string().min(1),
});

const storeInvitationRouteParamsSchema = z.object({
  orgSlug: z.string().min(1),
  storeSlug: z.string().min(1),
});

const invitationIdRouteParamsSchema = z.object({
  invitationId: z.string().min(1),
});

const createOrganizationInvitationBodySchema = z.object({
  email: z.email(),
  role: orgInvitationRoleSchema,
  resend: z.boolean().optional(),
});

const createStoreInvitationBodySchema = z.object({
  email: z.email(),
  role: storeInvitationRoleSchema,
  participantName: z.string().trim().min(1).max(120).optional(),
  resend: z.boolean().optional(),
});

const invitationSchema = z.object({
  id: z.string().min(1),
  subjectKind: invitationSubjectKindSchema,
  role: unifiedInvitationRoleSchema,
  organizationId: z.string().min(1),
  organizationSlug: z.string().min(1),
  organizationName: z.string().min(1),
  storeId: z.string().min(1).nullable(),
  storeSlug: z.string().min(1).nullable(),
  storeName: z.string().min(1).nullable(),
  email: z.string().email(),
  participantName: z.string().nullable(),
  status: invitationStatusSchema,
  expiresAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  invitedByUserId: z.string().nullable(),
  respondedByUserId: z.string().nullable(),
  respondedAt: z.string().nullable(),
});

const invitationAcceptResponseSchema = z.object({
  invitation: invitationSchema,
  accepted: z.object({
    memberId: z.string().nullable(),
    storeMemberId: z.string().nullable(),
    participantId: z.string().nullable(),
  }),
});

const createOrganizationInvitationRoute = createRoute({
  method: 'post',
  path: '/orgs/{orgSlug}/invitations',
  tags: ['Invitations'],
  summary: 'Create or resend organization operator invitation',
  request: {
    params: organizationInvitationRouteParamsSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: createOrganizationInvitationBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Invitation created or resent',
      content: {
        'application/json': {
          schema: invitationSchema,
        },
      },
    },
    400: messageResponse('Validation error'),
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Organization not found'),
    409: messageResponse('Invitation already exists'),
    429: messageResponse('Invitation resend limit reached'),
    500: messageResponse('Unexpected error'),
  },
});

const listOrganizationInvitationsRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/invitations',
  tags: ['Invitations'],
  summary: 'List organization operator invitations',
  request: {
    params: organizationInvitationRouteParamsSchema,
  },
  responses: {
    200: {
      description: 'Invitation list',
      content: {
        'application/json': {
          schema: z.array(invitationSchema),
        },
      },
    },
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Organization not found'),
  },
});

const createStoreInvitationRoute = createRoute({
  method: 'post',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/invitations',
  tags: ['Invitations'],
  summary: 'Create or resend store invitation',
  request: {
    params: storeInvitationRouteParamsSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: createStoreInvitationBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Invitation created or resent',
      content: {
        'application/json': {
          schema: invitationSchema,
        },
      },
    },
    400: messageResponse('Validation error'),
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Organization or store not found'),
    409: messageResponse('Invitation already exists'),
    429: messageResponse('Invitation resend limit reached'),
    500: messageResponse('Unexpected error'),
  },
});

const listStoreInvitationsRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/invitations',
  tags: ['Invitations'],
  summary: 'List store invitations',
  request: {
    params: storeInvitationRouteParamsSchema,
  },
  responses: {
    200: {
      description: 'Invitation list',
      content: {
        'application/json': {
          schema: z.array(invitationSchema),
        },
      },
    },
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Organization or store not found'),
  },
});

const listUserInvitationsRoute = createRoute({
  method: 'get',
  path: '/invitations/user',
  tags: ['Invitations'],
  summary: 'List invitations for current user email',
  responses: {
    200: {
      description: 'Invitation list',
      content: {
        'application/json': {
          schema: z.array(invitationSchema),
        },
      },
    },
    401: messageResponse('Unauthorized'),
    400: messageResponse('Current user email is unavailable'),
  },
});

const invitationDetailRoute = createRoute({
  method: 'get',
  path: '/invitations/{invitationId}',
  tags: ['Invitations'],
  summary: 'Get invitation detail',
  request: {
    params: invitationIdRouteParamsSchema,
  },
  responses: {
    200: {
      description: 'Invitation detail',
      content: {
        'application/json': {
          schema: invitationSchema,
        },
      },
    },
    400: messageResponse('Current user email is unavailable'),
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Invitation not found'),
  },
});

const acceptInvitationRoute = createRoute({
  method: 'post',
  path: '/invitations/{invitationId}/accept',
  tags: ['Invitations'],
  summary: 'Accept invitation',
  request: {
    params: invitationIdRouteParamsSchema,
  },
  responses: {
    200: {
      description: 'Invitation accepted',
      content: {
        'application/json': {
          schema: invitationAcceptResponseSchema,
        },
      },
    },
    400: messageResponse('Invitation cannot be accepted'),
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Invitation not found'),
    409: messageResponse('Invitation already fulfilled'),
  },
});

const rejectInvitationRoute = createRoute({
  method: 'post',
  path: '/invitations/{invitationId}/reject',
  tags: ['Invitations'],
  summary: 'Reject invitation',
  request: {
    params: invitationIdRouteParamsSchema,
  },
  responses: {
    200: {
      description: 'Invitation rejected',
      content: {
        'application/json': {
          schema: invitationSchema,
        },
      },
    },
    400: messageResponse('Invitation cannot be rejected'),
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Invitation not found'),
  },
});

const cancelInvitationRoute = createRoute({
  method: 'post',
  path: '/invitations/{invitationId}/cancel',
  tags: ['Invitations'],
  summary: 'Cancel invitation',
  request: {
    params: invitationIdRouteParamsSchema,
  },
  responses: {
    200: {
      description: 'Invitation canceled',
      content: {
        'application/json': {
          schema: invitationSchema,
        },
      },
    },
    400: messageResponse('Invitation cannot be cancelled'),
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Invitation not found'),
  },
});

const listParticipantsRoute = createRoute({
  method: 'get',
  path: '/organizations/participants',
  tags: ['Participants'],
  summary: 'List participants in an organization',
  request: {
    query: listParticipantsQuerySchema,
  },
  responses: {
    200: {
      description: 'Participant list',
    },
    401: {
      description: 'Unauthorized',
    },
    403: {
      description: 'Forbidden',
    },
    400: {
      description: 'Validation error',
    },
  },
});

const selfEnrollParticipantRoute = createRoute({
  method: 'post',
  path: '/organizations/participants/self-enroll',
  tags: ['Participants'],
  summary: 'Create participant membership for current user in public organization',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: selfEnrollParticipantBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Participant membership ensured',
    },
    401: {
      description: 'Unauthorized',
    },
    403: {
      description: 'Forbidden',
    },
    400: {
      description: 'Validation error',
    },
    503: {
      description: 'Public organization is not configured',
    },
  },
});

/**
 * Better Auth を土台に、organization/store、billing、invitation、asset upload の authenticated API を構築する。
 */
export const createAuthRoutes = (auth: AuthInstance, options: CreateAuthRoutesOptions) => {
  const database = options.database;
  const env = options.env;
  const organizationLogoService = options.organizationLogoService ?? null;
  const serviceImageUploadService = options.serviceImageUploadService ?? null;
  const authRoutes = new OpenAPIHono<AuthRouteBindings>();
  const hasCookieDomain = Boolean(env.BETTER_AUTH_COOKIE_DOMAIN?.trim());
  const appendLegacyOAuthStateCleanupCookie = (headers: Headers) => {
    if (!hasCookieDomain) {
      return;
    }

    // Domain=.wakureserve.com cookie へ移行したあとも、旧 host-only cookie が残ると
    // OAuth state/session が食い違うため、callback 時にまとめて削除する。
    const legacyCookieNames = [
      '__Secure-better-auth.oauth_state',
      '__Secure-better-auth.session_token',
      '__Secure-better-auth.session_data',
      '__Secure-better-auth.pkce_code_verifier',
      'better-auth.session_token',
      'better-auth.session_data',
      'better-auth.pkce_code_verifier',
    ];

    for (const cookieName of legacyCookieNames) {
      headers.append(
        'set-cookie',
        `${cookieName}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
      );
    }
  };

  type InvitationSubjectKind = z.infer<typeof invitationSubjectKindSchema>;
  type UnifiedInvitationRole = z.infer<typeof unifiedInvitationRoleSchema>;
  type InvitationStatus = z.infer<typeof invitationStatusSchema>;
  type InvitationEventType =
    | 'created'
    | 'resent'
    | 'accepted'
    | 'rejected'
    | 'cancelled'
    | 'expired';
  type InvitationRecord = {
    id: string;
    subjectKind: string;
    organizationId: string;
    organizationSlug: string;
    organizationName: string;
    storeId: string | null;
    storeSlug: string | null;
    storeName: string | null;
    email: string;
    role: string;
    principalKind: string;
    participantName: string | null;
    status: string;
    expiresAt: unknown;
    createdAt: unknown;
    invitedByUserId: string;
    respondedByUserId: string | null;
    respondedAt: unknown;
    acceptedMemberId: string | null;
    acceptedStoreMemberId: string | null;
    acceptedParticipantId: string | null;
  };

  const normalizeEmail = (value: string): string => value.trim().toLowerCase();

  const getSessionIdentity = async (
    headers: Headers,
  ): Promise<{
    userId: string;
    email: string | null;
    emailVerified: boolean;
    activeOrganizationId: string | null;
  } | null> => {
    const session = await auth.api.getSession({ headers });
    const userId = getStringValue(session?.user?.id);
    if (!userId) {
      return null;
    }

    const userEmail = getStringValue(session?.user?.email);
    return {
      userId,
      email: userEmail ? normalizeEmail(userEmail) : null,
      emailVerified: session?.user?.emailVerified === true,
      activeOrganizationId: getActiveOrganizationId(session?.session),
    };
  };

  const resolveOrganizationId = (
    requestedOrganizationId: string | undefined,
    activeOrganizationId: string | null,
  ) => {
    return requestedOrganizationId ?? activeOrganizationId;
  };

  const hasOrganizationAdminAccess = async ({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<boolean> => {
    const rows = await database
      .select({
        role: dbSchema.member.role,
      })
      .from(dbSchema.member)
      .where(
        and(eq(dbSchema.member.organizationId, organizationId), eq(dbSchema.member.userId, userId)),
      )
      .limit(1);

    const role = rows[0]?.role;
    return canManageParticipantsByRole(
      role === 'owner' || role === 'admin' || role === 'member' ? role : null,
    );
  };

  const canCreateOrganizationForIdentity = async ({
    userId,
    email,
  }: {
    userId: string;
    email: string | null;
  }): Promise<boolean> => {
    const ownerMembership = await database
      .select({ id: dbSchema.member.id })
      .from(dbSchema.member)
      .where(and(eq(dbSchema.member.userId, userId), eq(dbSchema.member.role, 'owner')))
      .limit(1);
    if (ownerMembership[0]) {
      return true;
    }

    const [memberRows, storeMemberRows, participantRows, pendingInvitationRows] = await Promise.all(
      [
        database
          .select({ id: dbSchema.member.id })
          .from(dbSchema.member)
          .where(eq(dbSchema.member.userId, userId))
          .limit(1),
        database
          .select({ id: dbSchema.storeMember.id })
          .from(dbSchema.storeMember)
          .where(eq(dbSchema.storeMember.userId, userId))
          .limit(1),
        database
          .select({ id: dbSchema.participant.id })
          .from(dbSchema.participant)
          .where(eq(dbSchema.participant.userId, userId))
          .limit(1),
        email
          ? database
              .select({ id: dbSchema.invitation.id })
              .from(dbSchema.invitation)
              .where(
                and(
                  eq(dbSchema.invitation.status, 'pending'),
                  sql`lower(${dbSchema.invitation.email}) = ${email}`,
                  sql`${dbSchema.invitation.expiresAt} > ${Date.now()}`,
                ),
              )
              .limit(1)
          : Promise.resolve([] as { id: string }[]),
      ],
    );

    return (
      !memberRows[0] && !storeMemberRows[0] && !participantRows[0] && !pendingInvitationRows[0]
    );
  };

  const toIsoDateString = (value: unknown): string | null => {
    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'number') {
      return new Date(value).toISOString();
    }

    if (typeof value === 'string') {
      return value;
    }

    return null;
  };

  const toTimestamp = (value: unknown): number | null => {
    if (value instanceof Date) {
      return value.getTime();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }

    return null;
  };

  const serializeParticipant = (
    participant: {
      id: string;
      organizationId: string;
      storeId?: string;
      storeSlug?: string | null;
      storeName?: string | null;
      userId: string;
      email: string;
      name: string;
      createdAt: unknown;
      updatedAt: unknown;
    } | null,
  ) => {
    if (!participant) {
      return null;
    }

    return {
      id: participant.id,
      organizationId: participant.organizationId,
      storeId: participant.storeId ?? null,
      storeSlug: participant.storeSlug ?? null,
      storeName: participant.storeName ?? null,
      userId: participant.userId,
      email: participant.email,
      name: participant.name,
      createdAt: toIsoDateString(participant.createdAt),
      updatedAt: toIsoDateString(participant.updatedAt),
    };
  };

  const normalizeInvitationSubjectKind = (value: string | null): InvitationSubjectKind | null => {
    if (value === 'org_operator' || value === 'store_operator' || value === 'participant') {
      return value;
    }

    return null;
  };

  const normalizeUnifiedInvitationRole = (value: string | null): UnifiedInvitationRole | null => {
    if (
      value === 'admin' ||
      value === 'member' ||
      value === 'manager' ||
      value === 'staff' ||
      value === 'participant'
    ) {
      return value;
    }

    return null;
  };

  const normalizeInvitationStatus = (
    value: string | null,
    expiresAt: unknown,
  ): InvitationStatus | null => {
    const normalized = value === 'canceled' ? 'cancelled' : value;
    if (
      normalized !== 'pending' &&
      normalized !== 'accepted' &&
      normalized !== 'rejected' &&
      normalized !== 'cancelled' &&
      normalized !== 'expired'
    ) {
      return null;
    }

    if (normalized === 'pending') {
      const expiresAtTimestamp = toTimestamp(expiresAt);
      if (expiresAtTimestamp !== null && expiresAtTimestamp <= Date.now()) {
        return 'expired';
      }
    }

    return normalized;
  };

  const invitationRecordSelection = {
    id: dbSchema.invitation.id,
    subjectKind: dbSchema.invitation.subjectKind,
    organizationId: dbSchema.invitation.organizationId,
    organizationSlug: dbSchema.organization.slug,
    organizationName: dbSchema.organization.name,
    storeId: dbSchema.invitation.storeId,
    storeSlug: dbSchema.store.slug,
    storeName: dbSchema.store.name,
    email: dbSchema.invitation.email,
    role: dbSchema.invitation.role,
    principalKind: dbSchema.invitation.principalKind,
    participantName: dbSchema.invitation.participantName,
    status: dbSchema.invitation.status,
    expiresAt: dbSchema.invitation.expiresAt,
    createdAt: dbSchema.invitation.createdAt,
    invitedByUserId: dbSchema.invitation.invitedByUserId,
    respondedByUserId: dbSchema.invitation.respondedByUserId,
    respondedAt: dbSchema.invitation.respondedAt,
    acceptedMemberId: dbSchema.invitation.acceptedMemberId,
    acceptedStoreMemberId: dbSchema.invitation.acceptedStoreMemberId,
    acceptedParticipantId: dbSchema.invitation.acceptedParticipantId,
  };

  const selectInvitationRecords = async (whereClause: SQL<unknown> | undefined) => {
    const query = database
      .select(invitationRecordSelection)
      .from(dbSchema.invitation)
      .innerJoin(
        dbSchema.organization,
        eq(dbSchema.organization.id, dbSchema.invitation.organizationId),
      )
      .leftJoin(dbSchema.store, eq(dbSchema.store.id, dbSchema.invitation.storeId));

    return (whereClause ? query.where(whereClause) : query).orderBy(
      desc(dbSchema.invitation.createdAt),
    );
  };

  const serializeInvitation = (invitation: InvitationRecord | null) => {
    if (!invitation) {
      return null;
    }

    const subjectKind = normalizeInvitationSubjectKind(invitation.subjectKind);
    const role = normalizeUnifiedInvitationRole(invitation.role);
    const status = normalizeInvitationStatus(invitation.status, invitation.expiresAt);
    if (!subjectKind || !role || !status) {
      return null;
    }

    return {
      id: invitation.id,
      subjectKind,
      role,
      organizationId: invitation.organizationId,
      organizationSlug: invitation.organizationSlug,
      organizationName: invitation.organizationName,
      storeId: invitation.storeId,
      storeSlug: invitation.storeSlug,
      storeName: invitation.storeName,
      email: invitation.email,
      participantName: invitation.participantName ?? null,
      status,
      expiresAt: toIsoDateString(invitation.expiresAt),
      createdAt: toIsoDateString(invitation.createdAt),
      invitedByUserId: invitation.invitedByUserId ?? null,
      respondedByUserId: invitation.respondedByUserId ?? null,
      respondedAt: toIsoDateString(invitation.respondedAt),
    } satisfies z.infer<typeof invitationSchema>;
  };

  const findInvitationRecordById = async (invitationId: string) => {
    const rows = await selectInvitationRecords(eq(dbSchema.invitation.id, invitationId));
    return (rows[0] as InvitationRecord | undefined) ?? null;
  };

  const findPendingInvitationForResend = async ({
    organizationId,
    storeId,
    subjectKind,
    role,
    email,
  }: {
    organizationId: string;
    storeId?: string | null;
    subjectKind: InvitationSubjectKind;
    role: UnifiedInvitationRole;
    email: string;
  }) => {
    const rows = await database
      .select(invitationRecordSelection)
      .from(dbSchema.invitation)
      .innerJoin(
        dbSchema.organization,
        eq(dbSchema.organization.id, dbSchema.invitation.organizationId),
      )
      .leftJoin(dbSchema.store, eq(dbSchema.store.id, dbSchema.invitation.storeId))
      .where(
        and(
          eq(dbSchema.invitation.organizationId, organizationId),
          eq(dbSchema.invitation.subjectKind, subjectKind),
          eq(dbSchema.invitation.role, role),
          ...(storeId ? [eq(dbSchema.invitation.storeId, storeId)] : []),
          eq(dbSchema.invitation.email, email),
          eq(dbSchema.invitation.status, 'pending'),
        ),
      )
      .limit(1);

    return (rows[0] as InvitationRecord | undefined) ?? null;
  };

  const countInvitationEvent = async ({
    invitationId,
    eventType,
  }: {
    invitationId: string;
    eventType: InvitationEventType;
  }): Promise<number> => {
    const rows = await database
      .select({
        value: sql<number>`count(*)`,
      })
      .from(dbSchema.invitationAuditLog)
      .where(
        and(
          eq(dbSchema.invitationAuditLog.invitationId, invitationId),
          eq(dbSchema.invitationAuditLog.eventType, eventType),
        ),
      );

    return Number(rows[0]?.value ?? 0);
  };

  const writeInvitationEvent = async ({
    invitationId,
    organizationId,
    storeId,
    actorUserId,
    targetEmail,
    eventType,
    metadata,
    headers,
  }: {
    invitationId: string;
    organizationId: string;
    storeId?: string | null;
    actorUserId: string;
    targetEmail: string;
    eventType: InvitationEventType;
    metadata?: Record<string, unknown>;
    headers: Headers;
  }) => {
    await database.insert(dbSchema.invitationAuditLog).values({
      id: crypto.randomUUID(),
      invitationId,
      organizationId,
      storeId: storeId ?? null,
      actorUserId,
      targetEmail,
      eventType,
      metadata: metadata ? JSON.stringify(metadata) : null,
      ipAddress: getIpAddress(headers),
      userAgent: headers.get('user-agent'),
    });
  };

  const resolveInvitationPrincipalKind = async (
    email: string,
  ): Promise<'email' | 'existing_user'> => {
    const rows = await database
      .select({
        id: dbSchema.user.id,
      })
      .from(dbSchema.user)
      .where(eq(dbSchema.user.email, email))
      .limit(1);

    return rows[0] ? 'existing_user' : 'email';
  };

  const createInvitationRecord = async ({
    subjectKind,
    role,
    organizationId,
    storeId,
    email,
    participantName,
    invitedByUserId,
  }: {
    subjectKind: InvitationSubjectKind;
    role: UnifiedInvitationRole;
    organizationId: string;
    storeId?: string | null;
    email: string;
    participantName?: string | null;
    invitedByUserId: string;
  }) => {
    const invitationId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 172_800_000);
    await database.insert(dbSchema.invitation).values({
      id: invitationId,
      subjectKind,
      organizationId,
      storeId: storeId ?? null,
      email,
      role,
      principalKind: await resolveInvitationPrincipalKind(email),
      participantName: participantName ?? null,
      status: 'pending',
      expiresAt,
      invitedByUserId,
    });

    return findInvitationRecordById(invitationId);
  };

  const sendInvitationEmailForRecord = async ({
    invitation,
    headers,
  }: {
    invitation: InvitationRecord;
    headers: Headers;
  }) => {
    const session = await auth.api.getSession({ headers });
    const inviterName = getStringValue(session?.user?.name);
    const inviterEmail = getStringValue(session?.user?.email);

    if (normalizeInvitationSubjectKind(invitation.subjectKind) === 'participant') {
      if (!invitation.participantName) {
        throw new Error('Participant invitation is missing participantName.');
      }

      await sendParticipantInvitationEmail({
        env,
        invitationId: invitation.id,
        inviteeEmail: invitation.email,
        participantName: invitation.participantName,
        inviterName,
        inviterEmail,
        organizationName: invitation.organizationName,
      });
      return;
    }

    await sendOrganizationInvitationEmail({
      env,
      invitationId: invitation.id,
      inviteeEmail: invitation.email,
      inviterName,
      inviterEmail,
      organizationName: invitation.organizationName,
      role: invitation.role,
    });
  };

  const markInvitationExpiredIfNeeded = async (invitation: InvitationRecord | null) => {
    if (!invitation) {
      return null;
    }

    if (normalizeInvitationStatus(invitation.status, invitation.expiresAt) !== 'expired') {
      return invitation;
    }

    if (invitation.status !== 'expired') {
      await database
        .update(dbSchema.invitation)
        .set({
          status: 'expired',
          updatedAt: new Date(),
        })
        .where(
          and(eq(dbSchema.invitation.id, invitation.id), eq(dbSchema.invitation.status, 'pending')),
        );
      return findInvitationRecordById(invitation.id);
    }

    return invitation;
  };

  const mergeOrganizationInvitationRole = (
    currentRole: string | null,
    invitedRole: 'admin' | 'member',
  ): 'owner' | 'admin' | 'member' => {
    if (currentRole === 'owner') {
      return 'owner';
    }
    if (currentRole === 'admin' || invitedRole === 'admin') {
      return 'admin';
    }
    return 'member';
  };

  const mergeStoreInvitationRole = (
    currentRole: string | null,
    invitedRole: 'manager' | 'staff',
  ): 'manager' | 'staff' => {
    if (currentRole === 'manager' || invitedRole === 'manager') {
      return 'manager';
    }
    return 'staff';
  };

  const ensureOrganizationMemberFromInvitation = async ({
    tx,
    invitation,
    userId,
  }: {
    tx: AuthRuntimeDatabase;
    invitation: InvitationRecord;
    userId: string;
  }) => {
    const invitedRole = normalizeUnifiedInvitationRole(invitation.role);
    if (invitedRole !== 'admin' && invitedRole !== 'member') {
      throw new Error('Organization invitation role is invalid.');
    }

    const rows = await tx
      .select({
        id: dbSchema.member.id,
        role: dbSchema.member.role,
      })
      .from(dbSchema.member)
      .where(
        and(
          eq(dbSchema.member.organizationId, invitation.organizationId),
          eq(dbSchema.member.userId, userId),
        ),
      )
      .limit(1);

    const existing = rows[0] as { id: string; role: string } | undefined;
    const nextRole = mergeOrganizationInvitationRole(existing?.role ?? null, invitedRole);
    if (existing) {
      if (nextRole !== existing.role) {
        await tx
          .update(dbSchema.member)
          .set({
            role: nextRole,
          })
          .where(eq(dbSchema.member.id, existing.id));
      }
      return existing.id;
    }

    const memberId = crypto.randomUUID();
    await tx.insert(dbSchema.member).values({
      id: memberId,
      organizationId: invitation.organizationId,
      userId,
      role: nextRole,
      createdAt: new Date(),
    });
    return memberId;
  };

  const ensureOrganizationMemberForStoreOperator = async ({
    tx,
    invitation,
    userId,
  }: {
    tx: AuthRuntimeDatabase;
    invitation: InvitationRecord;
    userId: string;
  }) => {
    const rows = await tx
      .select({
        id: dbSchema.member.id,
      })
      .from(dbSchema.member)
      .where(
        and(
          eq(dbSchema.member.organizationId, invitation.organizationId),
          eq(dbSchema.member.userId, userId),
        ),
      )
      .limit(1);

    const existing = rows[0] as { id: string } | undefined;
    if (existing) {
      return existing.id;
    }

    const memberId = crypto.randomUUID();
    await tx.insert(dbSchema.member).values({
      id: memberId,
      organizationId: invitation.organizationId,
      userId,
      role: 'member',
      createdAt: new Date(),
    });
    return memberId;
  };

  const ensureStoreMemberFromInvitation = async ({
    tx,
    invitation,
    userId,
  }: {
    tx: AuthRuntimeDatabase;
    invitation: InvitationRecord;
    userId: string;
  }) => {
    const invitedRole = normalizeUnifiedInvitationRole(invitation.role);
    if ((invitedRole !== 'manager' && invitedRole !== 'staff') || !invitation.storeId) {
      throw new Error('Store invitation role is invalid.');
    }

    const rows = await tx
      .select({
        id: dbSchema.storeMember.id,
        role: dbSchema.storeMember.role,
      })
      .from(dbSchema.storeMember)
      .where(
        and(
          eq(dbSchema.storeMember.storeId, invitation.storeId),
          eq(dbSchema.storeMember.userId, userId),
        ),
      )
      .limit(1);

    const existing = rows[0] as { id: string; role: string } | undefined;
    const nextRole = mergeStoreInvitationRole(existing?.role ?? null, invitedRole);
    if (existing) {
      if (nextRole !== existing.role) {
        await tx
          .update(dbSchema.storeMember)
          .set({
            role: nextRole,
          })
          .where(eq(dbSchema.storeMember.id, existing.id));
      }
      return existing.id;
    }

    const storeMemberId = crypto.randomUUID();
    await tx.insert(dbSchema.storeMember).values({
      id: storeMemberId,
      storeId: invitation.storeId,
      userId,
      role: nextRole,
      createdAt: new Date(),
    });
    return storeMemberId;
  };

  const ensureParticipantFromInvitation = async ({
    tx,
    invitation,
    userId,
  }: {
    tx: AuthRuntimeDatabase;
    invitation: InvitationRecord;
    userId: string;
  }) => {
    if (!invitation.storeId || !invitation.participantName) {
      throw new Error('Participant invitation is incomplete.');
    }

    const rows = await tx
      .select({
        id: dbSchema.participant.id,
      })
      .from(dbSchema.participant)
      .where(
        and(
          eq(dbSchema.participant.organizationId, invitation.organizationId),
          eq(dbSchema.participant.storeId, invitation.storeId),
          or(
            eq(dbSchema.participant.userId, userId),
            eq(dbSchema.participant.email, invitation.email),
          ),
        ),
      )
      .limit(1);

    const existing = rows[0] as { id: string } | undefined;
    if (existing) {
      return existing.id;
    }

    const participantId = crypto.randomUUID();
    await tx.insert(dbSchema.participant).values({
      id: participantId,
      organizationId: invitation.organizationId,
      storeId: invitation.storeId,
      userId,
      email: invitation.email,
      name: invitation.participantName,
    });
    return participantId;
  };

  const acceptInvitationRecord = async ({
    invitation,
    userId,
  }: {
    invitation: InvitationRecord;
    userId: string;
  }) => {
    const refreshedRows = await database
      .select({
        id: dbSchema.invitation.id,
        status: dbSchema.invitation.status,
      })
      .from(dbSchema.invitation)
      .where(eq(dbSchema.invitation.id, invitation.id))
      .limit(1);

    const refreshed = refreshedRows[0] as { id: string; status: string } | undefined;
    if (!refreshed || refreshed.status !== 'pending') {
      return null;
    }

    let acceptedMemberId: string | null = null;
    let acceptedStoreMemberId: string | null = null;
    let acceptedParticipantId: string | null = null;

    const subjectKind = normalizeInvitationSubjectKind(invitation.subjectKind);
    if (subjectKind === 'org_operator') {
      acceptedMemberId = await ensureOrganizationMemberFromInvitation({
        tx: database,
        invitation,
        userId,
      });
    } else if (subjectKind === 'store_operator') {
      acceptedMemberId = await ensureOrganizationMemberForStoreOperator({
        tx: database,
        invitation,
        userId,
      });
      acceptedStoreMemberId = await ensureStoreMemberFromInvitation({
        tx: database,
        invitation,
        userId,
      });
    } else if (subjectKind === 'participant') {
      acceptedParticipantId = await ensureParticipantFromInvitation({
        tx: database,
        invitation,
        userId,
      });
    } else {
      throw new Error('Invitation subjectKind is invalid.');
    }

    const updateResult = await database
      .update(dbSchema.invitation)
      .set({
        status: 'accepted',
        respondedByUserId: userId,
        respondedAt: new Date(),
        acceptedMemberId,
        acceptedStoreMemberId,
        acceptedParticipantId,
      })
      .where(
        and(eq(dbSchema.invitation.id, invitation.id), eq(dbSchema.invitation.status, 'pending')),
      );

    const updatedCount = Number(
      (
        updateResult as {
          rowsAffected?: number;
          meta?: { changes?: number };
        }
      ).rowsAffected ??
        (
          updateResult as {
            rowsAffected?: number;
            meta?: { changes?: number };
          }
        ).meta?.changes ??
        0,
    );
    if (updatedCount === 0) {
      return null;
    }

    return {
      memberId: acceptedMemberId,
      storeMemberId: acceptedStoreMemberId,
      participantId: acceptedParticipantId,
    };
  };

  const resolveStoreContextBySlugs = async ({
    orgSlug,
    storeSlug,
  }: {
    orgSlug: string;
    storeSlug: string;
  }) => {
    return resolveOrganizationStoreContext({
      database,
      organizationSlug: orgSlug,
      storeSlug,
    });
  };

  const resolveStoreContextByOrganizationId = async (organizationId: string) => {
    return resolveOrganizationStoreContext({
      database,
      organizationId,
    });
  };

  const resolveStoreContextByIds = async ({
    organizationId,
    storeId,
  }: {
    organizationId: string;
    storeId: string;
  }) => {
    const rows = await database
      .select({
        organizationId: dbSchema.organization.id,
        organizationSlug: dbSchema.organization.slug,
        organizationName: dbSchema.organization.name,
        storeId: dbSchema.store.id,
        storeSlug: dbSchema.store.slug,
        storeName: dbSchema.store.name,
      })
      .from(dbSchema.store)
      .innerJoin(dbSchema.organization, eq(dbSchema.organization.id, dbSchema.store.organizationId))
      .where(and(eq(dbSchema.store.organizationId, organizationId), eq(dbSchema.store.id, storeId)))
      .limit(1);

    return rows[0] ?? null;
  };

  const resolveOrganizationBySlug = async (orgSlug: string) => {
    const rows = await database
      .select({
        id: dbSchema.organization.id,
        slug: dbSchema.organization.slug,
        name: dbSchema.organization.name,
      })
      .from(dbSchema.organization)
      .where(eq(dbSchema.organization.slug, orgSlug))
      .limit(1);

    return rows[0] ?? null;
  };

  const serializeManagedStore = async ({
    context,
    userId,
  }: {
    context: Awaited<ReturnType<typeof resolveOrganizationStoreContext>>;
    userId: string;
  }) => {
    if (!context) {
      return null;
    }

    const access = await resolveOrganizationStoreAccess({
      database,
      userId,
      context,
    });

    if (
      !access.display.primaryRole &&
      !access.effective.canUseParticipantBooking &&
      !access.effective.canManageStore
    ) {
      return null;
    }

    return {
      id: context.storeId,
      slug: context.storeSlug,
      name: context.storeName,
      logo: null,
      facts: access.facts,
      effective: access.effective,
      sources: access.sources,
      display: access.display,
    };
  };

  const serializePublicSiteSetting = async ({
    context,
  }: {
    context: NonNullable<Awaited<ReturnType<typeof resolveOrganizationStoreContext>>>;
  }) => {
    const rows = await database
      .select({
        siteName: dbSchema.publicSiteSetting.siteName,
        description: dbSchema.publicSiteSetting.description,
        address: dbSchema.publicSiteSetting.address,
        phone: dbSchema.publicSiteSetting.phone,
        businessHours: dbSchema.publicSiteSetting.businessHours,
        imageUrl: dbSchema.publicSiteSetting.imageUrl,
        status: dbSchema.publicSiteSetting.status,
        acceptBookings: dbSchema.publicSiteSetting.acceptBookings,
        noindex: dbSchema.publicSiteSetting.noindex,
      })
      .from(dbSchema.publicSiteSetting)
      .where(
        and(
          eq(dbSchema.publicSiteSetting.organizationId, context.organizationId),
          eq(dbSchema.publicSiteSetting.storeId, context.storeId),
        ),
      )
      .limit(1);
    const setting = rows[0] ?? null;

    return {
      organizationId: context.organizationId,
      organizationSlug: context.organizationSlug,
      organizationName: context.organizationName,
      storeId: context.storeId,
      storeSlug: context.storeSlug,
      storeName: context.storeName,
      siteName: setting?.siteName?.trim() || context.storeName || context.organizationName,
      description: setting?.description ?? null,
      address: setting?.address ?? null,
      phone: setting?.phone ?? null,
      businessHours: setting?.businessHours ?? null,
      imageUrl: setting?.imageUrl ?? null,
      status:
        setting?.status === 'public' || setting?.status === 'suspended'
          ? setting.status
          : 'private',
      acceptBookings: setting?.acceptBookings ?? true,
      noindex: setting?.noindex ?? true,
    };
  };

  const normalizePublicSiteText = (
    value: string | null | undefined,
    fallback: string | null,
  ): string | null => {
    if (value === undefined) {
      return fallback;
    }
    const trimmed = value?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : null;
  };

  const listAccessibleStoresForOrganization = async ({
    organizationSlug,
    userId,
  }: {
    organizationSlug: string;
    userId: string;
  }) => {
    const organization = await resolveOrganizationBySlug(organizationSlug);
    if (!organization) {
      return {
        organization: null,
        stores: [] as Array<z.infer<typeof storeManagementSchema>>,
      };
    }

    const [memberRows, storeMemberRows, participantRows] = await Promise.all([
      database
        .select({
          role: dbSchema.member.role,
        })
        .from(dbSchema.member)
        .where(
          and(
            eq(dbSchema.member.organizationId, organization.id),
            eq(dbSchema.member.userId, userId),
          ),
        )
        .limit(1),
      database
        .select({
          storeId: dbSchema.storeMember.storeId,
        })
        .from(dbSchema.storeMember)
        .innerJoin(dbSchema.store, eq(dbSchema.store.id, dbSchema.storeMember.storeId))
        .where(
          and(
            eq(dbSchema.store.organizationId, organization.id),
            eq(dbSchema.storeMember.userId, userId),
          ),
        ),
      database
        .select({
          storeId: dbSchema.participant.storeId,
        })
        .from(dbSchema.participant)
        .where(
          and(
            eq(dbSchema.participant.organizationId, organization.id),
            eq(dbSchema.participant.userId, userId),
          ),
        ),
    ]);

    const organizationRole = memberRows[0]?.role;
    const hasOrganizationAccess =
      organizationRole === 'owner' ||
      organizationRole === 'admin' ||
      organizationRole === 'member' ||
      storeMemberRows.length > 0 ||
      participantRows.length > 0;

    if (!hasOrganizationAccess) {
      return { organization, stores: [] as Array<z.infer<typeof storeManagementSchema>> };
    }

    const storeContexts =
      organizationRole === 'owner' || organizationRole === 'admin'
        ? await listOrganizationStoreContexts({
            database,
            organizationId: organization.id,
          })
        : (
            await Promise.all(
              Array.from(
                new Set([
                  ...storeMemberRows.map((row: (typeof storeMemberRows)[number]) => row.storeId),
                  ...participantRows.map((row: (typeof participantRows)[number]) => row.storeId),
                ]),
              ).map((storeId) =>
                resolveStoreContextByIds({
                  organizationId: organization.id,
                  storeId,
                }),
              ),
            )
          ).filter((context): context is NonNullable<typeof context> => Boolean(context));

    const stores = (
      await Promise.all(
        storeContexts.map((context) =>
          serializeManagedStore({
            context,
            userId,
          }),
        ),
      )
    )
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((left, right) => left.name.localeCompare(right.name));

    return { organization, stores };
  };

  const hydrateInvitationRecord = async (invitationId: string) => {
    const invitation = await markInvitationExpiredIfNeeded(
      await findInvitationRecordById(invitationId),
    );
    return invitation;
  };

  const listSerializedInvitations = async (whereClause: SQL<unknown> | undefined) => {
    const invitations = await selectInvitationRecords(whereClause);
    const serialized: Array<z.infer<typeof invitationSchema>> = [];

    for (const invitation of invitations as InvitationRecord[]) {
      const hydrated = await markInvitationExpiredIfNeeded(invitation);
      const next = serializeInvitation(hydrated);
      if (next) {
        serialized.push(next);
      }
    }

    return serialized;
  };

  const isInvitationRecipient = ({
    invitation,
    email,
  }: {
    invitation: InvitationRecord;
    email: string | null;
  }) => {
    return Boolean(email && normalizeEmail(invitation.email) === email);
  };

  const canCancelInvitation = async ({
    invitation,
    userId,
  }: {
    invitation: InvitationRecord;
    userId: string;
  }) => {
    if (invitation.invitedByUserId === userId) {
      return true;
    }

    const subjectKind = normalizeInvitationSubjectKind(invitation.subjectKind);
    if (subjectKind === 'org_operator') {
      return hasOrganizationAdminAccess({
        organizationId: invitation.organizationId,
        userId,
      });
    }

    if (!invitation.storeId) {
      return false;
    }

    const storeContext = await resolveStoreContextByIds({
      organizationId: invitation.organizationId,
      storeId: invitation.storeId,
    });
    if (!storeContext) {
      return false;
    }

    const access = await resolveOrganizationStoreAccess({
      database,
      userId,
      context: storeContext,
    });
    if (subjectKind === 'participant') {
      return access.effective.canManageParticipants || access.effective.canManageStore;
    }

    return access.effective.canManageStore;
  };

  authRoutes.use('/session', async (c, next) => {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      c.set('user', null);
      c.set('session', null);
      await next();
      return;
    }

    c.set('user', session.user as Record<string, unknown>);
    c.set('session', session.session as Record<string, unknown>);
    await next();
  });

  authRoutes.openapi(signUpRoute, async (c) => {
    const body = c.req.valid('json');
    return auth.api.signUpEmail({
      body,
      headers: c.req.raw.headers,
      asResponse: true,
    });
  });

  authRoutes.openapi(signInRoute, async (c) => {
    const body = c.req.valid('json');
    return auth.api.signInEmail({
      body,
      headers: c.req.raw.headers,
      asResponse: true,
    });
  });

  authRoutes.openapi(signOutRoute, async (c) => {
    return auth.api.signOut({
      headers: c.req.raw.headers,
      asResponse: true,
    });
  });

  authRoutes.openapi(googleOidcRoute, async (c) => {
    const query = c.req.valid('query');

    const response = await auth.api.signInSocial({
      body: {
        provider: 'google',
        callbackURL: query.callbackURL,
        errorCallbackURL: query.errorCallbackURL,
        newUserCallbackURL: query.newUserCallbackURL,
        disableRedirect: query.disableRedirect,
      },
      headers: c.req.raw.headers,
      asResponse: true,
    });

    // Better Auth は social sign-in 開始時に 200 + { url, redirect } を返す。
    // 明示的に無効化されていない場合は、ブラウザ遷移用の 302 に変換する。
    if (query.disableRedirect === true) {
      const headers = new Headers(response.headers);
      appendLegacyOAuthStateCleanupCookie(headers);
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }

    if (!response.ok) {
      const headers = new Headers(response.headers);
      appendLegacyOAuthStateCleanupCookie(headers);
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }

    const location = response.headers.get('location');
    if (!location) {
      const headers = new Headers(response.headers);
      appendLegacyOAuthStateCleanupCookie(headers);
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }

    const headers = new Headers(response.headers);
    headers.delete('content-type');
    headers.delete('content-length');
    appendLegacyOAuthStateCleanupCookie(headers);

    return new Response(null, {
      status: 302,
      headers,
    });
  });

  authRoutes.openapi(sessionRoute, (c) => {
    const user = c.get('user');
    const session = c.get('session');

    if (!user || !session) {
      return c.json(null, 200);
    }

    return c.json({ user, session }, 200);
  });

  authRoutes.post('/organizations/logo', async (c) => {
    if (!organizationLogoService) {
      return c.json({ message: 'Organization logo upload is not configured.' }, 503);
    }

    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    const userId = session?.user?.id;
    if (typeof userId !== 'string' || userId.length === 0) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    let formData: FormData;
    try {
      formData = await c.req.raw.formData();
    } catch {
      return c.json({ message: 'Invalid multipart form-data request.' }, 400);
    }

    const file = formData.get('file');
    if (!isFileEntry(file)) {
      return c.json({ message: 'Image file is required.' }, 400);
    }

    try {
      const uploaded = await organizationLogoService.upload({
        file,
        ownerUserId: userId,
      });

      return c.json(uploaded, 201);
    } catch (error) {
      const message =
        error instanceof Error && error.message.length > 0
          ? error.message
          : 'Failed to upload organization logo.';
      return c.json({ message }, 400);
    }
  });

  authRoutes.get('/organizations/logo/:key', async (c) => {
    if (!organizationLogoService) {
      return c.text('Organization logo delivery is not configured.', 503);
    }

    const key = c.req.param('key');
    if (!LOGO_KEY_PATTERN.test(key)) {
      return c.json({ message: 'Invalid logo key.' }, 400);
    }

    const object = await organizationLogoService.get(key);
    if (!object) {
      return c.text('Logo not found.', 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata?.(headers);

    headers.set('content-type', object.httpMetadata?.contentType ?? 'image/webp');
    headers.set(
      'cache-control',
      object.httpMetadata?.cacheControl ?? 'public, max-age=31536000, immutable',
    );

    return new Response(object.body, {
      status: 200,
      headers,
    });
  });

  authRoutes.openapi(createOrganizationRoute, (c) => {
    return (async () => {
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const canCreateOrganization = await canCreateOrganizationForIdentity(identity);
      if (!canCreateOrganization) {
        return c.json(
          {
            message: '招待参加ユーザーは組織を作成できません。招待先の組織に参加してください。',
          },
          403,
        );
      }

      const body = c.req.valid('json');

      const response = await auth.api.createOrganization({
        body,
        headers: c.req.raw.headers,
        asResponse: true,
      });
      if (!response.ok) {
        return response;
      }

      const payload = (await response
        .clone()
        .json()
        .catch(() => null)) as Record<string, unknown> | null;
      const organizationId =
        typeof payload?.id === 'string' && payload.id.length > 0 ? payload.id : null;
      const organizationName =
        typeof payload?.name === 'string' && payload.name.length > 0 ? payload.name : body.name;

      if (organizationId) {
        await database
          .insert(dbSchema.store)
          .values({
            id: organizationId,
            organizationId,
            slug: body.slug,
            name: organizationName,
          })
          .onConflictDoNothing();

        await syncReserveAppBillingV2DerivedState({ database, env, organizationId });
      }

      return response;
    })();
  });

  authRoutes.openapi(listOrganizationsRoute, (c) => {
    return auth.api.listOrganizations({
      headers: c.req.raw.headers,
      asResponse: true,
    });
  });

  registerBillingRoutes(authRoutes, {
    auth,
    database,
    env,
  });

  authRoutes.openapi(listOrganizationStoresRoute, (c) => {
    return (async () => {
      const { orgSlug } = c.req.valid('param');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const result = await listAccessibleStoresForOrganization({
        organizationSlug: orgSlug,
        userId: identity.userId,
      });
      if (!result.organization) {
        return c.json({ message: 'Organization not found.' }, 404);
      }
      if (result.stores.length === 0) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      return c.json(result.stores, 200);
    })();
  });

  authRoutes.openapi(createStoreRoute, (c) => {
    return (async () => {
      const { orgSlug } = c.req.valid('param');
      const body = c.req.valid('json');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const organization = await resolveOrganizationBySlug(orgSlug);
      if (!organization) {
        return c.json({ message: 'Organization not found.' }, 404);
      }

      const organizationContext = await resolveStoreContextByOrganizationId(organization.id);
      if (!organizationContext) {
        return c.json({ message: 'Organization or store not found.' }, 404);
      }

      const access = await resolveOrganizationStoreAccess({
        database,
        userId: identity.userId,
        context: organizationContext,
      });
      if (!access.effective.canManageOrganization) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const premiumGate = await readOrganizationEntitlementGate({
        database,
        env,
        organizationId: organization.id,
        key: RESERVE_APP_ENTITLEMENTS.STORE_MULTIPLE,
      });
      if (!premiumGate.allowed) {
        return c.json(premiumGate.body, premiumGate.status);
      }

      const slug = body.slug.trim();
      const name = body.name.trim();
      const duplicateRows = await database
        .select({ id: dbSchema.store.id })
        .from(dbSchema.store)
        .where(
          and(eq(dbSchema.store.organizationId, organization.id), eq(dbSchema.store.slug, slug)),
        )
        .limit(1);
      if (duplicateRows[0]) {
        return c.json({ message: 'Store slug already exists.' }, 409);
      }

      const storeId = crypto.randomUUID();
      await database.insert(dbSchema.store).values({
        id: storeId,
        organizationId: organization.id,
        slug,
        name,
      });

      const storeContext = await resolveStoreContextByIds({
        organizationId: organization.id,
        storeId,
      });
      const serialized = await serializeManagedStore({
        context: storeContext,
        userId: identity.userId,
      });

      return c.json(
        serialized ?? {
          id: storeId,
          slug,
          name,
          logo: null,
          facts: {
            orgRole: access.facts.orgRole,
            storeStaffRole: null,
            hasParticipantRecord: false,
          },
          effective: {
            canManageOrganization: true,
            canManageStore: true,
            canManageBookings: true,
            canManageParticipants: true,
            canUseParticipantBooking: false,
          },
          sources: {
            canManageOrganization: 'org_role',
            canManageStore: 'org_role',
            canManageBookings: 'org_role',
            canManageParticipants: 'org_role',
            canUseParticipantBooking: null,
          },
          display: {
            primaryRole: access.display.primaryRole,
            badges: access.display.badges,
          },
        },
        200,
      );
    })();
  });

  authRoutes.openapi(updateStoreRoute, (c) => {
    return (async () => {
      const { orgSlug, storeSlug } = c.req.valid('param');
      const body = c.req.valid('json');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const storeContext = await resolveStoreContextBySlugs({ orgSlug, storeSlug });
      if (!storeContext) {
        return c.json({ message: 'Organization or store not found.' }, 404);
      }

      const access = await resolveOrganizationStoreAccess({
        database,
        userId: identity.userId,
        context: storeContext,
      });
      if (!access.effective.canManageOrganization) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const nextSlug = body.slug.trim();
      const nextName = body.name.trim();
      const duplicateRows = await database
        .select({ id: dbSchema.store.id })
        .from(dbSchema.store)
        .where(
          and(
            eq(dbSchema.store.organizationId, storeContext.organizationId),
            eq(dbSchema.store.slug, nextSlug),
          ),
        )
        .limit(1);
      if (duplicateRows[0] && duplicateRows[0].id !== storeContext.storeId) {
        return c.json({ message: 'Store slug already exists.' }, 409);
      }

      await database
        .update(dbSchema.store)
        .set({
          slug: nextSlug,
          name: nextName,
          updatedAt: new Date(),
        })
        .where(eq(dbSchema.store.id, storeContext.storeId));

      const updatedContext = await resolveStoreContextByIds({
        organizationId: storeContext.organizationId,
        storeId: storeContext.storeId,
      });
      const serialized = await serializeManagedStore({
        context: updatedContext,
        userId: identity.userId,
      });
      if (!serialized) {
        return c.json({ message: 'Store not found.' }, 404);
      }

      return c.json(serialized, 200);
    })();
  });

  authRoutes.openapi(getPublicSiteSettingRoute, (c) => {
    return (async () => {
      const { orgSlug, storeSlug } = c.req.valid('param');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const storeContext = await resolveStoreContextBySlugs({ orgSlug, storeSlug });
      if (!storeContext) {
        return c.json({ message: 'Organization or store not found.' }, 404);
      }

      const access = await resolveOrganizationStoreAccess({
        database,
        userId: identity.userId,
        context: storeContext,
      });
      if (!access.effective.canManageStore) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      return c.json(await serializePublicSiteSetting({ context: storeContext }), 200);
    })();
  });

  authRoutes.openapi(updatePublicSiteSettingRoute, (c) => {
    return (async () => {
      const { orgSlug, storeSlug } = c.req.valid('param');
      const body = c.req.valid('json');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const storeContext = await resolveStoreContextBySlugs({ orgSlug, storeSlug });
      if (!storeContext) {
        return c.json({ message: 'Organization or store not found.' }, 404);
      }

      const access = await resolveOrganizationStoreAccess({
        database,
        userId: identity.userId,
        context: storeContext,
      });
      if (!access.effective.canManageStore) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const currentRows = await database
        .select({
          siteName: dbSchema.publicSiteSetting.siteName,
          description: dbSchema.publicSiteSetting.description,
          address: dbSchema.publicSiteSetting.address,
          phone: dbSchema.publicSiteSetting.phone,
          businessHours: dbSchema.publicSiteSetting.businessHours,
          imageUrl: dbSchema.publicSiteSetting.imageUrl,
          status: dbSchema.publicSiteSetting.status,
          acceptBookings: dbSchema.publicSiteSetting.acceptBookings,
          noindex: dbSchema.publicSiteSetting.noindex,
        })
        .from(dbSchema.publicSiteSetting)
        .where(
          and(
            eq(dbSchema.publicSiteSetting.organizationId, storeContext.organizationId),
            eq(dbSchema.publicSiteSetting.storeId, storeContext.storeId),
          ),
        )
        .limit(1);
      const current = currentRows[0] ?? null;
      const now = new Date();
      const nextValues = {
        siteName: normalizePublicSiteText(body.siteName, current?.siteName ?? null),
        description: normalizePublicSiteText(body.description, current?.description ?? null),
        address: normalizePublicSiteText(body.address, current?.address ?? null),
        phone: normalizePublicSiteText(body.phone, current?.phone ?? null),
        businessHours: normalizePublicSiteText(body.businessHours, current?.businessHours ?? null),
        imageUrl: normalizePublicSiteText(body.imageUrl, current?.imageUrl ?? null),
        status: body.status ?? current?.status ?? 'public',
        acceptBookings: body.acceptBookings ?? current?.acceptBookings ?? true,
        noindex: body.noindex ?? current?.noindex ?? false,
      };

      await database
        .insert(dbSchema.publicSiteSetting)
        .values({
          id: crypto.randomUUID(),
          organizationId: storeContext.organizationId,
          storeId: storeContext.storeId,
          ...nextValues,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [dbSchema.publicSiteSetting.organizationId, dbSchema.publicSiteSetting.storeId],
          set: {
            ...nextValues,
            updatedAt: now,
          },
        });

      return c.json(await serializePublicSiteSetting({ context: storeContext }), 200);
    })();
  });

  authRoutes.openapi(listOrganizationAccessTreeRoute, (c) => {
    return (async () => {
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const [memberRows, participantRows] = await Promise.all([
        database
          .select({
            organizationId: dbSchema.member.organizationId,
            organizationSlug: dbSchema.organization.slug,
            organizationName: dbSchema.organization.name,
            organizationLogo: dbSchema.organization.logo,
            role: dbSchema.member.role,
          })
          .from(dbSchema.member)
          .innerJoin(
            dbSchema.organization,
            eq(dbSchema.organization.id, dbSchema.member.organizationId),
          )
          .where(eq(dbSchema.member.userId, identity.userId)),
        database
          .select({
            organizationId: dbSchema.participant.organizationId,
            storeId: dbSchema.participant.storeId,
            organizationSlug: dbSchema.organization.slug,
            organizationName: dbSchema.organization.name,
            organizationLogo: dbSchema.organization.logo,
          })
          .from(dbSchema.participant)
          .innerJoin(
            dbSchema.organization,
            eq(dbSchema.organization.id, dbSchema.participant.organizationId),
          )
          .where(eq(dbSchema.participant.userId, identity.userId)),
      ]);

      const storeMemberRows = await database
        .select({
          organizationId: dbSchema.store.organizationId,
          organizationSlug: dbSchema.organization.slug,
          organizationName: dbSchema.organization.name,
          organizationLogo: dbSchema.organization.logo,
          storeId: dbSchema.store.id,
          role: dbSchema.storeMember.role,
        })
        .from(dbSchema.storeMember)
        .innerJoin(dbSchema.store, eq(dbSchema.store.id, dbSchema.storeMember.storeId))
        .innerJoin(
          dbSchema.organization,
          eq(dbSchema.organization.id, dbSchema.store.organizationId),
        )
        .where(eq(dbSchema.storeMember.userId, identity.userId));

      const organizationsById = new Map<
        string,
        {
          organizationId: string;
          organizationSlug: string;
          organizationName: string;
          organizationLogo: string | null;
          organizationRole: 'owner' | 'admin' | 'member' | null;
        }
      >();
      for (const row of memberRows) {
        organizationsById.set(row.organizationId, {
          organizationId: row.organizationId,
          organizationSlug: row.organizationSlug,
          organizationName: row.organizationName,
          organizationLogo: row.organizationLogo,
          organizationRole:
            row.role === 'owner' || row.role === 'admin' || row.role === 'member' ? row.role : null,
        });
      }
      for (const row of participantRows) {
        organizationsById.set(row.organizationId, {
          organizationId: row.organizationId,
          organizationSlug: row.organizationSlug,
          organizationName: row.organizationName,
          organizationLogo: row.organizationLogo,
          organizationRole: organizationsById.get(row.organizationId)?.organizationRole ?? null,
        });
      }
      for (const row of storeMemberRows) {
        organizationsById.set(row.organizationId, {
          organizationId: row.organizationId,
          organizationSlug: row.organizationSlug,
          organizationName: row.organizationName,
          organizationLogo: row.organizationLogo,
          organizationRole: organizationsById.get(row.organizationId)?.organizationRole ?? null,
        });
      }

      const tree: Array<z.infer<typeof accessTreeOrganizationSchema>> = [];
      for (const row of organizationsById.values()) {
        const allStoreContexts =
          row.organizationRole === 'owner' || row.organizationRole === 'admin'
            ? await listOrganizationStoreContexts({
                database,
                organizationId: row.organizationId,
              })
            : [];

        const accessibleStoreIds = new Set<string>();
        for (const storeRow of storeMemberRows) {
          if (storeRow.organizationId === row.organizationId) {
            accessibleStoreIds.add(storeRow.storeId);
          }
        }
        for (const participantRow of participantRows) {
          if (participantRow.organizationId === row.organizationId) {
            accessibleStoreIds.add(participantRow.storeId);
          }
        }

        const storeContexts =
          allStoreContexts.length > 0
            ? allStoreContexts
            : (
                await Promise.all(
                  Array.from(accessibleStoreIds).map(async (storeId) =>
                    resolveOrganizationStoreContext({
                      database,
                      organizationId: row.organizationId,
                    }).then(async (fallbackContext) => {
                      if (fallbackContext?.storeId === storeId) {
                        return fallbackContext;
                      }
                      const storeRows = await database
                        .select({
                          id: dbSchema.store.id,
                          slug: dbSchema.store.slug,
                          name: dbSchema.store.name,
                        })
                        .from(dbSchema.store)
                        .where(
                          and(
                            eq(dbSchema.store.organizationId, row.organizationId),
                            eq(dbSchema.store.id, storeId),
                          ),
                        )
                        .limit(1);
                      const store = storeRows[0];
                      return store
                        ? {
                            organizationId: row.organizationId,
                            organizationSlug: row.organizationSlug,
                            organizationName: row.organizationName,
                            storeId: store.id,
                            storeSlug: store.slug,
                            storeName: store.name,
                          }
                        : null;
                    }),
                  ),
                )
              ).filter((context): context is NonNullable<typeof context> => Boolean(context));

        const stores = [];
        for (const context of storeContexts) {
          const access = await resolveOrganizationStoreAccess({
            database,
            userId: identity.userId,
            context,
          });
          if (
            !access.display.primaryRole &&
            !access.effective.canUseParticipantBooking &&
            !access.effective.canManageStore
          ) {
            continue;
          }
          stores.push({
            id: context.storeId,
            slug: context.storeSlug,
            name: context.storeName,
            logo: null,
            facts: access.facts,
            effective: access.effective,
            sources: access.sources,
            display: access.display,
          });
        }

        if (stores.length === 0) {
          continue;
        }

        stores.sort((left, right) => left.name.localeCompare(right.name));
        tree.push({
          org: {
            id: row.organizationId,
            slug: row.organizationSlug,
            name: row.organizationName,
            logo: row.organizationLogo,
          },
          facts: {
            orgRole: row.organizationRole,
          },
          stores,
        });
      }

      tree.sort((left, right) => left.org.name.localeCompare(right.org.name));
      return c.json({ orgs: tree }, 200);
    })();
  });

  authRoutes.openapi(setActiveOrganizationRoute, (c) => {
    const body = c.req.valid('json');

    return auth.api.setActiveOrganization({
      body,
      headers: c.req.raw.headers,
      asResponse: true,
    });
  });

  authRoutes.openapi(getFullOrganizationRoute, (c) => {
    const query = c.req.valid('query');

    return auth.api.getFullOrganization({
      query,
      headers: c.req.raw.headers,
      asResponse: true,
    });
  });

  authRoutes.openapi(createOrganizationInvitationRoute, (c) => {
    return (async () => {
      const { orgSlug } = c.req.valid('param');
      const body = c.req.valid('json');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const organization = await resolveOrganizationBySlug(orgSlug);
      if (!organization) {
        return c.json({ message: 'Organization not found.' }, 404);
      }

      const hasAccess = await hasOrganizationAdminAccess({
        organizationId: organization.id,
        userId: identity.userId,
      });
      if (!hasAccess) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const premiumGate = await readOrganizationEntitlementGate({
        database,
        env,
        organizationId: organization.id,
        key: RESERVE_APP_ENTITLEMENTS.STAFF_INVITE,
      });
      if (!premiumGate.allowed) {
        return c.json(premiumGate.body, premiumGate.status);
      }

      const normalizedEmail = normalizeEmail(body.email);
      const pendingInvitation = await markInvitationExpiredIfNeeded(
        await findPendingInvitationForResend({
          organizationId: organization.id,
          subjectKind: 'org_operator',
          role: body.role,
          email: normalizedEmail,
        }),
      );
      const pendingSerialized = serializeInvitation(pendingInvitation);

      if (body.resend) {
        if (!pendingInvitation || pendingSerialized?.status !== 'pending') {
          return c.json({ message: 'Pending invitation for resend was not found.' }, 400);
        }

        const resentCount = await countInvitationEvent({
          invitationId: pendingInvitation.id,
          eventType: 'resent',
        });
        if (resentCount >= 3) {
          return c.json({ message: 'Invitation resend limit reached (3).' }, 429);
        }

        await sendInvitationEmailForRecord({
          invitation: pendingInvitation,
          headers,
        });
        await writeInvitationEvent({
          invitationId: pendingInvitation.id,
          organizationId: pendingInvitation.organizationId,
          actorUserId: identity.userId,
          targetEmail: pendingInvitation.email,
          eventType: 'resent',
          metadata: {
            subjectKind: 'org_operator',
            role: body.role,
          },
          headers,
        });

        return c.json(pendingSerialized, 200);
      }

      if (pendingInvitation && pendingSerialized?.status === 'pending') {
        return c.json({ message: 'Pending invitation already exists for this email.' }, 409);
      }

      const createdInvitation = await createInvitationRecord({
        subjectKind: 'org_operator',
        role: body.role,
        organizationId: organization.id,
        email: normalizedEmail,
        invitedByUserId: identity.userId,
      });
      if (!createdInvitation) {
        return c.json({ message: 'Failed to create invitation.' }, 500);
      }

      const serializedInvitation = serializeInvitation(createdInvitation);
      if (!serializedInvitation) {
        return c.json({ message: 'Failed to serialize invitation.' }, 500);
      }

      await sendInvitationEmailForRecord({
        invitation: createdInvitation,
        headers,
      });
      await writeInvitationEvent({
        invitationId: createdInvitation.id,
        organizationId: createdInvitation.organizationId,
        actorUserId: identity.userId,
        targetEmail: createdInvitation.email,
        eventType: 'created',
        metadata: {
          subjectKind: 'org_operator',
          role: body.role,
        },
        headers,
      });

      return c.json(serializedInvitation, 200);
    })();
  });

  authRoutes.openapi(listOrganizationInvitationsRoute, (c) => {
    return (async () => {
      const { orgSlug } = c.req.valid('param');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const organization = await resolveOrganizationBySlug(orgSlug);
      if (!organization) {
        return c.json({ message: 'Organization not found.' }, 404);
      }

      const hasAccess = await hasOrganizationAdminAccess({
        organizationId: organization.id,
        userId: identity.userId,
      });
      if (!hasAccess) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const premiumGate = await readOrganizationEntitlementGate({
        database,
        env,
        organizationId: organization.id,
        key: RESERVE_APP_ENTITLEMENTS.STAFF_INVITE,
      });
      if (!premiumGate.allowed) {
        return c.json(premiumGate.body, premiumGate.status);
      }

      const invitations = await listSerializedInvitations(
        and(
          eq(dbSchema.invitation.organizationId, organization.id),
          eq(dbSchema.invitation.subjectKind, 'org_operator'),
        ),
      );
      return c.json(invitations, 200);
    })();
  });

  authRoutes.openapi(createStoreInvitationRoute, (c) => {
    return (async () => {
      const { orgSlug, storeSlug } = c.req.valid('param');
      const body = c.req.valid('json');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const storeContext = await resolveStoreContextBySlugs({ orgSlug, storeSlug });
      if (!storeContext) {
        return c.json({ message: 'Organization or store not found.' }, 404);
      }

      const access = await resolveOrganizationStoreAccess({
        database,
        userId: identity.userId,
        context: storeContext,
      });

      const normalizedEmail = normalizeEmail(body.email);
      const subjectKind: InvitationSubjectKind =
        body.role === 'participant' ? 'participant' : 'store_operator';

      if (subjectKind === 'participant') {
        if (!access.effective.canManageParticipants) {
          return c.json({ message: 'Forbidden' }, 403);
        }
        if (!body.participantName || body.participantName.trim().length === 0) {
          return c.json(
            { message: 'participantName is required for participant invitations.' },
            400,
          );
        }
      } else if (!access.effective.canManageStore) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const premiumGate = await readOrganizationEntitlementGate({
        database,
        env,
        organizationId: storeContext.organizationId,
        key: RESERVE_APP_ENTITLEMENTS.STAFF_INVITE,
      });
      if (!premiumGate.allowed) {
        return c.json(premiumGate.body, premiumGate.status);
      }

      const pendingInvitation = await markInvitationExpiredIfNeeded(
        await findPendingInvitationForResend({
          organizationId: storeContext.organizationId,
          storeId: storeContext.storeId,
          subjectKind,
          role: body.role,
          email: normalizedEmail,
        }),
      );
      const pendingSerialized = serializeInvitation(pendingInvitation);

      if (body.resend) {
        if (!pendingInvitation || pendingSerialized?.status !== 'pending') {
          return c.json({ message: 'Pending invitation for resend was not found.' }, 400);
        }

        const resentCount = await countInvitationEvent({
          invitationId: pendingInvitation.id,
          eventType: 'resent',
        });
        if (resentCount >= 3) {
          return c.json({ message: 'Invitation resend limit reached (3).' }, 429);
        }

        await sendInvitationEmailForRecord({
          invitation: pendingInvitation,
          headers,
        });
        await writeInvitationEvent({
          invitationId: pendingInvitation.id,
          organizationId: pendingInvitation.organizationId,
          storeId: pendingInvitation.storeId,
          actorUserId: identity.userId,
          targetEmail: pendingInvitation.email,
          eventType: 'resent',
          metadata: {
            subjectKind,
            role: body.role,
            storeSlug: storeContext.storeSlug,
          },
          headers,
        });

        return c.json(pendingSerialized, 200);
      }

      if (pendingInvitation && pendingSerialized?.status === 'pending') {
        return c.json({ message: 'Pending invitation already exists for this email.' }, 409);
      }

      const createdInvitation = await createInvitationRecord({
        subjectKind,
        role: body.role,
        organizationId: storeContext.organizationId,
        storeId: storeContext.storeId,
        email: normalizedEmail,
        participantName:
          body.role === 'participant' ? (body.participantName?.trim() ?? null) : null,
        invitedByUserId: identity.userId,
      });
      if (!createdInvitation) {
        return c.json({ message: 'Failed to create invitation.' }, 500);
      }

      const serializedInvitation = serializeInvitation(createdInvitation);
      if (!serializedInvitation) {
        return c.json({ message: 'Failed to serialize invitation.' }, 500);
      }

      await sendInvitationEmailForRecord({
        invitation: createdInvitation,
        headers,
      });
      await writeInvitationEvent({
        invitationId: createdInvitation.id,
        organizationId: createdInvitation.organizationId,
        storeId: createdInvitation.storeId,
        actorUserId: identity.userId,
        targetEmail: createdInvitation.email,
        eventType: 'created',
        metadata: {
          subjectKind,
          role: body.role,
          storeSlug: storeContext.storeSlug,
          participantName:
            body.role === 'participant' ? (body.participantName?.trim() ?? null) : null,
        },
        headers,
      });

      return c.json(serializedInvitation, 200);
    })();
  });

  authRoutes.openapi(listStoreInvitationsRoute, (c) => {
    return (async () => {
      const { orgSlug, storeSlug } = c.req.valid('param');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const storeContext = await resolveStoreContextBySlugs({ orgSlug, storeSlug });
      if (!storeContext) {
        return c.json({ message: 'Organization or store not found.' }, 404);
      }

      const access = await resolveOrganizationStoreAccess({
        database,
        userId: identity.userId,
        context: storeContext,
      });
      if (!access.effective.canManageParticipants && !access.effective.canManageStore) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const premiumGate = await readOrganizationEntitlementGate({
        database,
        env,
        organizationId: storeContext.organizationId,
        key: RESERVE_APP_ENTITLEMENTS.STAFF_INVITE,
      });
      if (!premiumGate.allowed) {
        return c.json(premiumGate.body, premiumGate.status);
      }

      const invitations = await listSerializedInvitations(
        and(
          eq(dbSchema.invitation.organizationId, storeContext.organizationId),
          eq(dbSchema.invitation.storeId, storeContext.storeId),
        ),
      );
      const filteredInvitations = invitations.filter((invitation) => {
        if (invitation.subjectKind === 'participant') {
          return access.effective.canManageParticipants || access.effective.canManageStore;
        }

        return access.effective.canManageStore;
      });

      return c.json(filteredInvitations, 200);
    })();
  });

  authRoutes.openapi(listUserInvitationsRoute, (c) => {
    return (async () => {
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }
      if (!identity.email) {
        return c.json({ message: 'Current user email is unavailable.' }, 400);
      }

      const invitations = await listSerializedInvitations(
        eq(dbSchema.invitation.email, identity.email),
      );
      return c.json(invitations, 200);
    })();
  });

  authRoutes.openapi(invitationDetailRoute, (c) => {
    return (async () => {
      const { invitationId } = c.req.valid('param');
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }
      if (!identity.email) {
        return c.json({ message: 'Current user email is unavailable.' }, 400);
      }

      const invitation = await hydrateInvitationRecord(invitationId);
      if (!invitation) {
        return c.json({ message: 'Invitation not found.' }, 404);
      }
      if (!isInvitationRecipient({ invitation, email: identity.email })) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const serializedInvitation = serializeInvitation(invitation);
      if (!serializedInvitation) {
        return c.json({ message: 'Invitation not found.' }, 404);
      }

      return c.json(serializedInvitation, 200);
    })();
  });

  authRoutes.openapi(acceptInvitationRoute, (c) => {
    return (async () => {
      const { invitationId } = c.req.valid('param');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }
      if (!identity.email) {
        return c.json({ message: 'Current user email is unavailable.' }, 400);
      }

      const invitation = await hydrateInvitationRecord(invitationId);
      if (!invitation) {
        return c.json({ message: 'Invitation not found.' }, 404);
      }
      if (!isInvitationRecipient({ invitation, email: identity.email })) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      if (
        invitation.subjectKind === 'org_operator' ||
        invitation.subjectKind === 'store_operator'
      ) {
        const premiumGate = await readOrganizationEntitlementGate({
          database,
          env,
          organizationId: invitation.organizationId,
          key: RESERVE_APP_ENTITLEMENTS.STAFF_INVITE,
        });
        if (!premiumGate.allowed) {
          return c.json(premiumGate.body, premiumGate.status);
        }
      }

      const serializedBeforeAccept = serializeInvitation(invitation);
      if (!serializedBeforeAccept || serializedBeforeAccept.status !== 'pending') {
        return c.json({ message: 'Invitation is not pending.' }, 400);
      }

      const accepted = await acceptInvitationRecord({
        invitation,
        userId: identity.userId,
      });
      if (!accepted) {
        return c.json({ message: 'Invitation has already been processed.' }, 409);
      }

      const updatedInvitation = await hydrateInvitationRecord(invitationId);
      const serializedInvitation = serializeInvitation(updatedInvitation);
      if (!serializedInvitation) {
        return c.json({ message: 'Invitation could not be loaded after acceptance.' }, 400);
      }

      await writeInvitationEvent({
        invitationId: invitation.id,
        organizationId: invitation.organizationId,
        storeId: invitation.storeId,
        actorUserId: identity.userId,
        targetEmail: invitation.email,
        eventType: 'accepted',
        headers,
      });

      return c.json(
        {
          invitation: serializedInvitation,
          accepted,
        },
        200,
      );
    })();
  });

  authRoutes.openapi(rejectInvitationRoute, (c) => {
    return (async () => {
      const { invitationId } = c.req.valid('param');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }
      if (!identity.email) {
        return c.json({ message: 'Current user email is unavailable.' }, 400);
      }

      const invitation = await hydrateInvitationRecord(invitationId);
      if (!invitation) {
        return c.json({ message: 'Invitation not found.' }, 404);
      }
      if (!isInvitationRecipient({ invitation, email: identity.email })) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const serializedInvitation = serializeInvitation(invitation);
      if (!serializedInvitation || serializedInvitation.status !== 'pending') {
        return c.json({ message: 'Invitation is not pending.' }, 400);
      }

      await database
        .update(dbSchema.invitation)
        .set({
          status: 'rejected',
          respondedByUserId: identity.userId,
          respondedAt: new Date(),
        })
        .where(
          and(eq(dbSchema.invitation.id, invitation.id), eq(dbSchema.invitation.status, 'pending')),
        );

      const updatedInvitation = await hydrateInvitationRecord(invitation.id);
      const nextInvitation = serializeInvitation(updatedInvitation);
      if (!nextInvitation) {
        return c.json({ message: 'Invitation could not be loaded after rejection.' }, 400);
      }

      await writeInvitationEvent({
        invitationId: invitation.id,
        organizationId: invitation.organizationId,
        storeId: invitation.storeId,
        actorUserId: identity.userId,
        targetEmail: invitation.email,
        eventType: 'rejected',
        headers,
      });

      return c.json(nextInvitation, 200);
    })();
  });

  authRoutes.openapi(cancelInvitationRoute, (c) => {
    return (async () => {
      const { invitationId } = c.req.valid('param');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const invitation = await hydrateInvitationRecord(invitationId);
      if (!invitation) {
        return c.json({ message: 'Invitation not found.' }, 404);
      }

      const serializedInvitation = serializeInvitation(invitation);
      if (!serializedInvitation || serializedInvitation.status !== 'pending') {
        return c.json({ message: 'Invitation is not pending.' }, 400);
      }

      const authorized = await canCancelInvitation({
        invitation,
        userId: identity.userId,
      });
      if (!authorized) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      await database
        .update(dbSchema.invitation)
        .set({
          status: 'cancelled',
          respondedByUserId: identity.userId,
          respondedAt: new Date(),
        })
        .where(
          and(eq(dbSchema.invitation.id, invitation.id), eq(dbSchema.invitation.status, 'pending')),
        );

      const updatedInvitation = await hydrateInvitationRecord(invitation.id);
      const nextInvitation = serializeInvitation(updatedInvitation);
      if (!nextInvitation) {
        return c.json({ message: 'Invitation could not be loaded after cancellation.' }, 400);
      }

      await writeInvitationEvent({
        invitationId: invitation.id,
        organizationId: invitation.organizationId,
        storeId: invitation.storeId,
        actorUserId: identity.userId,
        targetEmail: invitation.email,
        eventType: 'cancelled',
        headers,
      });

      return c.json(nextInvitation, 200);
    })();
  });

  authRoutes.openapi(listParticipantsRoute, (c) => {
    return (async () => {
      const query = c.req.valid('query');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);

      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const organizationId = resolveOrganizationId(
        query.organizationId,
        identity.activeOrganizationId,
      );
      if (!organizationId) {
        return c.json({ message: 'organizationId is required.' }, 400);
      }

      if (query.storeId) {
        const storeContext = await resolveStoreContextByIds({
          organizationId,
          storeId: query.storeId,
        });
        if (!storeContext) {
          return c.json({ message: 'Store not found.' }, 404);
        }

        const access = await resolveOrganizationStoreAccess({
          database,
          userId: identity.userId,
          context: storeContext,
        });
        if (!access.effective.canManageParticipants && !access.effective.canManageStore) {
          return c.json({ message: 'Forbidden' }, 403);
        }
      } else {
        const hasAccess = await hasOrganizationAdminAccess({
          organizationId,
          userId: identity.userId,
        });
        if (!hasAccess) {
          return c.json({ message: 'Forbidden' }, 403);
        }
      }

      const premiumGate = await readOrganizationEntitlementGate({
        database,
        env,
        organizationId,
        key: RESERVE_APP_ENTITLEMENTS.ORGANIZATION_PREMIUM,
      });
      if (!premiumGate.allowed) {
        return c.json(premiumGate.body, premiumGate.status);
      }

      const filters = [eq(dbSchema.participant.organizationId, organizationId)];
      if (query.storeId) {
        filters.push(eq(dbSchema.participant.storeId, query.storeId));
      }

      const rows = await database
        .select({
          id: dbSchema.participant.id,
          organizationId: dbSchema.participant.organizationId,
          storeId: dbSchema.participant.storeId,
          userId: dbSchema.participant.userId,
          email: dbSchema.participant.email,
          name: dbSchema.participant.name,
          createdAt: dbSchema.participant.createdAt,
          updatedAt: dbSchema.participant.updatedAt,
        })
        .from(dbSchema.participant)
        .where(and(...filters))
        .orderBy(desc(dbSchema.participant.createdAt));

      return c.json(
        rows.map((row: Record<string, unknown>) => ({
          ...row,
          createdAt: toIsoDateString(row.createdAt),
          updatedAt: toIsoDateString(row.updatedAt),
        })),
        200,
      );
    })();
  });

  authRoutes.openapi(selfEnrollParticipantRoute, (c) => {
    return (async () => {
      const body = c.req.valid('json');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }
      if (!identity.email) {
        return c.json({ message: 'Current user email is unavailable.' }, 400);
      }
      const participantEmail = identity.email;

      const publicOrganizationSlug = resolvePublicEventsOrganizationSlug(env);
      if (!publicOrganizationSlug) {
        return c.json({ message: 'PUBLIC_EVENTS_ORG_SLUG is not configured.' }, 503);
      }

      const publicOrganizationRows = await database
        .select({
          id: dbSchema.organization.id,
        })
        .from(dbSchema.organization)
        .where(eq(dbSchema.organization.slug, publicOrganizationSlug))
        .limit(1);
      const publicOrganization = publicOrganizationRows[0];
      if (!publicOrganization) {
        return c.json({ message: 'Public events organization was not found.' }, 503);
      }

      const publicStoreSlug = resolvePublicEventsStoreSlug(env) ?? publicOrganizationSlug;
      if (publicStoreSlug.length === 0) {
        return c.json({ message: 'PUBLIC_EVENTS_STORE_SLUG is invalid.' }, 503);
      }

      if (body.organizationId !== publicOrganization.id) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const storeContext = body.storeId
        ? await resolveStoreContextByIds({
            organizationId: body.organizationId,
            storeId: body.storeId,
          })
        : await resolveStoreContextBySlugs({
            orgSlug: publicOrganizationSlug,
            storeSlug: publicStoreSlug,
          });
      if (!storeContext) {
        return c.json({ message: 'Public events store was not found.' }, 503);
      }

      const currentSession = await auth.api.getSession({ headers });
      const participantName = getStringValue(currentSession?.user?.name)?.trim();
      if (!participantName) {
        return c.json({ message: 'Current user name is unavailable.' }, 400);
      }

      const selectExistingParticipant = async () => {
        const rows = await database
          .select({
            id: dbSchema.participant.id,
            organizationId: dbSchema.participant.organizationId,
            storeId: dbSchema.participant.storeId,
            userId: dbSchema.participant.userId,
            email: dbSchema.participant.email,
            name: dbSchema.participant.name,
            createdAt: dbSchema.participant.createdAt,
            updatedAt: dbSchema.participant.updatedAt,
          })
          .from(dbSchema.participant)
          .where(
            and(
              eq(dbSchema.participant.organizationId, body.organizationId),
              eq(dbSchema.participant.storeId, storeContext.storeId),
              or(
                eq(dbSchema.participant.userId, identity.userId),
                eq(dbSchema.participant.email, participantEmail),
              ),
            ),
          )
          .limit(1);

        return rows[0] ?? null;
      };

      const existingParticipant = await selectExistingParticipant();
      if (existingParticipant) {
        return c.json(
          {
            participant: serializeParticipant(existingParticipant),
            created: false,
          },
          200,
        );
      }

      const participantId = crypto.randomUUID();
      try {
        await database.insert(dbSchema.participant).values({
          id: participantId,
          organizationId: body.organizationId,
          storeId: storeContext.storeId,
          userId: identity.userId,
          email: participantEmail,
          name: participantName,
        });
      } catch (error) {
        const maybeUniqueConstraint =
          error instanceof Error && error.message.includes('UNIQUE constraint failed');
        if (maybeUniqueConstraint) {
          const duplicated = await selectExistingParticipant();
          if (duplicated) {
            return c.json(
              {
                participant: serializeParticipant(duplicated),
                created: false,
              },
              200,
            );
          }
        }
        throw error;
      }

      const createdRows = await database
        .select({
          id: dbSchema.participant.id,
          organizationId: dbSchema.participant.organizationId,
          storeId: dbSchema.participant.storeId,
          userId: dbSchema.participant.userId,
          email: dbSchema.participant.email,
          name: dbSchema.participant.name,
          createdAt: dbSchema.participant.createdAt,
          updatedAt: dbSchema.participant.updatedAt,
        })
        .from(dbSchema.participant)
        .where(eq(dbSchema.participant.id, participantId))
        .limit(1);
      const createdParticipant = createdRows[0] ?? null;
      if (!createdParticipant) {
        return c.json({ message: 'Failed to create participant.' }, 500);
      }

      return c.json(
        {
          participant: serializeParticipant(createdParticipant),
          created: true,
        },
        200,
      );
    })();
  });

  registerBookingRoutes({
    authRoutes,
    auth,
    database,
    env,
    serviceImageUploadService,
  });

  const scopedOrganizationApiPrefixes = [
    '/participants',
    '/services',
    '/slots',
    '/recurring-schedules',
    '/bookings',
    '/ticket-types',
    '/ticket-packs',
    '/ticket-purchases',
  ] as const;

  authRoutes.on(['GET', 'POST'], '/orgs/:orgSlug/stores/:storeSlug/*', async (c) => {
    const { orgSlug, storeSlug } = c.req.param();
    const storeContext = await resolveStoreContextBySlugs({ orgSlug, storeSlug });
    if (!storeContext) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }

    const scopedPrefix = `/orgs/${orgSlug}/stores/${storeSlug}`;
    const prefixIndex = c.req.path.indexOf(scopedPrefix);
    if (prefixIndex < 0) {
      return c.json({ message: 'Not found.' }, 404);
    }

    const suffix = c.req.path.slice(prefixIndex + scopedPrefix.length);
    if (
      suffix.length === 0 ||
      !scopedOrganizationApiPrefixes.some((candidatePrefix) => suffix.startsWith(candidatePrefix))
    ) {
      return c.json({ message: 'Not found.' }, 404);
    }

    const targetUrl = new URL(c.req.url);
    targetUrl.pathname = `/organizations${suffix}`;
    targetUrl.searchParams.set('organizationId', storeContext.organizationId);
    targetUrl.searchParams.set('storeId', storeContext.storeId);

    const headers = new Headers(c.req.raw.headers);
    headers.delete('content-length');

    let body: BodyInit | undefined;
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const contentType = c.req.raw.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const payload = await c.req.raw
          .clone()
          .json()
          .catch(() => ({}));
        const nextPayload =
          typeof payload === 'object' && payload !== null
            ? {
                ...payload,
                organizationId: storeContext.organizationId,
                storeId: storeContext.storeId,
              }
            : {
                organizationId: storeContext.organizationId,
                storeId: storeContext.storeId,
              };
        body = JSON.stringify(nextPayload);
        headers.set('content-type', 'application/json');
      } else {
        body = await c.req.raw.clone().arrayBuffer();
      }
    }

    const forwardedRequest = new Request(targetUrl.toString(), {
      method: c.req.method,
      headers,
      body,
    });

    const executionCtx = (() => {
      try {
        return c.executionCtx;
      } catch {
        return undefined;
      }
    })();

    return authRoutes.fetch(forwardedRequest, c.env, executionCtx);
  });

  return authRoutes;
};
