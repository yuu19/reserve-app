import fs from 'node:fs/promises';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/d1';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    .prepare('SELECT status FROM participant_invitation WHERE id = ?')
    .bind(invitationId)
    .first<{ status: string }>();

  return row?.status ?? null;
};

const selectParticipantInvitationActionCount = async (invitationId: string, action: string) => {
  const row = await d1
    .prepare(
      'SELECT COUNT(*) as count FROM participant_invitation_audit_log WHERE participant_invitation_id = ? AND action = ?',
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
  const response = await agent.request('/api/v1/auth/organizations/invitations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email,
      role,
      organizationId,
      resend,
    }),
  });

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
  const response = await agent.request('/api/v1/auth/organizations/participants/invitations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email,
      participantName,
      organizationId,
      resend,
    }),
  });

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

  it('requires auth for invitation endpoints', async () => {
    const response = await app.request('/api/v1/auth/organizations/invitations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'member@example.com',
        role: 'member',
      }),
    });

    expect(response.status).toBe(401);
  });

  it('requires auth for invitation detail/reject endpoints', async () => {
    const detailResponse = await app.request(
      '/api/v1/auth/organizations/invitations/detail?invitationId=dummy-id',
    );
    expect(detailResponse.status).toBe(401);

    const rejectResponse = await app.request('/api/v1/auth/organizations/invitations/reject', {
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
    const listResponse = await app.request('/api/v1/auth/organizations/participants');
    expect(listResponse.status).toBe(401);

    const createResponse = await app.request('/api/v1/auth/organizations/participants/invitations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'participant@example.com',
        participantName: 'Participant',
      }),
    });
    expect(createResponse.status).toBe(401);

    const detailResponse = await app.request(
      '/api/v1/auth/organizations/participants/invitations/detail?invitationId=dummy-id',
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
      `/api/v1/auth/organizations/invitations/detail?invitationId=${encodeURIComponent(invitationId)}`,
    );
    expect(detailResponse.status).toBe(200);

    const acceptResponse = await invitee.request('/api/v1/auth/organizations/invitations/accept', {
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

    const rejectResponse = await rejectee.request('/api/v1/auth/organizations/invitations/reject', {
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

    const cancelResponse = await inviter.request('/api/v1/auth/organizations/invitations/cancel', {
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
    const acceptAdminInviteResponse = await admin.request('/api/v1/auth/organizations/invitations/accept', {
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
    const acceptMemberInviteResponse = await member.request('/api/v1/auth/organizations/invitations/accept', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        invitationId: memberInvitationId,
      }),
    });
    expect(acceptMemberInviteResponse.status).toBe(200);

    const forbiddenCreate = await createParticipantInvitation({
      agent: member,
      email: 'participant-user@example.com',
      participantName: 'Member Should Fail',
      organizationId,
    });
    expect(forbiddenCreate.response.status).toBe(403);

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
      `/api/v1/auth/organizations/participants/invitations/detail?invitationId=${encodeURIComponent(participantInvitationId)}`,
    );
    expect(forbiddenDetail.status).toBe(403);

    const forbiddenAccept = await otherUser.request(
      '/api/v1/auth/organizations/participants/invitations/accept',
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
      '/api/v1/auth/organizations/participants/invitations/reject',
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
      `/api/v1/auth/organizations/participants/invitations/detail?invitationId=${encodeURIComponent(participantInvitationId)}`,
    );
    expect(detailResponse.status).toBe(200);

    const acceptResponse = await participantUser.request(
      '/api/v1/auth/organizations/participants/invitations/accept',
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
      '/api/v1/auth/organizations/participants/invitations/reject',
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
      '/api/v1/auth/organizations/participants/invitations/cancel',
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
        path: '/api/v1/auth/organizations/bookings',
        method: 'POST',
        body: {
          slotId: 'dummy-slot',
        },
      },
      { path: '/api/v1/auth/organizations/bookings/mine', method: 'GET' },
      { path: '/api/v1/auth/organizations/ticket-types', method: 'GET' },
      { path: '/api/v1/auth/organizations/ticket-packs/mine', method: 'GET' },
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
    const acceptAdminResponse = await admin.request('/api/v1/auth/organizations/invitations/accept', {
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
    const acceptMemberResponse = await member.request('/api/v1/auth/organizations/invitations/accept', {
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
      '/api/v1/auth/organizations/participants/invitations/accept',
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
    expect(body.paths['/api/v1/auth/organizations/invitations/reject']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/invitations/detail']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/participants']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/participants/invitations']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/participants/invitations/user']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/participants/invitations/detail']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/participants/invitations/accept']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/participants/invitations/reject']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/participants/invitations/cancel']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/services']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/services/update']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/services/archive']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/slots']).toBeDefined();
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
    expect(body.paths['/api/v1/auth/organizations/bookings/no-show']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/ticket-types']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/ticket-packs/grant']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/ticket-packs/mine']).toBeDefined();
  });
});
