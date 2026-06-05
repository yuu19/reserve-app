import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import * as dbSchema from '../../infra/db/schema.js';

export const FORM_TYPES = ['reservation_input', 'pre_survey', 'consent'] as const;
export const FORM_FIELD_TYPES = [
  'text',
  'textarea',
  'radio',
  'checkbox',
  'select',
  'date',
  'consent',
] as const;
export const FORM_TARGET_TYPES = ['store', 'service', 'slot'] as const;
export const FORM_TYPE_ORDER: Record<FormType, number> = {
  reservation_input: 0,
  pre_survey: 1,
  consent: 2,
};

export type FormType = (typeof FORM_TYPES)[number];
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];
export type FormTargetType = (typeof FORM_TARGET_TYPES)[number];
export type FormOption = { value: string; label: string };
export type FormFieldSnapshot = {
  fieldKey: string;
  fieldType: FormFieldType;
  label: string;
  description: string | null;
  placeholder: string | null;
  required: boolean;
  options: FormOption[];
  sortOrder: number;
};
export type ResolvedForm = {
  formTemplateId: string;
  formTemplateVersionId: string;
  formType: FormType;
  name: string;
  description: string | null;
  versionNumber: number;
  fields: FormFieldSnapshot[];
};
export type FormSubmissionInput = {
  formTemplateId: string;
  formTemplateVersionId: string;
  answers?: Array<{
    fieldKey: string;
    value: unknown;
  }>;
};
export type NormalizedFormSubmission = {
  form: ResolvedForm;
  answers: Array<{
    field: FormFieldSnapshot;
    value: unknown;
  }>;
};

export const isFormType = (value: string): value is FormType =>
  FORM_TYPES.includes(value as FormType);

export const isFormFieldType = (value: string): value is FormFieldType =>
  FORM_FIELD_TYPES.includes(value as FormFieldType);

export const isFormTargetType = (value: string): value is FormTargetType =>
  FORM_TARGET_TYPES.includes(value as FormTargetType);

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
};

const normalizeText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizeFormOptions = (values: unknown): FormOption[] => {
  if (!Array.isArray(values)) {
    return [];
  }

  const options: FormOption[] = [];
  const seen = new Set<string>();
  for (const item of values) {
    if (typeof item === 'string') {
      const label = item.trim();
      if (!label || seen.has(label)) {
        continue;
      }
      seen.add(label);
      options.push({ value: label, label });
      continue;
    }

    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const value = typeof record.value === 'string' ? record.value.trim() : '';
    const label = typeof record.label === 'string' ? record.label.trim() : value;
    if (!value || !label || seen.has(value)) {
      continue;
    }
    seen.add(value);
    options.push({ value, label });
  }
  return options;
};

export const parseFormOptionsJson = (value: string | null): FormOption[] => {
  if (!value) {
    return [];
  }
  try {
    return normalizeFormOptions(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
};

export const parseFieldsSnapshotJson = (value: string): FormFieldSnapshot[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry, index): FormFieldSnapshot | null => {
        if (typeof entry !== 'object' || entry === null) {
          return null;
        }
        const record = entry as Record<string, unknown>;
        const fieldType = typeof record.fieldType === 'string' ? record.fieldType : '';
        const fieldKey = typeof record.fieldKey === 'string' ? record.fieldKey.trim() : '';
        const label = typeof record.label === 'string' ? record.label.trim() : '';
        if (!fieldKey || !label || !isFormFieldType(fieldType)) {
          return null;
        }
        return {
          fieldKey,
          fieldType,
          label,
          description: normalizeText(
            typeof record.description === 'string' ? record.description : null,
          ),
          placeholder: normalizeText(
            typeof record.placeholder === 'string' ? record.placeholder : null,
          ),
          required: record.required === true,
          options: normalizeFormOptions(record.options),
          sortOrder: typeof record.sortOrder === 'number' ? record.sortOrder : index,
        };
      })
      .filter((entry): entry is FormFieldSnapshot => entry !== null)
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder || left.fieldKey.localeCompare(right.fieldKey),
      );
  } catch {
    return [];
  }
};

export const serializeFieldRows = (
  rows: Array<{
    fieldKey: string;
    fieldType: string;
    label: string;
    description: string | null;
    placeholder: string | null;
    required: boolean;
    optionsJson: string | null;
    sortOrder: number;
  }>,
): FormFieldSnapshot[] =>
  rows
    .map((row, index) => ({
      fieldKey: row.fieldKey,
      fieldType: isFormFieldType(row.fieldType) ? row.fieldType : 'text',
      label: row.label,
      description: row.description,
      placeholder: row.placeholder,
      required: row.required,
      options: parseFormOptionsJson(row.optionsJson),
      sortOrder: row.sortOrder ?? index,
    }))
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.fieldKey.localeCompare(right.fieldKey),
    );

export const validateFieldSnapshots = (
  formType: FormType,
  fields: FormFieldSnapshot[],
): { ok: true } | { ok: false; message: string } => {
  if (fields.length === 0) {
    return { ok: false, message: 'FORM_REQUIRED_FIELD_MISSING' };
  }

  const keys = new Set<string>();
  for (const field of fields) {
    if (!field.fieldKey || !/^[a-zA-Z0-9_-]+$/.test(field.fieldKey)) {
      return { ok: false, message: 'FORM_INVALID_FIELD' };
    }
    if (keys.has(field.fieldKey)) {
      return { ok: false, message: 'FORM_INVALID_FIELD' };
    }
    keys.add(field.fieldKey);

    if (
      (field.fieldType === 'radio' ||
        field.fieldType === 'select' ||
        field.fieldType === 'checkbox') &&
      field.options.length === 0
    ) {
      return { ok: false, message: 'FORM_INVALID_FIELD' };
    }
  }

  if (formType === 'consent' && !fields.some((field) => field.fieldType === 'consent')) {
    return { ok: false, message: 'FORM_INVALID_FIELD' };
  }

  return { ok: true };
};

const assignmentPriority = (targetType: FormTargetType): number => {
  if (targetType === 'slot') {
    return 3;
  }
  if (targetType === 'service') {
    return 2;
  }
  return 1;
};

export const resolveRequiredForms = async ({
  database,
  organizationId,
  storeId,
  serviceId,
  slotId,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId: string;
  serviceId?: string | null;
  slotId?: string | null;
}): Promise<{ formContextHash: string; forms: ResolvedForm[] }> => {
  const targetFilters = [
    and(
      eq(dbSchema.formAssignment.targetType, 'store'),
      eq(dbSchema.formAssignment.targetId, storeId),
    ),
  ];
  if (serviceId) {
    targetFilters.push(
      and(
        eq(dbSchema.formAssignment.targetType, 'service'),
        eq(dbSchema.formAssignment.targetId, serviceId),
      ),
    );
  }
  if (slotId) {
    targetFilters.push(
      and(
        eq(dbSchema.formAssignment.targetType, 'slot'),
        eq(dbSchema.formAssignment.targetId, slotId),
      ),
    );
  }

  const rows = await database
    .select({
      assignmentId: dbSchema.formAssignment.id,
      targetType: dbSchema.formAssignment.targetType,
      formTemplateId: dbSchema.formTemplate.id,
      formType: dbSchema.formTemplate.formType,
      name: dbSchema.formTemplateVersion.nameSnapshot,
      description: dbSchema.formTemplateVersion.descriptionSnapshot,
      formTemplateVersionId: dbSchema.formTemplateVersion.id,
      versionNumber: dbSchema.formTemplateVersion.versionNumber,
      fieldsSnapshotJson: dbSchema.formTemplateVersion.fieldsSnapshotJson,
    })
    .from(dbSchema.formAssignment)
    .innerJoin(
      dbSchema.formTemplate,
      eq(dbSchema.formTemplate.id, dbSchema.formAssignment.formTemplateId),
    )
    .innerJoin(
      dbSchema.formTemplateVersion,
      eq(dbSchema.formTemplateVersion.id, dbSchema.formTemplate.currentPublishedVersionId),
    )
    .where(
      and(
        eq(dbSchema.formAssignment.organizationId, organizationId),
        eq(dbSchema.formAssignment.storeId, storeId),
        eq(dbSchema.formTemplate.organizationId, organizationId),
        eq(dbSchema.formTemplate.storeId, storeId),
        eq(dbSchema.formTemplate.status, 'published'),
        or(...targetFilters),
      ),
    );

  const selectedByType = new Map<FormType, (typeof rows)[number]>();
  for (const row of rows) {
    if (!isFormType(row.formType) || !isFormTargetType(row.targetType)) {
      continue;
    }
    const current = selectedByType.get(row.formType);
    if (
      !current ||
      assignmentPriority(row.targetType) > assignmentPriority(current.targetType as FormTargetType)
    ) {
      selectedByType.set(row.formType, row);
    }
  }

  const forms = Array.from(selectedByType.values())
    .map((row) => ({
      formTemplateId: row.formTemplateId,
      formTemplateVersionId: row.formTemplateVersionId,
      formType: row.formType as FormType,
      name: row.name,
      description: row.description,
      versionNumber: row.versionNumber,
      fields: parseFieldsSnapshotJson(row.fieldsSnapshotJson),
    }))
    .sort((left, right) => FORM_TYPE_ORDER[left.formType] - FORM_TYPE_ORDER[right.formType]);

  return {
    formContextHash: await createFormContextHash(forms),
    forms,
  };
};

export const createFormContextHash = async (forms: ResolvedForm[]): Promise<string> => {
  const canonical = forms
    .map((form) => ({
      formType: form.formType,
      formTemplateId: form.formTemplateId,
      formTemplateVersionId: form.formTemplateVersionId,
      name: form.name,
      description: form.description,
      versionNumber: form.versionNumber,
      fields: form.fields
        .map((field) => ({
          fieldKey: field.fieldKey,
          fieldType: field.fieldType,
          label: field.label,
          description: field.description,
          placeholder: field.placeholder,
          required: field.required,
          options: field.options.map((option) => ({
            value: option.value,
            label: option.label,
          })),
          sortOrder: field.sortOrder,
        }))
        .sort(
          (left, right) =>
            left.sortOrder - right.sortOrder || left.fieldKey.localeCompare(right.fieldKey),
        ),
    }))
    .sort((left, right) => FORM_TYPE_ORDER[left.formType] - FORM_TYPE_ORDER[right.formType]);
  return `ctx_${await sha256Hex(JSON.stringify(canonical))}`;
};

const normalizeAnswerValue = (
  field: FormFieldSnapshot,
  value: unknown,
):
  | { ok: true; value: unknown; hasValue: boolean; shouldStore: boolean }
  | { ok: false; message: string } => {
  if (field.fieldType === 'consent') {
    if (value === true) {
      return { ok: true, value: true, hasValue: true, shouldStore: true };
    }
    if (value === false) {
      return { ok: true, value: false, hasValue: false, shouldStore: true };
    }
    if (value === null || value === undefined || value === '') {
      return { ok: true, value: false, hasValue: false, shouldStore: false };
    }
    return { ok: false, message: 'FORM_INVALID_VALUE' };
  }

  if (field.fieldType === 'checkbox') {
    if (value === null || value === undefined || value === '') {
      return { ok: true, value: [], hasValue: false, shouldStore: false };
    }
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
      return { ok: false, message: 'FORM_INVALID_VALUE' };
    }
    const allowed = new Set(field.options.map((option) => option.value));
    const normalized = Array.from(
      new Set(value.map((entry) => entry.trim()).filter((entry) => entry.length > 0)),
    );
    if (normalized.some((entry) => !allowed.has(entry))) {
      return { ok: false, message: 'FORM_INVALID_VALUE' };
    }
    return {
      ok: true,
      value: normalized,
      hasValue: normalized.length > 0,
      shouldStore: normalized.length > 0,
    };
  }

  if (typeof value !== 'string') {
    if (value === null || value === undefined) {
      return { ok: true, value: '', hasValue: false, shouldStore: false };
    }
    return { ok: false, message: 'FORM_INVALID_VALUE' };
  }

  const trimmed = value.trim();
  if (field.fieldType === 'radio' || field.fieldType === 'select') {
    if (!trimmed) {
      return { ok: true, value: '', hasValue: false, shouldStore: false };
    }
    if (!field.options.some((option) => option.value === trimmed)) {
      return { ok: false, message: 'FORM_INVALID_VALUE' };
    }
  }

  return {
    ok: true,
    value: trimmed,
    hasValue: trimmed.length > 0,
    shouldStore: trimmed.length > 0,
  };
};

export const validateFormSubmissions = ({
  forms,
  submissions,
  requireAllForms,
}: {
  forms: ResolvedForm[];
  submissions: FormSubmissionInput[] | undefined;
  requireAllForms: boolean;
}):
  | { ok: true; submissions: NormalizedFormSubmission[] }
  | { ok: false; status: 400 | 409; message: string } => {
  const formById = new Map(forms.map((form) => [form.formTemplateId, form]));
  const submittedByFormId = new Map<string, FormSubmissionInput>();
  for (const submission of submissions ?? []) {
    const formId = submission.formTemplateId.trim();
    if (!formById.has(formId)) {
      return { ok: false, status: 400, message: 'FORM_INVALID_FIELD' };
    }
    if (submittedByFormId.has(formId)) {
      return { ok: false, status: 400, message: 'FORM_INVALID_FIELD' };
    }
    submittedByFormId.set(formId, submission);
  }

  if (requireAllForms) {
    for (const form of forms) {
      if (!submittedByFormId.has(form.formTemplateId)) {
        return { ok: false, status: 400, message: 'FORM_REQUIRED_FIELD_MISSING' };
      }
    }
  }

  const normalizedSubmissions: NormalizedFormSubmission[] = [];
  for (const form of forms) {
    const submission = submittedByFormId.get(form.formTemplateId);
    if (!submission) {
      continue;
    }
    if (submission.formTemplateVersionId !== form.formTemplateVersionId) {
      return { ok: false, status: 409, message: 'FORM_VERSION_OUTDATED' };
    }

    const fieldByKey = new Map(form.fields.map((field) => [field.fieldKey, field]));
    const answerByKey = new Map<string, unknown>();
    for (const answer of submission.answers ?? []) {
      const key = answer.fieldKey.trim();
      if (!fieldByKey.has(key) || answerByKey.has(key)) {
        return { ok: false, status: 400, message: 'FORM_INVALID_FIELD' };
      }
      answerByKey.set(key, answer.value);
    }

    const normalizedAnswers: NormalizedFormSubmission['answers'] = [];
    for (const field of form.fields) {
      const hasSubmittedAnswer = answerByKey.has(field.fieldKey);
      const normalized = normalizeAnswerValue(field, answerByKey.get(field.fieldKey));
      if (!normalized.ok) {
        return { ok: false, status: 400, message: normalized.message };
      }
      if (requireAllForms && field.required && !normalized.hasValue) {
        return { ok: false, status: 400, message: 'FORM_REQUIRED_FIELD_MISSING' };
      }
      if (!requireAllForms && field.required && hasSubmittedAnswer && !normalized.hasValue) {
        return { ok: false, status: 400, message: 'FORM_REQUIRED_FIELD_MISSING' };
      }
      if (normalized.shouldStore) {
        normalizedAnswers.push({ field, value: normalized.value });
      }
    }
    normalizedSubmissions.push({ form, answers: normalizedAnswers });
  }

  return { ok: true, submissions: normalizedSubmissions };
};

export const insertFormSubmissions = async ({
  database,
  organizationId,
  storeId,
  bookingId,
  participantId,
  customerName,
  customerEmail,
  source,
  submittedByUserId,
  submittedAt,
  submissions,
}: {
  database: AuthRuntimeDatabase;
  organizationId: string;
  storeId: string;
  bookingId: string;
  participantId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  source: 'public' | 'participant' | 'staff';
  submittedByUserId?: string | null;
  submittedAt: Date;
  submissions: NormalizedFormSubmission[];
}) => {
  for (const submission of submissions) {
    const submissionId = crypto.randomUUID();
    await database.insert(dbSchema.formSubmission).values({
      id: submissionId,
      organizationId,
      storeId,
      formTemplateId: submission.form.formTemplateId,
      formTemplateVersionId: submission.form.formTemplateVersionId,
      formType: submission.form.formType,
      bookingId,
      participantId: participantId ?? null,
      customerNameSnapshot: customerName ?? null,
      customerEmailSnapshot: customerEmail ?? null,
      source,
      submittedByUserId: submittedByUserId ?? null,
      submittedAt,
      createdAt: submittedAt,
    });

    if (submission.answers.length > 0) {
      await database.insert(dbSchema.formAnswer).values(
        submission.answers.map((answer) => ({
          id: crypto.randomUUID(),
          formSubmissionId: submissionId,
          fieldKey: answer.field.fieldKey,
          fieldType: answer.field.fieldType,
          labelSnapshot: answer.field.label,
          valueJson: JSON.stringify(answer.value),
          sortOrder: answer.field.sortOrder,
          createdAt: submittedAt,
        })),
      );
    }
  }
};

export const listFormFields = async ({
  database,
  formTemplateId,
}: {
  database: AuthRuntimeDatabase;
  formTemplateId: string;
}) => {
  const rows = await database
    .select({
      id: dbSchema.formField.id,
      fieldKey: dbSchema.formField.fieldKey,
      fieldType: dbSchema.formField.fieldType,
      label: dbSchema.formField.label,
      description: dbSchema.formField.description,
      placeholder: dbSchema.formField.placeholder,
      required: dbSchema.formField.required,
      optionsJson: dbSchema.formField.optionsJson,
      sortOrder: dbSchema.formField.sortOrder,
      createdAt: dbSchema.formField.createdAt,
      updatedAt: dbSchema.formField.updatedAt,
    })
    .from(dbSchema.formField)
    .where(eq(dbSchema.formField.formTemplateId, formTemplateId))
    .orderBy(asc(dbSchema.formField.sortOrder), asc(dbSchema.formField.createdAt));
  return rows;
};

export const listAssignmentsForForm = async ({
  database,
  formTemplateId,
}: {
  database: AuthRuntimeDatabase;
  formTemplateId: string;
}) => {
  return database
    .select()
    .from(dbSchema.formAssignment)
    .where(eq(dbSchema.formAssignment.formTemplateId, formTemplateId))
    .orderBy(asc(dbSchema.formAssignment.targetType), asc(dbSchema.formAssignment.createdAt));
};

export const listLatestFormVersions = async ({
  database,
  formTemplateIds,
}: {
  database: AuthRuntimeDatabase;
  formTemplateIds: string[];
}) => {
  if (formTemplateIds.length === 0) {
    return [];
  }
  return database
    .select()
    .from(dbSchema.formTemplateVersion)
    .where(inArray(dbSchema.formTemplateVersion.formTemplateId, formTemplateIds))
    .orderBy(desc(dbSchema.formTemplateVersion.versionNumber));
};
