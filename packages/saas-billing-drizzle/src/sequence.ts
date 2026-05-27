const sequenceIndexNames = {
  billing_audit_event: 'billing_audit_event_account_sequence_uidx',
  billing_signal: 'billing_signal_account_sequence_uidx',
  billing_notification: 'billing_notification_account_sequence_uidx',
} as const;

/** sequence_number の一意制約衝突を retry 対象にする追記専用 table 名。 */
export type BillingSequencedTableName = keyof typeof sequenceIndexNames;

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

// D1/SQLite adapter によって一意制約エラーの message 形状が違うため、index 名と列名の両方で判定する。
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

/**
 * 追記専用 history table の sequence_number 衝突だけを短く retry する。
 *
 * @template Result operation が返す値。
 * @param input.tableName retry 対象の sequence unique index を持つ table 名。
 * @param input.operation sequence_number を採番して insert する処理。
 * @returns `operation` の成功結果。
 * @throws sequence unique 以外のエラー、または retry 上限後のエラー。
 */
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
