import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import type { AuthInstance, AuthRuntimeDatabase, AuthRuntimeEnv } from '../auth-runtime.js';
import * as dbSchema from '../db/schema.js';
import { sendParticipantInvitationEmail } from '../email/resend.js';
import type { OrganizationLogoService } from '../organization-logo-service.js';
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
});

const listParticipantsQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
});

const listParticipantInvitationsQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
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
  const authRoutes = new OpenAPIHono<AuthRouteBindings>();

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
    email,
  }: {
    organizationId: string;
    email: string;
  }) => {
    const rows = await database
      .select({
        id: dbSchema.invitation.id,
        organizationId: dbSchema.invitation.organizationId,
        email: dbSchema.invitation.email,
      })
      .from(dbSchema.invitation)
      .where(
        and(
          eq(dbSchema.invitation.organizationId, organizationId),
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
    return role === 'admin' || role === 'owner';
  };

  const findParticipantInvitationById = async (invitationId: string) => {
    const rows = await database
      .select({
        id: dbSchema.participantInvitation.id,
        organizationId: dbSchema.participantInvitation.organizationId,
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
    email,
  }: {
    organizationId: string;
    email: string;
  }) => {
    const rows = await database
      .select({
        id: dbSchema.participantInvitation.id,
        organizationId: dbSchema.participantInvitation.organizationId,
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
      .innerJoin(
        dbSchema.organization,
        eq(dbSchema.organization.id, dbSchema.participantInvitation.organizationId),
      )
      .where(
        and(
          eq(dbSchema.participantInvitation.organizationId, organizationId),
          eq(dbSchema.participantInvitation.email, email),
          eq(dbSchema.participantInvitation.status, 'pending'),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  };

  const findDuplicatePendingParticipantInvitation = async ({
    organizationId,
    email,
  }: {
    organizationId: string;
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
    actorUserId,
    targetEmail,
    action,
    metadata,
    headers,
  }: {
    participantInvitationId: string;
    organizationId: string;
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

  const serializeParticipantInvitation = (
    invitation:
      | {
          id: string;
          organizationId: string;
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
      return response;
    }

    if (!response.ok) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) {
      return response;
    }

    const headers = new Headers(response.headers);
    headers.delete('content-type');
    headers.delete('content-length');

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
    const body = c.req.valid('json');

    return auth.api.createOrganization({
      body,
      headers: c.req.raw.headers,
      asResponse: true,
    });
  });

  authRoutes.openapi(listOrganizationsRoute, (c) => {
    return auth.api.listOrganizations({
      headers: c.req.raw.headers,
      asResponse: true,
    });
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

      const hasAccess = await hasOrganizationAdminAccess({
        organizationId,
        userId: identity.userId,
      });
      if (!hasAccess) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const rows = await database
        .select({
          id: dbSchema.participant.id,
          organizationId: dbSchema.participant.organizationId,
          userId: dbSchema.participant.userId,
          email: dbSchema.participant.email,
          name: dbSchema.participant.name,
          createdAt: dbSchema.participant.createdAt,
          updatedAt: dbSchema.participant.updatedAt,
        })
        .from(dbSchema.participant)
        .where(eq(dbSchema.participant.organizationId, organizationId))
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

      const hasAccess = await hasOrganizationAdminAccess({
        organizationId,
        userId: identity.userId,
      });
      if (!hasAccess) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const normalizedEmail = normalizeEmail(body.email);
      const participantName = body.participantName.trim();

      if (body.resend) {
        const resendTargetInvitation = await findPendingParticipantInvitationForResend({
          organizationId,
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
          },
          headers,
        });

        return c.json(serializeParticipantInvitation(resendTargetInvitation), 200);
      }

      const duplicatePending = await findDuplicatePendingParticipantInvitation({
        organizationId,
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

      const hasAccess = await hasOrganizationAdminAccess({
        organizationId,
        userId: identity.userId,
      });
      if (!hasAccess) {
        return c.json({ message: 'Forbidden' }, 403);
      }

      const rows = await database
        .select({
          id: dbSchema.participantInvitation.id,
          organizationId: dbSchema.participantInvitation.organizationId,
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
        .innerJoin(
          dbSchema.organization,
          eq(dbSchema.organization.id, dbSchema.participantInvitation.organizationId),
        )
        .where(eq(dbSchema.participantInvitation.organizationId, organizationId))
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

      const hasAccess = await hasOrganizationAdminAccess({
        organizationId: invitation.organizationId,
        userId: identity.userId,
      });
      if (!hasAccess) {
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

  registerBookingRoutes({
    authRoutes,
    auth,
    database,
    env,
  });

  return authRoutes;
};
