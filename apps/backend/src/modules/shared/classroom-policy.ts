export const isRequestedClassroomMismatch = (
  requestedClassroomId: string | null | undefined,
  actualClassroomId: string,
) => Boolean(requestedClassroomId && requestedClassroomId !== actualClassroomId);
