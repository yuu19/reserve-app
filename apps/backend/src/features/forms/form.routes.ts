import { createRoute, z } from '@hono/zod-openapi';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import { resolveOrganizationStoreContext } from '../../domain/booking/authorization.js';
import * as dbSchema from '../../infra/db/schema.js';
import { runDatabaseTransaction } from '../../infra/db/transaction.js';
import type { BookingRouteContext } from '../booking/booking-route-context.js';
import { isUniqueConstraintError } from '../booking/booking-usecase-helpers.js';
import {
  FORM_FIELD_TYPES,
  FORM_TARGET_TYPES,
  FORM_TYPES,
  isFormFieldType,
  isFormTargetType,
  isFormType,
  listAssignmentsForForm,
  listFormFields,
  listLatestFormVersions,
  normalizeFormOptions,
  parseFormOptionsJson,
  resolveRequiredForms,
  serializeFieldRows,
  validateFieldSnapshots,
  type FormFieldSnapshot,
  type FormTargetType,
  type FormType,
} from './form.logic.js';

const organizationStoreRouteParamsSchema = z.object({
  orgSlug: z.string().min(1),
  storeSlug: z.string().min(1),
});

const formRouteParamsSchema = organizationStoreRouteParamsSchema.extend({
  formId: z.string().min(1),
});

const assignmentRouteParamsSchema = formRouteParamsSchema.extend({
  assignmentId: z.string().min(1),
});

const formSubmissionRouteParamsSchema = organizationStoreRouteParamsSchema.extend({
  submissionId: z.string().min(1),
});

const formTypeSchema = z.enum(FORM_TYPES);
const formFieldTypeSchema = z.enum(FORM_FIELD_TYPES);
const formTargetTypeSchema = z.enum(FORM_TARGET_TYPES);

const formOptionSchema = z.object({
  value: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(200),
});

const formFieldInputSchema = z.object({
  id: z.string().min(1).optional(),
  fieldKey: z.string().trim().min(1).max(120),
  fieldType: formFieldTypeSchema,
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  placeholder: z.string().trim().max(200).nullable().optional(),
  required: z.boolean().default(false),
  options: z.array(formOptionSchema).default([]),
  sortOrder: z.number().int().min(0).optional(),
});

const formFieldPayloadSchema = formFieldInputSchema.extend({
  id: z.string().optional(),
  description: z.string().nullable(),
  placeholder: z.string().nullable(),
  options: z.array(formOptionSchema),
  sortOrder: z.number(),
});

const formAssignmentPayloadSchema = z.object({
  id: z.string(),
  formType: formTypeSchema,
  targetType: formTargetTypeSchema,
  targetId: z.string(),
  formTemplateId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const formVersionPayloadSchema = z.object({
  id: z.string(),
  versionNumber: z.number(),
  publishedAt: z.string(),
});

const formPayloadSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  storeId: z.string(),
  formType: formTypeSchema,
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(['draft', 'published', 'archived']),
  currentPublishedVersionId: z.string().nullable(),
  currentPublishedVersion: formVersionPayloadSchema.nullable(),
  fields: z.array(formFieldPayloadSchema),
  assignments: z.array(formAssignmentPayloadSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
});

const requiredFormFieldPayloadSchema = formFieldPayloadSchema.omit({ id: true });

const requiredFormsPayloadSchema = z.object({
  formContextHash: z.string(),
  forms: z.array(
    z.object({
      formTemplateId: z.string(),
      formTemplateVersionId: z.string(),
      formType: formTypeSchema,
      name: z.string(),
      description: z.string().nullable(),
      versionNumber: z.number(),
      fields: z.array(requiredFormFieldPayloadSchema),
    }),
  ),
});

const formListPayloadSchema = z.object({
  forms: z.array(formPayloadSchema),
});

const formListQuerySchema = z.object({
  formType: formTypeSchema.optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  targetType: formTargetTypeSchema.optional(),
});

const requiredFormsQuerySchema = z.object({
  serviceId: z.string().min(1).optional(),
  slotId: z.string().min(1).optional(),
});

const createFormBodySchema = z.object({
  formType: formTypeSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  fields: z.array(formFieldInputSchema).default([]),
});

const updateFormBodySchema = z.object({
  formType: formTypeSchema.optional(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  fields: z.array(formFieldInputSchema).optional(),
});

const createAssignmentBodySchema = z.object({
  targetType: formTargetTypeSchema,
  targetId: z.string().trim().min(1).max(200),
});

const formSubmissionsPayloadSchema = z.object({
  submissions: z.array(
    z.object({
      id: z.string(),
      formTemplateId: z.string(),
      formTemplateVersionId: z.string(),
      formType: formTypeSchema,
      bookingId: z.string().nullable(),
      participantId: z.string().nullable(),
      customerNameSnapshot: z.string().nullable(),
      customerEmailSnapshot: z.string().nullable(),
      source: z.string(),
      submittedAt: z.string(),
      answerCount: z.number(),
    }),
  ),
});

const formSubmissionDetailPayloadSchema = z.object({
  id: z.string(),
  formTemplateId: z.string(),
  formTemplateVersionId: z.string(),
  formType: formTypeSchema,
  formName: z.string(),
  versionNumber: z.number(),
  bookingId: z.string().nullable(),
  participantId: z.string().nullable(),
  customerNameSnapshot: z.string().nullable(),
  customerEmailSnapshot: z.string().nullable(),
  source: z.string(),
  submittedAt: z.string(),
  answers: z.array(
    z.object({
      id: z.string(),
      fieldKey: z.string(),
      fieldType: formFieldTypeSchema,
      labelSnapshot: z.string(),
      value: z.unknown(),
      sortOrder: z.number(),
      createdAt: z.string(),
    }),
  ),
});

const messageResponse = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: z.object({
        message: z.string(),
      }),
    },
  },
});

const listFormsRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/forms',
  tags: ['Forms'],
  summary: 'List forms for a store',
  request: {
    params: organizationStoreRouteParamsSchema,
    query: formListQuerySchema,
  },
  responses: {
    200: {
      description: 'Form list',
      content: { 'application/json': { schema: formListPayloadSchema } },
    },
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Organization or store not found'),
  },
});

const createFormRoute = createRoute({
  method: 'post',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/forms',
  tags: ['Forms'],
  summary: 'Create a form',
  request: {
    params: organizationStoreRouteParamsSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: createFormBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'Created form',
      content: { 'application/json': { schema: formPayloadSchema } },
    },
    400: messageResponse('Validation error'),
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Organization or store not found'),
  },
});

const getRequiredFormsRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/forms/required',
  tags: ['Forms'],
  summary: 'Resolve required forms for a booking context',
  request: {
    params: organizationStoreRouteParamsSchema,
    query: requiredFormsQuerySchema,
  },
  responses: {
    200: {
      description: 'Required forms',
      content: { 'application/json': { schema: requiredFormsPayloadSchema } },
    },
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Organization, store, service, or slot not found'),
  },
});

const getFormRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}',
  tags: ['Forms'],
  summary: 'Get a form',
  request: { params: formRouteParamsSchema },
  responses: {
    200: {
      description: 'Form detail',
      content: { 'application/json': { schema: formPayloadSchema } },
    },
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Form not found'),
  },
});

const updateFormRoute = createRoute({
  method: 'patch',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}',
  tags: ['Forms'],
  summary: 'Update a form',
  request: {
    params: formRouteParamsSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: updateFormBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'Updated form',
      content: { 'application/json': { schema: formPayloadSchema } },
    },
    400: messageResponse('Validation error'),
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Form not found'),
    409: messageResponse('State conflict'),
  },
});

const publishFormRoute = createRoute({
  method: 'post',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/publish',
  tags: ['Forms'],
  summary: 'Publish a form version',
  request: { params: formRouteParamsSchema },
  responses: {
    200: {
      description: 'Published form',
      content: { 'application/json': { schema: formPayloadSchema } },
    },
    400: messageResponse('Validation error'),
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Form not found'),
  },
});

const archiveFormRoute = createRoute({
  method: 'post',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/archive',
  tags: ['Forms'],
  summary: 'Archive a form',
  request: { params: formRouteParamsSchema },
  responses: {
    200: {
      description: 'Archived form',
      content: { 'application/json': { schema: formPayloadSchema } },
    },
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Form not found'),
  },
});

const listFormAssignmentsRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/assignments',
  tags: ['Forms'],
  summary: 'List form assignments',
  request: { params: formRouteParamsSchema },
  responses: {
    200: {
      description: 'Form assignments',
      content: {
        'application/json': {
          schema: z.object({ assignments: z.array(formAssignmentPayloadSchema) }),
        },
      },
    },
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Form not found'),
  },
});

const createFormAssignmentRoute = createRoute({
  method: 'post',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/assignments',
  tags: ['Forms'],
  summary: 'Create a form assignment',
  request: {
    params: formRouteParamsSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: createAssignmentBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'Form assignments',
      content: {
        'application/json': {
          schema: z.object({ assignments: z.array(formAssignmentPayloadSchema) }),
        },
      },
    },
    400: messageResponse('Validation error'),
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Form not found'),
    409: messageResponse('Assignment conflict'),
  },
});

const deleteFormAssignmentRoute = createRoute({
  method: 'delete',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/assignments/{assignmentId}',
  tags: ['Forms'],
  summary: 'Delete a form assignment',
  request: { params: assignmentRouteParamsSchema },
  responses: {
    200: {
      description: 'Form assignments',
      content: {
        'application/json': {
          schema: z.object({ assignments: z.array(formAssignmentPayloadSchema) }),
        },
      },
    },
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Assignment not found'),
  },
});

const listFormSubmissionsRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/submissions',
  tags: ['Forms'],
  summary: 'List form submissions',
  request: { params: formRouteParamsSchema },
  responses: {
    200: {
      description: 'Form submissions',
      content: { 'application/json': { schema: formSubmissionsPayloadSchema } },
    },
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Form not found'),
  },
});

const getFormSubmissionRoute = createRoute({
  method: 'get',
  path: '/orgs/{orgSlug}/stores/{storeSlug}/form-submissions/{submissionId}',
  tags: ['Forms'],
  summary: 'Get form submission detail',
  request: { params: formSubmissionRouteParamsSchema },
  responses: {
    200: {
      description: 'Form submission detail',
      content: { 'application/json': { schema: formSubmissionDetailPayloadSchema } },
    },
    401: messageResponse('Unauthorized'),
    403: messageResponse('Forbidden'),
    404: messageResponse('Form submission not found'),
  },
});

type StoreContext = NonNullable<Awaited<ReturnType<typeof resolveOrganizationStoreContext>>>;
type FormPayload = z.infer<typeof formPayloadSchema>;
type FormAssignmentPayload = z.infer<typeof formAssignmentPayloadSchema>;

const toIso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null;

const normalizeOptionalText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

const serializeAssignment = (assignment: {
  id: string;
  formType: string;
  targetType: string;
  targetId: string;
  formTemplateId: string;
  createdAt: Date;
  updatedAt: Date;
}): FormAssignmentPayload => ({
  id: assignment.id,
  formType: isFormType(assignment.formType) ? assignment.formType : 'reservation_input',
  targetType: isFormTargetType(assignment.targetType) ? assignment.targetType : 'store',
  targetId: assignment.targetId,
  formTemplateId: assignment.formTemplateId,
  createdAt: assignment.createdAt.toISOString(),
  updatedAt: assignment.updatedAt.toISOString(),
});

const serializeFields = (
  fields: Array<{
    id?: string;
    fieldKey: string;
    fieldType: string;
    label: string;
    description: string | null;
    placeholder: string | null;
    required: boolean;
    optionsJson: string | null;
    sortOrder: number;
  }>,
): FormPayload['fields'] =>
  fields.map((field, index) => ({
    id: field.id,
    fieldKey: field.fieldKey,
    fieldType: isFormFieldType(field.fieldType) ? field.fieldType : 'text',
    label: field.label,
    description: field.description,
    placeholder: field.placeholder,
    required: field.required,
    options: parseFormOptionsJson(field.optionsJson),
    sortOrder: field.sortOrder ?? index,
  }));

const serializeForm = async ({
  ctx,
  template,
}: {
  ctx: BookingRouteContext;
  template: typeof dbSchema.formTemplate.$inferSelect;
}): Promise<FormPayload> => {
  const [fields, assignments, versions] = await Promise.all([
    listFormFields({ database: ctx.database, formTemplateId: template.id }),
    listAssignmentsForForm({ database: ctx.database, formTemplateId: template.id }),
    listLatestFormVersions({ database: ctx.database, formTemplateIds: [template.id] }),
  ]);
  const currentVersion =
    versions.find(
      (version: typeof dbSchema.formTemplateVersion.$inferSelect) =>
        version.id === template.currentPublishedVersionId,
    ) ?? null;
  const status: FormPayload['status'] =
    template.status === 'published' || template.status === 'archived' ? template.status : 'draft';

  return {
    id: template.id,
    organizationId: template.organizationId,
    storeId: template.storeId,
    formType: isFormType(template.formType) ? template.formType : 'reservation_input',
    name: template.name,
    description: template.description,
    status,
    currentPublishedVersionId: template.currentPublishedVersionId,
    currentPublishedVersion: currentVersion
      ? {
          id: currentVersion.id,
          versionNumber: currentVersion.versionNumber,
          publishedAt: currentVersion.publishedAt.toISOString(),
        }
      : null,
    fields: serializeFields(fields),
    assignments: assignments.map((assignment: typeof dbSchema.formAssignment.$inferSelect) =>
      serializeAssignment(assignment),
    ),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
    archivedAt: toIso(template.archivedAt),
  };
};

const getStoreContext = async ({
  ctx,
  orgSlug,
  storeSlug,
}: {
  ctx: BookingRouteContext;
  orgSlug: string;
  storeSlug: string;
}) =>
  resolveOrganizationStoreContext({
    database: ctx.database,
    organizationSlug: orgSlug,
    storeSlug,
  });

const requireStoreManager = async ({
  ctx,
  headers,
  storeContext,
}: {
  ctx: BookingRouteContext;
  headers: Headers;
  storeContext: StoreContext;
}): Promise<{ ok: true; userId: string } | { ok: false; status: 401 | 403; message: string }> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return { ok: false, status: 401, message: 'Unauthorized' };
  }
  const hasAccess = await ctx.canManageStoreScope({
    organizationId: storeContext.organizationId,
    storeId: storeContext.storeId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return { ok: false, status: 403, message: 'Forbidden' };
  }
  return { ok: true, userId: identity.userId };
};

const requireSubmissionReader = async ({
  ctx,
  headers,
  storeContext,
}: {
  ctx: BookingRouteContext;
  headers: Headers;
  storeContext: StoreContext;
}): Promise<{ ok: true; userId: string } | { ok: false; status: 401 | 403; message: string }> => {
  const identity = await ctx.requireIdentity(headers);
  if (!identity) {
    return { ok: false, status: 401, message: 'Unauthorized' };
  }
  const hasAccess = await ctx.canManageBookingsScope({
    organizationId: storeContext.organizationId,
    storeId: storeContext.storeId,
    userId: identity.userId,
  });
  if (!hasAccess) {
    return { ok: false, status: 403, message: 'Forbidden' };
  }
  return { ok: true, userId: identity.userId };
};

const getFormTemplate = async ({
  ctx,
  storeContext,
  formId,
}: {
  ctx: BookingRouteContext;
  storeContext: StoreContext;
  formId: string;
}) => {
  const rows = await ctx.database
    .select()
    .from(dbSchema.formTemplate)
    .where(
      and(
        eq(dbSchema.formTemplate.id, formId),
        eq(dbSchema.formTemplate.organizationId, storeContext.organizationId),
        eq(dbSchema.formTemplate.storeId, storeContext.storeId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
};

const toFieldSnapshots = (
  fields: Array<z.infer<typeof formFieldInputSchema>>,
): FormFieldSnapshot[] =>
  fields.map((field, index) => ({
    fieldKey: field.fieldKey.trim(),
    fieldType: field.fieldType,
    label: field.label.trim(),
    description: normalizeOptionalText(field.description),
    placeholder: field.fieldType === 'consent' ? null : normalizeOptionalText(field.placeholder),
    required: field.required,
    options:
      field.fieldType === 'radio' || field.fieldType === 'select' || field.fieldType === 'checkbox'
        ? normalizeFormOptions(field.options)
        : [],
    sortOrder: field.sortOrder ?? index,
  }));

const replaceFields = async ({
  database,
  formTemplateId,
  fields,
  now,
}: {
  database: BookingRouteContext['database'];
  formTemplateId: string;
  fields: FormFieldSnapshot[];
  now: Date;
}) => {
  await database
    .delete(dbSchema.formField)
    .where(eq(dbSchema.formField.formTemplateId, formTemplateId));
  if (fields.length === 0) {
    return;
  }
  await database.insert(dbSchema.formField).values(
    fields.map((field) => ({
      id: crypto.randomUUID(),
      formTemplateId,
      fieldKey: field.fieldKey,
      fieldType: field.fieldType,
      label: field.label,
      description: field.description,
      placeholder: field.placeholder,
      required: field.required,
      optionsJson: field.options.length > 0 ? JSON.stringify(field.options) : null,
      validationJson: null,
      sortOrder: field.sortOrder,
      createdAt: now,
      updatedAt: now,
    })),
  );
};

const validateAssignmentTarget = async ({
  ctx,
  storeContext,
  targetType,
  targetId,
}: {
  ctx: BookingRouteContext;
  storeContext: StoreContext;
  targetType: FormTargetType;
  targetId: string;
}): Promise<boolean> => {
  if (targetType === 'store') {
    return targetId === storeContext.storeId;
  }

  if (targetType === 'service') {
    const rows = await ctx.database
      .select({ id: dbSchema.service.id })
      .from(dbSchema.service)
      .where(
        and(
          eq(dbSchema.service.id, targetId),
          eq(dbSchema.service.organizationId, storeContext.organizationId),
          eq(dbSchema.service.storeId, storeContext.storeId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  const rows = await ctx.database
    .select({ id: dbSchema.slot.id })
    .from(dbSchema.slot)
    .where(
      and(
        eq(dbSchema.slot.id, targetId),
        eq(dbSchema.slot.organizationId, storeContext.organizationId),
        eq(dbSchema.slot.storeId, storeContext.storeId),
      ),
    )
    .limit(1);
  return rows.length > 0;
};

const resolveRequiredFormsContext = async ({
  ctx,
  storeContext,
  serviceId,
  slotId,
}: {
  ctx: BookingRouteContext;
  storeContext: StoreContext;
  serviceId?: string | null;
  slotId?: string | null;
}): Promise<{ serviceId?: string; slotId?: string } | null> => {
  if (slotId) {
    const rows = await ctx.database
      .select({
        slotId: dbSchema.slot.id,
        serviceId: dbSchema.slot.serviceId,
      })
      .from(dbSchema.slot)
      .where(
        and(
          eq(dbSchema.slot.id, slotId),
          eq(dbSchema.slot.organizationId, storeContext.organizationId),
          eq(dbSchema.slot.storeId, storeContext.storeId),
        ),
      )
      .limit(1);
    const slot = rows[0] ?? null;
    if (!slot || (serviceId && serviceId !== slot.serviceId)) {
      return null;
    }
    return { serviceId: slot.serviceId, slotId: slot.slotId };
  }

  if (serviceId) {
    const rows = await ctx.database
      .select({ id: dbSchema.service.id })
      .from(dbSchema.service)
      .where(
        and(
          eq(dbSchema.service.id, serviceId),
          eq(dbSchema.service.organizationId, storeContext.organizationId),
          eq(dbSchema.service.storeId, storeContext.storeId),
        ),
      )
      .limit(1);
    return rows.length > 0 ? { serviceId } : null;
  }

  return {};
};

export const registerFormRoutes = (ctx: BookingRouteContext) => {
  ctx.authRoutes.openapi(listFormsRoute, async (c) => {
    const { orgSlug, storeSlug } = c.req.valid('param');
    const query = c.req.valid('query');
    const storeContext = await getStoreContext({ ctx, orgSlug, storeSlug });
    if (!storeContext) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    const access = await requireStoreManager({
      ctx,
      headers: c.req.raw.headers,
      storeContext,
    });
    if (!access.ok) {
      return c.json({ message: access.message }, access.status);
    }

    const filters = [
      eq(dbSchema.formTemplate.organizationId, storeContext.organizationId),
      eq(dbSchema.formTemplate.storeId, storeContext.storeId),
    ];
    if (query.formType) {
      filters.push(eq(dbSchema.formTemplate.formType, query.formType));
    }
    if (query.status) {
      filters.push(eq(dbSchema.formTemplate.status, query.status));
    }

    const templates = await ctx.database
      .select()
      .from(dbSchema.formTemplate)
      .where(and(...filters))
      .orderBy(desc(dbSchema.formTemplate.updatedAt));
    const serialized: FormPayload[] = await Promise.all(
      templates.map((template: typeof dbSchema.formTemplate.$inferSelect) =>
        serializeForm({ ctx, template }),
      ),
    );
    const forms = query.targetType
      ? serialized.filter((form) =>
          form.assignments.some((assignment) => assignment.targetType === query.targetType),
        )
      : serialized;
    return c.json({ forms }, 200);
  });

  ctx.authRoutes.openapi(createFormRoute, async (c) => {
    const { orgSlug, storeSlug } = c.req.valid('param');
    const body = c.req.valid('json');
    const storeContext = await getStoreContext({ ctx, orgSlug, storeSlug });
    if (!storeContext) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    const access = await requireStoreManager({
      ctx,
      headers: c.req.raw.headers,
      storeContext,
    });
    if (!access.ok) {
      return c.json({ message: access.message }, access.status);
    }

    const fields = toFieldSnapshots(body.fields);
    const validation =
      fields.length > 0 ? validateFieldSnapshots(body.formType, fields) : { ok: true as const };
    if (!validation.ok) {
      return c.json({ message: validation.message }, 400);
    }

    const formId = crypto.randomUUID();
    const now = new Date();
    await runDatabaseTransaction(ctx.database, async (tx: AuthRuntimeDatabase) => {
      await tx.insert(dbSchema.formTemplate).values({
        id: formId,
        organizationId: storeContext.organizationId,
        storeId: storeContext.storeId,
        formType: body.formType,
        name: body.name.trim(),
        description: normalizeOptionalText(body.description),
        status: 'draft',
        currentPublishedVersionId: null,
        createdByUserId: access.userId,
        updatedByUserId: access.userId,
        createdAt: now,
        updatedAt: now,
      });
      await replaceFields({ database: tx, formTemplateId: formId, fields, now });
    });

    const template = await getFormTemplate({ ctx, storeContext, formId });
    return c.json(await serializeForm({ ctx, template: template! }), 200);
  });

  ctx.authRoutes.openapi(getRequiredFormsRoute, async (c) => {
    const { orgSlug, storeSlug } = c.req.valid('param');
    const { serviceId, slotId } = c.req.valid('query');
    const storeContext = await getStoreContext({ ctx, orgSlug, storeSlug });
    if (!storeContext) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    const access = await requireSubmissionReader({
      ctx,
      headers: c.req.raw.headers,
      storeContext,
    });
    if (!access.ok) {
      return c.json({ message: access.message }, access.status);
    }

    const formsContext = await resolveRequiredFormsContext({
      ctx,
      storeContext,
      serviceId,
      slotId,
    });
    if (!formsContext) {
      return c.json({ message: 'FORM_TARGET_NOT_FOUND' }, 404);
    }

    const requiredForms = await resolveRequiredForms({
      database: ctx.database,
      organizationId: storeContext.organizationId,
      storeId: storeContext.storeId,
      serviceId: formsContext.serviceId,
      slotId: formsContext.slotId,
    });
    return c.json(requiredForms, 200);
  });

  ctx.authRoutes.openapi(getFormRoute, async (c) => {
    const { orgSlug, storeSlug, formId } = c.req.valid('param');
    const storeContext = await getStoreContext({ ctx, orgSlug, storeSlug });
    if (!storeContext) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    const access = await requireStoreManager({
      ctx,
      headers: c.req.raw.headers,
      storeContext,
    });
    if (!access.ok) {
      return c.json({ message: access.message }, access.status);
    }
    const template = await getFormTemplate({ ctx, storeContext, formId });
    if (!template) {
      return c.json({ message: 'FORM_NOT_FOUND' }, 404);
    }
    return c.json(await serializeForm({ ctx, template }), 200);
  });

  ctx.authRoutes.openapi(updateFormRoute, async (c) => {
    const { orgSlug, storeSlug, formId } = c.req.valid('param');
    const body = c.req.valid('json');
    const storeContext = await getStoreContext({ ctx, orgSlug, storeSlug });
    if (!storeContext) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    const access = await requireStoreManager({
      ctx,
      headers: c.req.raw.headers,
      storeContext,
    });
    if (!access.ok) {
      return c.json({ message: access.message }, access.status);
    }
    const template = await getFormTemplate({ ctx, storeContext, formId });
    if (!template) {
      return c.json({ message: 'FORM_NOT_FOUND' }, 404);
    }
    if (template.status === 'archived') {
      return c.json({ message: 'FORM_NOT_PUBLISHED' }, 409);
    }

    const nextFormType = body.formType ?? (template.formType as FormType);
    if (!isFormType(nextFormType)) {
      return c.json({ message: 'FORM_INVALID_FIELD' }, 400);
    }
    const fields = body.fields ? toFieldSnapshots(body.fields) : null;
    const validation = fields
      ? validateFieldSnapshots(nextFormType, fields)
      : { ok: true as const };
    if (!validation.ok) {
      return c.json({ message: validation.message }, 400);
    }

    const now = new Date();
    await runDatabaseTransaction(ctx.database, async (tx: AuthRuntimeDatabase) => {
      await tx
        .update(dbSchema.formTemplate)
        .set({
          formType: nextFormType,
          name: body.name?.trim() ?? template.name,
          description:
            body.description === undefined
              ? template.description
              : normalizeOptionalText(body.description),
          updatedByUserId: access.userId,
          updatedAt: now,
        })
        .where(eq(dbSchema.formTemplate.id, formId));
      if (fields) {
        await replaceFields({ database: tx, formTemplateId: formId, fields, now });
      }
    });

    const updated = await getFormTemplate({ ctx, storeContext, formId });
    return c.json(await serializeForm({ ctx, template: updated! }), 200);
  });

  ctx.authRoutes.openapi(publishFormRoute, async (c) => {
    const { orgSlug, storeSlug, formId } = c.req.valid('param');
    const storeContext = await getStoreContext({ ctx, orgSlug, storeSlug });
    if (!storeContext) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    const access = await requireStoreManager({
      ctx,
      headers: c.req.raw.headers,
      storeContext,
    });
    if (!access.ok) {
      return c.json({ message: access.message }, access.status);
    }
    const template = await getFormTemplate({ ctx, storeContext, formId });
    if (!template || !isFormType(template.formType)) {
      return c.json({ message: 'FORM_NOT_FOUND' }, 404);
    }

    const fieldRows = await listFormFields({ database: ctx.database, formTemplateId: formId });
    const fields = serializeFieldRows(fieldRows);
    const validation = validateFieldSnapshots(template.formType, fields);
    if (!validation.ok) {
      return c.json({ message: validation.message }, 400);
    }

    const latest = await ctx.database
      .select({
        versionNumber: sql<number>`coalesce(max(${dbSchema.formTemplateVersion.versionNumber}), 0)`,
      })
      .from(dbSchema.formTemplateVersion)
      .where(eq(dbSchema.formTemplateVersion.formTemplateId, formId));
    const versionNumber = (latest[0]?.versionNumber ?? 0) + 1;
    const versionId = crypto.randomUUID();
    const now = new Date();
    await runDatabaseTransaction(ctx.database, async (tx: AuthRuntimeDatabase) => {
      await tx.insert(dbSchema.formTemplateVersion).values({
        id: versionId,
        formTemplateId: formId,
        organizationId: storeContext.organizationId,
        storeId: storeContext.storeId,
        formType: template.formType,
        versionNumber,
        nameSnapshot: template.name,
        descriptionSnapshot: template.description,
        fieldsSnapshotJson: JSON.stringify(fields),
        publishedByUserId: access.userId,
        publishedAt: now,
        createdAt: now,
      });
      await tx
        .update(dbSchema.formTemplate)
        .set({
          status: 'published',
          currentPublishedVersionId: versionId,
          updatedByUserId: access.userId,
          updatedAt: now,
        })
        .where(eq(dbSchema.formTemplate.id, formId));
    });

    const updated = await getFormTemplate({ ctx, storeContext, formId });
    return c.json(await serializeForm({ ctx, template: updated! }), 200);
  });

  ctx.authRoutes.openapi(archiveFormRoute, async (c) => {
    const { orgSlug, storeSlug, formId } = c.req.valid('param');
    const storeContext = await getStoreContext({ ctx, orgSlug, storeSlug });
    if (!storeContext) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    const access = await requireStoreManager({
      ctx,
      headers: c.req.raw.headers,
      storeContext,
    });
    if (!access.ok) {
      return c.json({ message: access.message }, access.status);
    }
    const template = await getFormTemplate({ ctx, storeContext, formId });
    if (!template) {
      return c.json({ message: 'FORM_NOT_FOUND' }, 404);
    }
    const now = new Date();
    await runDatabaseTransaction(ctx.database, async (tx: AuthRuntimeDatabase) => {
      await tx
        .update(dbSchema.formTemplate)
        .set({
          status: 'archived',
          archivedAt: now,
          updatedByUserId: access.userId,
          updatedAt: now,
        })
        .where(eq(dbSchema.formTemplate.id, formId));
      await tx
        .delete(dbSchema.formAssignment)
        .where(eq(dbSchema.formAssignment.formTemplateId, formId));
    });
    const updated = await getFormTemplate({ ctx, storeContext, formId });
    return c.json(await serializeForm({ ctx, template: updated! }), 200);
  });

  ctx.authRoutes.openapi(listFormAssignmentsRoute, async (c) => {
    const { orgSlug, storeSlug, formId } = c.req.valid('param');
    const storeContext = await getStoreContext({ ctx, orgSlug, storeSlug });
    if (!storeContext) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    const access = await requireStoreManager({
      ctx,
      headers: c.req.raw.headers,
      storeContext,
    });
    if (!access.ok) {
      return c.json({ message: access.message }, access.status);
    }
    const template = await getFormTemplate({ ctx, storeContext, formId });
    if (!template) {
      return c.json({ message: 'FORM_NOT_FOUND' }, 404);
    }
    const assignments = await listAssignmentsForForm({
      database: ctx.database,
      formTemplateId: formId,
    });
    return c.json({ assignments: assignments.map(serializeAssignment) }, 200);
  });

  ctx.authRoutes.openapi(createFormAssignmentRoute, async (c) => {
    const { orgSlug, storeSlug, formId } = c.req.valid('param');
    const body = c.req.valid('json');
    const storeContext = await getStoreContext({ ctx, orgSlug, storeSlug });
    if (!storeContext) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    const access = await requireStoreManager({
      ctx,
      headers: c.req.raw.headers,
      storeContext,
    });
    if (!access.ok) {
      return c.json({ message: access.message }, access.status);
    }
    const template = await getFormTemplate({ ctx, storeContext, formId });
    if (
      !template ||
      !isFormType(template.formType) ||
      template.status !== 'published' ||
      !template.currentPublishedVersionId
    ) {
      return c.json({ message: 'FORM_NOT_PUBLISHED' }, template ? 409 : 404);
    }
    const targetValid = await validateAssignmentTarget({
      ctx,
      storeContext,
      targetType: body.targetType,
      targetId: body.targetId,
    });
    if (!targetValid) {
      return c.json({ message: 'FORM_ASSIGNMENT_TARGET_INVALID' }, 400);
    }

    const now = new Date();
    try {
      await ctx.database.insert(dbSchema.formAssignment).values({
        id: crypto.randomUUID(),
        organizationId: storeContext.organizationId,
        storeId: storeContext.storeId,
        formType: template.formType,
        targetType: body.targetType,
        targetId: body.targetId,
        formTemplateId: formId,
        createdByUserId: access.userId,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return c.json({ message: 'FORM_ASSIGNMENT_CONFLICT' }, 409);
      }
      throw error;
    }
    const assignments = await listAssignmentsForForm({
      database: ctx.database,
      formTemplateId: formId,
    });
    return c.json({ assignments: assignments.map(serializeAssignment) }, 200);
  });

  ctx.authRoutes.openapi(deleteFormAssignmentRoute, async (c) => {
    const { orgSlug, storeSlug, formId, assignmentId } = c.req.valid('param');
    const storeContext = await getStoreContext({ ctx, orgSlug, storeSlug });
    if (!storeContext) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    const access = await requireStoreManager({
      ctx,
      headers: c.req.raw.headers,
      storeContext,
    });
    if (!access.ok) {
      return c.json({ message: access.message }, access.status);
    }
    await ctx.database
      .delete(dbSchema.formAssignment)
      .where(
        and(
          eq(dbSchema.formAssignment.id, assignmentId),
          eq(dbSchema.formAssignment.formTemplateId, formId),
          eq(dbSchema.formAssignment.organizationId, storeContext.organizationId),
          eq(dbSchema.formAssignment.storeId, storeContext.storeId),
        ),
      );
    const assignments = await listAssignmentsForForm({
      database: ctx.database,
      formTemplateId: formId,
    });
    return c.json({ assignments: assignments.map(serializeAssignment) }, 200);
  });

  ctx.authRoutes.openapi(listFormSubmissionsRoute, async (c) => {
    const { orgSlug, storeSlug, formId } = c.req.valid('param');
    const storeContext = await getStoreContext({ ctx, orgSlug, storeSlug });
    if (!storeContext) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    const access = await requireSubmissionReader({
      ctx,
      headers: c.req.raw.headers,
      storeContext,
    });
    if (!access.ok) {
      return c.json({ message: access.message }, access.status);
    }
    const template = await getFormTemplate({ ctx, storeContext, formId });
    if (!template) {
      return c.json({ message: 'FORM_NOT_FOUND' }, 404);
    }
    const rows = await ctx.database
      .select({
        id: dbSchema.formSubmission.id,
        formTemplateId: dbSchema.formSubmission.formTemplateId,
        formTemplateVersionId: dbSchema.formSubmission.formTemplateVersionId,
        formType: dbSchema.formSubmission.formType,
        bookingId: dbSchema.formSubmission.bookingId,
        participantId: dbSchema.formSubmission.participantId,
        customerNameSnapshot: dbSchema.formSubmission.customerNameSnapshot,
        customerEmailSnapshot: dbSchema.formSubmission.customerEmailSnapshot,
        source: dbSchema.formSubmission.source,
        submittedAt: dbSchema.formSubmission.submittedAt,
        answerCount: sql<number>`count(${dbSchema.formAnswer.id})`,
      })
      .from(dbSchema.formSubmission)
      .leftJoin(
        dbSchema.formAnswer,
        eq(dbSchema.formAnswer.formSubmissionId, dbSchema.formSubmission.id),
      )
      .where(
        and(
          eq(dbSchema.formSubmission.organizationId, storeContext.organizationId),
          eq(dbSchema.formSubmission.storeId, storeContext.storeId),
          eq(dbSchema.formSubmission.formTemplateId, formId),
        ),
      )
      .groupBy(dbSchema.formSubmission.id)
      .orderBy(desc(dbSchema.formSubmission.submittedAt));

    return c.json(
      {
        submissions: rows.map(
          (row: {
            id: string;
            formTemplateId: string;
            formTemplateVersionId: string;
            formType: string;
            bookingId: string | null;
            participantId: string | null;
            customerNameSnapshot: string | null;
            customerEmailSnapshot: string | null;
            source: string;
            submittedAt: Date;
            answerCount: number;
          }) => ({
            id: row.id,
            formTemplateId: row.formTemplateId,
            formTemplateVersionId: row.formTemplateVersionId,
            formType: isFormType(row.formType) ? row.formType : 'reservation_input',
            bookingId: row.bookingId,
            participantId: row.participantId,
            customerNameSnapshot: row.customerNameSnapshot,
            customerEmailSnapshot: row.customerEmailSnapshot,
            source: row.source,
            submittedAt: row.submittedAt.toISOString(),
            answerCount: Number(row.answerCount ?? 0),
          }),
        ),
      },
      200,
    );
  });

  ctx.authRoutes.openapi(getFormSubmissionRoute, async (c) => {
    const { orgSlug, storeSlug, submissionId } = c.req.valid('param');
    const storeContext = await getStoreContext({ ctx, orgSlug, storeSlug });
    if (!storeContext) {
      return c.json({ message: 'Organization or store not found.' }, 404);
    }
    const access = await requireSubmissionReader({
      ctx,
      headers: c.req.raw.headers,
      storeContext,
    });
    if (!access.ok) {
      return c.json({ message: access.message }, access.status);
    }
    const rows = await ctx.database
      .select({
        id: dbSchema.formSubmission.id,
        formTemplateId: dbSchema.formSubmission.formTemplateId,
        formTemplateVersionId: dbSchema.formSubmission.formTemplateVersionId,
        formType: dbSchema.formSubmission.formType,
        bookingId: dbSchema.formSubmission.bookingId,
        participantId: dbSchema.formSubmission.participantId,
        customerNameSnapshot: dbSchema.formSubmission.customerNameSnapshot,
        customerEmailSnapshot: dbSchema.formSubmission.customerEmailSnapshot,
        source: dbSchema.formSubmission.source,
        submittedAt: dbSchema.formSubmission.submittedAt,
        formName: dbSchema.formTemplateVersion.nameSnapshot,
        versionNumber: dbSchema.formTemplateVersion.versionNumber,
      })
      .from(dbSchema.formSubmission)
      .innerJoin(
        dbSchema.formTemplateVersion,
        eq(dbSchema.formTemplateVersion.id, dbSchema.formSubmission.formTemplateVersionId),
      )
      .where(
        and(
          eq(dbSchema.formSubmission.id, submissionId),
          eq(dbSchema.formSubmission.organizationId, storeContext.organizationId),
          eq(dbSchema.formSubmission.storeId, storeContext.storeId),
        ),
      )
      .limit(1);
    const submission = rows[0] ?? null;
    if (!submission || !isFormType(submission.formType)) {
      return c.json({ message: 'FORM_NOT_FOUND' }, 404);
    }

    const answers = await ctx.database
      .select()
      .from(dbSchema.formAnswer)
      .where(eq(dbSchema.formAnswer.formSubmissionId, submissionId))
      .orderBy(dbSchema.formAnswer.sortOrder);

    return c.json(
      {
        id: submission.id,
        formTemplateId: submission.formTemplateId,
        formTemplateVersionId: submission.formTemplateVersionId,
        formType: submission.formType,
        formName: submission.formName,
        versionNumber: submission.versionNumber,
        bookingId: submission.bookingId,
        participantId: submission.participantId,
        customerNameSnapshot: submission.customerNameSnapshot,
        customerEmailSnapshot: submission.customerEmailSnapshot,
        source: submission.source,
        submittedAt: submission.submittedAt.toISOString(),
        answers: answers.map((answer: typeof dbSchema.formAnswer.$inferSelect) => {
          let value: unknown = null;
          try {
            value = JSON.parse(answer.valueJson) as unknown;
          } catch {
            value = answer.valueJson;
          }
          return {
            id: answer.id,
            fieldKey: answer.fieldKey,
            fieldType: isFormFieldType(answer.fieldType) ? answer.fieldType : 'text',
            labelSnapshot: answer.labelSnapshot,
            value,
            sortOrder: answer.sortOrder,
            createdAt: answer.createdAt.toISOString(),
          };
        }),
      },
      200,
    );
  });
};
