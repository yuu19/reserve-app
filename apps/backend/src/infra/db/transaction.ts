import type { AuthRuntimeDatabase } from '../../auth-runtime.js';

const collectErrorMessages = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = (error as Error & { cause?: unknown }).cause;
  return `${error.message}\n${cause ? collectErrorMessages(cause) : ''}`;
};

const isUnsupportedD1TransactionError = (error: unknown): boolean => {
  const message = collectErrorMessages(error);
  return (
    message.includes('Failed query: begin') &&
    message.includes('To execute a transaction, please use the state.storage.transaction')
  );
};

export const runDatabaseTransaction = async <T>(
  database: AuthRuntimeDatabase,
  callback: (tx: AuthRuntimeDatabase) => Promise<T>,
): Promise<T> => {
  try {
    return await database.transaction((tx: unknown) => callback(tx as AuthRuntimeDatabase));
  } catch (error) {
    if (isUnsupportedD1TransactionError(error)) {
      return callback(database);
    }
    throw error;
  }
};
