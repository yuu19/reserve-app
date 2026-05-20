/**
 * リクエストで明示された classroomId が実データの所属教室と異なるかを判定します。
 */
export const isRequestedClassroomMismatch = (
  requestedClassroomId: string | null | undefined,
  actualClassroomId: string,
) => Boolean(requestedClassroomId && requestedClassroomId !== actualClassroomId);
