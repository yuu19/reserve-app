export const isUniqueConstraintError = (error: unknown): boolean => {
  const queue: unknown[] = [error];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!(current instanceof Error)) {
      continue;
    }
    if (
      current.message.includes('UNIQUE constraint failed') ||
      current.message.includes('SQLITE_CONSTRAINT')
    ) {
      return true;
    }
    const nestedCause = (current as Error & { cause?: unknown }).cause;
    if (nestedCause) {
      queue.push(nestedCause);
    }
  }
  return false;
};

export const resolveBookingPolicy = (value: string | null | undefined): 'instant' | 'approval' => {
  return value === 'approval' ? 'approval' : 'instant';
};
