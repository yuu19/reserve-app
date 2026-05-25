import type {
  AiChatRequest,
  AiChatResponse,
  AiFeedbackRequest,
  AiFeedbackResponse,
  AiSourceReference,
  AiSuggestedAction,
} from '@repo/saas-chatbot-core';
import { describe, expectTypeOf, it } from 'vitest';
import type { z } from '@hono/zod-openapi';
import {
  aiChatRequestSchema,
  aiChatResponseSchema,
  aiSourceReferenceSchema,
  aiSuggestedActionSchema,
  feedbackRequestSchema,
  feedbackResponseSchema,
  type AiChatRequestBody,
  type AiChatResponseBody,
  type AiFeedbackRequestBody,
  type AiFeedbackResponseBody,
} from './ai.schemas.js';

describe('AI web contract', () => {
  it('keeps backend schemas aligned with @repo/saas-chatbot-core contracts', () => {
    expectTypeOf<AiChatRequestBody>().toEqualTypeOf<AiChatRequest>();
    expectTypeOf<AiChatRequest>().toEqualTypeOf<AiChatRequestBody>();

    expectTypeOf<AiChatResponseBody>().toEqualTypeOf<AiChatResponse>();
    expectTypeOf<AiChatResponse>().toEqualTypeOf<AiChatResponseBody>();

    expectTypeOf<AiFeedbackRequestBody>().toEqualTypeOf<AiFeedbackRequest>();
    expectTypeOf<AiFeedbackRequest>().toEqualTypeOf<AiFeedbackRequestBody>();

    expectTypeOf<AiFeedbackResponseBody>().toEqualTypeOf<AiFeedbackResponse>();
    expectTypeOf<AiFeedbackResponse>().toEqualTypeOf<AiFeedbackResponseBody>();

    expectTypeOf<z.infer<typeof aiSourceReferenceSchema>>().toEqualTypeOf<AiSourceReference>();
    expectTypeOf<AiSourceReference>().toEqualTypeOf<z.infer<typeof aiSourceReferenceSchema>>();

    expectTypeOf<z.infer<typeof aiSuggestedActionSchema>>().toEqualTypeOf<AiSuggestedAction>();
    expectTypeOf<AiSuggestedAction>().toEqualTypeOf<z.infer<typeof aiSuggestedActionSchema>>();
  });
});
