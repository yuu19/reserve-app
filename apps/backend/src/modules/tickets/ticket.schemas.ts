import { createRoute, z } from '@hono/zod-openapi';
import { TICKET_PURCHASE_METHOD, TICKET_PURCHASE_STATUS } from '../../booking/constants.js';

const isoDateTimeSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid ISO datetime');

const boolStringSchema = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'));

/**
 * organization と任意の classroom scope を受け取る共通 query を検証します。
 */
export const orgQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
});

/**
 * staff が ticket type を作成する入力を検証します。
 */
export const ticketTypeCreateBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  serviceIds: z.array(z.string().min(1)).optional(),
  totalCount: z.int().min(1).max(1000),
  expiresInDays: z.int().min(1).max(3650).optional(),
  isActive: z.boolean().optional(),
  isForSale: z.boolean().optional(),
  stripePriceId: z.string().trim().min(1).max(200).optional(),
});

/**
 * staff 向け ticket type 一覧 query を検証します。
 */
export const ticketTypeListQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
  isActive: boolStringSchema,
});

/**
 * staff が participant に ticket pack を付与する入力を検証します。
 */
export const ticketPackGrantBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
  participantId: z.string().min(1),
  ticketTypeId: z.string().min(1),
  count: z.int().min(1).max(1000).optional(),
  expiresAt: isoDateTimeSchema.optional(),
});

/**
 * participant 自身の ticket pack 一覧 query を検証します。
 */
export const ticketPackMineQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
});

const ticketPurchaseMethodSchema = z.enum([
  TICKET_PURCHASE_METHOD.STRIPE,
  TICKET_PURCHASE_METHOD.CASH_ON_SITE,
  TICKET_PURCHASE_METHOD.BANK_TRANSFER,
]);

const ticketPurchaseStatusSchema = z.enum([
  TICKET_PURCHASE_STATUS.PENDING_PAYMENT,
  TICKET_PURCHASE_STATUS.PENDING_APPROVAL,
  TICKET_PURCHASE_STATUS.APPROVED,
  TICKET_PURCHASE_STATUS.REJECTED,
  TICKET_PURCHASE_STATUS.CANCELLED_BY_PARTICIPANT,
]);

/**
 * participant が ticket purchase を作成する入力を検証します。
 */
export const ticketPurchaseCreateBodySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
  ticketTypeId: z.string().min(1),
  paymentMethod: ticketPurchaseMethodSchema,
});

/**
 * participant 自身の ticket purchase 一覧 query を検証します。
 */
export const ticketPurchaseMineQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
  status: ticketPurchaseStatusSchema.optional(),
});

/**
 * staff 向け ticket purchase 一覧 query を検証します。
 */
export const ticketPurchaseListQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
  participantId: z.string().min(1).optional(),
  paymentMethod: ticketPurchaseMethodSchema.optional(),
  status: ticketPurchaseStatusSchema.optional(),
});

/**
 * staff が ticket purchase を承認する入力を検証します。
 */
export const ticketPurchaseApproveBodySchema = z.object({
  purchaseId: z.string().min(1),
  classroomId: z.string().min(1).optional(),
});

/**
 * staff が ticket purchase を却下する入力を検証します。
 */
export const ticketPurchaseRejectBodySchema = z.object({
  purchaseId: z.string().min(1),
  classroomId: z.string().min(1).optional(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * participant が自身の ticket purchase を取り消す入力を検証します。
 */
export const ticketPurchaseCancelBodySchema = z.object({
  purchaseId: z.string().min(1),
  classroomId: z.string().min(1).optional(),
});

/**
 * organization/classroom scope を受け取る参加者向け query 型です。
 */
export type OrgQuery = z.infer<typeof orgQuerySchema>;
/**
 * ticket type 作成 usecase が受け取る検証済み body 型です。
 */
export type TicketTypeCreateBody = z.infer<typeof ticketTypeCreateBodySchema>;
/**
 * ticket type 一覧 usecase が受け取る検証済み query 型です。
 */
export type TicketTypeListQuery = z.infer<typeof ticketTypeListQuerySchema>;
/**
 * ticket pack 手動付与 usecase が受け取る検証済み body 型です。
 */
export type TicketPackGrantBody = z.infer<typeof ticketPackGrantBodySchema>;
/**
 * participant 自身の ticket pack 一覧 usecase が受け取る検証済み query 型です。
 */
export type TicketPackMineQuery = z.infer<typeof ticketPackMineQuerySchema>;
/**
 * ticket purchase 作成 usecase が受け取る検証済み body 型です。
 */
export type TicketPurchaseCreateBody = z.infer<typeof ticketPurchaseCreateBodySchema>;
/**
 * participant 自身の ticket purchase 一覧 usecase が受け取る検証済み query 型です。
 */
export type TicketPurchaseMineQuery = z.infer<typeof ticketPurchaseMineQuerySchema>;
/**
 * staff 向け ticket purchase 一覧 usecase が受け取る検証済み query 型です。
 */
export type TicketPurchaseListQuery = z.infer<typeof ticketPurchaseListQuerySchema>;
/**
 * ticket purchase 承認 usecase が受け取る検証済み body 型です。
 */
export type TicketPurchaseApproveBody = z.infer<typeof ticketPurchaseApproveBodySchema>;
/**
 * ticket purchase 却下 usecase が受け取る検証済み body 型です。
 */
export type TicketPurchaseRejectBody = z.infer<typeof ticketPurchaseRejectBodySchema>;
/**
 * ticket purchase 取り消し usecase が受け取る検証済み body 型です。
 */
export type TicketPurchaseCancelBody = z.infer<typeof ticketPurchaseCancelBodySchema>;

/**
 * staff が ticket type を作成する OpenAPI 定義です。
 */
export const createTicketTypeRoute = createRoute({
  method: 'post',
  path: '/organizations/ticket-types',
  tags: ['Tickets'],
  summary: 'Create ticket type',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: ticketTypeCreateBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Ticket type created' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    422: { description: 'Validation error' },
  },
});

/**
 * staff が管理対象 ticket type を一覧する OpenAPI 定義です。
 */
export const listTicketTypesRoute = createRoute({
  method: 'get',
  path: '/organizations/ticket-types',
  tags: ['Tickets'],
  summary: 'List ticket types',
  request: {
    query: ticketTypeListQuerySchema,
  },
  responses: {
    200: { description: 'Ticket type list' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

/**
 * staff が participant に ticket pack を手動付与する OpenAPI 定義です。
 */
export const grantTicketPackRoute = createRoute({
  method: 'post',
  path: '/organizations/ticket-packs/grant',
  tags: ['Tickets'],
  summary: 'Grant ticket pack',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: ticketPackGrantBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Ticket pack granted' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    422: { description: 'Validation error' },
  },
});

/**
 * participant が自身の ticket pack を一覧する OpenAPI 定義です。
 */
export const listMyTicketPacksRoute = createRoute({
  method: 'get',
  path: '/organizations/ticket-packs/mine',
  tags: ['Tickets'],
  summary: 'List my ticket packs',
  request: {
    query: ticketPackMineQuerySchema,
  },
  responses: {
    200: { description: 'Ticket pack list' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

/**
 * participant が購入可能な ticket type を一覧する OpenAPI 定義です。
 */
export const listPurchasableTicketTypesRoute = createRoute({
  method: 'get',
  path: '/organizations/ticket-types/purchasable',
  tags: ['Tickets'],
  summary: 'List purchasable ticket types',
  request: {
    query: orgQuerySchema,
  },
  responses: {
    200: { description: 'Purchasable ticket type list' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

/**
 * participant が ticket purchase を作成する OpenAPI 定義です。
 */
export const createTicketPurchaseRoute = createRoute({
  method: 'post',
  path: '/organizations/ticket-purchases',
  tags: ['Tickets'],
  summary: 'Create ticket purchase',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: ticketPurchaseCreateBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Ticket purchase created' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    409: { description: 'State conflict' },
    422: { description: 'Validation error' },
  },
});

/**
 * participant が自身の ticket purchase を一覧する OpenAPI 定義です。
 */
export const listMyTicketPurchasesRoute = createRoute({
  method: 'get',
  path: '/organizations/ticket-purchases/mine',
  tags: ['Tickets'],
  summary: 'List my ticket purchases',
  request: {
    query: ticketPurchaseMineQuerySchema,
  },
  responses: {
    200: { description: 'Ticket purchase list for participant' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

/**
 * staff が管理対象 ticket purchase を一覧する OpenAPI 定義です。
 */
export const listTicketPurchasesRoute = createRoute({
  method: 'get',
  path: '/organizations/ticket-purchases',
  tags: ['Tickets'],
  summary: 'List ticket purchases for staff',
  request: {
    query: ticketPurchaseListQuerySchema,
  },
  responses: {
    200: { description: 'Ticket purchase list for staff' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
  },
});

/**
 * staff が承認待ち ticket purchase を承認する OpenAPI 定義です。
 */
export const approveTicketPurchaseRoute = createRoute({
  method: 'post',
  path: '/organizations/ticket-purchases/approve',
  tags: ['Tickets'],
  summary: 'Approve ticket purchase',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: ticketPurchaseApproveBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Ticket purchase approved' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    409: { description: 'State conflict' },
  },
});

/**
 * staff が承認待ち ticket purchase を却下する OpenAPI 定義です。
 */
export const rejectTicketPurchaseRoute = createRoute({
  method: 'post',
  path: '/organizations/ticket-purchases/reject',
  tags: ['Tickets'],
  summary: 'Reject ticket purchase',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: ticketPurchaseRejectBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Ticket purchase rejected' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    409: { description: 'State conflict' },
  },
});

/**
 * participant が自身の承認待ち ticket purchase を取り消す OpenAPI 定義です。
 */
export const cancelTicketPurchaseRoute = createRoute({
  method: 'post',
  path: '/organizations/ticket-purchases/cancel',
  tags: ['Tickets'],
  summary: 'Cancel ticket purchase by participant',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: ticketPurchaseCancelBodySchema,
        },
      },
    },
  },
  responses: {
    200: { description: 'Ticket purchase canceled' },
    401: { description: 'Unauthorized' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    409: { description: 'State conflict' },
  },
});
