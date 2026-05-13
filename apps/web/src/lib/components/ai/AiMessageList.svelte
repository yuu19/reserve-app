<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import type { AiChatMessage } from '$lib/features/ai-chat.svelte';
	import { AlertTriangle, Bot, Check, ThumbsDown, ThumbsUp, UserRound } from '@lucide/svelte';
	import AiSourceList from './AiSourceList.svelte';
	import AiSuggestedActions from './AiSuggestedActions.svelte';

	type Props = {
		messages?: AiChatMessage[];
		sending?: boolean;
		onFeedback?: (messageId: string, rating: 'helpful' | 'unhelpful', comment?: string) => void;
	};

	let { messages = [], sending = false, onFeedback }: Props = $props();
	let expandedFeedback = $state<Record<string, boolean>>({});
	let feedbackComments = $state<Record<string, string>>({});

	const confidenceLabel = (
		confidence: number | undefined,
		needsHumanSupport: boolean | undefined
	) => {
		if (needsHumanSupport || (confidence ?? 0) < 50) {
			return '確認が必要';
		}
		if ((confidence ?? 0) >= 75) {
			return '根拠あり';
		}
		return '参考情報';
	};

	const submitHelpful = (message: AiChatMessage) => {
		onFeedback?.(message.id, 'helpful');
	};

	const submitUnhelpful = (message: AiChatMessage) => {
		if (!expandedFeedback[message.id]) {
			expandedFeedback = { ...expandedFeedback, [message.id]: true };
			return;
		}
		onFeedback?.(message.id, 'unhelpful', feedbackComments[message.id] ?? '');
	};
</script>

<div class="space-y-4" aria-live="polite">
	{#if messages.length === 0}
		<p class="text-sm text-muted-foreground">
			予約、参加者、招待、チケット、課金、操作方法について質問できます。
		</p>
	{/if}

	{#each messages as message (message.id)}
		<article class={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
			{#if message.role === 'assistant'}
				<div
					class="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-secondary-foreground"
					aria-hidden="true"
				>
					<Bot class="size-4" />
				</div>
			{/if}

			<div
				class={`max-w-[min(34rem,100%)] space-y-3 rounded-lg border px-4 py-3 text-sm ${
					message.role === 'user'
						? 'border-primary/30 bg-primary text-primary-foreground'
						: 'border-border bg-card text-card-foreground'
				}`}
			>
				<p class="whitespace-pre-wrap break-words leading-6">{message.content}</p>

				{#if message.role === 'assistant'}
					<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
						<span class="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1">
							{#if message.needsHumanSupport}
								<AlertTriangle class="size-3.5" aria-hidden="true" />
							{:else}
								<Check class="size-3.5" aria-hidden="true" />
							{/if}
							{confidenceLabel(message.confidence, message.needsHumanSupport)}
						</span>
						{#if typeof message.confidence === 'number'}
							<span>信頼度 {message.confidence}%</span>
						{/if}
					</div>

					{#if message.needsHumanSupport}
						<p
							class="rounded-md border border-border bg-secondary px-3 py-2 text-xs text-secondary-foreground"
						>
							断定できない内容です。owner またはサポートに確認してください。
						</p>
					{/if}

					<AiSourceList sources={message.sources ?? []} />
					<AiSuggestedActions actions={message.suggestedActions ?? []} />

					<div class="space-y-2 border-t border-border/70 pt-3">
						<div class="flex flex-wrap items-center gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={message.feedbackStatus === 'sent' || message.feedbackStatus === 'sending'}
								onclick={() => submitHelpful(message)}
							>
								<ThumbsUp class="size-3.5" aria-hidden="true" />
								役に立った
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={message.feedbackStatus === 'sent' || message.feedbackStatus === 'sending'}
								onclick={() => submitUnhelpful(message)}
							>
								<ThumbsDown class="size-3.5" aria-hidden="true" />
								役に立たない
							</Button>
							{#if message.feedbackStatus === 'sent'}
								<span class="text-xs text-muted-foreground">フィードバックを送信しました。</span>
							{:else if message.feedbackStatus === 'failed'}
								<span class="text-xs text-destructive">
									{message.feedbackError ?? 'フィードバックを送信できません。'}
								</span>
							{/if}
						</div>

						{#if expandedFeedback[message.id] && message.feedbackStatus !== 'sent'}
							<label class="block space-y-1 text-xs text-muted-foreground">
								<span>任意コメント</span>
								<textarea
									class="min-h-20 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
									maxlength="1000"
									bind:value={feedbackComments[message.id]}
									placeholder="不足していた点を入力できます"
								></textarea>
							</label>
						{/if}
					</div>
				{/if}
			</div>

			{#if message.role === 'user'}
				<div
					class="flex size-8 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary text-primary-foreground"
					aria-hidden="true"
				>
					<UserRound class="size-4" />
				</div>
			{/if}
		</article>
	{/each}

	{#if sending}
		<p class="text-sm text-muted-foreground">回答を作成しています。</p>
	{/if}
</div>
