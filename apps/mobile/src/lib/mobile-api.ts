import { backendBaseURL, getAuthCookie, isWebPlatform } from './auth-client';

export type JsonRecord = Record<string, unknown>;

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

export type OrganizationRole = 'admin' | 'member';

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

type OrganizationQuery = {
  organizationId?: string;
};

const buildHeaders = (initHeaders?: HeadersInit, hasBody?: boolean) => {
  const headers = new Headers(initHeaders);
  const cookie = getAuthCookie();
  if (cookie) {
    headers.set('Cookie', cookie);
  }
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
};

const request = async (path: string, init?: RequestInit) => {
  const headers = buildHeaders(init?.headers, Boolean(init?.body));
  return fetch(`${backendBaseURL}${path}`, {
    ...init,
    headers,
    credentials: isWebPlatform ? 'include' : 'omit',
  });
};

const withQuery = (path: string, query?: OrganizationQuery) => {
  if (!query?.organizationId) {
    return path;
  }
  const search = new URLSearchParams({ organizationId: query.organizationId });
  return `${path}?${search.toString()}`;
};

export const mobileApi = {
  getSession: () => request('/api/v1/auth/session'),
  listOrganizations: () => request('/api/v1/auth/organizations'),
  createOrganization: (json: CreateOrganizationInput) =>
    request('/api/v1/auth/organizations', {
      method: 'POST',
      body: JSON.stringify(json),
    }),
  setActiveOrganization: (json: SetActiveOrganizationInput) =>
    request('/api/v1/auth/organizations/set-active', {
      method: 'POST',
      body: JSON.stringify(json),
    }),
  getFullOrganization: (organizationId?: string) =>
    request(withQuery('/api/v1/auth/organizations/full', { organizationId })),
  listInvitations: (organizationId?: string) =>
    request(withQuery('/api/v1/auth/organizations/invitations', { organizationId })),
  listUserInvitations: () => request('/api/v1/auth/organizations/invitations/user'),
  createInvitation: (json: CreateInvitationInput) =>
    request('/api/v1/auth/organizations/invitations', {
      method: 'POST',
      body: JSON.stringify(json),
    }),
  acceptInvitation: (json: InvitationActionInput) =>
    request('/api/v1/auth/organizations/invitations/accept', {
      method: 'POST',
      body: JSON.stringify(json),
    }),
  cancelInvitation: (json: InvitationActionInput) =>
    request('/api/v1/auth/organizations/invitations/cancel', {
      method: 'POST',
      body: JSON.stringify(json),
    }),
  listParticipants: (organizationId?: string) =>
    request(withQuery('/api/v1/auth/organizations/participants', { organizationId })),
  listParticipantInvitations: (organizationId?: string) =>
    request(withQuery('/api/v1/auth/organizations/participants/invitations', { organizationId })),
  listUserParticipantInvitations: () => request('/api/v1/auth/organizations/participants/invitations/user'),
  createParticipantInvitation: (json: CreateParticipantInvitationInput) =>
    request('/api/v1/auth/organizations/participants/invitations', {
      method: 'POST',
      body: JSON.stringify(json),
    }),
  getParticipantInvitationDetail: (invitationId: string) =>
    request(
      `/api/v1/auth/organizations/participants/invitations/detail?${new URLSearchParams({ invitationId }).toString()}`,
    ),
  acceptParticipantInvitation: (json: InvitationActionInput) =>
    request('/api/v1/auth/organizations/participants/invitations/accept', {
      method: 'POST',
      body: JSON.stringify(json),
    }),
  rejectParticipantInvitation: (json: InvitationActionInput) =>
    request('/api/v1/auth/organizations/participants/invitations/reject', {
      method: 'POST',
      body: JSON.stringify(json),
    }),
  cancelParticipantInvitation: (json: InvitationActionInput) =>
    request('/api/v1/auth/organizations/participants/invitations/cancel', {
      method: 'POST',
      body: JSON.stringify(json),
    }),
};
