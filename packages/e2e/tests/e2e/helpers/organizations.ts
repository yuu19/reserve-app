import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { createAccount, signUpAccount, syncRequestCookiesToBrowser } from './accounts';
import { expectOkJson, parseResponseBody } from './assertions';
import { backendUrl } from './env';

/**
 * Organization と初期 store をまとめて扱う E2E fixture。
 */
export type TestOrganization = {
  /** Backend API が返す organization id。 */
  id: string;
  /** 画面表示や fixture 作成時に使う organization name。 */
  name: string;
  /** Scoped route と API path で使う organization slug。 */
  slug: string;
  /** Organization 作成時に生成される primary store id。 */
  storeId: string;
  /** Scoped route と API path で使う store slug。 */
  storeSlug: string;
};

/** 予約 service fixture の最小情報。 */
export type TestService = {
  /** Backend API が返す service id。 */
  id: string;
  /** 画面上の row や select option を探す service name。 */
  name: string;
};

/** 単発予約枠 fixture の最小情報。 */
export type TestSlot = {
  /** Backend API が返す slot id。 */
  id: string;
  /** ISO 8601 形式の開始日時。 */
  startAt: string;
  /** ISO 8601 形式の終了日時。 */
  endAt: string;
};

/** 回数券種別 fixture の最小情報。 */
export type TestTicketType = {
  /** Backend API が返す ticket type id。 */
  id: string;
  /** 画面表示や検索に使う ticket type name。 */
  name: string;
  /** 1 購入あたりの利用可能回数。 */
  totalCount: number;
  /** 購入後の有効日数。無期限の場合は `null` または未指定。 */
  expiresInDays?: number | null;
};

/** 回数券購入申請 fixture の最小情報。 */
export type TestTicketPurchase = {
  /** Backend API が返す purchase id。 */
  id: string;
  /** 購入対象の ticket type id。 */
  ticketTypeId: string;
  /** 購入者 participant id。response に含まれない場合は未指定。 */
  participantId?: string;
};

/** 招待 fixture の最小情報。 */
export type TestInvitation = {
  /** Backend API が返す invitation id。 */
  id: string;
  /** 招待先 email address。 */
  email: string;
};

/** 参加者 fixture の最小情報。 */
export type TestParticipant = {
  /** Backend API が返す participant id。 */
  id: string;
  /** 参加者 account の email address。 */
  email: string;
  /** 参加者として表示される name。 */
  name: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

/**
 * ログイン済み owner の request context で organization と primary store を作成する。
 *
 * @param input - 作成する organization の情報。
 * @param input.request - owner として認証済みの Playwright request context。
 * @param input.name - 作成する organization name。
 * @param input.slug - organization と初期 store に使う slug。
 * @returns Organization と初期 store を同時に扱える fixture。
 */
export const createOrganization = async ({
  request,
  name,
  slug,
}: {
  request: APIRequestContext;
  name: string;
  slug: string;
}): Promise<TestOrganization> => {
  const response = await request.post(`${backendUrl}/api/v1/auth/organizations`, {
    data: {
      name,
      slug,
    },
  });
  const payload = await expectOkJson(response, `create organization ${slug}`);
  const id = typeof payload.id === 'string' ? payload.id : null;
  expect(id, 'organization id should be returned').toBeTruthy();
  return {
    id: id as string,
    name,
    slug,
    storeId: id as string,
    storeSlug: slug,
  };
};

/**
 * Organization の primary store の表示名と slug を更新する。
 *
 * @param input - 更新対象 store と更新後の値。
 * @param input.request - owner として認証済みの Playwright request context。
 * @param input.organization - 更新対象の organization fixture。
 * @param input.name - 更新後の store name。
 * @param input.slug - 更新後の store slug。
 * @returns store id と slug を更新した organization fixture。
 */
export const updateStore = async ({
  request,
  organization,
  name,
  slug,
}: {
  request: APIRequestContext;
  organization: TestOrganization;
  name: string;
  slug: string;
}): Promise<TestOrganization> => {
  const response = await request.patch(
    `${backendUrl}/api/v1/auth/orgs/${encodeURIComponent(
      organization.slug,
    )}/stores/${encodeURIComponent(organization.storeSlug)}`,
    {
      data: {
        name,
        slug,
      },
    },
  );
  const payload = await expectOkJson(response, `update store ${organization.storeSlug}`);
  const id = typeof payload.id === 'string' ? payload.id : organization.storeId;
  const nextSlug = typeof payload.slug === 'string' ? payload.slug : slug;
  return {
    ...organization,
    storeId: id,
    storeSlug: nextSlug,
  };
};

/**
 * Owner account の sign-up、organization 作成、必要に応じた store 更新をまとめて行う。
 *
 * `context` を渡した場合は、作成した owner session の cookie を browser context に同期する。
 *
 * @param input - Owner organization fixture の作成 option。
 * @param input.request - backend API を呼び出す Playwright request context。
 * @param input.context - owner session を同期する browser context。
 * @param input.token - owner account と organization 名に使う一意 token。
 * @param input.slug - organization slug。未指定時は `token` を使う。
 * @param input.storeSlug - primary store slug を変更する場合の slug。
 * @param input.storeName - primary store name を変更する場合の name。
 * @returns Owner account と organization fixture。
 */
export const createOwnerOrganization = async ({
  request,
  context,
  token,
  slug = token,
  storeSlug,
  storeName,
}: {
  request: APIRequestContext;
  context?: BrowserContext;
  token: string;
  slug?: string;
  storeSlug?: string;
  storeName?: string;
}) => {
  const owner = createAccount(token, 'owner');
  await signUpAccount({ request, account: owner });
  let organization = await createOrganization({
    request,
    name: `E2E ${token}`,
    slug,
  });
  if (
    (storeSlug && storeSlug !== organization.storeSlug) ||
    (storeName && storeName !== organization.name)
  ) {
    organization = await updateStore({
      request,
      organization,
      name: storeName ?? `E2E ${token}`,
      slug: storeSlug ?? organization.storeSlug,
    });
  }
  if (context) {
    await syncRequestCookiesToBrowser(request, context);
  }
  return { owner, organization };
};

/**
 * Organization の primary store に service を作成する。
 *
 * @param input - Service 作成 option。
 * @param input.request - owner または store operator として認証済みの request context。
 * @param input.organization - service を作成する organization fixture。
 * @param input.name - 作成する service name。
 * @param input.capacity - 予約枠の既定定員。
 * @param input.kind - 単発または定期の service 種別。
 * @param input.bookingPolicy - 即時予約または承認制の予約方式。
 * @param input.durationMinutes - service の所要時間。
 * @param input.bookingOpenMinutesBefore - 予約受付開始までの分数。
 * @param input.bookingCloseMinutesBefore - 予約受付終了までの分数。
 * @param input.cancellationDeadlineMinutes - 参加者キャンセル期限までの分数。
 * @param input.timezone - service の timezone。
 * @param input.requiresTicket - 予約に回数券を必須にするか。
 * @param input.isActive - service を公開対象として有効にするか。
 * @returns 作成した service fixture。
 */
export const createService = async ({
  request,
  organization,
  name,
  capacity = 3,
  kind = 'single',
  bookingPolicy = 'instant',
  durationMinutes = 60,
  bookingOpenMinutesBefore = 43_200,
  bookingCloseMinutesBefore = 0,
  cancellationDeadlineMinutes = 1_440,
  timezone = 'Asia/Tokyo',
  requiresTicket = false,
  isActive = true,
}: {
  request: APIRequestContext;
  organization: TestOrganization;
  name: string;
  capacity?: number;
  kind?: 'single' | 'recurring';
  bookingPolicy?: 'instant' | 'approval';
  durationMinutes?: number;
  bookingOpenMinutesBefore?: number;
  bookingCloseMinutesBefore?: number;
  cancellationDeadlineMinutes?: number;
  timezone?: string;
  requiresTicket?: boolean;
  isActive?: boolean;
}): Promise<TestService> => {
  const response = await request.post(`${backendUrl}/api/v1/auth/organizations/services`, {
    data: {
      organizationId: organization.id,
      storeId: organization.storeId,
      name,
      description: `${name} description`,
      kind,
      bookingPolicy,
      durationMinutes,
      capacity,
      bookingOpenMinutesBefore,
      bookingCloseMinutesBefore,
      cancellationDeadlineMinutes,
      timezone,
      requiresTicket,
      isActive,
    },
  });
  const payload = await expectOkJson(response, `create service ${name}`);
  const id = typeof payload.id === 'string' ? payload.id : null;
  expect(id, 'service id should be returned').toBeTruthy();
  return { id: id as string, name };
};

/**
 * 未来日の単発予約枠 fixture に使う日時 input を作る。
 *
 * @param daysFromNow - 現在時刻から何日後の枠にするか。
 * @returns API 用 ISO datetime と画面 form 用 date/time input。
 */
export const futureSlotRange = (daysFromNow = 2) => {
  const start = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  start.setUTCHours(1, 0, 0, 0);
  const end = new Date(start);
  end.setUTCHours(2, 0, 0, 0);
  return {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    dateInput: start.toISOString().slice(0, 10),
    startTime: '10:00',
    endTime: '11:00',
  };
};

/**
 * Service に紐づく単発予約枠を backend API で作成する。
 *
 * @param input - Slot 作成 option。
 * @param input.request - owner または store operator として認証済みの request context。
 * @param input.organization - slot を作成する organization fixture。
 * @param input.service - slot を紐づける service fixture。
 * @param input.startAt - ISO 8601 形式の開始日時。
 * @param input.endAt - ISO 8601 形式の終了日時。
 * @param input.capacity - slot 固有の定員。
 * @param input.staffLabel - slot に表示する staff label。
 * @param input.locationLabel - slot に表示する location label。
 * @returns 作成した slot fixture。
 */
export const createSlot = async ({
  request,
  organization,
  service,
  startAt,
  endAt,
  capacity = 3,
  staffLabel = 'E2E Staff',
  locationLabel = 'E2E Room',
}: {
  request: APIRequestContext;
  organization: TestOrganization;
  service: TestService;
  startAt: string;
  endAt: string;
  capacity?: number;
  staffLabel?: string;
  locationLabel?: string;
}): Promise<TestSlot> => {
  const response = await request.post(`${backendUrl}/api/v1/auth/organizations/slots`, {
    data: {
      organizationId: organization.id,
      storeId: organization.storeId,
      serviceId: service.id,
      startAt,
      endAt,
      capacity,
      staffLabel,
      locationLabel,
    },
  });
  const payload = await expectOkJson(response, `create slot for ${service.name}`);
  const id = typeof payload.id === 'string' ? payload.id : null;
  expect(id, 'slot id should be returned').toBeTruthy();
  return { id: id as string, startAt, endAt };
};

/**
 * Store の public site 設定を更新する。
 *
 * @param input - Public site の公開状態と表示名。
 * @param input.request - owner または store operator として認証済みの request context。
 * @param input.organization - public site を更新する organization fixture。
 * @param input.siteName - 公開ページに表示する site name。
 * @param input.status - 公開状態。
 * @param input.acceptBookings - 公開予約を受け付けるか。
 */
export const updatePublicSiteSetting = async ({
  request,
  organization,
  siteName = organization.name,
  status = 'public',
  acceptBookings = true,
}: {
  request: APIRequestContext;
  organization: TestOrganization;
  siteName?: string;
  status?: 'public' | 'private' | 'suspended';
  acceptBookings?: boolean;
}) => {
  const response = await request.patch(
    `${backendUrl}/api/v1/auth/orgs/${encodeURIComponent(
      organization.slug,
    )}/stores/${encodeURIComponent(organization.storeSlug)}/public-site`,
    {
      data: {
        siteName,
        status,
        acceptBookings,
        noindex: true,
      },
    },
  );
  await expectOkJson(response, `update public site setting for ${organization.slug}`);
};

/**
 * Organization の premium trial を開始する。
 *
 * @param input - Trial 開始対象。
 * @param input.request - owner として認証済みの request context。
 * @param input.organization - trial を開始する organization fixture。
 */
export const startPremiumTrial = async ({
  request,
  organization,
}: {
  request: APIRequestContext;
  organization: TestOrganization;
}) => {
  const response = await request.post(`${backendUrl}/api/v1/auth/organizations/billing/trial`, {
    data: {
      organizationId: organization.id,
    },
  });
  await expectOkJson(response, `start premium trial for ${organization.slug}`);
};

/**
 * Organization scope の管理者または member 招待を作成する。
 *
 * @param input - Organization invitation 作成 option。
 * @param input.request - owner として認証済みの request context。
 * @param input.organization - 招待を作成する organization fixture。
 * @param input.email - 招待先 email address。
 * @param input.role - 招待する organization role。
 * @returns 作成した invitation id。
 */
export const createOrganizationInvitation = async ({
  request,
  organization,
  email,
  role = 'member',
}: {
  request: APIRequestContext;
  organization: TestOrganization;
  email: string;
  role?: 'admin' | 'member';
}) => {
  const response = await request.post(
    `${backendUrl}/api/v1/auth/orgs/${encodeURIComponent(organization.slug)}/invitations`,
    {
      data: {
        email,
        role,
      },
    },
  );
  const payload = await expectOkJson(response, `create invitation for ${email}`);
  const id = typeof payload.id === 'string' ? payload.id : null;
  expect(id, 'invitation id should be returned').toBeTruthy();
  return { id: id as string };
};

/**
 * Organization の primary store に回数券種別を作成する。
 *
 * @param input - Ticket type 作成 option。
 * @param input.request - owner または store operator として認証済みの request context。
 * @param input.organization - ticket type を作成する organization fixture。
 * @param input.name - ticket type name。
 * @param input.totalCount - 1 購入あたりの利用可能回数。
 * @param input.expiresInDays - 購入後の有効日数。
 * @param input.serviceScope - 利用対象 service の範囲。
 * @param input.serviceIds - `serviceScope` が `specific` の場合の対象 service ids。
 * @param input.isActive - ticket type を有効にするか。
 * @param input.isForSale - 参加者の購入申請対象にするか。
 * @returns 作成した ticket type fixture。
 */
export const createTicketType = async ({
  request,
  organization,
  name,
  totalCount = 10,
  expiresInDays,
  serviceScope = 'all',
  serviceIds = [],
  isActive = true,
  isForSale = true,
}: {
  request: APIRequestContext;
  organization: TestOrganization;
  name: string;
  totalCount?: number;
  expiresInDays?: number;
  serviceScope?: 'all' | 'specific';
  serviceIds?: string[];
  isActive?: boolean;
  isForSale?: boolean;
}): Promise<TestTicketType> => {
  const response = await request.post(`${backendUrl}/api/v1/auth/organizations/ticket-types`, {
    data: {
      organizationId: organization.id,
      storeId: organization.storeId,
      name,
      serviceScope,
      serviceIds,
      totalCount,
      expiresInDays,
      isActive,
      isForSale,
    },
  });
  const payload = await expectOkJson(response, `create ticket type ${name}`);
  const id = typeof payload.id === 'string' ? payload.id : null;
  expect(id, 'ticket type id should be returned').toBeTruthy();
  return {
    id: id as string,
    name,
    totalCount,
    expiresInDays:
      typeof payload.expiresInDays === 'number' || payload.expiresInDays === null
        ? payload.expiresInDays
        : expiresInDays,
  };
};

/**
 * Ticket type 一覧から name が一致する fixture を取得する。
 *
 * @param input - 検索対象の organization と ticket type name。
 * @param input.request - owner または store operator として認証済みの request context。
 * @param input.organization - ticket type を検索する organization fixture。
 * @param input.name - 検索する ticket type name。
 * @returns API response から読み取った ticket type fixture。
 */
export const findTicketTypeByName = async ({
  request,
  organization,
  name,
}: {
  request: APIRequestContext;
  organization: TestOrganization;
  name: string;
}): Promise<TestTicketType> => {
  const query = new URLSearchParams({
    organizationId: organization.id,
    storeId: organization.storeId,
  });
  const response = await request.get(
    `${backendUrl}/api/v1/auth/organizations/ticket-types?${query.toString()}`,
  );
  const payload = await parseResponseBody(response);
  expect(
    response.ok(),
    `list ticket types for ${organization.slug}: ${response.status()} ${JSON.stringify(payload)}`,
  ).toBe(true);
  expect(Array.isArray(payload), 'ticket type list should be returned').toBe(true);
  const record = (payload as unknown[]).map(asRecord).find((item) => item?.name === name) ?? null;
  expect(record, `ticket type ${name} should be returned`).toBeTruthy();
  const id = typeof record?.id === 'string' ? record.id : null;
  const totalCount = typeof record?.totalCount === 'number' ? record.totalCount : null;
  expect(id, 'ticket type id should be returned').toBeTruthy();
  expect(totalCount, 'ticket type total count should be returned').toBeTruthy();
  return {
    id: id as string,
    name,
    totalCount: totalCount as number,
    expiresInDays:
      typeof record?.expiresInDays === 'number' || record?.expiresInDays === null
        ? record.expiresInDays
        : undefined,
  };
};

/**
 * Store operator 向けの店舗招待を作成する。
 *
 * @param input - Store invitation 作成 option。
 * @param input.request - owner または manager として認証済みの request context。
 * @param input.organization - 招待を作成する organization fixture。
 * @param input.email - 招待先 email address。
 * @param input.role - 招待する store role。
 * @param input.resend - 既存招待がある場合に再送扱いにするか。
 * @returns 作成した invitation fixture。
 */
export const createStoreInvitation = async ({
  request,
  organization,
  email,
  role = 'staff',
  resend = false,
}: {
  request: APIRequestContext;
  organization: TestOrganization;
  email: string;
  role?: 'manager' | 'staff';
  resend?: boolean;
}): Promise<TestInvitation> => {
  const response = await request.post(
    `${backendUrl}/api/v1/auth/orgs/${encodeURIComponent(
      organization.slug,
    )}/stores/${encodeURIComponent(organization.storeSlug)}/invitations`,
    {
      data: {
        email,
        role,
        resend,
      },
    },
  );
  const payload = await expectOkJson(response, `create store invitation for ${email}`);
  const id = typeof payload.id === 'string' ? payload.id : null;
  expect(id, 'store invitation id should be returned').toBeTruthy();
  return { id: id as string, email };
};

/**
 * 参加者向けの店舗招待を作成する。
 *
 * @param input - Participant invitation 作成 option。
 * @param input.request - owner または store operator として認証済みの request context。
 * @param input.organization - 招待を作成する organization fixture。
 * @param input.email - 招待先 email address。
 * @param input.participantName - 招待後に登録される participant name。
 * @param input.resend - 既存招待がある場合に再送扱いにするか。
 * @returns 作成した invitation fixture。
 */
export const createParticipantInvitation = async ({
  request,
  organization,
  email,
  participantName,
  resend = false,
}: {
  request: APIRequestContext;
  organization: TestOrganization;
  email: string;
  participantName: string;
  resend?: boolean;
}): Promise<TestInvitation> => {
  const response = await request.post(
    `${backendUrl}/api/v1/auth/orgs/${encodeURIComponent(
      organization.slug,
    )}/stores/${encodeURIComponent(organization.storeSlug)}/invitations`,
    {
      data: {
        email,
        role: 'participant',
        participantName,
        resend,
      },
    },
  );
  const payload = await expectOkJson(response, `create participant invitation for ${email}`);
  const id = typeof payload.id === 'string' ? payload.id : null;
  expect(id, 'participant invitation id should be returned').toBeTruthy();
  return { id: id as string, email };
};

/**
 * Store invitation 一覧から email と subject kind が一致する招待を探す。
 *
 * @param input - 検索対象の store と招待先。
 * @param input.request - owner または store operator として認証済みの request context。
 * @param input.organization - invitation を検索する organization fixture。
 * @param input.email - 検索する招待先 email address。
 * @param input.subjectKind - store operator と participant のどちらの招待を探すか。
 * @returns API response から読み取った invitation fixture。
 */
export const findStoreInvitationByEmail = async ({
  request,
  organization,
  email,
  subjectKind,
}: {
  request: APIRequestContext;
  organization: TestOrganization;
  email: string;
  subjectKind?: 'store_operator' | 'participant';
}): Promise<TestInvitation> => {
  const response = await request.get(
    `${backendUrl}/api/v1/auth/orgs/${encodeURIComponent(
      organization.slug,
    )}/stores/${encodeURIComponent(organization.storeSlug)}/invitations`,
  );
  const payload = await parseResponseBody(response);
  expect(
    response.ok(),
    `list store invitations for ${organization.slug}: ${response.status()} ${JSON.stringify(payload)}`,
  ).toBe(true);
  expect(Array.isArray(payload), 'store invitation list should be returned').toBe(true);
  const record =
    (payload as unknown[])
      .map(asRecord)
      .find(
        (item) => item?.email === email && (!subjectKind || item.subjectKind === subjectKind),
      ) ?? null;
  expect(record, `store invitation for ${email} should be returned`).toBeTruthy();
  const id = typeof record?.id === 'string' ? record.id : null;
  expect(id, 'store invitation id should be returned').toBeTruthy();
  return { id: id as string, email };
};

/**
 * 現在ログイン中の account で organization invitation を承諾する。
 *
 * @param input - 承諾対象の invitation。
 * @param input.request - 招待先 account として認証済みの request context。
 * @param input.invitation - 承諾する invitation fixture。
 */
export const acceptInvitation = async ({
  request,
  invitation,
}: {
  request: APIRequestContext;
  invitation: TestInvitation;
}) => {
  const response = await request.post(
    `${backendUrl}/api/v1/auth/invitations/${encodeURIComponent(invitation.id)}/accept`,
    {
      data: {},
    },
  );
  await expectOkJson(response, `accept invitation ${invitation.id}`);
};

/**
 * 現在ログイン中の account を organization の参加者として自己登録する。
 *
 * @param input - 自己登録先の organization。
 * @param input.request - 参加者 account として認証済みの request context。
 * @param input.organization - 自己登録先の organization fixture。
 * @returns 作成または取得された participant fixture。
 */
export const selfEnrollParticipant = async ({
  request,
  organization,
}: {
  request: APIRequestContext;
  organization: TestOrganization;
}): Promise<TestParticipant> => {
  const response = await request.post(
    `${backendUrl}/api/v1/auth/organizations/participants/self-enroll`,
    {
      data: {
        organizationId: organization.id,
        storeId: organization.storeId,
      },
    },
  );
  const payload = await expectOkJson(response, `self-enroll participant for ${organization.slug}`);
  const participant = payload.participant;
  expect(
    typeof participant === 'object' && participant !== null,
    'participant payload should be returned',
  ).toBe(true);
  const record = participant as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : null;
  const email = typeof record.email === 'string' ? record.email : null;
  const name = typeof record.name === 'string' ? record.name : null;
  expect(id, 'participant id should be returned').toBeTruthy();
  expect(email, 'participant email should be returned').toBeTruthy();
  expect(name, 'participant name should be returned').toBeTruthy();
  return { id: id as string, email: email as string, name: name as string };
};

/**
 * 現在ログイン中の参加者として回数券購入申請を作成する。
 *
 * @param input - 購入申請の対象と支払い方法。
 * @param input.request - 参加者 account として認証済みの request context。
 * @param input.organization - 購入申請先の organization fixture。
 * @param input.ticketType - 購入対象の ticket type fixture。
 * @param input.paymentMethod - 購入申請に記録する支払い方法。
 * @returns 作成した ticket purchase fixture。
 */
export const createTicketPurchase = async ({
  request,
  organization,
  ticketType,
  paymentMethod = 'cash_on_site',
}: {
  request: APIRequestContext;
  organization: TestOrganization;
  ticketType: TestTicketType;
  paymentMethod?: 'cash_on_site' | 'bank_transfer';
}): Promise<TestTicketPurchase> => {
  const response = await request.post(`${backendUrl}/api/v1/auth/organizations/ticket-purchases`, {
    data: {
      organizationId: organization.id,
      storeId: organization.storeId,
      ticketTypeId: ticketType.id,
      paymentMethod,
    },
  });
  const payload = await expectOkJson(response, `create ticket purchase for ${ticketType.name}`);
  const id = typeof payload.id === 'string' ? payload.id : null;
  expect(id, 'ticket purchase id should be returned').toBeTruthy();
  return {
    id: id as string,
    ticketTypeId: ticketType.id,
    participantId: typeof payload.participantId === 'string' ? payload.participantId : undefined,
  };
};

/**
 * Store operator 権限で回数券購入申請を承認する。
 *
 * @param input - 承認対象の purchase。
 * @param input.request - owner または store operator として認証済みの request context。
 * @param input.organization - purchase が属する organization fixture。
 * @param input.purchase - 承認する purchase fixture。
 */
export const approveTicketPurchase = async ({
  request,
  organization,
  purchase,
}: {
  request: APIRequestContext;
  organization: TestOrganization;
  purchase: TestTicketPurchase;
}) => {
  const response = await request.post(
    `${backendUrl}/api/v1/auth/organizations/ticket-purchases/approve`,
    {
      data: {
        purchaseId: purchase.id,
        storeId: organization.storeId,
      },
    },
  );
  await expectOkJson(response, `approve ticket purchase ${purchase.id}`);
};

/**
 * Scoped route の初期化漏れを示す error message が画面に出ていないことを検証する。
 *
 * @param page - 検証対象の Playwright page。
 */
export const expectNoScopedContextError = async (page: Page) => {
  await expect(page.getByText('URL に組織/店舗コンテキストがありません。')).toHaveCount(0);
  await expect(
    page.getByText('利用中の組織を `/admin/dashboard` で選択してください。'),
  ).toHaveCount(0);
};
