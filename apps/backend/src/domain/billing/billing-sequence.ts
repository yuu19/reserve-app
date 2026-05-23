const sequenceIndexNames = {
  billing_audit_event: 'billing_audit_event_account_sequence_uidx',
  billing_signal: 'billing_signal_account_sequence_uidx',
  billing_notification: 'billing_notification_account_sequence_uidx',
} as const;

type BillingSequencedTableName = keyof typeof sequenceIndexNames;

const MAX_BILLING_SEQUENCE_INSERT_ATTEMPTS = 3;

const collectErrorMessages = (error: unknown): string[] => {
  const messages: string[] = [];
  const queue: unknown[] = [error];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!(current instanceof Error)) {
      continue;
    }

    messages.push(current.message);
    const nestedCause = (current as Error & { cause?: unknown }).cause;
    if (nestedCause) {
      queue.push(nestedCause);
    }
  }

  return messages;
};

const isBillingSequenceConstraintError = ({
  error,
  tableName,
}: {
  error: unknown;
  tableName: BillingSequencedTableName;
}) => {
  const messages = collectErrorMessages(error);
  const sequenceIndexName = sequenceIndexNames[tableName];
  const requiredColumns = [`${tableName}.billing_account_id`, `${tableName}.sequence_number`];

  return messages.some((message) => {
    if (message.includes(sequenceIndexName)) {
      return true;
    }

    if (!message.includes('UNIQUE constraint failed') && !message.includes('SQLITE_CONSTRAINT')) {
      return false;
    }

    return requiredColumns.every((column) => message.includes(column));
  });
};

export const retryBillingSequenceInsert = async <Result>({
  tableName,
  operation,
}: {
  tableName: BillingSequencedTableName;
  operation(): Promise<Result>;
}): Promise<Result> => {
  for (let attempt = 1; attempt <= MAX_BILLING_SEQUENCE_INSERT_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const shouldRetry =
        attempt < MAX_BILLING_SEQUENCE_INSERT_ATTEMPTS &&
        isBillingSequenceConstraintError({ error, tableName });
      if (!shouldRetry) {
        throw error;
      }
    }
  }

  return operation();
};
