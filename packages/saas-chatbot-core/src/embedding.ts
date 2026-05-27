/** knowledge chunk を Vectorize へ投入するための embedding 結果。 */
export type AiEmbeddingResult = {
  /** embedding vector。 */
  vector: number[];
  /** プロバイダーが返す shape。取得できない場合は `null`。 */
  shape: number[] | null;
  /** embedding に利用した model 名。 */
  model: string;
};

/** embedding プロバイダーに text を渡す入力。 */
export type GenerateEmbeddingInput = {
  /** embedding 対象の text。 */
  text: string;
  /** プロバイダーや cache 層で cache を使うかどうか。 */
  cache?: boolean;
};

/** Workers AI などの embedding プロバイダーを抽象化する境界。 */
export interface EmbeddingProvider {
  /** プロバイダーが設定済みで呼び出し可能かどうか。 */
  isConfigured: boolean;
  /** text から embedding vector を生成する。 */
  generateEmbedding(input: GenerateEmbeddingInput): Promise<AiEmbeddingResult>;
}

/** 旧呼称との互換を保つ embedding プロバイダー型。 */
export type AiEmbeddingProvider = EmbeddingProvider;
