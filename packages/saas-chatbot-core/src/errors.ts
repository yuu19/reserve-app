/** chatbot core の呼び出し側が UI 表示や再試行を分岐できる安定 code 付き error。 */
export class AiChatbotCoreError extends Error {
  /**
   * @param message ログや開発者向けに残す error message。
   * @param code UI や API response が分岐に使う安定した error code。
   */
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AiChatbotCoreError';
  }
}
