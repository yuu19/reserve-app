import fs from 'node:fs/promises';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/d1';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { createAuthRuntime } from './auth-runtime.js';

type D1DatabaseBinding = Awaited<ReturnType<Miniflare['getD1Database']>>;

let app: ReturnType<typeof createApp>;
let mf: Miniflare;
let d1: D1DatabaseBinding;

const splitSetCookieHeader = (header: string): string[] => {
  return header.split(/,(?=[^;,\s]+=)/g).map((value) => value.trim());
};

const getSetCookieValues = (response: Response): string[] => {
  const headersWithGetSetCookie = response.headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof headersWithGetSetCookie.getSetCookie === 'function') {
    return headersWithGetSetCookie.getSetCookie();
  }

  const setCookieHeader = response.headers.get('set-cookie');
  return setCookieHeader ? splitSetCookieHeader(setCookieHeader) : [];
};

const createAuthAgent = (application: ReturnType<typeof createApp>) => {
  const cookieJar = new Map<string, string>();

  const refreshCookieHeader = () => {
    return Array.from(cookieJar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  };

  const applyResponseCookies = (response: Response) => {
    for (const setCookie of getSetCookieValues(response)) {
      const firstPart = setCookie.split(';', 1)[0];
      const separator = firstPart.indexOf('=');
      if (separator <= 0) {
        continue;
      }

      const name = firstPart.slice(0, separator);
      const value = firstPart.slice(separator + 1);
      cookieJar.set(name, value);
    }
  };

  const request = async (input: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const cookieHeader = refreshCookieHeader();
    if (cookieHeader.length > 0) {
      headers.set('cookie', cookieHeader);
    }

    const response = await application.request(input, {
      ...init,
      headers,
    });

    applyResponseCookies(response);
    return response;
  };

  return { request };
};

const toJson = async (response: Response): Promise<unknown> => {
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

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const createStripeSignatureHeader = async (payload: string, secret: string, timestamp?: number) => {
  const signatureTimestamp = timestamp ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${signatureTimestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signedPayload),
  );
  const signature = toHex(signatureBuffer);
  return `t=${signatureTimestamp},v1=${signature}`;
};

const selectInvitationStatus = async (invitationId: string) => {
  const row = await d1
    .prepare('SELECT status FROM invitation WHERE id = ?')
    .bind(invitationId)
    .first<{ status: string }>();

  return row?.status ?? null;
};

const selectInvitationActionCount = async (invitationId: string, action: string) => {
  const row = await d1
    .prepare('SELECT COUNT(*) as count FROM invitation_audit_log WHERE invitation_id = ? AND action = ?')
    .bind(invitationId, action)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
};

const selectParticipantInvitationStatus = async (invitationId: string) => {
  const row = await d1
    .prepare('SELECT status FROM classroom_invitation WHERE id = ?')
    .bind(invitationId)
    .first<{ status: string }>();

  return row?.status ?? null;
};

const selectParticipantInvitationActionCount = async (invitationId: string, action: string) => {
  const row = await d1
    .prepare(
      'SELECT COUNT(*) as count FROM classroom_invitation_audit_log WHERE classroom_invitation_id = ? AND action = ?',
    )
    .bind(invitationId, action)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
};

const selectParticipantCountByEmail = async (organizationId: string, email: string) => {
  const row = await d1
    .prepare('SELECT COUNT(*) as count FROM participant WHERE organization_id = ? AND email = ?')
    .bind(organizationId, email)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
};

const selectParticipantIdByEmail = async (organizationId: string, email: string) => {
  const row = await d1
    .prepare('SELECT id FROM participant WHERE organization_id = ? AND email = ? LIMIT 1')
    .bind(organizationId, email)
    .first<{ id: string }>();

  return row?.id ?? null;
};

const selectSlotReservedCount = async (slotId: string) => {
  const row = await d1
    .prepare('SELECT reserved_count as reservedCount FROM slot WHERE id = ?')
    .bind(slotId)
    .first<{ reservedCount: number | string }>();

  return Number(row?.reservedCount ?? 0);
};

const selectBookingStatus = async (bookingId: string) => {
  const row = await d1
    .prepare('SELECT status FROM booking WHERE id = ?')
    .bind(bookingId)
    .first<{ status: string }>();

  return row?.status ?? null;
};

const selectTicketPackRemaining = async (ticketPackId: string) => {
  const row = await d1
    .prepare('SELECT remaining_count as remainingCount FROM ticket_pack WHERE id = ?')
    .bind(ticketPackId)
    .first<{ remainingCount: number | string }>();

  return Number(row?.remainingCount ?? 0);
};

const selectTicketLedgerActionCount = async (ticketPackId: string, action: string) => {
  const row = await d1
    .prepare('SELECT COUNT(*) as count FROM ticket_ledger WHERE ticket_pack_id = ? AND action = ?')
    .bind(ticketPackId, action)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
};

const selectTicketPurchaseRow = async (purchaseId: string) => {
  return d1
    .prepare(
      'SELECT id, participant_id as participantId, ticket_type_id as ticketTypeId, payment_method as paymentMethod, status, ticket_pack_id as ticketPackId, stripe_checkout_session_id as stripeCheckoutSessionId FROM ticket_purchase WHERE id = ? LIMIT 1',
    )
    .bind(purchaseId)
    .first<{
      id: string;
      participantId: string;
      ticketTypeId: string;
      paymentMethod: string;
      status: string;
      ticketPackId: string | null;
      stripeCheckoutSessionId: string | null;
    }>();
};

const countTicketPacksForParticipantAndType = async (participantId: string, ticketTypeId: string) => {
  const row = await d1
    .prepare(
      'SELECT COUNT(*) as count FROM ticket_pack WHERE participant_id = ? AND ticket_type_id = ?',
    )
    .bind(participantId, ticketTypeId)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
};

const selectBookingAuditActionCount = async (bookingId: string, action: string) => {
  const row = await d1
    .prepare('SELECT COUNT(*) as count FROM booking_audit_log WHERE booking_id = ? AND action = ?')
    .bind(bookingId, action)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
};

const listSlotStartsByRecurringSchedule = async (recurringScheduleId: string) => {
  const rows = await d1
    .prepare(
      'SELECT id, start_at as startAt, status FROM slot WHERE recurring_schedule_id = ? ORDER BY start_at asc',
    )
    .bind(recurringScheduleId)
    .all<{ id: string; startAt: number; status: string }>();

  return rows.results ?? [];
};

const signUpUser = async ({
  agent,
  name,
  email,
}: {
  agent: ReturnType<typeof createAuthAgent>;
  name: string;
  email: string;
}) => {
  const response = await agent.request('/api/v1/auth/sign-up', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name,
      email,
      password: 'password1234',
    }),
  });

  expect(response.status).toBe(200);
};

const createOrganization = async ({
  agent,
  name,
  slug,
}: {
  agent: ReturnType<typeof createAuthAgent>;
  name: string;
  slug: string;
}) => {
  const response = await agent.request('/api/v1/auth/organizations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name, slug }),
  });

  expect(response.status).toBe(200);
  const payload = (await toJson(response)) as { id?: unknown };
  expect(typeof payload?.id).toBe('string');
  return payload.id as string;
};

const selectOrganizationSlugById = async (organizationId: string) => {
  const row = await d1
    .prepare('SELECT slug FROM organization WHERE id = ? LIMIT 1')
    .bind(organizationId)
    .first<{ slug: string }>();
  return row?.slug ?? null;
};

const createInvitation = async ({
  agent,
  email,
  role,
  organizationId,
  resend,
}: {
  agent: ReturnType<typeof createAuthAgent>;
  email: string;
  role: 'admin' | 'member' | 'owner';
  organizationId: string;
  resend?: boolean;
}) => {
  const organizationSlug = await selectOrganizationSlugById(organizationId);
  expect(organizationSlug).toBeTruthy();

  const mappedRole = role === 'admin' ? 'manager' : role === 'member' ? 'staff' : 'owner';
  const response = await agent.request(
    `/api/v1/auth/orgs/${encodeURIComponent(
      organizationSlug as string,
    )}/classrooms/${encodeURIComponent(organizationSlug as string)}/invitations`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email,
        role: mappedRole,
        resend,
      }),
    },
  );

  return {
    response,
    payload: (await toJson(response)) as Record<string, unknown> | null,
  };
};

const createParticipantInvitation = async ({
  agent,
  email,
  participantName,
  organizationId,
  resend,
}: {
  agent: ReturnType<typeof createAuthAgent>;
  email: string;
  participantName: string;
  organizationId: string;
  resend?: boolean;
}) => {
  const organizationSlug = await selectOrganizationSlugById(organizationId);
  expect(organizationSlug).toBeTruthy();

  const response = await agent.request(
    `/api/v1/auth/orgs/${encodeURIComponent(
      organizationSlug as string,
    )}/classrooms/${encodeURIComponent(organizationSlug as string)}/invitations`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email,
        role: 'participant',
        participantName,
        resend,
      }),
    },
  );

  return {
    response,
    payload: (await toJson(response)) as Record<string, unknown> | null,
  };
};

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { async fetch() { return new Response("ok"); } }',
    d1Databases: ['DB'],
  });

  d1 = await mf.getD1Database('DB');
  const migrationDir = path.resolve(process.cwd(), 'drizzle');
  const migrationFiles = (await fs.readdir(migrationDir))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  for (const migrationFile of migrationFiles) {
    const migrationPath = path.join(migrationDir, migrationFile);
    const migrationSql = await fs.readFile(migrationPath, 'utf8');
    const statements = migrationSql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    for (const statement of statements) {
      await d1.prepare(statement).run();
    }
  }

  const authRuntime = createAuthRuntime({
    database: drizzle(d1),
    env: {
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
      BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
      PUBLIC_EVENTS_ORG_SLUG: 'public-events-org',
      PUBLIC_EVENTS_CLASSROOM_SLUG: 'public-events-org',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    },
  });

  app = createApp(authRuntime);
});

afterAll(async () => {
  await mf.dispose();
});

describe('backend app', () => {
  it('returns hello message at GET /', async () => {
    const response = await app.request('/');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Hono + Better Auth API');
  });

  it('returns health response at GET /api/health', async () => {
    const response = await app.request('/api/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('exposes RPC auth session endpoint', async () => {
    const response = await app.request('/api/v1/auth/session');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('null');
  });

  it('redirects Google OIDC start endpoint by default', async () => {
    const response = await app.request(
      '/api/v1/auth/oidc/google?callbackURL=http%3A%2F%2Flocalhost%3A5173%2F',
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('https://accounts.google.com/o/oauth2/v2/auth');
  });

  it('sets oauth_state cookie on Google OIDC start endpoint', async () => {
    const response = await app.request(
      '/api/v1/auth/oidc/google?callbackURL=http%3A%2F%2Flocalhost%3A5173%2F',
    );

    expect(response.status).toBe(302);
    const setCookies = getSetCookieValues(response);
    expect(setCookies.some((cookie) => /oauth_state=/.test(cookie))).toBe(true);
  });

  it('uses non-secure oauth_state cookie for local http development', async () => {
    const response = await app.request(
      '/api/v1/auth/oidc/google?callbackURL=http%3A%2F%2Flocalhost%3A5173%2F',
    );

    expect(response.status).toBe(302);
    const setCookies = getSetCookieValues(response);
    const oauthStateCookie = setCookies.find((cookie) => /oauth_state=/.test(cookie));
    expect(oauthStateCookie).toBeDefined();
    expect(oauthStateCookie).not.toContain('Secure');
  });

  it('keeps JSON response when disableRedirect=true for Google OIDC start endpoint', async () => {
    const response = await app.request(
      '/api/v1/auth/oidc/google?callbackURL=http%3A%2F%2Flocalhost%3A5173%2F&disableRedirect=true',
    );

    expect(response.status).toBe(200);

    const body = (await toJson(response)) as { redirect?: unknown; url?: unknown };
    expect(body.redirect).toBe(false);
    expect(typeof body.url).toBe('string');
    expect((body.url as string) || '').toContain('https://accounts.google.com/o/oauth2/v2/auth');
  });

  it('requires auth for organization endpoints', async () => {
    const response = await app.request('/api/v1/auth/organizations');

    expect(response.status).toBe(401);
  });

  it('requires auth for organization access endpoint', async () => {
    const response = await app.request('/api/v1/auth/orgs/access-tree');
    expect(response.status).toBe(401);
  });

  it('requires auth for invitation endpoints', async () => {
    const response = await app.request('/api/v1/auth/orgs/demo/classrooms/demo/invitations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'member@example.com',
        role: 'staff',
      }),
    });

    expect(response.status).toBe(401);
  });

  it('requires auth for invitation detail/reject endpoints', async () => {
    const detailResponse = await app.request(
      '/api/v1/auth/orgs/classrooms/invitations/detail?invitationId=dummy-id',
    );
    expect(detailResponse.status).toBe(401);

    const rejectResponse = await app.request('/api/v1/auth/orgs/classrooms/invitations/reject', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        invitationId: 'dummy-id',
      }),
    });

    expect(rejectResponse.status).toBe(401);
  });

  it('requires auth for participant invitation endpoints', async () => {
    const listResponse = await app.request('/api/v1/auth/orgs/demo/classrooms/demo/invitations');
    expect(listResponse.status).toBe(401);

    const createResponse = await app.request('/api/v1/auth/orgs/demo/classrooms/demo/invitations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'participant@example.com',
        role: 'participant',
        participantName: 'Participant',
      }),
    });
    expect(createResponse.status).toBe(401);

    const detailResponse = await app.request(
      '/api/v1/auth/orgs/classrooms/invitations/detail?invitationId=dummy-id',
    );
    expect(detailResponse.status).toBe(401);
  });

  it('handles invitation policies and audit logs', async () => {
    const inviter = createAuthAgent(app);
    await signUpUser({
      agent: inviter,
      name: 'Inviter',
      email: 'inviter@example.com',
    });

    const organizationId = await createOrganization({
      agent: inviter,
      name: 'Invite Org',
      slug: 'invite-org',
    });

    const ownerInvite = await createInvitation({
      agent: inviter,
      email: 'owner-target@example.com',
      role: 'owner',
      organizationId,
    });
    expect(ownerInvite.response.status).toBe(400);

    const created = await createInvitation({
      agent: inviter,
      email: 'invitee@example.com',
      role: 'admin',
      organizationId,
    });
    expect(created.response.status).toBe(200);
    expect(typeof created.payload?.id).toBe('string');

    const invitationId = created.payload?.id as string;
    expect(await selectInvitationActionCount(invitationId, 'invitation.created')).toBe(1);

    for (let index = 0; index < 3; index += 1) {
      const resent = await createInvitation({
        agent: inviter,
        email: 'invitee@example.com',
        role: 'admin',
        organizationId,
        resend: true,
      });

      expect(resent.response.status).toBe(200);
    }

    const resendLimit = await createInvitation({
      agent: inviter,
      email: 'invitee@example.com',
      role: 'admin',
      organizationId,
      resend: true,
    });
    expect(resendLimit.response.status).toBe(429);
    expect(await selectInvitationActionCount(invitationId, 'invitation.resent')).toBe(3);

    const invitee = createAuthAgent(app);
    await signUpUser({
      agent: invitee,
      name: 'Invitee',
      email: 'invitee@example.com',
    });

    const detailResponse = await invitee.request(
      `/api/v1/auth/orgs/classrooms/invitations/detail?invitationId=${encodeURIComponent(invitationId)}`,
    );
    expect(detailResponse.status).toBe(200);

    const acceptResponse = await invitee.request('/api/v1/auth/orgs/classrooms/invitations/accept', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        invitationId,
      }),
    });
    expect(acceptResponse.status).toBe(200);
    expect(await selectInvitationStatus(invitationId)).toBe('accepted');
    expect(await selectInvitationActionCount(invitationId, 'invitation.accepted')).toBe(1);

    const rejectTarget = await createInvitation({
      agent: inviter,
      email: 'rejectee@example.com',
      role: 'member',
      organizationId,
    });
    expect(rejectTarget.response.status).toBe(200);
    const rejectInvitationId = rejectTarget.payload?.id as string;

    const rejectee = createAuthAgent(app);
    await signUpUser({
      agent: rejectee,
      name: 'Rejectee',
      email: 'rejectee@example.com',
    });

    const rejectResponse = await rejectee.request('/api/v1/auth/orgs/classrooms/invitations/reject', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        invitationId: rejectInvitationId,
      }),
    });
    expect(rejectResponse.status).toBe(200);
    expect(await selectInvitationStatus(rejectInvitationId)).toBe('rejected');
    expect(await selectInvitationActionCount(rejectInvitationId, 'invitation.rejected')).toBe(1);

    const cancelTarget = await createInvitation({
      agent: inviter,
      email: 'cancel-target@example.com',
      role: 'member',
      organizationId,
    });
    expect(cancelTarget.response.status).toBe(200);
    const cancelInvitationId = cancelTarget.payload?.id as string;

    const cancelResponse = await inviter.request('/api/v1/auth/orgs/classrooms/invitations/cancel', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        invitationId: cancelInvitationId,
      }),
    });
    expect(cancelResponse.status).toBe(200);
    expect(await selectInvitationStatus(cancelInvitationId)).toBe('canceled');
    expect(await selectInvitationActionCount(cancelInvitationId, 'invitation.canceled')).toBe(1);
  });

  it('lists organization access for owner and participant-only user', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Access Owner',
      email: 'access-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Access Org',
      slug: 'access-org',
    });

    const participantInvite = await createParticipantInvitation({
      agent: owner,
      email: 'access-participant@example.com',
      participantName: 'Access Participant',
      organizationId,
    });
    expect(participantInvite.response.status).toBe(200);

    const participantUser = createAuthAgent(app);
    await signUpUser({
      agent: participantUser,
      name: 'Access Participant',
      email: 'access-participant@example.com',
    });
    const acceptParticipantInviteResponse = await participantUser.request(
      '/api/v1/auth/orgs/classrooms/invitations/accept',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId: participantInvite.payload?.id,
        }),
      },
    );
    expect(acceptParticipantInviteResponse.status).toBe(200);

    const ownerAccessResponse = await owner.request('/api/v1/auth/organizations/access');
    expect(ownerAccessResponse.status).toBe(200);
    const ownerAccessPayload = (await toJson(ownerAccessResponse)) as Array<Record<string, unknown>>;
    const ownerAccess = ownerAccessPayload.find((entry) => entry.organizationId === organizationId);
    expect(ownerAccess).toBeDefined();
    expect(ownerAccess?.role).toBe('owner');
    expect(ownerAccess?.classroomRole).toBe('manager');
    expect(ownerAccess?.canManage).toBe(true);
    expect(ownerAccess?.canUseParticipantBooking).toBe(false);

    const participantAccessResponse = await participantUser.request('/api/v1/auth/organizations/access');
    expect(participantAccessResponse.status).toBe(200);
    const participantAccessPayload = (await toJson(participantAccessResponse)) as Array<
      Record<string, unknown>
    >;
    const participantAccess = participantAccessPayload.find(
      (entry) => entry.organizationId === organizationId,
    );
    expect(participantAccess).toBeDefined();
    expect(participantAccess?.role).toBeNull();
    expect(participantAccess?.classroomRole).toBe('participant');
    expect(participantAccess?.canManage).toBe(false);
    expect(participantAccess?.canUseParticipantBooking).toBe(true);

    const ownerAccessTreeResponse = await owner.request('/api/v1/auth/orgs/access-tree');
    expect(ownerAccessTreeResponse.status).toBe(200);
    const ownerAccessTreePayload = (await toJson(ownerAccessTreeResponse)) as {
      orgs?: Array<{
        org?: { id?: string; slug?: string; name?: string; logo?: string | null };
        orgRole?: string | null;
        classrooms?: Array<{
          id?: string;
          slug?: string;
          name?: string;
          role?: string | null;
          canManage?: boolean;
          canUseParticipantBooking?: boolean;
        }>;
      }>;
    };
    const ownerOrgEntry = ownerAccessTreePayload.orgs?.find(
      (entry) => entry.org?.id === organizationId,
    );
    expect(ownerOrgEntry).toBeDefined();
    expect(ownerOrgEntry?.orgRole).toBe('owner');
    expect(ownerOrgEntry?.org?.slug).toBe('access-org');
    expect(ownerOrgEntry?.classrooms?.[0]?.slug).toBe('access-org');
    expect(ownerOrgEntry?.classrooms?.[0]?.role).toBe('manager');
    expect(ownerOrgEntry?.classrooms?.[0]?.canManage).toBe(true);
  });

  it('supports multiple classrooms in access-tree and scoped service routes', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Multi Classroom Owner',
      email: 'multi-classroom-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Multi Classroom Org',
      slug: 'multi-classroom-org',
    });
    const organizationSlug = await selectOrganizationSlugById(organizationId);
    expect(organizationSlug).toBe('multi-classroom-org');

    const secondClassroomId = crypto.randomUUID();
    const secondClassroomSlug = 'room-b';
    await d1
      .prepare('INSERT INTO classroom (id, organization_id, slug, name) VALUES (?, ?, ?, ?)')
      .bind(secondClassroomId, organizationId, secondClassroomSlug, 'Room B')
      .run();

    const defaultServiceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        name: 'Default Classroom Service',
        description: 'default classroom service',
        kind: 'single',
        bookingPolicy: 'instant',
        durationMinutes: 45,
        capacity: 4,
      }),
    });
    expect(defaultServiceResponse.status).toBe(200);
    const defaultServicePayload = (await toJson(defaultServiceResponse)) as Record<string, unknown>;

    const scopedServiceResponse = await owner.request(
      `/api/v1/auth/orgs/${encodeURIComponent(
        organizationSlug as string,
      )}/classrooms/${encodeURIComponent(secondClassroomSlug)}/services`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Room B Service',
          description: 'second classroom service',
          kind: 'single',
          bookingPolicy: 'instant',
          durationMinutes: 30,
          capacity: 2,
        }),
      },
    );
    expect(scopedServiceResponse.status).toBe(200);
    const scopedServicePayload = (await toJson(scopedServiceResponse)) as Record<string, unknown>;
    expect(scopedServicePayload.classroomId).toBe(secondClassroomId);

    const accessTreeResponse = await owner.request('/api/v1/auth/orgs/access-tree');
    expect(accessTreeResponse.status).toBe(200);
    const accessTreePayload = (await toJson(accessTreeResponse)) as {
      orgs?: Array<{
        org?: { id?: string; slug?: string };
        classrooms?: Array<{
          id?: string;
          slug?: string;
          role?: string | null;
          canManage?: boolean;
        }>;
      }>;
    };
    const orgEntry = accessTreePayload.orgs?.find((entry) => entry.org?.id === organizationId);
    expect(orgEntry?.classrooms?.map((classroom) => classroom.slug)).toEqual(
      expect.arrayContaining(['multi-classroom-org', secondClassroomSlug]),
    );
    const secondClassroomEntry = orgEntry?.classrooms?.find(
      (classroom) => classroom.slug === secondClassroomSlug,
    );
    expect(secondClassroomEntry?.id).toBe(secondClassroomId);
    expect(secondClassroomEntry?.role).toBe('manager');
    expect(secondClassroomEntry?.canManage).toBe(true);

    const defaultScopedListResponse = await owner.request(
      `/api/v1/auth/orgs/${encodeURIComponent(
        organizationSlug as string,
      )}/classrooms/${encodeURIComponent(organizationSlug as string)}/services`,
    );
    expect(defaultScopedListResponse.status).toBe(200);
    const defaultScopedList = (await toJson(defaultScopedListResponse)) as Array<Record<string, unknown>>;
    expect(defaultScopedList).toHaveLength(1);
    expect(defaultScopedList[0]?.id).toBe(defaultServicePayload.id);
    expect(defaultScopedList[0]?.classroomId).not.toBe(secondClassroomId);

    const secondScopedListResponse = await owner.request(
      `/api/v1/auth/orgs/${encodeURIComponent(
        organizationSlug as string,
      )}/classrooms/${encodeURIComponent(secondClassroomSlug)}/services`,
    );
    expect(secondScopedListResponse.status).toBe(200);
    const secondScopedList = (await toJson(secondScopedListResponse)) as Array<Record<string, unknown>>;
    expect(secondScopedList).toHaveLength(1);
    expect(secondScopedList[0]?.id).toBe(scopedServicePayload.id);
    expect(secondScopedList[0]?.classroomId).toBe(secondClassroomId);
  });

  it('handles participant invitation flows and permissions', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Owner',
      email: 'participant-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Participant Org',
      slug: 'participant-org',
    });

    const adminInvite = await createInvitation({
      agent: owner,
      email: 'participant-admin@example.com',
      role: 'admin',
      organizationId,
    });
    expect(adminInvite.response.status).toBe(200);
    const adminInvitationId = adminInvite.payload?.id as string;

    const memberInvite = await createInvitation({
      agent: owner,
      email: 'participant-member@example.com',
      role: 'member',
      organizationId,
    });
    expect(memberInvite.response.status).toBe(200);
    const memberInvitationId = memberInvite.payload?.id as string;

    const admin = createAuthAgent(app);
    await signUpUser({
      agent: admin,
      name: 'Participant Admin',
      email: 'participant-admin@example.com',
    });
    const acceptAdminInviteResponse = await admin.request('/api/v1/auth/orgs/classrooms/invitations/accept', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        invitationId: adminInvitationId,
      }),
    });
    expect(acceptAdminInviteResponse.status).toBe(200);

    const member = createAuthAgent(app);
    await signUpUser({
      agent: member,
      name: 'Participant Member',
      email: 'participant-member@example.com',
    });
    const acceptMemberInviteResponse = await member.request('/api/v1/auth/orgs/classrooms/invitations/accept', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        invitationId: memberInvitationId,
      }),
    });
    expect(acceptMemberInviteResponse.status).toBe(200);

    const staffCreate = await createParticipantInvitation({
      agent: member,
      email: 'participant-staff-created@example.com',
      participantName: 'Staff Created Participant',
      organizationId,
    });
    expect(staffCreate.response.status).toBe(200);

    const created = await createParticipantInvitation({
      agent: admin,
      email: 'participant-user@example.com',
      participantName: 'Participant User',
      organizationId,
    });
    expect(created.response.status).toBe(200);
    expect(typeof created.payload?.id).toBe('string');
    const participantInvitationId = created.payload?.id as string;
    expect(await selectParticipantInvitationActionCount(participantInvitationId, 'participant-invitation.created')).toBe(
      1,
    );

    const duplicate = await createParticipantInvitation({
      agent: admin,
      email: 'participant-user@example.com',
      participantName: 'Participant User',
      organizationId,
    });
    expect(duplicate.response.status).toBe(409);

    for (let index = 0; index < 3; index += 1) {
      const resent = await createParticipantInvitation({
        agent: admin,
        email: 'participant-user@example.com',
        participantName: 'Participant User',
        organizationId,
        resend: true,
      });
      expect(resent.response.status).toBe(200);
    }

    const resendLimit = await createParticipantInvitation({
      agent: admin,
      email: 'participant-user@example.com',
      participantName: 'Participant User',
      organizationId,
      resend: true,
    });
    expect(resendLimit.response.status).toBe(429);
    expect(await selectParticipantInvitationActionCount(participantInvitationId, 'participant-invitation.resent')).toBe(
      3,
    );

    const otherUser = createAuthAgent(app);
    await signUpUser({
      agent: otherUser,
      name: 'Other User',
      email: 'participant-other@example.com',
    });

    const forbiddenDetail = await otherUser.request(
      `/api/v1/auth/orgs/classrooms/invitations/detail?invitationId=${encodeURIComponent(participantInvitationId)}`,
    );
    expect(forbiddenDetail.status).toBe(403);

    const forbiddenAccept = await otherUser.request(
      '/api/v1/auth/orgs/classrooms/invitations/accept',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId: participantInvitationId,
        }),
      },
    );
    expect(forbiddenAccept.status).toBe(403);

    const forbiddenReject = await otherUser.request(
      '/api/v1/auth/orgs/classrooms/invitations/reject',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId: participantInvitationId,
        }),
      },
    );
    expect(forbiddenReject.status).toBe(403);

    const participantUser = createAuthAgent(app);
    await signUpUser({
      agent: participantUser,
      name: 'Participant User',
      email: 'participant-user@example.com',
    });

    const detailResponse = await participantUser.request(
      `/api/v1/auth/orgs/classrooms/invitations/detail?invitationId=${encodeURIComponent(participantInvitationId)}`,
    );
    expect(detailResponse.status).toBe(200);

    const acceptResponse = await participantUser.request(
      '/api/v1/auth/orgs/classrooms/invitations/accept',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId: participantInvitationId,
        }),
      },
    );
    expect(acceptResponse.status).toBe(200);
    expect(await selectParticipantInvitationStatus(participantInvitationId)).toBe('accepted');
    expect(await selectParticipantInvitationActionCount(participantInvitationId, 'participant-invitation.accepted')).toBe(
      1,
    );
    expect(await selectParticipantCountByEmail(organizationId, 'participant-user@example.com')).toBe(1);

    const rejectTarget = await createParticipantInvitation({
      agent: admin,
      email: 'participant-reject@example.com',
      participantName: 'Participant Reject',
      organizationId,
    });
    expect(rejectTarget.response.status).toBe(200);
    const rejectInvitationId = rejectTarget.payload?.id as string;

    const rejectUser = createAuthAgent(app);
    await signUpUser({
      agent: rejectUser,
      name: 'Reject User',
      email: 'participant-reject@example.com',
    });

    const rejectResponse = await rejectUser.request(
      '/api/v1/auth/orgs/classrooms/invitations/reject',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId: rejectInvitationId,
        }),
      },
    );
    expect(rejectResponse.status).toBe(200);
    expect(await selectParticipantInvitationStatus(rejectInvitationId)).toBe('rejected');
    expect(await selectParticipantInvitationActionCount(rejectInvitationId, 'participant-invitation.rejected')).toBe(
      1,
    );

    const cancelTarget = await createParticipantInvitation({
      agent: admin,
      email: 'participant-cancel@example.com',
      participantName: 'Participant Cancel',
      organizationId,
    });
    expect(cancelTarget.response.status).toBe(200);
    const cancelInvitationId = cancelTarget.payload?.id as string;

    const cancelResponse = await admin.request(
      '/api/v1/auth/orgs/classrooms/invitations/cancel',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId: cancelInvitationId,
        }),
      },
    );
    expect(cancelResponse.status).toBe(200);
    expect(await selectParticipantInvitationStatus(cancelInvitationId)).toBe('canceled');
    expect(await selectParticipantInvitationActionCount(cancelInvitationId, 'participant-invitation.canceled')).toBe(
      1,
    );

    const participantListResponse = await admin.request(
      `/api/v1/auth/organizations/participants?organizationId=${encodeURIComponent(organizationId)}`,
    );
    expect(participantListResponse.status).toBe(200);

    const invitationListResponse = await admin.request(
      `/api/v1/auth/organizations/participants/invitations?organizationId=${encodeURIComponent(organizationId)}`,
    );
    expect(invitationListResponse.status).toBe(200);
  });

  it('requires auth for booking domain endpoints', async () => {
    const targets: Array<{
      path: string;
      method: 'GET' | 'POST';
      body?: Record<string, unknown>;
    }> = [
      { path: '/api/v1/auth/organizations/services', method: 'GET' },
      {
        path: '/api/v1/auth/organizations/services',
        method: 'POST',
        body: {
          organizationId: 'dummy-org',
          name: 'Dummy',
          kind: 'single',
          durationMinutes: 60,
          capacity: 1,
        },
      },
      {
        path: `/api/v1/auth/organizations/slots?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 60 * 60 * 1000).toISOString())}`,
        method: 'GET',
      },
      {
        path: `/api/v1/auth/organizations/slots/available?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 60 * 60 * 1000).toISOString())}`,
        method: 'GET',
      },
      {
        path: '/api/v1/auth/organizations/slots/update',
        method: 'POST',
        body: {
          slotId: 'dummy-slot',
          startAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          endAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        },
      },
      {
        path: '/api/v1/auth/organizations/bookings',
        method: 'POST',
        body: {
          slotId: 'dummy-slot',
        },
      },
      {
        path: '/api/v1/auth/organizations/participants/self-enroll',
        method: 'POST',
        body: {
          organizationId: 'dummy-org',
        },
      },
      { path: '/api/v1/auth/organizations/bookings/mine', method: 'GET' },
      {
        path: '/api/v1/auth/organizations/bookings/cancel',
        method: 'POST',
        body: {
          bookingId: 'dummy-booking',
        },
      },
      {
        path: '/api/v1/auth/organizations/bookings/cancel-by-staff',
        method: 'POST',
        body: {
          bookingId: 'dummy-booking',
        },
      },
      {
        path: '/api/v1/auth/organizations/bookings/approve',
        method: 'POST',
        body: {
          bookingId: 'dummy-booking',
        },
      },
      {
        path: '/api/v1/auth/organizations/bookings/reject',
        method: 'POST',
        body: {
          bookingId: 'dummy-booking',
        },
      },
      {
        path: '/api/v1/auth/organizations/bookings/no-show',
        method: 'POST',
        body: {
          bookingId: 'dummy-booking',
        },
      },
      { path: '/api/v1/auth/organizations/ticket-types', method: 'GET' },
      { path: '/api/v1/auth/organizations/ticket-types/purchasable', method: 'GET' },
      { path: '/api/v1/auth/organizations/ticket-packs/mine', method: 'GET' },
      { path: '/api/v1/auth/organizations/ticket-purchases', method: 'GET' },
      {
        path: '/api/v1/auth/organizations/ticket-purchases',
        method: 'POST',
        body: {
          ticketTypeId: 'dummy-ticket-type',
          paymentMethod: 'stripe',
        },
      },
      { path: '/api/v1/auth/organizations/ticket-purchases/mine', method: 'GET' },
      {
        path: '/api/v1/auth/organizations/ticket-purchases/approve',
        method: 'POST',
        body: {
          purchaseId: 'dummy-purchase',
        },
      },
      {
        path: '/api/v1/auth/organizations/ticket-purchases/reject',
        method: 'POST',
        body: {
          purchaseId: 'dummy-purchase',
        },
      },
      {
        path: '/api/v1/auth/organizations/ticket-purchases/cancel',
        method: 'POST',
        body: {
          purchaseId: 'dummy-purchase',
        },
      },
      { path: '/api/v1/auth/organizations/recurring-schedules', method: 'GET' },
    ];

    for (const target of targets) {
      const response = await app.request(target.path, {
        method: target.method,
        headers: {
          'content-type': 'application/json',
        },
        ...(target.body ? { body: JSON.stringify(target.body) } : {}),
      });
      expect(response.status).toBe(401);
    }
  });

  it('lists public events and supports self-enroll before booking', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Public Owner',
      email: 'public-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Public Events Org',
      slug: 'public-events-org',
    });

    const serviceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        name: 'Public Event Service',
        description: '公開向けのサービス説明テキストです。',
        kind: 'single',
        bookingPolicy: 'instant',
        durationMinutes: 60,
        capacity: 3,
      }),
    });
    expect(serviceResponse.status).toBe(200);
    const servicePayload = (await toJson(serviceResponse)) as Record<string, unknown>;
    const serviceId = servicePayload.id as string;

    const slotStartAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const slotEndAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    const slotResponse = await owner.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: slotStartAt,
        endAt: slotEndAt,
      }),
    });
    expect(slotResponse.status).toBe(200);
    const slotPayload = (await toJson(slotResponse)) as Record<string, unknown>;
    const slotId = slotPayload.id as string;

    const publicEventsResponse = await app.request(
      '/api/v1/public/orgs/public-events-org/classrooms/public-events-org/events',
    );
    expect(publicEventsResponse.status).toBe(200);
    const publicEventsPayload = (await toJson(publicEventsResponse)) as Array<Record<string, unknown>>;
    const publicEvent = publicEventsPayload.find((row) => row.slotId === slotId);
    expect(publicEvent).toBeTruthy();
    expect(publicEvent?.serviceDescription).toBe('公開向けのサービス説明テキストです。');

    const publicEventDetailResponse = await app.request(
      `/api/v1/public/orgs/public-events-org/classrooms/public-events-org/events/${encodeURIComponent(slotId)}`,
    );
    expect(publicEventDetailResponse.status).toBe(200);
    const publicEventDetail = (await toJson(publicEventDetailResponse)) as Record<string, unknown>;
    expect(publicEventDetail.slotId).toBe(slotId);
    expect(publicEventDetail.organizationId).toBe(organizationId);
    expect(publicEventDetail.serviceDescription).toBe('公開向けのサービス説明テキストです。');

    const unauthSelfEnrollResponse = await app.request(
      '/api/v1/auth/organizations/participants/self-enroll',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          organizationId,
        }),
      },
    );
    expect(unauthSelfEnrollResponse.status).toBe(401);

    const participantUser = createAuthAgent(app);
    await signUpUser({
      agent: participantUser,
      name: 'Self Enroll User',
      email: 'self-enroll-user@example.com',
    });

    const bookingBeforeSelfEnrollResponse = await participantUser.request(
      '/api/v1/auth/organizations/bookings',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          slotId,
        }),
      },
    );
    expect(bookingBeforeSelfEnrollResponse.status).toBe(403);

    const forbiddenSelfEnrollResponse = await participantUser.request(
      '/api/v1/auth/organizations/participants/self-enroll',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          organizationId: 'another-org',
        }),
      },
    );
    expect(forbiddenSelfEnrollResponse.status).toBe(403);

    const firstSelfEnrollResponse = await participantUser.request(
      '/api/v1/auth/organizations/participants/self-enroll',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          organizationId,
        }),
      },
    );
    expect(firstSelfEnrollResponse.status).toBe(200);
    const firstSelfEnrollPayload = (await toJson(firstSelfEnrollResponse)) as Record<string, unknown>;
    expect(firstSelfEnrollPayload.created).toBe(true);

    const secondSelfEnrollResponse = await participantUser.request(
      '/api/v1/auth/organizations/participants/self-enroll',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          organizationId,
        }),
      },
    );
    expect(secondSelfEnrollResponse.status).toBe(200);
    const secondSelfEnrollPayload = (await toJson(secondSelfEnrollResponse)) as Record<string, unknown>;
    expect(secondSelfEnrollPayload.created).toBe(false);
    expect(await selectParticipantCountByEmail(organizationId, 'self-enroll-user@example.com')).toBe(1);

    const bookingAfterSelfEnrollResponse = await participantUser.request(
      '/api/v1/auth/organizations/bookings',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          slotId,
        }),
      },
    );
    expect([200, 409]).toContain(bookingAfterSelfEnrollResponse.status);
  });

  it('validates service name/description limits and normalizes description on update', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Service Rule Owner',
      email: 'service-rule-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Service Rule Org',
      slug: 'service-rule-org',
    });

    const validServiceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        name: '名'.repeat(120),
        description: '説'.repeat(500),
        kind: 'single',
        durationMinutes: 60,
        capacity: 5,
      }),
    });
    expect(validServiceResponse.status).toBe(200);
    const validServicePayload = (await toJson(validServiceResponse)) as Record<string, unknown>;
    const serviceId = validServicePayload.id as string;
    expect(validServicePayload.description).toBe('説'.repeat(500));

    const tooLongNameResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        name: '名'.repeat(121),
        kind: 'single',
        durationMinutes: 60,
        capacity: 5,
      }),
    });
    expect([400, 422]).toContain(tooLongNameResponse.status);

    const tooLongDescriptionResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        name: '文字制限チェック',
        description: '説'.repeat(501),
        kind: 'single',
        durationMinutes: 60,
        capacity: 5,
      }),
    });
    expect([400, 422]).toContain(tooLongDescriptionResponse.status);

    const updateDescriptionResponse = await owner.request('/api/v1/auth/organizations/services/update', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        serviceId,
        description: '   ',
      }),
    });
    expect(updateDescriptionResponse.status).toBe(200);
    const updateDescriptionPayload = (await toJson(updateDescriptionResponse)) as Record<string, unknown>;
    expect(updateDescriptionPayload.description).toBeNull();
  });

  it('updates slot with guard conditions and recalculates booking window', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Slot Update Owner',
      email: 'slot-update-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Slot Update Org',
      slug: 'slot-update-org',
    });

    const participantInvite = await createParticipantInvitation({
      agent: owner,
      email: 'slot-update-participant@example.com',
      participantName: 'Slot Update Participant',
      organizationId,
    });
    expect(participantInvite.response.status).toBe(200);

    const participantUser = createAuthAgent(app);
    await signUpUser({
      agent: participantUser,
      name: 'Slot Update Participant',
      email: 'slot-update-participant@example.com',
    });
    const participantAcceptResponse = await participantUser.request(
      '/api/v1/auth/orgs/classrooms/invitations/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invitationId: participantInvite.payload?.id,
        }),
      },
    );
    expect(participantAcceptResponse.status).toBe(200);

    const serviceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        name: 'Slot Update Service',
        kind: 'single',
        bookingPolicy: 'instant',
        durationMinutes: 60,
        capacity: 8,
        bookingOpenMinutesBefore: 120,
        bookingCloseMinutesBefore: 30,
      }),
    });
    expect(serviceResponse.status).toBe(200);
    const servicePayload = (await toJson(serviceResponse)) as Record<string, unknown>;
    const serviceId = servicePayload.id as string;

    const firstStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const firstEnd = new Date(firstStart.getTime() + 60 * 60 * 1000);
    const firstSlotResponse = await owner.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: firstStart.toISOString(),
        endAt: firstEnd.toISOString(),
      }),
    });
    expect(firstSlotResponse.status).toBe(200);
    const firstSlotPayload = (await toJson(firstSlotResponse)) as Record<string, unknown>;
    const firstSlotId = firstSlotPayload.id as string;

    const updatedStart = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const updatedEnd = new Date(updatedStart.getTime() + 90 * 60 * 1000);
    const updateResponse = await owner.request('/api/v1/auth/organizations/slots/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: firstSlotId,
        startAt: updatedStart.toISOString(),
        endAt: updatedEnd.toISOString(),
        capacity: 12,
        staffLabel: '  Coach  ',
        locationLabel: '  Room A  ',
      }),
    });
    expect(updateResponse.status).toBe(200);
    const updatePayload = (await toJson(updateResponse)) as Record<string, unknown>;
    expect(updatePayload.capacity).toBe(12);
    expect(updatePayload.staffLabel).toBe('Coach');
    expect(updatePayload.locationLabel).toBe('Room A');
    expect(updatePayload.bookingOpenAt).toBe(
      new Date(updatedStart.getTime() - 120 * 60 * 1000).toISOString(),
    );
    expect(updatePayload.bookingCloseAt).toBe(
      new Date(updatedStart.getTime() - 30 * 60 * 1000).toISOString(),
    );

    const invalidRangeResponse = await owner.request('/api/v1/auth/organizations/slots/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: firstSlotId,
        startAt: updatedStart.toISOString(),
        endAt: updatedStart.toISOString(),
      }),
    });
    expect(invalidRangeResponse.status).toBe(422);

    const canceledStart = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    const canceledEnd = new Date(canceledStart.getTime() + 60 * 60 * 1000);
    const canceledSlotResponse = await owner.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: canceledStart.toISOString(),
        endAt: canceledEnd.toISOString(),
      }),
    });
    expect(canceledSlotResponse.status).toBe(200);
    const canceledSlotPayload = (await toJson(canceledSlotResponse)) as Record<string, unknown>;
    const canceledSlotId = canceledSlotPayload.id as string;

    const cancelSlotResponse = await owner.request('/api/v1/auth/organizations/slots/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: canceledSlotId,
      }),
    });
    expect(cancelSlotResponse.status).toBe(200);

    const updateCanceledSlotResponse = await owner.request('/api/v1/auth/organizations/slots/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: canceledSlotId,
        startAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        endAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(updateCanceledSlotResponse.status).toBe(409);

    const reservedStart = new Date(Date.now() + 90 * 60 * 1000);
    const reservedEnd = new Date(reservedStart.getTime() + 60 * 60 * 1000);
    const reservedSlotResponse = await owner.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: reservedStart.toISOString(),
        endAt: reservedEnd.toISOString(),
      }),
    });
    expect(reservedSlotResponse.status).toBe(200);
    const reservedSlotPayload = (await toJson(reservedSlotResponse)) as Record<string, unknown>;
    const reservedSlotId = reservedSlotPayload.id as string;

    const reservedBookingResponse = await participantUser.request('/api/v1/auth/organizations/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: reservedSlotId,
      }),
    });
    expect(reservedBookingResponse.status).toBe(200);

    const updateReservedSlotResponse = await owner.request('/api/v1/auth/organizations/slots/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: reservedSlotId,
        startAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(updateReservedSlotResponse.status).toBe(409);

    const startedStart = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const startedEnd = new Date(startedStart.getTime() + 60 * 60 * 1000);
    const startedSlotResponse = await owner.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: startedStart.toISOString(),
        endAt: startedEnd.toISOString(),
      }),
    });
    expect(startedSlotResponse.status).toBe(200);
    const startedSlotPayload = (await toJson(startedSlotResponse)) as Record<string, unknown>;
    const startedSlotId = startedSlotPayload.id as string;

    await d1
      .prepare('UPDATE slot SET start_at = ?, end_at = ? WHERE id = ?')
      .bind(Date.now() - 10 * 60 * 1000, Date.now() + 20 * 60 * 1000, startedSlotId)
      .run();

    const updateStartedSlotResponse = await owner.request('/api/v1/auth/organizations/slots/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: startedSlotId,
        startAt: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString(),
        endAt: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(updateStartedSlotResponse.status).toBe(409);
  });

  it('handles booking and ticket flows with permissions', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Booking Owner',
      email: 'booking-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Booking Org',
      slug: 'booking-org',
    });

    const adminInvite = await createInvitation({
      agent: owner,
      email: 'booking-admin@example.com',
      role: 'admin',
      organizationId,
    });
    const memberInvite = await createInvitation({
      agent: owner,
      email: 'booking-member@example.com',
      role: 'member',
      organizationId,
    });

    const admin = createAuthAgent(app);
    await signUpUser({
      agent: admin,
      name: 'Booking Admin',
      email: 'booking-admin@example.com',
    });
    const acceptAdminResponse = await admin.request('/api/v1/auth/orgs/classrooms/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        invitationId: adminInvite.payload?.id,
      }),
    });
    expect(acceptAdminResponse.status).toBe(200);

    const member = createAuthAgent(app);
    await signUpUser({
      agent: member,
      name: 'Booking Member',
      email: 'booking-member@example.com',
    });
    const acceptMemberResponse = await member.request('/api/v1/auth/orgs/classrooms/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        invitationId: memberInvite.payload?.id,
      }),
    });
    expect(acceptMemberResponse.status).toBe(200);

    const participantInvite = await createParticipantInvitation({
      agent: admin,
      email: 'booking-participant@example.com',
      participantName: 'Booking Participant',
      organizationId,
    });
    expect(participantInvite.response.status).toBe(200);

    const participantUser = createAuthAgent(app);
    await signUpUser({
      agent: participantUser,
      name: 'Booking Participant',
      email: 'booking-participant@example.com',
    });
    const participantAcceptResponse = await participantUser.request(
      '/api/v1/auth/orgs/classrooms/invitations/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invitationId: participantInvite.payload?.id,
        }),
      },
    );
    expect(participantAcceptResponse.status).toBe(200);

    const forbiddenServiceCreate = await member.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        name: 'Forbidden Service',
        kind: 'single',
        durationMinutes: 60,
        capacity: 5,
      }),
    });
    expect(forbiddenServiceCreate.status).toBe(403);

    const serviceCreateResponse = await admin.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        name: 'Ticket Class',
        kind: 'single',
        durationMinutes: 60,
        capacity: 2,
        cancellationDeadlineMinutes: 60,
        requiresTicket: true,
      }),
    });
    expect(serviceCreateResponse.status).toBe(200);
    const servicePayload = (await toJson(serviceCreateResponse)) as Record<string, unknown>;
    const serviceId = servicePayload.id as string;

    const ticketTypeCreateResponse = await admin.request('/api/v1/auth/organizations/ticket-types', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        name: '3 Tickets',
        totalCount: 3,
        serviceIds: [serviceId],
      }),
    });
    expect(ticketTypeCreateResponse.status).toBe(200);
    const ticketTypePayload = (await toJson(ticketTypeCreateResponse)) as Record<string, unknown>;
    const ticketTypeId = ticketTypePayload.id as string;

    const participantId = await selectParticipantIdByEmail(organizationId, 'booking-participant@example.com');
    expect(participantId).toBeTruthy();

    const grantTicketResponse = await admin.request('/api/v1/auth/organizations/ticket-packs/grant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        participantId,
        ticketTypeId,
        count: 3,
      }),
    });
    expect(grantTicketResponse.status).toBe(200);
    const grantPayload = (await toJson(grantTicketResponse)) as Record<string, unknown>;
    const ticketPackId = grantPayload.id as string;

    const startAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    const slotCreateResponse = await admin.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      }),
    });
    expect(slotCreateResponse.status).toBe(200);
    const slotPayload = (await toJson(slotCreateResponse)) as Record<string, unknown>;
    const slotId = slotPayload.id as string;

    const availableSlotsResponse = await participantUser.request(
      `/api/v1/auth/organizations/slots/available?organizationId=${encodeURIComponent(
        organizationId,
      )}&from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(
        new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      )}`,
    );
    expect(availableSlotsResponse.status).toBe(200);

    const bookingCreateResponse = await participantUser.request('/api/v1/auth/organizations/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId,
      }),
    });
    const bookingCreatePayload = (await toJson(bookingCreateResponse)) as Record<string, unknown>;
    expect(bookingCreateResponse.status, JSON.stringify(bookingCreatePayload)).toBe(200);
    const bookingPayload = bookingCreatePayload;
    const bookingId = bookingPayload.id as string;
    expect(await selectSlotReservedCount(slotId)).toBe(1);
    expect(await selectTicketPackRemaining(ticketPackId)).toBe(2);
    expect(await selectTicketLedgerActionCount(ticketPackId, 'consume')).toBe(1);
    expect(await selectBookingAuditActionCount(bookingId, 'booking.created')).toBe(1);

    const duplicateBookingResponse = await participantUser.request('/api/v1/auth/organizations/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId,
      }),
    });
    expect(duplicateBookingResponse.status).toBe(409);

    const cancelBookingResponse = await participantUser.request('/api/v1/auth/organizations/bookings/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId,
      }),
    });
    expect(cancelBookingResponse.status).toBe(200);
    expect(await selectBookingStatus(bookingId)).toBe('cancelled_by_participant');
    expect(await selectSlotReservedCount(slotId)).toBe(0);
    expect(await selectTicketPackRemaining(ticketPackId)).toBe(3);
    expect(await selectTicketLedgerActionCount(ticketPackId, 'restore')).toBe(1);
    expect(await selectBookingAuditActionCount(bookingId, 'booking.cancelled_by_participant')).toBe(1);

    const nearStart = new Date(Date.now() + 30 * 60 * 1000);
    const nearEnd = new Date(nearStart.getTime() + 60 * 60 * 1000);
    const nearSlotCreateResponse = await admin.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: nearStart.toISOString(),
        endAt: nearEnd.toISOString(),
      }),
    });
    expect(nearSlotCreateResponse.status).toBe(200);
    const nearSlotPayload = (await toJson(nearSlotCreateResponse)) as Record<string, unknown>;
    const nearSlotId = nearSlotPayload.id as string;

    const secondBookingResponse = await participantUser.request('/api/v1/auth/organizations/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: nearSlotId,
      }),
    });
    expect(secondBookingResponse.status).toBe(200);
    const secondBookingPayload = (await toJson(secondBookingResponse)) as Record<string, unknown>;
    const secondBookingId = secondBookingPayload.id as string;
    expect(await selectTicketPackRemaining(ticketPackId)).toBe(2);

    const lateCancelResponse = await participantUser.request('/api/v1/auth/organizations/bookings/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: secondBookingId,
      }),
    });
    expect(lateCancelResponse.status).toBe(409);

    const staffCancelResponse = await admin.request('/api/v1/auth/organizations/bookings/cancel-by-staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: secondBookingId,
      }),
    });
    expect(staffCancelResponse.status).toBe(200);
    expect(await selectBookingStatus(secondBookingId)).toBe('cancelled_by_staff');
    expect(await selectTicketPackRemaining(ticketPackId)).toBe(2);
    expect(await selectBookingAuditActionCount(secondBookingId, 'booking.cancelled_by_staff')).toBe(1);

    const thirdStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const thirdEnd = new Date(thirdStart.getTime() + 60 * 60 * 1000);
    const thirdSlotCreateResponse = await admin.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: thirdStart.toISOString(),
        endAt: thirdEnd.toISOString(),
      }),
    });
    expect(thirdSlotCreateResponse.status).toBe(200);
    const thirdSlotPayload = (await toJson(thirdSlotCreateResponse)) as Record<string, unknown>;
    const thirdSlotId = thirdSlotPayload.id as string;

    const thirdBookingResponse = await participantUser.request('/api/v1/auth/organizations/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: thirdSlotId,
      }),
    });
    expect(thirdBookingResponse.status).toBe(200);
    const thirdBookingPayload = (await toJson(thirdBookingResponse)) as Record<string, unknown>;
    const thirdBookingId = thirdBookingPayload.id as string;

    const noShowResponse = await admin.request('/api/v1/auth/organizations/bookings/no-show', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: thirdBookingId,
      }),
    });
    expect(noShowResponse.status).toBe(200);
    expect(await selectBookingStatus(thirdBookingId)).toBe('no_show');
    expect(await selectBookingAuditActionCount(thirdBookingId, 'booking.no_show')).toBe(1);

    const noShowTwiceResponse = await admin.request('/api/v1/auth/organizations/bookings/no-show', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: thirdBookingId,
      }),
    });
    expect(noShowTwiceResponse.status).toBe(409);
  });

  it('handles ticket purchase approval, rejection and participant cancel flows', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Ticket Purchase Owner',
      email: 'ticket-purchase-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Ticket Purchase Org',
      slug: 'ticket-purchase-org',
    });

    const participantInvite = await createParticipantInvitation({
      agent: owner,
      email: 'ticket-purchase-participant@example.com',
      participantName: 'Ticket Purchase Participant',
      organizationId,
    });
    expect(participantInvite.response.status).toBe(200);

    const participantUser = createAuthAgent(app);
    await signUpUser({
      agent: participantUser,
      name: 'Ticket Purchase Participant',
      email: 'ticket-purchase-participant@example.com',
    });
    const participantAcceptResponse = await participantUser.request(
      '/api/v1/auth/orgs/classrooms/invitations/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invitationId: participantInvite.payload?.id,
        }),
      },
    );
    expect(participantAcceptResponse.status).toBe(200);

    const ticketTypeCreateResponse = await owner.request('/api/v1/auth/organizations/ticket-types', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        name: 'Purchase Ticket',
        totalCount: 5,
        isForSale: true,
        stripePriceId: 'price_test_purchase',
      }),
    });
    expect(ticketTypeCreateResponse.status).toBe(200);
    const ticketTypePayload = (await toJson(ticketTypeCreateResponse)) as Record<string, unknown>;
    const ticketTypeId = ticketTypePayload.id as string;

    const participantId = await selectParticipantIdByEmail(
      organizationId,
      'ticket-purchase-participant@example.com',
    );
    expect(participantId).toBeTruthy();

    const bankPurchaseResponse = await participantUser.request('/api/v1/auth/organizations/ticket-purchases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        ticketTypeId,
        paymentMethod: 'bank_transfer',
      }),
    });
    expect(bankPurchaseResponse.status).toBe(200);
    const bankPurchasePayload = (await toJson(bankPurchaseResponse)) as Record<string, unknown>;
    const bankPurchaseId = bankPurchasePayload.id as string;
    expect(bankPurchasePayload.status).toBe('pending_approval');

    const approveResponse = await owner.request('/api/v1/auth/organizations/ticket-purchases/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        purchaseId: bankPurchaseId,
      }),
    });
    expect(approveResponse.status).toBe(200);
    const approvedPurchase = await selectTicketPurchaseRow(bankPurchaseId);
    expect(approvedPurchase?.status).toBe('approved');
    expect(approvedPurchase?.ticketPackId).toBeTruthy();
    expect(await countTicketPacksForParticipantAndType(participantId as string, ticketTypeId)).toBe(1);

    const approveAgainResponse = await owner.request('/api/v1/auth/organizations/ticket-purchases/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        purchaseId: bankPurchaseId,
      }),
    });
    expect(approveAgainResponse.status).toBe(409);

    const cashPurchaseResponse = await participantUser.request('/api/v1/auth/organizations/ticket-purchases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        ticketTypeId,
        paymentMethod: 'cash_on_site',
      }),
    });
    expect(cashPurchaseResponse.status).toBe(200);
    const cashPurchasePayload = (await toJson(cashPurchaseResponse)) as Record<string, unknown>;
    const cashPurchaseId = cashPurchasePayload.id as string;
    expect(cashPurchasePayload.status).toBe('pending_approval');

    const rejectResponse = await owner.request('/api/v1/auth/organizations/ticket-purchases/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        purchaseId: cashPurchaseId,
        reason: '入金確認ができませんでした',
      }),
    });
    expect(rejectResponse.status).toBe(200);
    const rejectedPurchase = await selectTicketPurchaseRow(cashPurchaseId);
    expect(rejectedPurchase?.status).toBe('rejected');
    expect(await countTicketPacksForParticipantAndType(participantId as string, ticketTypeId)).toBe(1);

    const anotherPurchaseResponse = await participantUser.request('/api/v1/auth/organizations/ticket-purchases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        ticketTypeId,
        paymentMethod: 'bank_transfer',
      }),
    });
    expect(anotherPurchaseResponse.status).toBe(200);
    const anotherPurchasePayload = (await toJson(anotherPurchaseResponse)) as Record<string, unknown>;
    const anotherPurchaseId = anotherPurchasePayload.id as string;
    expect(anotherPurchasePayload.status).toBe('pending_approval');

    const cancelResponse = await participantUser.request('/api/v1/auth/organizations/ticket-purchases/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        purchaseId: anotherPurchaseId,
      }),
    });
    expect(cancelResponse.status).toBe(200);
    const canceledPurchase = await selectTicketPurchaseRow(anotherPurchaseId);
    expect(canceledPurchase?.status).toBe('cancelled_by_participant');

    const cancelApprovedResponse = await participantUser.request(
      '/api/v1/auth/organizations/ticket-purchases/cancel',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          purchaseId: bankPurchaseId,
        }),
      },
    );
    expect(cancelApprovedResponse.status).toBe(409);

    const participantApproveForbidden = await participantUser.request(
      '/api/v1/auth/organizations/ticket-purchases/approve',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          purchaseId: bankPurchaseId,
        }),
      },
    );
    expect(participantApproveForbidden.status).toBe(403);
  });

  it('handles stripe ticket purchase webhook idempotently', async () => {
    const stripeSecretKey = 'sk_test_dummy';
    const stripeWebhookSecret = 'whsec_test_dummy';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === 'https://api.stripe.com/v1/checkout/sessions') {
        return new Response(
          JSON.stringify({
            id: 'cs_test_ticket_purchase',
            url: 'https://checkout.stripe.com/c/pay/cs_test_ticket_purchase',
            status: 'open',
            payment_status: 'unpaid',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: owner,
        name: 'Stripe Purchase Owner',
        email: 'stripe-purchase-owner@example.com',
      });
      const organizationId = await createOrganization({
        agent: owner,
        name: 'Stripe Purchase Org',
        slug: 'stripe-purchase-org',
      });

      const participantInvite = await createParticipantInvitation({
        agent: owner,
        email: 'stripe-purchase-participant@example.com',
        participantName: 'Stripe Purchase Participant',
        organizationId,
      });
      expect(participantInvite.response.status).toBe(200);

      const participantUser = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: participantUser,
        name: 'Stripe Purchase Participant',
        email: 'stripe-purchase-participant@example.com',
      });
      const participantAcceptResponse = await participantUser.request(
        '/api/v1/auth/orgs/classrooms/invitations/accept',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            invitationId: participantInvite.payload?.id,
          }),
        },
      );
      expect(participantAcceptResponse.status).toBe(200);

      const ticketTypeCreateResponse = await owner.request('/api/v1/auth/organizations/ticket-types', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          name: 'Stripe Ticket',
          totalCount: 4,
          isForSale: true,
          stripePriceId: 'price_test_webhook',
        }),
      });
      expect(ticketTypeCreateResponse.status).toBe(200);
      const ticketTypePayload = (await toJson(ticketTypeCreateResponse)) as Record<string, unknown>;
      const ticketTypeId = ticketTypePayload.id as string;

      const participantId = await selectParticipantIdByEmail(
        organizationId,
        'stripe-purchase-participant@example.com',
      );
      expect(participantId).toBeTruthy();

      const createPurchaseResponse = await participantUser.request('/api/v1/auth/organizations/ticket-purchases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          ticketTypeId,
          paymentMethod: 'stripe',
        }),
      });
      expect(createPurchaseResponse.status).toBe(200);
      const createPurchasePayload = (await toJson(createPurchaseResponse)) as Record<string, unknown>;
      const purchaseId = createPurchasePayload.id as string;
      expect(createPurchasePayload.status).toBe('pending_payment');
      expect(typeof createPurchasePayload.checkoutUrl).toBe('string');

      const purchaseBeforeWebhook = await selectTicketPurchaseRow(purchaseId);
      expect(purchaseBeforeWebhook?.stripeCheckoutSessionId).toBe('cs_test_ticket_purchase');

      const webhookPayload = JSON.stringify({
        id: 'evt_test_checkout_completed',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_ticket_purchase',
            metadata: {
              purchaseId,
            },
          },
        },
      });
      const validSignatureHeader = await createStripeSignatureHeader(
        webhookPayload,
        stripeWebhookSecret,
      );

      const webhookResponse = await appWithStripe.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': validSignatureHeader,
        },
        body: webhookPayload,
      });
      expect(webhookResponse.status).toBe(200);

      const purchaseAfterWebhook = await selectTicketPurchaseRow(purchaseId);
      expect(purchaseAfterWebhook?.status).toBe('approved');
      expect(purchaseAfterWebhook?.ticketPackId).toBeTruthy();
      expect(await countTicketPacksForParticipantAndType(participantId as string, ticketTypeId)).toBe(1);

      const webhookDuplicateResponse = await appWithStripe.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': validSignatureHeader,
        },
        body: webhookPayload,
      });
      expect(webhookDuplicateResponse.status).toBe(200);
      expect(await countTicketPacksForParticipantAndType(participantId as string, ticketTypeId)).toBe(1);

      const invalidSignatureResponse = await appWithStripe.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': 't=1,v1=invalid',
        },
        body: webhookPayload,
      });
      expect(invalidSignatureResponse.status).toBe(400);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('handles approval booking policy flows', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Approval Owner',
      email: 'approval-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Approval Org',
      slug: 'approval-org',
    });

    const participantInvite1 = await createParticipantInvitation({
      agent: owner,
      email: 'approval-participant-1@example.com',
      participantName: 'Approval Participant 1',
      organizationId,
    });
    expect(participantInvite1.response.status).toBe(200);
    const participantInvite2 = await createParticipantInvitation({
      agent: owner,
      email: 'approval-participant-2@example.com',
      participantName: 'Approval Participant 2',
      organizationId,
    });
    expect(participantInvite2.response.status).toBe(200);

    const participantUser1 = createAuthAgent(app);
    await signUpUser({
      agent: participantUser1,
      name: 'Approval Participant 1',
      email: 'approval-participant-1@example.com',
    });
    const participantAcceptResponse1 = await participantUser1.request(
      '/api/v1/auth/orgs/classrooms/invitations/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invitationId: participantInvite1.payload?.id,
        }),
      },
    );
    expect(participantAcceptResponse1.status).toBe(200);

    const participantUser2 = createAuthAgent(app);
    await signUpUser({
      agent: participantUser2,
      name: 'Approval Participant 2',
      email: 'approval-participant-2@example.com',
    });
    const participantAcceptResponse2 = await participantUser2.request(
      '/api/v1/auth/orgs/classrooms/invitations/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invitationId: participantInvite2.payload?.id,
        }),
      },
    );
    expect(participantAcceptResponse2.status).toBe(200);

    const approvalServiceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        name: 'Approval Ticket Service',
        kind: 'single',
        durationMinutes: 60,
        capacity: 2,
        cancellationDeadlineMinutes: 60,
        bookingPolicy: 'approval',
        requiresTicket: true,
      }),
    });
    expect(approvalServiceResponse.status).toBe(200);
    const approvalServicePayload = (await toJson(approvalServiceResponse)) as Record<string, unknown>;
    const approvalServiceId = approvalServicePayload.id as string;

    const ticketTypeCreateResponse = await owner.request('/api/v1/auth/organizations/ticket-types', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        name: 'Approval Tickets',
        totalCount: 2,
        serviceIds: [approvalServiceId],
      }),
    });
    expect(ticketTypeCreateResponse.status).toBe(200);
    const ticketTypePayload = (await toJson(ticketTypeCreateResponse)) as Record<string, unknown>;
    const ticketTypeId = ticketTypePayload.id as string;

    const participantId1 = await selectParticipantIdByEmail(
      organizationId,
      'approval-participant-1@example.com',
    );
    expect(participantId1).toBeTruthy();

    const grantTicketResponse = await owner.request('/api/v1/auth/organizations/ticket-packs/grant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        participantId: participantId1,
        ticketTypeId,
        count: 2,
      }),
    });
    expect(grantTicketResponse.status).toBe(200);
    const grantPayload = (await toJson(grantTicketResponse)) as Record<string, unknown>;
    const ticketPackId = grantPayload.id as string;

    const makeSlot = async (serviceId: string, offsetMs: number) => {
      const startAt = new Date(Date.now() + offsetMs);
      const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
      const slotResponse = await owner.request('/api/v1/auth/organizations/slots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          serviceId,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
        }),
      });
      expect(slotResponse.status).toBe(200);
      const slotPayload = (await toJson(slotResponse)) as Record<string, unknown>;
      return slotPayload.id as string;
    };

    const approvalSlotId = await makeSlot(approvalServiceId, 3 * 24 * 60 * 60 * 1000);
    const pendingCreateResponse = await participantUser1.request('/api/v1/auth/organizations/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: approvalSlotId,
      }),
    });
    expect(pendingCreateResponse.status).toBe(200);
    const pendingCreatePayload = (await toJson(pendingCreateResponse)) as Record<string, unknown>;
    const pendingBookingId = pendingCreatePayload.id as string;
    expect(pendingCreatePayload.status).toBe('pending_approval');
    expect(await selectBookingStatus(pendingBookingId)).toBe('pending_approval');
    expect(await selectSlotReservedCount(approvalSlotId)).toBe(0);
    expect(await selectTicketPackRemaining(ticketPackId)).toBe(2);

    const approveResponse = await owner.request('/api/v1/auth/organizations/bookings/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: pendingBookingId,
      }),
    });
    expect(approveResponse.status).toBe(200);
    expect(await selectBookingStatus(pendingBookingId)).toBe('confirmed');
    expect(await selectSlotReservedCount(approvalSlotId)).toBe(1);
    expect(await selectTicketPackRemaining(ticketPackId)).toBe(1);
    expect(await selectTicketLedgerActionCount(ticketPackId, 'consume')).toBe(1);
    expect(await selectBookingAuditActionCount(pendingBookingId, 'booking.approved')).toBe(1);

    const approveAgainResponse = await owner.request('/api/v1/auth/organizations/bookings/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: pendingBookingId,
      }),
    });
    expect(approveAgainResponse.status).toBe(409);
    const rejectConfirmedResponse = await owner.request('/api/v1/auth/organizations/bookings/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: pendingBookingId,
      }),
    });
    expect(rejectConfirmedResponse.status).toBe(409);

    const nearSlotId = await makeSlot(approvalServiceId, 10 * 60 * 1000);
    const nearPendingResponse = await participantUser1.request('/api/v1/auth/organizations/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: nearSlotId,
      }),
    });
    expect(nearPendingResponse.status).toBe(200);
    const nearPendingPayload = (await toJson(nearPendingResponse)) as Record<string, unknown>;
    const nearPendingBookingId = nearPendingPayload.id as string;
    expect(nearPendingPayload.status).toBe('pending_approval');

    const cancelPendingResponse = await participantUser1.request('/api/v1/auth/organizations/bookings/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: nearPendingBookingId,
      }),
    });
    expect(cancelPendingResponse.status).toBe(200);
    expect(await selectBookingStatus(nearPendingBookingId)).toBe('cancelled_by_participant');
    expect(await selectSlotReservedCount(nearSlotId)).toBe(0);
    expect(await selectTicketPackRemaining(ticketPackId)).toBe(1);

    const rejectSlotId = await makeSlot(approvalServiceId, 4 * 24 * 60 * 60 * 1000);
    const rejectPendingResponse = await participantUser1.request('/api/v1/auth/organizations/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: rejectSlotId,
      }),
    });
    expect(rejectPendingResponse.status).toBe(200);
    const rejectPendingPayload = (await toJson(rejectPendingResponse)) as Record<string, unknown>;
    const rejectPendingBookingId = rejectPendingPayload.id as string;
    expect(rejectPendingPayload.status).toBe('pending_approval');

    const rejectResponse = await owner.request('/api/v1/auth/organizations/bookings/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: rejectPendingBookingId,
        reason: '運営都合',
      }),
    });
    expect(rejectResponse.status).toBe(200);
    expect(await selectBookingStatus(rejectPendingBookingId)).toBe('rejected_by_staff');
    expect(await selectBookingAuditActionCount(rejectPendingBookingId, 'booking.rejected_by_staff')).toBe(1);

    const rejectAgainResponse = await owner.request('/api/v1/auth/organizations/bookings/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: rejectPendingBookingId,
      }),
    });
    expect(rejectAgainResponse.status).toBe(409);

    const approvalCapacityServiceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        name: 'Approval Capacity Service',
        kind: 'single',
        durationMinutes: 60,
        capacity: 1,
        bookingPolicy: 'approval',
        requiresTicket: false,
      }),
    });
    expect(approvalCapacityServiceResponse.status).toBe(200);
    const approvalCapacityServicePayload = (await toJson(
      approvalCapacityServiceResponse,
    )) as Record<string, unknown>;
    const approvalCapacityServiceId = approvalCapacityServicePayload.id as string;

    const capacitySlotId = await makeSlot(approvalCapacityServiceId, 5 * 24 * 60 * 60 * 1000);
    const capacityPendingResponse1 = await participantUser1.request('/api/v1/auth/organizations/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: capacitySlotId,
      }),
    });
    expect(capacityPendingResponse1.status).toBe(200);
    const capacityPendingPayload1 = (await toJson(capacityPendingResponse1)) as Record<string, unknown>;
    const capacityBookingId1 = capacityPendingPayload1.id as string;
    expect(capacityPendingPayload1.status).toBe('pending_approval');

    const capacityPendingResponse2 = await participantUser2.request('/api/v1/auth/organizations/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: capacitySlotId,
      }),
    });
    expect(capacityPendingResponse2.status).toBe(200);
    const capacityPendingPayload2 = (await toJson(capacityPendingResponse2)) as Record<string, unknown>;
    const capacityBookingId2 = capacityPendingPayload2.id as string;
    expect(capacityPendingPayload2.status).toBe('pending_approval');

    const approveCapacityFirst = await owner.request('/api/v1/auth/organizations/bookings/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: capacityBookingId1,
      }),
    });
    expect(approveCapacityFirst.status).toBe(200);
    expect(await selectBookingStatus(capacityBookingId1)).toBe('confirmed');
    expect(await selectSlotReservedCount(capacitySlotId)).toBe(1);

    const approveCapacitySecond = await owner.request('/api/v1/auth/organizations/bookings/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: capacityBookingId2,
      }),
    });
    expect(approveCapacitySecond.status).toBe(409);
    expect(await selectBookingStatus(capacityBookingId2)).toBe('pending_approval');
  });

  it('sends booking notification emails for booking lifecycle events', async () => {
    const authRuntimeWithEmail = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        RESEND_API_KEY: 'test-resend-api-key',
        RESEND_FROM_EMAIL: 'no-reply@example.com',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithEmail = createApp(authRuntimeWithEmail);

    const resendRequests: Array<{ to: string[]; subject: string }> = [];
    let shouldFailResend = false;
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === 'https://api.resend.com/emails') {
        const payloadText =
          typeof init?.body === 'string'
            ? init.body
            : init?.body
              ? String(init.body)
              : '{}';
        const payload = JSON.parse(payloadText) as { to?: unknown; subject?: unknown };
        const to = Array.isArray(payload.to)
          ? payload.to.filter((value): value is string => typeof value === 'string')
          : [];
        const subject = typeof payload.subject === 'string' ? payload.subject : '';

        resendRequests.push({ to, subject });

        if (shouldFailResend) {
          return new Response('failed', { status: 500 });
        }
        return new Response(JSON.stringify({ id: crypto.randomUUID() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithEmail);
      await signUpUser({
        agent: owner,
        name: 'Booking Email Owner',
        email: 'booking-email-owner@example.com',
      });
      const organizationId = await createOrganization({
        agent: owner,
        name: 'Booking Email Org',
        slug: 'booking-email-org',
      });

      const participantInvite = await createParticipantInvitation({
        agent: owner,
        email: 'booking-email-participant@example.com',
        participantName: 'Booking Email Participant',
        organizationId,
      });
      expect(participantInvite.response.status).toBe(200);

      const participantUser = createAuthAgent(appWithEmail);
      await signUpUser({
        agent: participantUser,
        name: 'Booking Email Participant',
        email: 'booking-email-participant@example.com',
      });
      const participantAcceptResponse = await participantUser.request(
        '/api/v1/auth/orgs/classrooms/invitations/accept',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            invitationId: participantInvite.payload?.id,
          }),
        },
      );
      expect(participantAcceptResponse.status).toBe(200);

      const serviceCreateResponse = await owner.request('/api/v1/auth/organizations/services', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          name: 'Email Notify Service',
          kind: 'single',
          durationMinutes: 60,
          capacity: 5,
          cancellationDeadlineMinutes: 30,
          requiresTicket: false,
        }),
      });
      expect(serviceCreateResponse.status).toBe(200);
      const servicePayload = (await toJson(serviceCreateResponse)) as Record<string, unknown>;
      const serviceId = servicePayload.id as string;

      const makeSlot = async (offsetDays: number) => {
        const startAt = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
        const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
        const slotCreateResponse = await owner.request('/api/v1/auth/organizations/slots', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            organizationId,
            serviceId,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
          }),
        });
        expect(slotCreateResponse.status).toBe(200);
        const slotPayload = (await toJson(slotCreateResponse)) as Record<string, unknown>;
        return slotPayload.id as string;
      };

      const firstSlotId = await makeSlot(4);
      const firstBookingResponse = await participantUser.request('/api/v1/auth/organizations/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: firstSlotId,
        }),
      });
      expect(firstBookingResponse.status).toBe(200);
      const firstBookingPayload = (await toJson(firstBookingResponse)) as Record<string, unknown>;
      const firstBookingId = firstBookingPayload.id as string;

      const participantCancelResponse = await participantUser.request(
        '/api/v1/auth/organizations/bookings/cancel',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            bookingId: firstBookingId,
            reason: '都合が悪くなったため',
          }),
        },
      );
      expect(participantCancelResponse.status).toBe(200);

      const secondSlotId = await makeSlot(5);
      const secondBookingResponse = await participantUser.request('/api/v1/auth/organizations/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: secondSlotId,
        }),
      });
      expect(secondBookingResponse.status).toBe(200);
      const secondBookingPayload = (await toJson(secondBookingResponse)) as Record<string, unknown>;
      const secondBookingId = secondBookingPayload.id as string;

      const staffCancelResponse = await owner.request('/api/v1/auth/organizations/bookings/cancel-by-staff', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId: secondBookingId,
          reason: '設備メンテナンス',
        }),
      });
      expect(staffCancelResponse.status).toBe(200);

      const thirdSlotId = await makeSlot(6);
      const thirdBookingResponse = await participantUser.request('/api/v1/auth/organizations/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: thirdSlotId,
        }),
      });
      expect(thirdBookingResponse.status).toBe(200);
      const thirdBookingPayload = (await toJson(thirdBookingResponse)) as Record<string, unknown>;
      const thirdBookingId = thirdBookingPayload.id as string;

      const noShowResponse = await owner.request('/api/v1/auth/organizations/bookings/no-show', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId: thirdBookingId,
        }),
      });
      expect(noShowResponse.status).toBe(200);

      const bookingNotificationRequests = resendRequests.filter((request) =>
        request.subject.startsWith('【予約通知】'),
      );
      const uniqueSubjects = Array.from(
        new Set(bookingNotificationRequests.map((request) => request.subject)),
      );
      expect(uniqueSubjects).toHaveLength(4);
      expect(uniqueSubjects).toContain('【予約通知】予約が確定しました');
      expect(uniqueSubjects).toContain('【予約通知】予約をキャンセルしました');
      expect(uniqueSubjects).toContain('【予約通知】運営により予約がキャンセルされました');
      expect(uniqueSubjects).toContain('【予約通知】予約がNo-showとして記録されました');
      expect(
        bookingNotificationRequests.every((request) =>
          request.to.includes('booking-email-participant@example.com'),
        ),
      ).toBe(true);

      shouldFailResend = true;
      const fourthSlotId = await makeSlot(7);
      const fourthBookingResponse = await participantUser.request('/api/v1/auth/organizations/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: fourthSlotId,
        }),
      });
      expect(fourthBookingResponse.status).toBe(200);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('sends booking notification emails for approval lifecycle events', async () => {
    const authRuntimeWithEmail = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        RESEND_API_KEY: 'test-resend-api-key',
        RESEND_FROM_EMAIL: 'no-reply@example.com',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithEmail = createApp(authRuntimeWithEmail);

    const resendRequests: Array<{ to: string[]; subject: string }> = [];
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === 'https://api.resend.com/emails') {
        const payloadText =
          typeof init?.body === 'string'
            ? init.body
            : init?.body
              ? String(init.body)
              : '{}';
        const payload = JSON.parse(payloadText) as { to?: unknown; subject?: unknown };
        const to = Array.isArray(payload.to)
          ? payload.to.filter((value): value is string => typeof value === 'string')
          : [];
        const subject = typeof payload.subject === 'string' ? payload.subject : '';

        resendRequests.push({ to, subject });

        return new Response(JSON.stringify({ id: crypto.randomUUID() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithEmail);
      await signUpUser({
        agent: owner,
        name: 'Booking Approval Email Owner',
        email: 'booking-approval-email-owner@example.com',
      });
      const organizationId = await createOrganization({
        agent: owner,
        name: 'Booking Approval Email Org',
        slug: 'booking-approval-email-org',
      });

      const participantInvite = await createParticipantInvitation({
        agent: owner,
        email: 'booking-approval-email-participant@example.com',
        participantName: 'Booking Approval Email Participant',
        organizationId,
      });
      expect(participantInvite.response.status).toBe(200);

      const participantUser = createAuthAgent(appWithEmail);
      await signUpUser({
        agent: participantUser,
        name: 'Booking Approval Email Participant',
        email: 'booking-approval-email-participant@example.com',
      });
      const participantAcceptResponse = await participantUser.request(
        '/api/v1/auth/orgs/classrooms/invitations/accept',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            invitationId: participantInvite.payload?.id,
          }),
        },
      );
      expect(participantAcceptResponse.status).toBe(200);

      const serviceCreateResponse = await owner.request('/api/v1/auth/organizations/services', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          name: 'Approval Email Notify Service',
          kind: 'single',
          durationMinutes: 60,
          capacity: 5,
          bookingPolicy: 'approval',
          requiresTicket: false,
        }),
      });
      expect(serviceCreateResponse.status).toBe(200);
      const servicePayload = (await toJson(serviceCreateResponse)) as Record<string, unknown>;
      const serviceId = servicePayload.id as string;

      const makeSlot = async (offsetDays: number) => {
        const startAt = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
        const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
        const slotCreateResponse = await owner.request('/api/v1/auth/organizations/slots', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            organizationId,
            serviceId,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
          }),
        });
        expect(slotCreateResponse.status).toBe(200);
        const slotPayload = (await toJson(slotCreateResponse)) as Record<string, unknown>;
        return slotPayload.id as string;
      };

      const slotId1 = await makeSlot(4);
      const bookingResponse1 = await participantUser.request('/api/v1/auth/organizations/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: slotId1,
        }),
      });
      expect(bookingResponse1.status).toBe(200);
      const bookingPayload1 = (await toJson(bookingResponse1)) as Record<string, unknown>;
      const bookingId1 = bookingPayload1.id as string;

      const approveResponse = await owner.request('/api/v1/auth/organizations/bookings/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId: bookingId1,
        }),
      });
      expect(approveResponse.status).toBe(200);

      const slotId2 = await makeSlot(5);
      const bookingResponse2 = await participantUser.request('/api/v1/auth/organizations/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: slotId2,
        }),
      });
      expect(bookingResponse2.status).toBe(200);
      const bookingPayload2 = (await toJson(bookingResponse2)) as Record<string, unknown>;
      const bookingId2 = bookingPayload2.id as string;

      const rejectResponse = await owner.request('/api/v1/auth/organizations/bookings/reject', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId: bookingId2,
          reason: '運営都合',
        }),
      });
      expect(rejectResponse.status).toBe(200);

      const bookingNotificationRequests = resendRequests.filter((request) =>
        request.subject.startsWith('【予約通知】'),
      );
      expect(
        bookingNotificationRequests.some(
          (request) => request.subject === '【予約通知】予約申請を受け付けました',
        ),
      ).toBe(true);
      expect(
        bookingNotificationRequests.some(
          (request) => request.subject === '【予約通知】予約が承認されました',
        ),
      ).toBe(true);
      expect(
        bookingNotificationRequests.some(
          (request) => request.subject === '【予約通知】予約が却下されました',
        ),
      ).toBe(true);
      expect(
        bookingNotificationRequests.every((request) =>
          request.to.includes('booking-approval-email-participant@example.com'),
        ),
      ).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('generates recurring slots and applies skip exception', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Recurring Owner',
      email: 'recurring-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Recurring Org',
      slug: 'recurring-org',
    });

    const serviceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        name: 'Recurring Service',
        kind: 'recurring',
        durationMinutes: 60,
        capacity: 8,
      }),
    });
    expect(serviceResponse.status).toBe(200);
    const servicePayload = (await toJson(serviceResponse)) as Record<string, unknown>;
    const serviceId = servicePayload.id as string;

    const now = new Date();
    const weekday = ((now.getUTCDay() + 6) % 7) + 1;
    const startDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const startDateStr = `${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(
      2,
      '0',
    )}-${String(startDate.getUTCDate()).padStart(2, '0')}`;

    const recurringCreateResponse = await owner.request('/api/v1/auth/organizations/recurring-schedules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        serviceId,
        timezone: 'Asia/Tokyo',
        frequency: 'weekly',
        interval: 1,
        byWeekday: [weekday],
        startDate: startDateStr,
        startTimeLocal: '10:00',
      }),
    });
    expect(recurringCreateResponse.status).toBe(200);
    const recurringPayload = (await toJson(recurringCreateResponse)) as Record<string, unknown>;
    const recurringScheduleId = recurringPayload.id as string;
    const generated = recurringPayload.generated as Record<string, unknown>;
    expect(Number(generated.createdCount ?? 0)).toBeGreaterThan(0);

    const generateAgainResponse = await owner.request(
      '/api/v1/auth/organizations/recurring-schedules/generate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recurringScheduleId,
        }),
      },
    );
    expect(generateAgainResponse.status).toBe(200);
    const generateAgainPayload = (await toJson(generateAgainResponse)) as Record<string, unknown>;
    expect(Number(generateAgainPayload.createdCount ?? 0)).toBe(0);

    const slots = await listSlotStartsByRecurringSchedule(recurringScheduleId);
    expect(slots.length).toBeGreaterThan(0);
    const targetSlot = slots[0];
    const startAtDate = new Date(Number(targetSlot.startAt));
    const dateKey = `${startAtDate.getUTCFullYear()}-${String(startAtDate.getUTCMonth() + 1).padStart(
      2,
      '0',
    )}-${String(startAtDate.getUTCDate()).padStart(2, '0')}`;

    const skipExceptionResponse = await owner.request(
      '/api/v1/auth/organizations/recurring-schedules/exceptions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recurringScheduleId,
          date: dateKey,
          action: 'skip',
        }),
      },
    );
    expect(skipExceptionResponse.status).toBe(200);

    const skippedSlotRow = await d1
      .prepare('SELECT status FROM slot WHERE id = ?')
      .bind(targetSlot.id)
      .first<{ status: string }>();
    expect(skippedSlotRow?.status).toBe('canceled');
  });

  it('sets CORS headers for API routes', async () => {
    const origin = 'http://localhost:5173';
    const response = await app.request('/api/health', {
      headers: {
        Origin: origin,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('responds to auth CORS preflight requests', async () => {
    const origin = 'http://localhost:5173';
    const response = await app.request('/api/auth/sign-in', {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
      },
    });

    expect([200, 204]).toContain(response.status);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('serves OpenAPI schema', async () => {
    const response = await app.request('/api/openapi.json');

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.openapi).toBe('3.0.0');
    expect(body.paths['/api/v1/auth/sign-in']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/invitations']).toBeDefined();
    expect(body.paths['/api/v1/auth/orgs/classrooms/invitations/reject']).toBeDefined();
    expect(body.paths['/api/v1/auth/orgs/classrooms/invitations/detail']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/participants']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/participants/invitations']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/participants/invitations/user']).toBeDefined();
    expect(body.paths['/api/v1/auth/orgs/classrooms/invitations/detail']).toBeDefined();
    expect(body.paths['/api/v1/auth/orgs/classrooms/invitations/accept']).toBeDefined();
    expect(body.paths['/api/v1/auth/orgs/classrooms/invitations/reject']).toBeDefined();
    expect(body.paths['/api/v1/auth/orgs/classrooms/invitations/cancel']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/participants/self-enroll']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/services']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/services/update']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/services/archive']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/slots']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/slots/update']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/slots/available']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/slots/cancel']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/recurring-schedules']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/recurring-schedules/update']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/recurring-schedules/exceptions']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/recurring-schedules/generate']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/bookings']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/bookings/mine']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/bookings/cancel']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/bookings/cancel-by-staff']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/bookings/approve']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/bookings/reject']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/bookings/no-show']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/ticket-types']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/ticket-types/purchasable']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/ticket-packs/grant']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/ticket-packs/mine']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/ticket-purchases']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/ticket-purchases/mine']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/ticket-purchases/approve']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/ticket-purchases/reject']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/ticket-purchases/cancel']).toBeDefined();
    expect(body.paths['/api/v1/public/orgs/{orgSlug}/classrooms/{classroomSlug}/events']).toBeDefined();
    expect(body.paths['/api/v1/public/orgs/{orgSlug}/classrooms/{classroomSlug}/events/{slotId}']).toBeDefined();
  });
});
