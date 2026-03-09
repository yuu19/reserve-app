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
  organizationSlug: string;
  organizationName: string;
  classroomId?: string | null;
  classroomSlug?: string | null;
  classroomName?: string | null;
  email: string;
  subjectKind: 'org_operator' | 'classroom_operator' | 'participant';
  role: 'admin' | 'member' | 'manager' | 'staff' | 'participant';
  participantName?: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired';
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

export type OrganizationRole = 'admin' | 'member';
export type ClassroomInvitationRole = 'manager' | 'staff' | 'participant';

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

type OrganizationQuery = {
  organizationId?: string;
};

type ClassroomInvitationContext = {
  orgSlug: string;
  classroomSlug: string;
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

const encodePathSegment = (value: string) => encodeURIComponent(value);

const getOrgInvitationPath = (orgSlug: string) =>
  `/api/v1/auth/orgs/${encodePathSegment(orgSlug)}/invitations`;

const getClassroomInvitationPath = (context: ClassroomInvitationContext) =>
  `/api/v1/auth/orgs/${encodePathSegment(context.orgSlug)}/classrooms/${encodePathSegment(context.classroomSlug)}/invitations`;

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
  listInvitations: (orgSlug: string) => request(getOrgInvitationPath(orgSlug)),
  listUserInvitations: () => request('/api/v1/auth/invitations/user'),
  createInvitation: (orgSlug: string, json: CreateInvitationInput) =>
    request(getOrgInvitationPath(orgSlug), {
      method: 'POST',
      body: JSON.stringify(json),
    }),
  getInvitationDetail: (invitationId: string) =>
    request(`/api/v1/auth/invitations/${encodePathSegment(invitationId)}`),
  acceptInvitation: (json: InvitationActionInput) =>
    request(`/api/v1/auth/invitations/${encodePathSegment(json.invitationId)}/accept`, {
      method: 'POST',
      body: JSON.stringify(json),
    }),
  rejectInvitation: (json: InvitationActionInput) =>
    request(`/api/v1/auth/invitations/${encodePathSegment(json.invitationId)}/reject`, {
      method: 'POST',
      body: JSON.stringify(json),
    }),
  cancelInvitation: (json: InvitationActionInput) =>
    request(`/api/v1/auth/invitations/${encodePathSegment(json.invitationId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify(json),
    }),
  listParticipants: (organizationId?: string) =>
    request(withQuery('/api/v1/auth/organizations/participants', { organizationId })),
  listParticipantInvitations: (context: ClassroomInvitationContext) =>
    request(getClassroomInvitationPath(context)),
  listUserParticipantInvitations: () => request('/api/v1/auth/invitations/user'),
  createParticipantInvitation: (context: ClassroomInvitationContext, json: CreateParticipantInvitationInput) =>
    request(getClassroomInvitationPath(context), {
      method: 'POST',
      body: JSON.stringify({ ...json, role: 'participant' satisfies ClassroomInvitationRole }),
    }),
  getParticipantInvitationDetail: (invitationId: string) =>
    request(`/api/v1/auth/invitations/${encodePathSegment(invitationId)}`),
  acceptParticipantInvitation: (json: InvitationActionInput) =>
    request(`/api/v1/auth/invitations/${encodePathSegment(json.invitationId)}/accept`, {
      method: 'POST',
      body: JSON.stringify(json),
    }),
  rejectParticipantInvitation: (json: InvitationActionInput) =>
    request(`/api/v1/auth/invitations/${encodePathSegment(json.invitationId)}/reject`, {
      method: 'POST',
      body: JSON.stringify(json),
    }),
  cancelParticipantInvitation: (json: InvitationActionInput) =>
    request(`/api/v1/auth/invitations/${encodePathSegment(json.invitationId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify(json),
    }),
};
