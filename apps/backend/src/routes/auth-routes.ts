import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import {
  canManageParticipantsByRole,
  listOrganizationClassroomContexts,
  resolveOrganizationClassroomAccess,
  resolveOrganizationClassroomContext,
} from '../booking/authorization.js';
import type { AuthInstance, AuthRuntimeDatabase, AuthRuntimeEnv } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';
import { sendParticipantInvitationEmail } from '../email/resend.js';
import type { OrganizationLogoService } from '../organization-logo-service.js';
import type { ServiceImageUploadService } from '../service-image-upload-service.js';
import { registerBookingRoutes } from './booking-routes.js';

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

const isFileEntry = (value: FormDataEntryValue | null): value is File => {
  return typeof File !== 'undefined' && value instanceof File;
};

type InvitationPayload = {
  id: string;
  organizationId: string;
  email: string;
  [key: string]: unknown;
};

const isInvitationPayload = (value: unknown): value is InvitationPayload => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.id === 'string' &&
    typeof payload.organizationId === 'string' &&
    typeof payload.email === 'string'
  );
};

const parseResponseBody = async (response: Response): Promise<unknown> => {
  const cloned = response.clone();
  const contentType = cloned.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return cloned.json();
  }

  const text = await cloned.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
  slug: z.string().min(1).max(120),
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

const createInvitationBodySchema = z.object({
  email: z.email(),
  role: z.enum(['admin', 'member']),
  resend: z.boolean().optional(),
  organizationId: z.string().min(1).optional(),
});

const listInvitationsQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

const invitationActionBodySchema = z.object({
  invitationId: z.string().min(1),
});

const invitationDetailQuerySchema = z.object({
  invitationId: z.string().min(1),
});

const createParticipantInvitationBodySchema = z.object({
  email: z.email(),
  participantName: z.string().trim().min(1).max(120),
  resend: z.boolean().optional(),
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
});

const listParticipantsQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
});

const selfEnrollParticipantBodySchema = z.object({
  organizationId: z.string().min(1),
  classroomId: z.string().min(1).optional(),
});

const listParticipantInvitationsQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
});

const participantInvitationActionBodySchema = z.object({
  invitationId: z.string().min(1),
});

const participantInvitationDetailQuerySchema = z.object({
  invitationId: z.string().min(1),
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
const classroomRoleSchema = z.enum(['manager', 'staff', 'participant']);

const organizationAccessSchema = z.object({
  organizationId: z.string().min(1),
  organizationName: z.string().nullable(),
  role: organizationMembershipRoleSchema.nullable(),
  classroomRole: classroomRoleSchema,
  canManage: z.boolean(),
  canUseParticipantBooking: z.boolean(),
});

const listOrganizationAccessRoute = createRoute({
  method: 'get',
  path: '/organizations/access',
  tags: ['Organization'],
  summary: 'List effective organization access for current user',
  responses: {
    200: {
      description: 'Organization access list',
      content: {
        'application/json': {
          schema: z.array(organizationAccessSchema),
        },
      },
    },
    401: {
      description: 'Unauthorized',
    },
  },
});

const accessTreeClassroomSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  logo: z.string().min(1).nullable().optional(),
  role: classroomRoleSchema.nullable(),
  canManage: z.boolean(),
  canManageBookings: z.boolean(),
  canManageParticipants: z.boolean(),
  canUseParticipantBooking: z.boolean(),
});

const accessTreeOrganizationSchema = z.object({
  org: z.object({
    id: z.string().min(1),
    slug: z.string().min(1),
    name: z.string().min(1),
    logo: z.string().min(1).nullable().optional(),
  }),
  orgRole: organizationMembershipRoleSchema.nullable(),
  classrooms: z.array(accessTreeClassroomSchema),
});

const accessTreeResponseSchema = z.object({
  orgs: z.array(accessTreeOrganizationSchema),
});

const listOrganizationAccessTreeRoute = createRoute({
  method: 'get',
  path: '/orgs/access-tree',
  tags: ['Organization'],
  summary: 'List organization and classroom access tree for current user',
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

const classroomInvitationRoleSchema = z.enum(['manager', 'staff', 'participant']);

const classroomInvitationRouteParamsSchema = z.object({
  orgSlug: z.string().min(1),
  classroomSlug: z.string().min(1),
});

const createClassroomInvitationBodySchema = z.object({
  email: z.email(),
  role: classroomInvitationRoleSchema,
  participantName: z.string().trim().min(1).max(120).optional(),
  resend: z.boolean().optional(),
});

const classroomInvitationSchema = z.object({
  id: z.string().min(1),
  invitationKind: z.enum(['classroom-member', 'participant']),
  role: classroomInvitationRoleSchema,
  organizationId: z.string().min(1),
  organizationSlug: z.string().min(1),
  organizationName: z.string().min(1),
  classroomId: z.string().min(1),
  classroomSlug: z.string().min(1),
  classroomName: z.string().min(1),
  email: z.string().email(),
  status: z.string(),
  participantName: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  invitedByUserId: z.string().nullable(),
  respondedByUserId: z.string().nullable(),
  respondedAt: z.string().nullable(),
});

const createClassroomInvitationRoute = createRoute({
  method: 'post',
  path: '/orgs/{orgSlug}/classrooms/{classroomSlug}/invitations',
  tags: ['Classroom Invitations'],
  summary: 'Create or resend classroom invitation',
  request: {
    params: classroomInvitationRouteParamsSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: createClassroomInvitationBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Invitation created or resent',
      content: {
        'application/json': {
          schema: classroomInvitationSchema,
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
      description: 'Organization or classroom not found',
    },
    409: {
      description: 'Duplicate pending invitation',
    },
    429: {
      description: 'Resend limit reached',
    },
    400: {
      description: 'Validation error',
    },
  },
});

const listClassroomInvitationsRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/classrooms/{classroomSlug}/invitations',
  tags: ['Classroom Invitations'],
  summary: 'List classroom invitations',
  request: {
    params: classroomInvitationRouteParamsSchema,
  },
  responses: {
    200: {
      description: 'Classroom invitation list',
      content: {
        'application/json': {
          schema: z.array(classroomInvitationSchema),
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
      description: 'Organization or classroom not found',
    },
  },
});

const listUserClassroomInvitationsRoute = createRoute({
  method: 'get',
  path: '/orgs/classrooms/invitations/user',
  tags: ['Classroom Invitations'],
  summary: 'List classroom invitations for current user email',
  responses: {
    200: {
      description: 'Classroom invitation list for current user',
      content: {
        'application/json': {
          schema: z.array(classroomInvitationSchema),
        },
      },
    },
    401: {
      description: 'Unauthorized',
    },
    400: {
      description: 'Validation error',
    },
  },
});

const classroomInvitationDetailQuerySchema = z.object({
  invitationId: z.string().min(1),
});

const classroomInvitationActionBodySchema = z.object({
  invitationId: z.string().min(1),
});

const classroomInvitationDetailRoute = createRoute({
  method: 'get',
  path: '/orgs/classrooms/invitations/detail',
  tags: ['Classroom Invitations'],
  summary: 'Get classroom invitation detail',
  request: {
    query: classroomInvitationDetailQuerySchema,
  },
  responses: {
    200: {
      description: 'Classroom invitation detail',
      content: {
        'application/json': {
          schema: classroomInvitationSchema,
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
      description: 'Invitation not found',
    },
  },
});

const acceptClassroomInvitationRoute = createRoute({
  method: 'post',
  path: '/orgs/classrooms/invitations/accept',
  tags: ['Classroom Invitations'],
  summary: 'Accept classroom invitation',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: classroomInvitationActionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Invitation accepted',
    },
    401: {
      description: 'Unauthorized',
    },
    403: {
      description: 'Forbidden',
    },
    404: {
      description: 'Invitation not found',
    },
    409: {
      description: 'Already exists',
    },
  },
});

const rejectClassroomInvitationRoute = createRoute({
  method: 'post',
  path: '/orgs/classrooms/invitations/reject',
  tags: ['Classroom Invitations'],
  summary: 'Reject classroom invitation',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: classroomInvitationActionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Invitation rejected',
    },
    401: {
      description: 'Unauthorized',
    },
    403: {
      description: 'Forbidden',
    },
    404: {
      description: 'Invitation not found',
    },
  },
});

const cancelClassroomInvitationRoute = createRoute({
  method: 'post',
  path: '/orgs/classrooms/invitations/cancel',
  tags: ['Classroom Invitations'],
  summary: 'Cancel classroom invitation',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: classroomInvitationActionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Invitation canceled',
    },
    401: {
      description: 'Unauthorized',
    },
    403: {
      description: 'Forbidden',
    },
    404: {
      description: 'Invitation not found',
    },
  },
});

const createInvitationRoute = createRoute({
  method: 'post',
  path: '/organizations/invitations',
  tags: ['Organization Invitations'],
  summary: 'Invite a member to an organization',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: createInvitationBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Invitation created',
    },
    429: {
      description: 'Invitation resend limit reached',
    },
    401: {
      description: 'Unauthorized',
    },
    400: {
      description: 'Validation or auth error',
    },
  },
});

const listInvitationsRoute = createRoute({
  method: 'get',
  path: '/organizations/invitations',
  tags: ['Organization Invitations'],
  summary: 'List invitations for an organization',
  request: {
    query: listInvitationsQuerySchema,
  },
  responses: {
    200: {
      description: 'Invitation list',
    },
    401: {
      description: 'Unauthorized',
    },
    400: {
      description: 'Validation or auth error',
    },
  },
});

const listUserInvitationsRoute = createRoute({
  method: 'get',
  path: '/organizations/invitations/user',
  tags: ['Organization Invitations'],
  summary: 'List invitations received by current user',
  responses: {
    200: {
      description: 'User invitation list',
    },
    401: {
      description: 'Unauthorized',
    },
    400: {
      description: 'Validation or auth error',
    },
  },
});

const invitationDetailRoute = createRoute({
  method: 'get',
  path: '/organizations/invitations/detail',
  tags: ['Organization Invitations'],
  summary: 'Get invitation detail for current user',
  request: {
    query: invitationDetailQuerySchema,
  },
  responses: {
    200: {
      description: 'Invitation detail',
    },
    401: {
      description: 'Unauthorized',
    },
    400: {
      description: 'Validation or auth error',
    },
  },
});

const acceptInvitationRoute = createRoute({
  method: 'post',
  path: '/organizations/invitations/accept',
  tags: ['Organization Invitations'],
  summary: 'Accept an organization invitation',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: invitationActionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Invitation accepted',
    },
    401: {
      description: 'Unauthorized',
    },
    400: {
      description: 'Validation or auth error',
    },
  },
});

const rejectInvitationRoute = createRoute({
  method: 'post',
  path: '/organizations/invitations/reject',
  tags: ['Organization Invitations'],
  summary: 'Reject an organization invitation',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: invitationActionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Invitation rejected',
    },
    401: {
      description: 'Unauthorized',
    },
    400: {
      description: 'Validation or auth error',
    },
  },
});

const cancelInvitationRoute = createRoute({
  method: 'post',
  path: '/organizations/invitations/cancel',
  tags: ['Organization Invitations'],
  summary: 'Cancel an organization invitation',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: invitationActionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Invitation canceled',
    },
    401: {
      description: 'Unauthorized',
    },
    400: {
      description: 'Validation or auth error',
    },
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

const createParticipantInvitationRoute = createRoute({
  method: 'post',
  path: '/organizations/participants/invitations',
  tags: ['Participant Invitations'],
  summary: 'Create or resend participant invitation',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: createParticipantInvitationBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Participant invitation created or resent',
    },
    401: {
      description: 'Unauthorized',
    },
    403: {
      description: 'Forbidden',
    },
    409: {
      description: 'Duplicate pending invitation',
    },
    429: {
      description: 'Resend limit reached',
    },
    400: {
      description: 'Validation error',
    },
  },
});

const listParticipantInvitationsRoute = createRoute({
  method: 'get',
  path: '/organizations/participants/invitations',
  tags: ['Participant Invitations'],
  summary: 'List participant invitations for an organization',
  request: {
    query: listParticipantInvitationsQuerySchema,
  },
  responses: {
    200: {
      description: 'Participant invitation list',
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

const listUserParticipantInvitationsRoute = createRoute({
  method: 'get',
  path: '/organizations/participants/invitations/user',
  tags: ['Participant Invitations'],
  summary: 'List participant invitations for current user email',
  responses: {
    200: {
      description: 'Participant invitation list for current user',
    },
    401: {
      description: 'Unauthorized',
    },
    400: {
      description: 'Validation error',
    },
  },
});

const participantInvitationDetailRoute = createRoute({
  method: 'get',
  path: '/organizations/participants/invitations/detail',
  tags: ['Participant Invitations'],
  summary: 'Get participant invitation detail',
  request: {
    query: participantInvitationDetailQuerySchema,
  },
  responses: {
    200: {
      description: 'Participant invitation detail',
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

const acceptParticipantInvitationRoute = createRoute({
  method: 'post',
  path: '/organizations/participants/invitations/accept',
  tags: ['Participant Invitations'],
  summary: 'Accept participant invitation',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: participantInvitationActionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Participant invitation accepted',
    },
    401: {
      description: 'Unauthorized',
    },
    403: {
      description: 'Forbidden',
    },
    409: {
      description: 'Participant already exists',
    },
    400: {
      description: 'Validation error',
    },
  },
});

const rejectParticipantInvitationRoute = createRoute({
  method: 'post',
  path: '/organizations/participants/invitations/reject',
  tags: ['Participant Invitations'],
  summary: 'Reject participant invitation',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: participantInvitationActionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Participant invitation rejected',
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

const cancelParticipantInvitationRoute = createRoute({
  method: 'post',
  path: '/organizations/participants/invitations/cancel',
  tags: ['Participant Invitations'],
  summary: 'Cancel participant invitation',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: participantInvitationActionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Participant invitation canceled',
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

    // Clear legacy host-only auth cookies to avoid mismatched state/session after
    // migrating to Domain=.wakureserve.com cookies.
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

  const getActorUserId = async (headers: Headers): Promise<string | null> => {
    const session = await auth.api.getSession({ headers });
    return getStringValue(session?.user?.id);
  };

  const findInvitationById = async (invitationId: string) => {
    const rows = await database
      .select({
        id: dbSchema.invitation.id,
        organizationId: dbSchema.invitation.organizationId,
        email: dbSchema.invitation.email,
      })
      .from(dbSchema.invitation)
      .where(eq(dbSchema.invitation.id, invitationId))
      .limit(1);

    return rows[0] ?? null;
  };

  const findPendingInvitationForResend = async ({
    organizationId,
    classroomId,
    classroomRole,
    email,
  }: {
    organizationId: string;
    classroomId?: string | null;
    classroomRole?: string | null;
    email: string;
  }) => {
    const rows = await database
      .select({
        id: dbSchema.invitation.id,
        organizationId: dbSchema.invitation.organizationId,
        classroomId: dbSchema.invitation.classroomId,
        classroomRole: dbSchema.invitation.classroomRole,
        email: dbSchema.invitation.email,
      })
      .from(dbSchema.invitation)
      .where(
        and(
          eq(dbSchema.invitation.organizationId, organizationId),
          ...(classroomId ? [eq(dbSchema.invitation.classroomId, classroomId)] : []),
          ...(classroomRole ? [eq(dbSchema.invitation.classroomRole, classroomRole)] : []),
          eq(dbSchema.invitation.email, email),
          eq(dbSchema.invitation.status, 'pending'),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  };

  const countInvitationAuditAction = async ({
    invitationId,
    action,
  }: {
    invitationId: string;
    action: string;
  }): Promise<number> => {
    const rows = await database
      .select({
        value: sql<number>`count(*)`,
      })
      .from(dbSchema.invitationAuditLog)
      .where(
        and(
          eq(dbSchema.invitationAuditLog.invitationId, invitationId),
          eq(dbSchema.invitationAuditLog.action, action),
        ),
      );

    return Number(rows[0]?.value ?? 0);
  };

  const writeInvitationAuditLog = async ({
    invitationId,
    organizationId,
    actorUserId,
    targetEmail,
    action,
    metadata,
    headers,
  }: {
    invitationId: string;
    organizationId: string;
    actorUserId: string;
    targetEmail: string;
    action: string;
    metadata?: Record<string, unknown>;
    headers: Headers;
  }) => {
    await database.insert(dbSchema.invitationAuditLog).values({
      id: crypto.randomUUID(),
      invitationId,
      organizationId,
      actorUserId,
      targetEmail,
      action,
      metadata: metadata ? JSON.stringify(metadata) : null,
      ipAddress: getIpAddress(headers),
      userAgent: headers.get('user-agent'),
    });
  };

  const normalizeEmail = (value: string): string => value.trim().toLowerCase();

  const getSessionIdentity = async (
    headers: Headers,
  ): Promise<{ userId: string; email: string | null; activeOrganizationId: string | null } | null> => {
    const session = await auth.api.getSession({ headers });
    const userId = getStringValue(session?.user?.id);
    if (!userId) {
      return null;
    }

    const userEmail = getStringValue(session?.user?.email);
    return {
      userId,
      email: userEmail ? normalizeEmail(userEmail) : null,
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

  const findParticipantInvitationById = async (invitationId: string) => {
    const rows = await database
      .select({
        id: dbSchema.participantInvitation.id,
        organizationId: dbSchema.participantInvitation.organizationId,
        classroomId: dbSchema.participantInvitation.classroomId,
        organizationSlug: dbSchema.organization.slug,
        classroomSlug: dbSchema.classroom.slug,
        classroomName: dbSchema.classroom.name,
        organizationName: dbSchema.organization.name,
        email: dbSchema.participantInvitation.email,
        participantName: dbSchema.participantInvitation.participantName,
        status: dbSchema.participantInvitation.status,
        expiresAt: dbSchema.participantInvitation.expiresAt,
        createdAt: dbSchema.participantInvitation.createdAt,
        invitedByUserId: dbSchema.participantInvitation.invitedByUserId,
        respondedByUserId: dbSchema.participantInvitation.respondedByUserId,
        respondedAt: dbSchema.participantInvitation.respondedAt,
      })
      .from(dbSchema.participantInvitation)
      .innerJoin(dbSchema.classroom, eq(dbSchema.classroom.id, dbSchema.participantInvitation.classroomId))
      .innerJoin(
        dbSchema.organization,
        eq(dbSchema.organization.id, dbSchema.participantInvitation.organizationId),
      )
      .where(eq(dbSchema.participantInvitation.id, invitationId))
      .limit(1);

    return rows[0] ?? null;
  };

  const findPendingParticipantInvitationForResend = async ({
    organizationId,
    classroomId,
    email,
  }: {
    organizationId: string;
    classroomId?: string | null;
    email: string;
  }) => {
    const rows = await database
      .select({
        id: dbSchema.participantInvitation.id,
        organizationId: dbSchema.participantInvitation.organizationId,
        classroomId: dbSchema.participantInvitation.classroomId,
        organizationSlug: dbSchema.organization.slug,
        classroomSlug: dbSchema.classroom.slug,
        classroomName: dbSchema.classroom.name,
        organizationName: dbSchema.organization.name,
        email: dbSchema.participantInvitation.email,
        participantName: dbSchema.participantInvitation.participantName,
        status: dbSchema.participantInvitation.status,
        expiresAt: dbSchema.participantInvitation.expiresAt,
        createdAt: dbSchema.participantInvitation.createdAt,
        invitedByUserId: dbSchema.participantInvitation.invitedByUserId,
        respondedByUserId: dbSchema.participantInvitation.respondedByUserId,
        respondedAt: dbSchema.participantInvitation.respondedAt,
      })
      .from(dbSchema.participantInvitation)
      .innerJoin(dbSchema.classroom, eq(dbSchema.classroom.id, dbSchema.participantInvitation.classroomId))
      .innerJoin(
        dbSchema.organization,
        eq(dbSchema.organization.id, dbSchema.participantInvitation.organizationId),
      )
      .where(
        and(
          eq(dbSchema.participantInvitation.organizationId, organizationId),
          ...(classroomId ? [eq(dbSchema.participantInvitation.classroomId, classroomId)] : []),
          eq(dbSchema.participantInvitation.email, email),
          eq(dbSchema.participantInvitation.status, 'pending'),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  };

  const findDuplicatePendingParticipantInvitation = async ({
    organizationId,
    classroomId,
    email,
  }: {
    organizationId: string;
    classroomId?: string | null;
    email: string;
  }) => {
    const rows = await database
      .select({
        id: dbSchema.participantInvitation.id,
      })
      .from(dbSchema.participantInvitation)
      .where(
        and(
          eq(dbSchema.participantInvitation.organizationId, organizationId),
          ...(classroomId ? [eq(dbSchema.participantInvitation.classroomId, classroomId)] : []),
          eq(dbSchema.participantInvitation.email, email),
          eq(dbSchema.participantInvitation.status, 'pending'),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  };

  const countParticipantInvitationAuditAction = async ({
    participantInvitationId,
    action,
  }: {
    participantInvitationId: string;
    action: string;
  }): Promise<number> => {
    const rows = await database
      .select({
        value: sql<number>`count(*)`,
      })
      .from(dbSchema.participantInvitationAuditLog)
      .where(
        and(
          eq(dbSchema.participantInvitationAuditLog.participantInvitationId, participantInvitationId),
          eq(dbSchema.participantInvitationAuditLog.action, action),
        ),
      );

    return Number(rows[0]?.value ?? 0);
  };

  const writeParticipantInvitationAuditLog = async ({
    participantInvitationId,
    organizationId,
    classroomId,
    actorUserId,
    targetEmail,
    action,
    metadata,
    headers,
  }: {
    participantInvitationId: string;
    organizationId: string;
    classroomId?: string;
    actorUserId: string;
    targetEmail: string;
    action: string;
    metadata?: Record<string, unknown>;
    headers: Headers;
  }) => {
    await database.insert(dbSchema.participantInvitationAuditLog).values({
      id: crypto.randomUUID(),
      participantInvitationId,
      organizationId,
      classroomId: classroomId ?? organizationId,
      actorUserId,
      targetEmail,
      action,
      metadata: metadata ? JSON.stringify(metadata) : null,
      ipAddress: getIpAddress(headers),
      userAgent: headers.get('user-agent'),
    });
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

  const serializeParticipant = (
    participant:
      | {
          id: string;
          organizationId: string;
          classroomId?: string;
          classroomSlug?: string | null;
          classroomName?: string | null;
          userId: string;
          email: string;
          name: string;
          createdAt: unknown;
          updatedAt: unknown;
        }
      | null,
  ) => {
    if (!participant) {
      return null;
    }

    return {
      id: participant.id,
      organizationId: participant.organizationId,
      classroomId: participant.classroomId ?? null,
      classroomSlug: participant.classroomSlug ?? null,
      classroomName: participant.classroomName ?? null,
      userId: participant.userId,
      email: participant.email,
      name: participant.name,
      createdAt: toIsoDateString(participant.createdAt),
      updatedAt: toIsoDateString(participant.updatedAt),
    };
  };

  const serializeParticipantInvitation = (
    invitation:
      | {
          id: string;
          organizationId: string;
          classroomId?: string;
          classroomSlug?: string | null;
          classroomName?: string | null;
          organizationName: string;
          email: string;
          participantName: string;
          status: string;
          expiresAt: unknown;
          createdAt: unknown;
          invitedByUserId: string;
          respondedByUserId: string | null;
          respondedAt: unknown;
        }
      | null,
  ) => {
    if (!invitation) {
      return null;
    }

    return {
      id: invitation.id,
      organizationId: invitation.organizationId,
      classroomId: invitation.classroomId ?? null,
      classroomSlug: invitation.classroomSlug ?? null,
      classroomName: invitation.classroomName ?? null,
      organizationName: invitation.organizationName,
      email: invitation.email,
      participantName: invitation.participantName,
      status: invitation.status,
      expiresAt: toIsoDateString(invitation.expiresAt),
      createdAt: toIsoDateString(invitation.createdAt),
      invitedByUserId: invitation.invitedByUserId,
      respondedByUserId: invitation.respondedByUserId,
      respondedAt: toIsoDateString(invitation.respondedAt),
    };
  };

  const normalizeClassroomInvitationRole = (
    value: string | null,
  ): 'manager' | 'staff' | 'participant' | null => {
    if (value === 'manager' || value === 'admin') {
      return 'manager';
    }
    if (value === 'staff' || value === 'member') {
      return 'staff';
    }
    if (value === 'participant') {
      return 'participant';
    }
    return null;
  };

  const mapClassroomInvitationRoleToAuthRole = (value: 'manager' | 'staff'): 'admin' | 'member' => {
    return value === 'manager' ? 'admin' : 'member';
  };

  const resolveClassroomContextBySlugs = async ({
    orgSlug,
    classroomSlug,
  }: {
    orgSlug: string;
    classroomSlug: string;
  }) => {
    return resolveOrganizationClassroomContext({
      database,
      organizationSlug: orgSlug,
      classroomSlug,
    });
  };

  const resolveClassroomContextByOrganizationId = async (organizationId: string) => {
    return resolveOrganizationClassroomContext({
      database,
      organizationId,
    });
  };

  const resolveClassroomContextByIds = async ({
    organizationId,
    classroomId,
  }: {
    organizationId: string;
    classroomId: string;
  }) => {
    const rows = await database
      .select({
        organizationId: dbSchema.organization.id,
        organizationSlug: dbSchema.organization.slug,
        organizationName: dbSchema.organization.name,
        classroomId: dbSchema.classroom.id,
        classroomSlug: dbSchema.classroom.slug,
        classroomName: dbSchema.classroom.name,
      })
      .from(dbSchema.classroom)
      .innerJoin(dbSchema.organization, eq(dbSchema.organization.id, dbSchema.classroom.organizationId))
      .where(and(eq(dbSchema.classroom.organizationId, organizationId), eq(dbSchema.classroom.id, classroomId)))
      .limit(1);

    return rows[0] ?? null;
  };

  const findOrganizationInvitationDetailById = async (invitationId: string) => {
    const rows = await database
      .select({
        id: dbSchema.invitation.id,
        organizationId: dbSchema.invitation.organizationId,
        organizationSlug: dbSchema.organization.slug,
        organizationName: dbSchema.organization.name,
        classroomId: dbSchema.invitation.classroomId,
        classroomSlug: dbSchema.classroom.slug,
        classroomName: dbSchema.classroom.name,
        organizationRole: dbSchema.invitation.role,
        classroomRole: dbSchema.invitation.classroomRole,
        email: dbSchema.invitation.email,
        status: dbSchema.invitation.status,
        expiresAt: dbSchema.invitation.expiresAt,
        createdAt: dbSchema.invitation.createdAt,
        invitedByUserId: dbSchema.invitation.inviterId,
      })
      .from(dbSchema.invitation)
      .innerJoin(dbSchema.organization, eq(dbSchema.organization.id, dbSchema.invitation.organizationId))
      .leftJoin(dbSchema.classroom, eq(dbSchema.classroom.id, dbSchema.invitation.classroomId))
      .where(eq(dbSchema.invitation.id, invitationId))
      .limit(1);

    return rows[0] ?? null;
  };

  const serializeClassroomMemberInvitation = (
    invitation:
      | {
          id: string;
          organizationId: string;
          organizationSlug: string;
          organizationName: string;
          classroomId: string | null;
          classroomSlug: string | null;
          classroomName: string | null;
          organizationRole: string | null;
          classroomRole: string | null;
          email: string;
          status: string;
          expiresAt: unknown;
          createdAt: unknown;
          invitedByUserId: string;
        }
      | null,
  ) => {
    if (!invitation) {
      return null;
    }

    const role = normalizeClassroomInvitationRole(invitation.classroomRole ?? invitation.organizationRole);
    if (!role || role === 'participant') {
      return null;
    }

    return {
      id: invitation.id,
      invitationKind: 'classroom-member' as const,
      role,
      organizationId: invitation.organizationId,
      organizationSlug: invitation.organizationSlug,
      organizationName: invitation.organizationName,
      classroomId: invitation.classroomId ?? invitation.organizationId,
      classroomSlug: invitation.classroomSlug ?? invitation.organizationSlug,
      classroomName: invitation.classroomName ?? invitation.organizationName,
      email: invitation.email,
      status: invitation.status,
      participantName: null,
      expiresAt: toIsoDateString(invitation.expiresAt),
      createdAt: toIsoDateString(invitation.createdAt),
      invitedByUserId: invitation.invitedByUserId,
      respondedByUserId: null,
      respondedAt: null,
    };
  };

  const serializeClassroomParticipantInvitation = (
    invitation:
      | {
          id: string;
          organizationId: string;
          classroomId: string;
          classroomSlug: string;
          classroomName: string;
          organizationName: string;
          email: string;
          participantName: string;
          status: string;
          expiresAt: unknown;
          createdAt: unknown;
          invitedByUserId: string;
          respondedByUserId: string | null;
          respondedAt: unknown;
        }
      | null,
    organizationSlug: string,
  ) => {
    if (!invitation) {
      return null;
    }

    return {
      id: invitation.id,
      invitationKind: 'participant' as const,
      role: 'participant' as const,
      organizationId: invitation.organizationId,
      organizationSlug,
      organizationName: invitation.organizationName,
      classroomId: invitation.classroomId,
      classroomSlug: invitation.classroomSlug,
      classroomName: invitation.classroomName,
      email: invitation.email,
      status: invitation.status,
      participantName: invitation.participantName,
      expiresAt: toIsoDateString(invitation.expiresAt),
      createdAt: toIsoDateString(invitation.createdAt),
      invitedByUserId: invitation.invitedByUserId,
      respondedByUserId: invitation.respondedByUserId,
      respondedAt: toIsoDateString(invitation.respondedAt),
    };
  };

  const findClassroomInvitationDetailById = async (invitationId: string) => {
    const organizationInvitation = await findOrganizationInvitationDetailById(invitationId);
    if (organizationInvitation) {
      const serialized = serializeClassroomMemberInvitation(organizationInvitation);
      if (serialized) {
        return serialized;
      }
    }

    const participantInvitation = await findParticipantInvitationById(invitationId);
    if (!participantInvitation) {
      return null;
    }

    return serializeClassroomParticipantInvitation(
      participantInvitation,
      participantInvitation.organizationSlug,
    );
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

    // Better Auth returns 200 + { url, redirect } for social sign-in starts.
    // Convert to an actual 302 for browser navigation unless explicitly disabled.
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
      const body = c.req.valid('json');

      const response = await auth.api.createOrganization({
        body,
        headers: c.req.raw.headers,
        asResponse: true,
      });
      if (!response.ok) {
        return response;
      }

      const payload = (await response.clone().json().catch(() => null)) as Record<string, unknown> | null;
      const organizationId = typeof payload?.id === 'string' && payload.id.length > 0 ? payload.id : null;
      const organizationName =
        typeof payload?.name === 'string' && payload.name.length > 0 ? payload.name : body.name;

      if (organizationId) {
        await database
          .insert(dbSchema.classroom)
          .values({
            id: organizationId,
            organizationId,
            slug: body.slug,
            name: organizationName,
          })
          .onConflictDoNothing();
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
          .innerJoin(dbSchema.organization, eq(dbSchema.organization.id, dbSchema.member.organizationId))
          .where(eq(dbSchema.member.userId, identity.userId)),
        database
          .select({
            organizationId: dbSchema.participant.organizationId,
            classroomId: dbSchema.participant.classroomId,
            organizationSlug: dbSchema.organization.slug,
            organizationName: dbSchema.organization.name,
            organizationLogo: dbSchema.organization.logo,
          })
          .from(dbSchema.participant)
          .innerJoin(dbSchema.organization, eq(dbSchema.organization.id, dbSchema.participant.organizationId))
          .where(eq(dbSchema.participant.userId, identity.userId)),
      ]);

      const classroomMemberRows = await database
        .select({
          organizationId: dbSchema.classroom.organizationId,
          organizationSlug: dbSchema.organization.slug,
          organizationName: dbSchema.organization.name,
          organizationLogo: dbSchema.organization.logo,
          classroomId: dbSchema.classroom.id,
          role: dbSchema.classroomMember.role,
        })
        .from(dbSchema.classroomMember)
        .innerJoin(dbSchema.classroom, eq(dbSchema.classroom.id, dbSchema.classroomMember.classroomId))
        .innerJoin(dbSchema.organization, eq(dbSchema.organization.id, dbSchema.classroom.organizationId))
        .where(eq(dbSchema.classroomMember.userId, identity.userId));

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
      for (const row of classroomMemberRows) {
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
        const allClassroomContexts =
          row.organizationRole === 'owner' || row.organizationRole === 'admin'
            ? await listOrganizationClassroomContexts({
                database,
                organizationId: row.organizationId,
              })
            : [];

        const accessibleClassroomIds = new Set<string>();
        for (const classroomRow of classroomMemberRows) {
          if (classroomRow.organizationId === row.organizationId) {
            accessibleClassroomIds.add(classroomRow.classroomId);
          }
        }
        for (const participantRow of participantRows) {
          if (participantRow.organizationId === row.organizationId) {
            accessibleClassroomIds.add(participantRow.classroomId);
          }
        }

        const classroomContexts =
          allClassroomContexts.length > 0
            ? allClassroomContexts
            : (
                await Promise.all(
                  Array.from(accessibleClassroomIds).map(async (classroomId) =>
                    resolveOrganizationClassroomContext({
                      database,
                      organizationId: row.organizationId,
                    }).then(async (fallbackContext) => {
                      if (fallbackContext?.classroomId === classroomId) {
                        return fallbackContext;
                      }
                      const classroomRows = await database
                        .select({
                          id: dbSchema.classroom.id,
                          slug: dbSchema.classroom.slug,
                          name: dbSchema.classroom.name,
                        })
                        .from(dbSchema.classroom)
                        .where(and(eq(dbSchema.classroom.organizationId, row.organizationId), eq(dbSchema.classroom.id, classroomId)))
                        .limit(1);
                      const classroom = classroomRows[0];
                      return classroom
                        ? {
                            organizationId: row.organizationId,
                            organizationSlug: row.organizationSlug,
                            organizationName: row.organizationName,
                            classroomId: classroom.id,
                            classroomSlug: classroom.slug,
                            classroomName: classroom.name,
                          }
                        : null;
                    }),
                  ),
                )
              ).filter(
                (context): context is NonNullable<typeof context> => Boolean(context),
              );

        const classrooms = [];
        for (const context of classroomContexts) {
          const access = await resolveOrganizationClassroomAccess({
            database,
            userId: identity.userId,
            context,
          });
          if (!access.classroomRole && !access.canUseParticipantBooking && !access.canManageClassroom) {
            continue;
          }
          classrooms.push({
            id: context.classroomId,
            slug: context.classroomSlug,
            name: context.classroomName,
            logo: null,
            role: access.classroomRole,
            canManage: access.canManageClassroom,
            canManageBookings: access.canManageBookings,
            canManageParticipants: access.canManageParticipants,
            canUseParticipantBooking: access.canUseParticipantBooking,
          });
        }

        if (classrooms.length === 0) {
          continue;
        }

        classrooms.sort((left, right) => left.name.localeCompare(right.name));
        tree.push({
          org: {
            id: row.organizationId,
            slug: row.organizationSlug,
            name: row.organizationName,
            logo: row.organizationLogo,
          },
          orgRole: row.organizationRole,
          classrooms,
        });
      }

      tree.sort((left, right) => left.org.name.localeCompare(right.org.name));
      return c.json({ orgs: tree }, 200);
    })();
  });

  authRoutes.openapi(listOrganizationAccessRoute, (c) => {
    return (async () => {
      const identity = await getSessionIdentity(c.req.raw.headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const memberRows = await database
        .select({
          organizationId: dbSchema.member.organizationId,
          organizationName: dbSchema.organization.name,
          role: dbSchema.member.role,
        })
        .from(dbSchema.member)
        .innerJoin(dbSchema.organization, eq(dbSchema.organization.id, dbSchema.member.organizationId))
        .where(eq(dbSchema.member.userId, identity.userId));

      const participantRows = await database
        .select({
          organizationId: dbSchema.participant.organizationId,
          classroomId: dbSchema.participant.classroomId,
          organizationName: dbSchema.organization.name,
        })
        .from(dbSchema.participant)
        .innerJoin(
          dbSchema.organization,
          eq(dbSchema.organization.id, dbSchema.participant.organizationId),
        )
        .where(eq(dbSchema.participant.userId, identity.userId));

      const normalizeMembershipRole = (value: string | null): 'owner' | 'admin' | 'member' | null => {
        if (value === 'owner' || value === 'admin' || value === 'member') {
          return value;
        }
        return null;
      };

      const accessByOrganizationId = new Map<
        string,
        {
          organizationId: string;
          organizationName: string | null;
          role: 'owner' | 'admin' | 'member' | null;
          classroomRole: 'manager' | 'staff' | 'participant';
          canManage: boolean;
          canUseParticipantBooking: boolean;
        }
      >();

      for (const row of memberRows) {
        const role = normalizeMembershipRole(row.role);
        const canManage = role === 'owner' || role === 'admin';
        const classroomRole = canManage ? 'manager' : 'staff';
        accessByOrganizationId.set(row.organizationId, {
          organizationId: row.organizationId,
          organizationName: row.organizationName,
          role,
          classroomRole,
          canManage,
          canUseParticipantBooking:
            accessByOrganizationId.get(row.organizationId)?.canUseParticipantBooking ?? false,
        });
      }

      for (const row of participantRows) {
        const current = accessByOrganizationId.get(row.organizationId);
        accessByOrganizationId.set(row.organizationId, {
          organizationId: row.organizationId,
          organizationName: current?.organizationName ?? row.organizationName,
          role: current?.role ?? null,
          classroomRole: current?.classroomRole ?? 'participant',
          canManage: current?.canManage ?? false,
          canUseParticipantBooking: true,
        });
      }

      const entries = Array.from(accessByOrganizationId.values()).sort((left, right) =>
        (left.organizationName ?? left.organizationId).localeCompare(
          right.organizationName ?? right.organizationId,
        ),
      );
      return c.json(entries, 200);
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

  authRoutes.openapi(createClassroomInvitationRoute, (c) => {
    return (async () => {
      const { orgSlug, classroomSlug } = c.req.valid('param');
      const body = c.req.valid('json');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const classroomContext = await resolveClassroomContextBySlugs({ orgSlug, classroomSlug });
      if (!classroomContext) {
        return c.json({ message: 'Organization or classroom not found.' }, 404);
      }

      const access = await resolveOrganizationClassroomAccess({
        database,
        userId: identity.userId,
        context: classroomContext,
      });

      const normalizedEmail = normalizeEmail(body.email);
      if (body.role === 'participant') {
        if (!access.canManageParticipants) {
          return c.json({ message: 'Forbidden' }, 403);
        }
        if (!body.participantName) {
          return c.json({ message: 'participantName is required for participant invitations.' }, 400);
        }

        const currentSession = await auth.api.getSession({ headers });
        const participantName = body.participantName.trim();

        if (body.resend) {
          const resendTargetInvitation = await findPendingParticipantInvitationForResend({
            organizationId: classroomContext.organizationId,
            email: normalizedEmail,
          });

          if (!resendTargetInvitation) {
            return c.json({ message: 'Pending invitation for resend was not found.' }, 400);
          }

          const resentCount = await countParticipantInvitationAuditAction({
            participantInvitationId: resendTargetInvitation.id,
            action: 'participant-invitation.resent',
          });
          if (resentCount >= 3) {
            return c.json({ message: 'Participant invitation resend limit reached (3).' }, 429);
          }

          await sendParticipantInvitationEmail({
            env,
            invitationId: resendTargetInvitation.id,
            inviteeEmail: resendTargetInvitation.email,
            participantName: resendTargetInvitation.participantName,
            inviterName: getStringValue(currentSession?.user?.name),
            inviterEmail: getStringValue(currentSession?.user?.email),
            organizationName: resendTargetInvitation.organizationName,
          });

          await writeParticipantInvitationAuditLog({
            participantInvitationId: resendTargetInvitation.id,
            organizationId: resendTargetInvitation.organizationId,
            actorUserId: identity.userId,
            targetEmail: resendTargetInvitation.email,
            action: 'participant-invitation.resent',
            metadata: {
              resend: true,
              classroomSlug: classroomContext.classroomSlug,
            },
            headers,
          });

          return c.json(
            serializeClassroomParticipantInvitation(
              resendTargetInvitation,
              classroomContext.organizationSlug,
            ),
            200,
          );
        }

        const duplicatePending = await findDuplicatePendingParticipantInvitation({
          organizationId: classroomContext.organizationId,
          email: normalizedEmail,
        });
        if (duplicatePending) {
          return c.json({ message: 'Pending invitation already exists for this email.' }, 409);
        }

        const invitationId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 172_800_000);
        await database.insert(dbSchema.participantInvitation).values({
          id: invitationId,
          organizationId: classroomContext.organizationId,
          classroomId: classroomContext.classroomId,
          email: normalizedEmail,
          participantName,
          status: 'pending',
          expiresAt,
          invitedByUserId: identity.userId,
        });

        const createdInvitation = await findParticipantInvitationById(invitationId);
        if (!createdInvitation) {
          return c.json({ message: 'Failed to create participant invitation.' }, 500);
        }

        await sendParticipantInvitationEmail({
          env,
          invitationId: createdInvitation.id,
          inviteeEmail: createdInvitation.email,
          participantName: createdInvitation.participantName,
          inviterName: getStringValue(currentSession?.user?.name),
          inviterEmail: getStringValue(currentSession?.user?.email),
          organizationName: createdInvitation.organizationName,
        });

        await writeParticipantInvitationAuditLog({
          participantInvitationId: createdInvitation.id,
          organizationId: createdInvitation.organizationId,
          actorUserId: identity.userId,
          targetEmail: createdInvitation.email,
          action: 'participant-invitation.created',
          metadata: {
            resend: false,
            participantName,
            classroomSlug: classroomContext.classroomSlug,
          },
          headers,
        });

        return c.json(
          serializeClassroomParticipantInvitation(createdInvitation, classroomContext.organizationSlug),
          200,
        );
      }

      if (!access.canManageClassroom) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const authRole = mapClassroomInvitationRoleToAuthRole(body.role);
      let resendTargetInvitation:
        | {
            id: string;
            organizationId: string;
            email: string;
          }
        | null = null;

      if (body.resend) {
        resendTargetInvitation = await findPendingInvitationForResend({
          organizationId: classroomContext.organizationId,
          classroomId: classroomContext.classroomId,
          classroomRole: body.role,
          email: normalizedEmail,
        });

        if (!resendTargetInvitation) {
          return c.json({ message: 'Pending invitation for resend was not found.' }, 400);
        }

        const resendTargetDetail = await findOrganizationInvitationDetailById(resendTargetInvitation.id);
        const resendTargetRole = normalizeClassroomInvitationRole(
          resendTargetDetail?.classroomRole ?? resendTargetDetail?.organizationRole ?? null,
        );
        if (!resendTargetRole || resendTargetRole === 'participant' || resendTargetRole !== body.role) {
          return c.json({ message: 'Pending invitation role does not match resend role.' }, 400);
        }

        const resentCount = await countInvitationAuditAction({
          invitationId: resendTargetInvitation.id,
          action: 'invitation.resent',
        });
        if (resentCount >= 3) {
          return c.json({ message: 'Invitation resend limit reached (3).' }, 429);
        }
      }

      const actorUserId = await getActorUserId(headers);
      if (!actorUserId) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      let invitationPayload:
        | {
            id: string;
            organizationId: string;
            email: string;
          }
        | null = null;
      if (body.resend && resendTargetInvitation) {
        invitationPayload = {
          id: resendTargetInvitation.id,
          organizationId: resendTargetInvitation.organizationId,
          email: resendTargetInvitation.email,
        };
      } else {
        const response = await auth.api.createInvitation({
          body: {
            email: normalizedEmail,
            role: authRole,
            organizationId: classroomContext.organizationId,
          },
          headers,
          asResponse: true,
        });

        if (!response.ok) {
          return response;
        }

        const payload = await parseResponseBody(response);
        invitationPayload = isInvitationPayload(payload) ? payload : null;
        if (!invitationPayload) {
          return response;
        }

        await database
          .update(dbSchema.invitation)
          .set({
            classroomId: classroomContext.classroomId,
            classroomRole: body.role,
          })
          .where(eq(dbSchema.invitation.id, invitationPayload.id));
      }

      await writeInvitationAuditLog({
        invitationId: invitationPayload.id,
        organizationId: invitationPayload.organizationId,
        actorUserId,
        targetEmail: invitationPayload.email,
        action: body.resend ? 'invitation.resent' : 'invitation.created',
        metadata: {
          resend: body.resend ?? false,
          classroomSlug: classroomContext.classroomSlug,
          classroomRole: body.role,
        },
        headers,
      });

      const detail = await findOrganizationInvitationDetailById(invitationPayload.id);
      const serialized = serializeClassroomMemberInvitation(detail);
      return c.json(
        serialized ?? {
          id: invitationPayload.id,
          invitationKind: 'classroom-member',
          role: body.role,
          organizationId: classroomContext.organizationId,
          organizationSlug: classroomContext.organizationSlug,
          organizationName: classroomContext.organizationName,
          classroomId: classroomContext.classroomId,
          classroomSlug: classroomContext.classroomSlug,
          classroomName: classroomContext.classroomName,
          email: normalizedEmail,
          status: 'pending',
          participantName: null,
          expiresAt: null,
          createdAt: null,
          invitedByUserId: actorUserId,
          respondedByUserId: null,
          respondedAt: null,
        },
        200,
      );
    })();
  });

  authRoutes.openapi(listClassroomInvitationsRoute, (c) => {
    return (async () => {
      const { orgSlug, classroomSlug } = c.req.valid('param');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const classroomContext = await resolveClassroomContextBySlugs({ orgSlug, classroomSlug });
      if (!classroomContext) {
        return c.json({ message: 'Organization or classroom not found.' }, 404);
      }

      const access = await resolveOrganizationClassroomAccess({
        database,
        userId: identity.userId,
        context: classroomContext,
      });

      if (!access.canManageParticipants && !access.canManageClassroom) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const [organizationInvitationRows, participantInvitationRows] = await Promise.all([
        access.canManageClassroom
          ? database
              .select({
                id: dbSchema.invitation.id,
                organizationId: dbSchema.invitation.organizationId,
                organizationSlug: dbSchema.organization.slug,
                organizationName: dbSchema.organization.name,
                classroomId: dbSchema.invitation.classroomId,
                classroomSlug: dbSchema.classroom.slug,
                classroomName: dbSchema.classroom.name,
                organizationRole: dbSchema.invitation.role,
                classroomRole: dbSchema.invitation.classroomRole,
                email: dbSchema.invitation.email,
                status: dbSchema.invitation.status,
                expiresAt: dbSchema.invitation.expiresAt,
                createdAt: dbSchema.invitation.createdAt,
                invitedByUserId: dbSchema.invitation.inviterId,
              })
              .from(dbSchema.invitation)
              .innerJoin(dbSchema.organization, eq(dbSchema.organization.id, dbSchema.invitation.organizationId))
              .leftJoin(dbSchema.classroom, eq(dbSchema.classroom.id, dbSchema.invitation.classroomId))
              .where(
                and(
                  eq(dbSchema.invitation.organizationId, classroomContext.organizationId),
                  eq(dbSchema.invitation.classroomId, classroomContext.classroomId),
                ),
              )
              .orderBy(desc(dbSchema.invitation.createdAt))
          : Promise.resolve([]),
        database
          .select({
            id: dbSchema.participantInvitation.id,
            organizationId: dbSchema.participantInvitation.organizationId,
            classroomId: dbSchema.participantInvitation.classroomId,
            classroomSlug: dbSchema.classroom.slug,
            classroomName: dbSchema.classroom.name,
            organizationName: dbSchema.organization.name,
            email: dbSchema.participantInvitation.email,
            participantName: dbSchema.participantInvitation.participantName,
            status: dbSchema.participantInvitation.status,
            expiresAt: dbSchema.participantInvitation.expiresAt,
            createdAt: dbSchema.participantInvitation.createdAt,
            invitedByUserId: dbSchema.participantInvitation.invitedByUserId,
            respondedByUserId: dbSchema.participantInvitation.respondedByUserId,
            respondedAt: dbSchema.participantInvitation.respondedAt,
          })
          .from(dbSchema.participantInvitation)
          .innerJoin(dbSchema.classroom, eq(dbSchema.classroom.id, dbSchema.participantInvitation.classroomId))
          .innerJoin(
            dbSchema.organization,
            eq(dbSchema.organization.id, dbSchema.participantInvitation.organizationId),
          )
          .where(
            and(
              eq(dbSchema.participantInvitation.organizationId, classroomContext.organizationId),
              eq(dbSchema.participantInvitation.classroomId, classroomContext.classroomId),
            ),
          )
          .orderBy(desc(dbSchema.participantInvitation.createdAt)),
      ]);

      const memberInvitations = organizationInvitationRows
        .map((row: (typeof organizationInvitationRows)[number]) => serializeClassroomMemberInvitation(row))
        .filter(
          (
            row: ReturnType<typeof serializeClassroomMemberInvitation>,
          ): row is NonNullable<ReturnType<typeof serializeClassroomMemberInvitation>> => Boolean(row),
        );
      const participantInvitations = participantInvitationRows
        .map((row: (typeof participantInvitationRows)[number]) =>
          serializeClassroomParticipantInvitation(row, classroomContext.organizationSlug),
        )
        .filter(
          (
            row: ReturnType<typeof serializeClassroomParticipantInvitation>,
          ): row is NonNullable<ReturnType<typeof serializeClassroomParticipantInvitation>> => Boolean(row),
        );

      return c.json([...memberInvitations, ...participantInvitations], 200);
    })();
  });

  authRoutes.openapi(listUserClassroomInvitationsRoute, (c) => {
    return (async () => {
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }
      if (!identity.email) {
        return c.json({ message: 'Current user email is unavailable.' }, 400);
      }

      const [organizationInvitationRows, participantInvitationRows] = await Promise.all([
        database
          .select({
            id: dbSchema.invitation.id,
            organizationId: dbSchema.invitation.organizationId,
            organizationSlug: dbSchema.organization.slug,
            organizationName: dbSchema.organization.name,
            classroomId: dbSchema.invitation.classroomId,
            classroomSlug: dbSchema.classroom.slug,
            classroomName: dbSchema.classroom.name,
            organizationRole: dbSchema.invitation.role,
            classroomRole: dbSchema.invitation.classroomRole,
            email: dbSchema.invitation.email,
            status: dbSchema.invitation.status,
            expiresAt: dbSchema.invitation.expiresAt,
            createdAt: dbSchema.invitation.createdAt,
            invitedByUserId: dbSchema.invitation.inviterId,
          })
          .from(dbSchema.invitation)
          .innerJoin(dbSchema.organization, eq(dbSchema.organization.id, dbSchema.invitation.organizationId))
          .leftJoin(dbSchema.classroom, eq(dbSchema.classroom.id, dbSchema.invitation.classroomId))
          .where(eq(dbSchema.invitation.email, identity.email))
          .orderBy(desc(dbSchema.invitation.createdAt)),
        database
          .select({
            id: dbSchema.participantInvitation.id,
            organizationId: dbSchema.participantInvitation.organizationId,
            classroomId: dbSchema.participantInvitation.classroomId,
            classroomSlug: dbSchema.classroom.slug,
            classroomName: dbSchema.classroom.name,
            organizationSlug: dbSchema.organization.slug,
            organizationName: dbSchema.organization.name,
            email: dbSchema.participantInvitation.email,
            participantName: dbSchema.participantInvitation.participantName,
            status: dbSchema.participantInvitation.status,
            expiresAt: dbSchema.participantInvitation.expiresAt,
            createdAt: dbSchema.participantInvitation.createdAt,
            invitedByUserId: dbSchema.participantInvitation.invitedByUserId,
            respondedByUserId: dbSchema.participantInvitation.respondedByUserId,
            respondedAt: dbSchema.participantInvitation.respondedAt,
          })
          .from(dbSchema.participantInvitation)
          .innerJoin(dbSchema.classroom, eq(dbSchema.classroom.id, dbSchema.participantInvitation.classroomId))
          .innerJoin(
            dbSchema.organization,
            eq(dbSchema.organization.id, dbSchema.participantInvitation.organizationId),
          )
          .where(eq(dbSchema.participantInvitation.email, identity.email))
          .orderBy(desc(dbSchema.participantInvitation.createdAt)),
      ]);

      const memberInvitations = organizationInvitationRows
        .map((row: (typeof organizationInvitationRows)[number]) => serializeClassroomMemberInvitation(row))
        .filter(
          (
            row: ReturnType<typeof serializeClassroomMemberInvitation>,
          ): row is NonNullable<ReturnType<typeof serializeClassroomMemberInvitation>> => Boolean(row),
        );
      const participantInvitations = participantInvitationRows
        .map((row: (typeof participantInvitationRows)[number]) =>
          serializeClassroomParticipantInvitation(row, row.organizationSlug),
        )
        .filter(
          (
            row: ReturnType<typeof serializeClassroomParticipantInvitation>,
          ): row is NonNullable<ReturnType<typeof serializeClassroomParticipantInvitation>> => Boolean(row),
        );

      return c.json([...memberInvitations, ...participantInvitations], 200);
    })();
  });

  authRoutes.openapi(classroomInvitationDetailRoute, (c) => {
    return (async () => {
      const query = c.req.valid('query');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }
      if (!identity.email) {
        return c.json({ message: 'Current user email is unavailable.' }, 400);
      }

      const invitation = await findClassroomInvitationDetailById(query.invitationId);
      if (!invitation) {
        return c.json({ message: 'Classroom invitation not found.' }, 404);
      }

      if (normalizeEmail(invitation.email) !== identity.email) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      return c.json(invitation, 200);
    })();
  });

  authRoutes.openapi(acceptClassroomInvitationRoute, (c) => {
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

      const organizationInvitation = await findOrganizationInvitationDetailById(body.invitationId);
      if (organizationInvitation) {
        if (normalizeEmail(organizationInvitation.email) !== identity.email) {
          return c.json({ message: 'Forbidden' }, 403);
        }

        const response = await auth.api.acceptInvitation({
          body: { invitationId: body.invitationId },
          headers,
          asResponse: true,
        });
        if (!response.ok) {
          return response;
        }

        const mappedRole = normalizeClassroomInvitationRole(
          organizationInvitation.classroomRole ?? organizationInvitation.organizationRole,
        );
        if (
          (mappedRole === 'manager' || mappedRole === 'staff') &&
          typeof organizationInvitation.classroomId === 'string'
        ) {
          await database
            .insert(dbSchema.classroomMember)
            .values({
              id: crypto.randomUUID(),
              classroomId: organizationInvitation.classroomId,
              userId: identity.userId,
              role: mappedRole,
              createdAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [dbSchema.classroomMember.classroomId, dbSchema.classroomMember.userId],
              set: {
                role: mappedRole,
              },
            });
        }

        await writeInvitationAuditLog({
          invitationId: organizationInvitation.id,
          organizationId: organizationInvitation.organizationId,
          actorUserId: identity.userId,
          targetEmail: organizationInvitation.email,
          action: 'invitation.accepted',
          metadata: {
            classroomRole: mappedRole,
            classroomId: organizationInvitation.classroomId,
            classroomSlug: organizationInvitation.classroomSlug,
          },
          headers,
        });

        return response;
      }

      const invitation = await findParticipantInvitationById(body.invitationId);
      if (!invitation) {
        return c.json({ message: 'Classroom invitation not found.' }, 404);
      }
      if (normalizeEmail(invitation.email) !== identity.email) {
        return c.json({ message: 'Forbidden' }, 403);
      }
      if (invitation.status !== 'pending') {
        return c.json({ message: 'Invitation is not pending.' }, 400);
      }

      const existingParticipant = await database
        .select({
          id: dbSchema.participant.id,
        })
        .from(dbSchema.participant)
        .where(
          and(
            eq(dbSchema.participant.organizationId, invitation.organizationId),
            or(
              eq(dbSchema.participant.userId, identity.userId),
              eq(dbSchema.participant.email, invitation.email),
            ),
          ),
        )
        .limit(1);
      if (existingParticipant[0]) {
        return c.json({ message: 'Participant already exists for organization.' }, 409);
      }

      const participantId = crypto.randomUUID();
      const now = new Date();
      await database.insert(dbSchema.participant).values({
        id: participantId,
        organizationId: invitation.organizationId,
        classroomId: invitation.classroomId,
        userId: identity.userId,
        email: invitation.email,
        name: invitation.participantName,
      });
      await database
        .update(dbSchema.participantInvitation)
        .set({
          status: 'accepted',
          respondedByUserId: identity.userId,
          respondedAt: now,
        })
        .where(
          and(
            eq(dbSchema.participantInvitation.id, invitation.id),
            eq(dbSchema.participantInvitation.status, 'pending'),
          ),
        );

      await writeParticipantInvitationAuditLog({
        participantInvitationId: invitation.id,
        organizationId: invitation.organizationId,
        actorUserId: identity.userId,
        targetEmail: invitation.email,
        action: 'participant-invitation.accepted',
        headers,
      });

      const updatedInvitation = await findParticipantInvitationById(invitation.id);
      return c.json(
        {
          invitation: serializeParticipantInvitation(updatedInvitation),
          participant: {
            id: participantId,
            organizationId: invitation.organizationId,
            userId: identity.userId,
            email: invitation.email,
            name: invitation.participantName,
            createdAt: now.toISOString(),
          },
        },
        200,
      );
    })();
  });

  authRoutes.openapi(rejectClassroomInvitationRoute, (c) => {
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

      const organizationInvitation = await findOrganizationInvitationDetailById(body.invitationId);
      if (organizationInvitation) {
        if (normalizeEmail(organizationInvitation.email) !== identity.email) {
          return c.json({ message: 'Forbidden' }, 403);
        }
        const response = await auth.api.rejectInvitation({
          body: { invitationId: body.invitationId },
          headers,
          asResponse: true,
        });
        if (response.ok) {
          await writeInvitationAuditLog({
            invitationId: organizationInvitation.id,
            organizationId: organizationInvitation.organizationId,
            actorUserId: identity.userId,
            targetEmail: organizationInvitation.email,
            action: 'invitation.rejected',
            headers,
          });
        }
        return response;
      }

      const invitation = await findParticipantInvitationById(body.invitationId);
      if (!invitation) {
        return c.json({ message: 'Classroom invitation not found.' }, 404);
      }
      if (normalizeEmail(invitation.email) !== identity.email) {
        return c.json({ message: 'Forbidden' }, 403);
      }
      if (invitation.status !== 'pending') {
        return c.json({ message: 'Invitation is not pending.' }, 400);
      }

      await database
        .update(dbSchema.participantInvitation)
        .set({
          status: 'rejected',
          respondedByUserId: identity.userId,
          respondedAt: new Date(),
        })
        .where(
          and(
            eq(dbSchema.participantInvitation.id, invitation.id),
            eq(dbSchema.participantInvitation.status, 'pending'),
          ),
        );

      await writeParticipantInvitationAuditLog({
        participantInvitationId: invitation.id,
        organizationId: invitation.organizationId,
        actorUserId: identity.userId,
        targetEmail: invitation.email,
        action: 'participant-invitation.rejected',
        headers,
      });

      const updatedInvitation = await findParticipantInvitationById(invitation.id);
      return c.json(serializeParticipantInvitation(updatedInvitation), 200);
    })();
  });

  authRoutes.openapi(cancelClassroomInvitationRoute, (c) => {
    return (async () => {
      const body = c.req.valid('json');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);
      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const organizationInvitation = await findOrganizationInvitationDetailById(body.invitationId);
      if (organizationInvitation) {
        const classroomContext =
          typeof organizationInvitation.classroomId === 'string'
            ? await resolveClassroomContextByIds({
                organizationId: organizationInvitation.organizationId,
                classroomId: organizationInvitation.classroomId,
              })
            : await resolveClassroomContextByOrganizationId(organizationInvitation.organizationId);
        if (!classroomContext) {
          return c.json({ message: 'Organization or classroom not found.' }, 404);
        }
        const access = await resolveOrganizationClassroomAccess({
          database,
          userId: identity.userId,
          context: classroomContext,
        });
        if (!access.canManageClassroom) {
          return c.json({ message: 'Forbidden' }, 403);
        }

        const response = await auth.api.cancelInvitation({
          body: { invitationId: body.invitationId },
          headers,
          asResponse: true,
        });
        if (response.ok) {
          await writeInvitationAuditLog({
            invitationId: organizationInvitation.id,
            organizationId: organizationInvitation.organizationId,
            actorUserId: identity.userId,
            targetEmail: organizationInvitation.email,
            action: 'invitation.canceled',
            headers,
          });
        }
        return response;
      }

      const invitation = await findParticipantInvitationById(body.invitationId);
      if (!invitation) {
        return c.json({ message: 'Classroom invitation not found.' }, 404);
      }

      const classroomContext = await resolveClassroomContextByIds({
        organizationId: invitation.organizationId,
        classroomId: invitation.classroomId,
      });
      if (!classroomContext) {
        return c.json({ message: 'Organization or classroom not found.' }, 404);
      }
      const access = await resolveOrganizationClassroomAccess({
        database,
        userId: identity.userId,
        context: classroomContext,
      });
      if (!access.canManageParticipants) {
        return c.json({ message: 'Forbidden' }, 403);
      }
      if (invitation.status !== 'pending') {
        return c.json({ message: 'Invitation is not pending.' }, 400);
      }

      await database
        .update(dbSchema.participantInvitation)
        .set({
          status: 'canceled',
          respondedByUserId: identity.userId,
          respondedAt: new Date(),
        })
        .where(
          and(
            eq(dbSchema.participantInvitation.id, invitation.id),
            eq(dbSchema.participantInvitation.status, 'pending'),
          ),
        );

      await writeParticipantInvitationAuditLog({
        participantInvitationId: invitation.id,
        organizationId: invitation.organizationId,
        actorUserId: identity.userId,
        targetEmail: invitation.email,
        action: 'participant-invitation.canceled',
        headers,
      });

      const updatedInvitation = await findParticipantInvitationById(invitation.id);
      return c.json(serializeParticipantInvitation(updatedInvitation), 200);
    })();
  });

  authRoutes.openapi(createInvitationRoute, (c) => {
    return (async () => {
      const body = c.req.valid('json');
      const headers = c.req.raw.headers;
      const normalizedEmail = body.email.trim().toLowerCase();
      const actorUserId = await getActorUserId(headers);

      if (!actorUserId) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const currentSession = await auth.api.getSession({ headers });
      const activeOrganizationId = getActiveOrganizationId(currentSession?.session);
      const organizationId = body.organizationId ?? activeOrganizationId;

      if (!organizationId) {
        return c.json({ message: 'organizationId is required.' }, 400);
      }

      let resendTargetInvitation:
        | {
            id: string;
            organizationId: string;
            email: string;
          }
        | null = null;

      if (body.resend) {
        resendTargetInvitation = await findPendingInvitationForResend({
          organizationId,
          email: normalizedEmail,
        });

        if (!resendTargetInvitation) {
          return c.json({ message: 'Pending invitation for resend was not found.' }, 400);
        }

        const resentCount = await countInvitationAuditAction({
          invitationId: resendTargetInvitation.id,
          action: 'invitation.resent',
        });

        if (resentCount >= 3) {
          return c.json({ message: 'Invitation resend limit reached (3).' }, 429);
        }
      }

      const response = await auth.api.createInvitation({
        body: {
          ...body,
          email: normalizedEmail,
          organizationId,
        },
        headers,
        asResponse: true,
      });

      if (!response.ok) {
        return response;
      }

      const payload = await parseResponseBody(response);
      const invitationPayload = isInvitationPayload(payload)
        ? payload
        : resendTargetInvitation
          ? {
              id: resendTargetInvitation.id,
              organizationId: resendTargetInvitation.organizationId,
              email: resendTargetInvitation.email,
            }
          : null;

      if (invitationPayload) {
        await writeInvitationAuditLog({
          invitationId: invitationPayload.id,
          organizationId: invitationPayload.organizationId,
          actorUserId,
          targetEmail: invitationPayload.email,
          action: body.resend ? 'invitation.resent' : 'invitation.created',
          metadata: {
            resend: body.resend ?? false,
          },
          headers,
        });
      }

      return response;
    })();
  });

  authRoutes.openapi(listInvitationsRoute, (c) => {
    const query = c.req.valid('query');

    return auth.api.listInvitations({
      query,
      headers: c.req.raw.headers,
      asResponse: true,
    });
  });

  authRoutes.openapi(listUserInvitationsRoute, (c) => {
    return auth.api.listUserInvitations({
      headers: c.req.raw.headers,
      asResponse: true,
    });
  });

  authRoutes.openapi(invitationDetailRoute, (c) => {
    const query = c.req.valid('query');

    return auth.api.getInvitation({
      query: { id: query.invitationId },
      headers: c.req.raw.headers,
      asResponse: true,
    });
  });

  authRoutes.openapi(acceptInvitationRoute, (c) => {
    return (async () => {
      const body = c.req.valid('json');
      const headers = c.req.raw.headers;
      const actorUserId = await getActorUserId(headers);
      const invitationBeforeAction = await findInvitationById(body.invitationId);
      const response = await auth.api.acceptInvitation({
        body,
        headers,
        asResponse: true,
      });

      if (response.ok && actorUserId && invitationBeforeAction) {
        await writeInvitationAuditLog({
          invitationId: invitationBeforeAction.id,
          organizationId: invitationBeforeAction.organizationId,
          actorUserId,
          targetEmail: invitationBeforeAction.email,
          action: 'invitation.accepted',
          headers,
        });
      }

      return response;
    })();
  });

  authRoutes.openapi(rejectInvitationRoute, (c) => {
    return (async () => {
      const body = c.req.valid('json');
      const headers = c.req.raw.headers;
      const actorUserId = await getActorUserId(headers);
      const invitationBeforeAction = await findInvitationById(body.invitationId);
      const response = await auth.api.rejectInvitation({
        body,
        headers,
        asResponse: true,
      });

      if (response.ok && actorUserId && invitationBeforeAction) {
        await writeInvitationAuditLog({
          invitationId: invitationBeforeAction.id,
          organizationId: invitationBeforeAction.organizationId,
          actorUserId,
          targetEmail: invitationBeforeAction.email,
          action: 'invitation.rejected',
          headers,
        });
      }

      return response;
    })();
  });

  authRoutes.openapi(cancelInvitationRoute, (c) => {
    return (async () => {
      const body = c.req.valid('json');
      const headers = c.req.raw.headers;
      const actorUserId = await getActorUserId(headers);
      const invitationBeforeAction = await findInvitationById(body.invitationId);
      const response = await auth.api.cancelInvitation({
        body,
        headers,
        asResponse: true,
      });

      if (response.ok && actorUserId && invitationBeforeAction) {
        await writeInvitationAuditLog({
          invitationId: invitationBeforeAction.id,
          organizationId: invitationBeforeAction.organizationId,
          actorUserId,
          targetEmail: invitationBeforeAction.email,
          action: 'invitation.canceled',
          headers,
        });
      }

      return response;
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

      const organizationId = resolveOrganizationId(query.organizationId, identity.activeOrganizationId);
      if (!organizationId) {
        return c.json({ message: 'organizationId is required.' }, 400);
      }

      if (query.classroomId) {
        const classroomContext = await resolveClassroomContextByIds({
          organizationId,
          classroomId: query.classroomId,
        });
        if (!classroomContext) {
          return c.json({ message: 'Classroom not found.' }, 404);
        }

        const access = await resolveOrganizationClassroomAccess({
          database,
          userId: identity.userId,
          context: classroomContext,
        });
        if (!access.canManageParticipants && !access.canManageClassroom) {
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

      const filters = [eq(dbSchema.participant.organizationId, organizationId)];
      if (query.classroomId) {
        filters.push(eq(dbSchema.participant.classroomId, query.classroomId));
      }

      const rows = await database
        .select({
          id: dbSchema.participant.id,
          organizationId: dbSchema.participant.organizationId,
          classroomId: dbSchema.participant.classroomId,
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

      const publicOrganizationSlug = env.PUBLIC_EVENTS_ORG_SLUG?.trim();
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

      const publicClassroomSlug = env.PUBLIC_EVENTS_CLASSROOM_SLUG?.trim() || publicOrganizationSlug;
      if (publicClassroomSlug.length === 0) {
        return c.json({ message: 'PUBLIC_EVENTS_CLASSROOM_SLUG is invalid.' }, 503);
      }

      if (body.organizationId !== publicOrganization.id) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const classroomContext = body.classroomId
        ? await resolveClassroomContextByIds({
            organizationId: body.organizationId,
            classroomId: body.classroomId,
          })
        : await resolveClassroomContextBySlugs({
            orgSlug: publicOrganizationSlug,
            classroomSlug: publicClassroomSlug,
          });
      if (!classroomContext) {
        return c.json({ message: 'Public events classroom was not found.' }, 503);
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
          classroomId: dbSchema.participant.classroomId,
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
                  eq(dbSchema.participant.classroomId, classroomContext.classroomId),
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
          classroomId: classroomContext.classroomId,
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
          classroomId: dbSchema.participant.classroomId,
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

  authRoutes.openapi(createParticipantInvitationRoute, (c) => {
    return (async () => {
      const body = c.req.valid('json');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);
      const currentSession = await auth.api.getSession({ headers });

      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const organizationId = resolveOrganizationId(body.organizationId, identity.activeOrganizationId);
      if (!organizationId) {
        return c.json({ message: 'organizationId is required.' }, 400);
      }

      let classroomContext:
        | Awaited<ReturnType<typeof resolveClassroomContextByIds>>
        | Awaited<ReturnType<typeof resolveClassroomContextByOrganizationId>>
        | null = null;
      if (body.classroomId) {
        classroomContext = await resolveClassroomContextByIds({
          organizationId,
          classroomId: body.classroomId,
        });
        if (!classroomContext) {
          return c.json({ message: 'Classroom not found.' }, 404);
        }

        const access = await resolveOrganizationClassroomAccess({
          database,
          userId: identity.userId,
          context: classroomContext,
        });
        if (!access.canManageParticipants && !access.canManageClassroom) {
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

        classroomContext = await resolveClassroomContextByOrganizationId(organizationId);
      }

      if (!classroomContext) {
        return c.json({ message: 'Classroom not found.' }, 404);
      }

      const normalizedEmail = normalizeEmail(body.email);
      const participantName = body.participantName.trim();

      if (body.resend) {
        const resendTargetInvitation = await findPendingParticipantInvitationForResend({
          organizationId,
          classroomId: classroomContext.classroomId,
          email: normalizedEmail,
        });

        if (!resendTargetInvitation) {
          return c.json({ message: 'Pending invitation for resend was not found.' }, 400);
        }

        const resentCount = await countParticipantInvitationAuditAction({
          participantInvitationId: resendTargetInvitation.id,
          action: 'participant-invitation.resent',
        });

        if (resentCount >= 3) {
          return c.json({ message: 'Participant invitation resend limit reached (3).' }, 429);
        }

        await sendParticipantInvitationEmail({
          env,
          invitationId: resendTargetInvitation.id,
          inviteeEmail: resendTargetInvitation.email,
          participantName: resendTargetInvitation.participantName,
          inviterName: getStringValue(currentSession?.user?.name),
          inviterEmail: getStringValue(currentSession?.user?.email),
          organizationName: resendTargetInvitation.organizationName,
        });

        await writeParticipantInvitationAuditLog({
          participantInvitationId: resendTargetInvitation.id,
          organizationId: resendTargetInvitation.organizationId,
          actorUserId: identity.userId,
          targetEmail: resendTargetInvitation.email,
          action: 'participant-invitation.resent',
          metadata: {
            resend: true,
            classroomSlug: classroomContext.classroomSlug,
          },
          headers,
        });

        return c.json(serializeParticipantInvitation(resendTargetInvitation), 200);
      }

      const duplicatePending = await findDuplicatePendingParticipantInvitation({
        organizationId,
        classroomId: classroomContext.classroomId,
        email: normalizedEmail,
      });
      if (duplicatePending) {
        return c.json({ message: 'Pending invitation already exists for this email.' }, 409);
      }

      const invitationId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 172_800_000);

      await database.insert(dbSchema.participantInvitation).values({
        id: invitationId,
        organizationId,
        classroomId: classroomContext.classroomId,
        email: normalizedEmail,
        participantName,
        status: 'pending',
        expiresAt,
        invitedByUserId: identity.userId,
      });

      const createdInvitation = await findParticipantInvitationById(invitationId);
      if (!createdInvitation) {
        return c.json({ message: 'Failed to create participant invitation.' }, 500);
      }

      await sendParticipantInvitationEmail({
        env,
        invitationId: createdInvitation.id,
        inviteeEmail: createdInvitation.email,
        participantName: createdInvitation.participantName,
        inviterName: getStringValue(currentSession?.user?.name),
        inviterEmail: getStringValue(currentSession?.user?.email),
        organizationName: createdInvitation.organizationName,
      });

      await writeParticipantInvitationAuditLog({
        participantInvitationId: createdInvitation.id,
        organizationId: createdInvitation.organizationId,
        actorUserId: identity.userId,
        targetEmail: createdInvitation.email,
        action: 'participant-invitation.created',
        metadata: {
          resend: false,
          participantName,
          classroomSlug: classroomContext.classroomSlug,
        },
        headers,
      });

      return c.json(serializeParticipantInvitation(createdInvitation), 200);
    })();
  });

  authRoutes.openapi(listParticipantInvitationsRoute, (c) => {
    return (async () => {
      const query = c.req.valid('query');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);

      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const organizationId = resolveOrganizationId(query.organizationId, identity.activeOrganizationId);
      if (!organizationId) {
        return c.json({ message: 'organizationId is required.' }, 400);
      }

      if (query.classroomId) {
        const classroomContext = await resolveClassroomContextByIds({
          organizationId,
          classroomId: query.classroomId,
        });
        if (!classroomContext) {
          return c.json({ message: 'Classroom not found.' }, 404);
        }

        const access = await resolveOrganizationClassroomAccess({
          database,
          userId: identity.userId,
          context: classroomContext,
        });
        if (!access.canManageParticipants && !access.canManageClassroom) {
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

      const filters = [eq(dbSchema.participantInvitation.organizationId, organizationId)];
      if (query.classroomId) {
        filters.push(eq(dbSchema.participantInvitation.classroomId, query.classroomId));
      }

      const rows = await database
        .select({
          id: dbSchema.participantInvitation.id,
          organizationId: dbSchema.participantInvitation.organizationId,
          classroomId: dbSchema.participantInvitation.classroomId,
          classroomSlug: dbSchema.classroom.slug,
          classroomName: dbSchema.classroom.name,
          organizationName: dbSchema.organization.name,
          email: dbSchema.participantInvitation.email,
          participantName: dbSchema.participantInvitation.participantName,
          status: dbSchema.participantInvitation.status,
          expiresAt: dbSchema.participantInvitation.expiresAt,
          createdAt: dbSchema.participantInvitation.createdAt,
          invitedByUserId: dbSchema.participantInvitation.invitedByUserId,
          respondedByUserId: dbSchema.participantInvitation.respondedByUserId,
          respondedAt: dbSchema.participantInvitation.respondedAt,
        })
        .from(dbSchema.participantInvitation)
        .innerJoin(dbSchema.classroom, eq(dbSchema.classroom.id, dbSchema.participantInvitation.classroomId))
        .innerJoin(
          dbSchema.organization,
          eq(dbSchema.organization.id, dbSchema.participantInvitation.organizationId),
        )
        .where(and(...filters))
        .orderBy(desc(dbSchema.participantInvitation.createdAt));

      return c.json(
        rows.map((row: any) =>
          serializeParticipantInvitation(row as Parameters<typeof serializeParticipantInvitation>[0]),
        ),
        200,
      );
    })();
  });

  authRoutes.openapi(listUserParticipantInvitationsRoute, (c) => {
    return (async () => {
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);

      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }
      if (!identity.email) {
        return c.json({ message: 'Current user email is unavailable.' }, 400);
      }

      const rows = await database
        .select({
          id: dbSchema.participantInvitation.id,
          organizationId: dbSchema.participantInvitation.organizationId,
          classroomId: dbSchema.participantInvitation.classroomId,
          classroomSlug: dbSchema.classroom.slug,
          classroomName: dbSchema.classroom.name,
          organizationName: dbSchema.organization.name,
          email: dbSchema.participantInvitation.email,
          participantName: dbSchema.participantInvitation.participantName,
          status: dbSchema.participantInvitation.status,
          expiresAt: dbSchema.participantInvitation.expiresAt,
          createdAt: dbSchema.participantInvitation.createdAt,
          invitedByUserId: dbSchema.participantInvitation.invitedByUserId,
          respondedByUserId: dbSchema.participantInvitation.respondedByUserId,
          respondedAt: dbSchema.participantInvitation.respondedAt,
        })
        .from(dbSchema.participantInvitation)
        .innerJoin(dbSchema.classroom, eq(dbSchema.classroom.id, dbSchema.participantInvitation.classroomId))
        .innerJoin(
          dbSchema.organization,
          eq(dbSchema.organization.id, dbSchema.participantInvitation.organizationId),
        )
        .where(eq(dbSchema.participantInvitation.email, identity.email))
        .orderBy(desc(dbSchema.participantInvitation.createdAt));

      return c.json(
        rows.map((row: any) =>
          serializeParticipantInvitation(row as Parameters<typeof serializeParticipantInvitation>[0]),
        ),
        200,
      );
    })();
  });

  authRoutes.openapi(participantInvitationDetailRoute, (c) => {
    return (async () => {
      const query = c.req.valid('query');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);

      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }
      if (!identity.email) {
        return c.json({ message: 'Current user email is unavailable.' }, 400);
      }

      const invitation = await findParticipantInvitationById(query.invitationId);
      if (!invitation) {
        return c.json({ message: 'Participant invitation not found.' }, 404);
      }

      if (normalizeEmail(invitation.email) !== identity.email) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      return c.json(serializeParticipantInvitation(invitation), 200);
    })();
  });

  authRoutes.openapi(acceptParticipantInvitationRoute, (c) => {
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

      const invitation = await findParticipantInvitationById(body.invitationId);
      if (!invitation) {
        return c.json({ message: 'Participant invitation not found.' }, 404);
      }

      if (normalizeEmail(invitation.email) !== identity.email) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      if (invitation.status !== 'pending') {
        return c.json({ message: 'Invitation is not pending.' }, 400);
      }

      const existingParticipant = await database
        .select({
          id: dbSchema.participant.id,
        })
        .from(dbSchema.participant)
        .where(
          and(
            eq(dbSchema.participant.organizationId, invitation.organizationId),
            eq(dbSchema.participant.classroomId, invitation.classroomId),
            or(
              eq(dbSchema.participant.userId, identity.userId),
              eq(dbSchema.participant.email, invitation.email),
            ),
          ),
        )
        .limit(1);

      if (existingParticipant[0]) {
        return c.json({ message: 'Participant already exists for organization.' }, 409);
      }

      const participantId = crypto.randomUUID();
      const now = new Date();

      await database.insert(dbSchema.participant).values({
        id: participantId,
        organizationId: invitation.organizationId,
        classroomId: invitation.classroomId,
        userId: identity.userId,
        email: invitation.email,
        name: invitation.participantName,
      });

      await database
        .update(dbSchema.participantInvitation)
        .set({
          status: 'accepted',
          respondedByUserId: identity.userId,
          respondedAt: now,
        })
        .where(
          and(
            eq(dbSchema.participantInvitation.id, invitation.id),
            eq(dbSchema.participantInvitation.status, 'pending'),
          ),
        );

      await writeParticipantInvitationAuditLog({
        participantInvitationId: invitation.id,
        organizationId: invitation.organizationId,
        classroomId: invitation.classroomId,
        actorUserId: identity.userId,
        targetEmail: invitation.email,
        action: 'participant-invitation.accepted',
        headers,
      });

      const updatedInvitation = await findParticipantInvitationById(invitation.id);
      return c.json(
        {
          invitation: serializeParticipantInvitation(updatedInvitation),
          participant: {
            id: participantId,
            organizationId: invitation.organizationId,
            userId: identity.userId,
            email: invitation.email,
            name: invitation.participantName,
            createdAt: now.toISOString(),
          },
        },
        200,
      );
    })();
  });

  authRoutes.openapi(rejectParticipantInvitationRoute, (c) => {
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

      const invitation = await findParticipantInvitationById(body.invitationId);
      if (!invitation) {
        return c.json({ message: 'Participant invitation not found.' }, 404);
      }

      if (normalizeEmail(invitation.email) !== identity.email) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      if (invitation.status !== 'pending') {
        return c.json({ message: 'Invitation is not pending.' }, 400);
      }

      await database
        .update(dbSchema.participantInvitation)
        .set({
          status: 'rejected',
          respondedByUserId: identity.userId,
          respondedAt: new Date(),
        })
        .where(
          and(
            eq(dbSchema.participantInvitation.id, invitation.id),
            eq(dbSchema.participantInvitation.status, 'pending'),
          ),
        );

      await writeParticipantInvitationAuditLog({
        participantInvitationId: invitation.id,
        organizationId: invitation.organizationId,
        classroomId: invitation.classroomId,
        actorUserId: identity.userId,
        targetEmail: invitation.email,
        action: 'participant-invitation.rejected',
        headers,
      });

      const updatedInvitation = await findParticipantInvitationById(invitation.id);
      return c.json(serializeParticipantInvitation(updatedInvitation), 200);
    })();
  });

  authRoutes.openapi(cancelParticipantInvitationRoute, (c) => {
    return (async () => {
      const body = c.req.valid('json');
      const headers = c.req.raw.headers;
      const identity = await getSessionIdentity(headers);

      if (!identity) {
        return c.json({ message: 'Unauthorized' }, 401);
      }

      const invitation = await findParticipantInvitationById(body.invitationId);
      if (!invitation) {
        return c.json({ message: 'Participant invitation not found.' }, 404);
      }

      const classroomContext = await resolveClassroomContextByIds({
        organizationId: invitation.organizationId,
        classroomId: invitation.classroomId,
      });
      if (!classroomContext) {
        return c.json({ message: 'Classroom not found.' }, 404);
      }

      const access = await resolveOrganizationClassroomAccess({
        database,
        userId: identity.userId,
        context: classroomContext,
      });
      if (!access.canManageParticipants && !access.canManageClassroom) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      if (invitation.status !== 'pending') {
        return c.json({ message: 'Invitation is not pending.' }, 400);
      }

      await database
        .update(dbSchema.participantInvitation)
        .set({
          status: 'canceled',
          respondedByUserId: identity.userId,
          respondedAt: new Date(),
        })
        .where(
          and(
            eq(dbSchema.participantInvitation.id, invitation.id),
            eq(dbSchema.participantInvitation.status, 'pending'),
          ),
        );

      await writeParticipantInvitationAuditLog({
        participantInvitationId: invitation.id,
        organizationId: invitation.organizationId,
        classroomId: invitation.classroomId,
        actorUserId: identity.userId,
        targetEmail: invitation.email,
        action: 'participant-invitation.canceled',
        headers,
      });

      const updatedInvitation = await findParticipantInvitationById(invitation.id);
      return c.json(serializeParticipantInvitation(updatedInvitation), 200);
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

  authRoutes.on(['GET', 'POST'], '/orgs/:orgSlug/classrooms/:classroomSlug/*', async (c) => {
    const { orgSlug, classroomSlug } = c.req.param();
    const classroomContext = await resolveClassroomContextBySlugs({ orgSlug, classroomSlug });
    if (!classroomContext) {
      return c.json({ message: 'Organization or classroom not found.' }, 404);
    }

    const scopedPrefix = `/orgs/${orgSlug}/classrooms/${classroomSlug}`;
    const prefixIndex = c.req.path.indexOf(scopedPrefix);
    if (prefixIndex < 0) {
      return c.json({ message: 'Not found.' }, 404);
    }

    const suffix = c.req.path.slice(prefixIndex + scopedPrefix.length);
    if (
      suffix.length === 0
      || !scopedOrganizationApiPrefixes.some((candidatePrefix) => suffix.startsWith(candidatePrefix))
    ) {
      return c.json({ message: 'Not found.' }, 404);
    }

    const targetUrl = new URL(c.req.url);
    targetUrl.pathname = `/organizations${suffix}`;
    targetUrl.searchParams.set('organizationId', classroomContext.organizationId);
    targetUrl.searchParams.set('classroomId', classroomContext.classroomId);

    const headers = new Headers(c.req.raw.headers);
    headers.delete('content-length');

    let body: BodyInit | undefined;
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const contentType = c.req.raw.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const payload = await c.req.raw.clone().json().catch(() => ({}));
        const nextPayload =
          typeof payload === 'object' && payload !== null
            ? {
                ...payload,
                organizationId: classroomContext.organizationId,
                classroomId: classroomContext.classroomId,
              }
            : {
                organizationId: classroomContext.organizationId,
                classroomId: classroomContext.classroomId,
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
