<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { createAiChatState } from '$lib/features/ai-chat.svelte';
	import { MessageCircle, Send, X } from '@lucide/svelte';
	import { tick } from 'svelte';
	import AiMessageList from './AiMessageList.svelte';

	type Props = {
		active?: boolean;
		organizationId?: string | null;
		classroomId?: string | null;
		currentPage?: string | null;
	};

	let {
		active = false,
		organizationId = null,
		classroomId = null,
		currentPage = null
	}: Props = $props();

	const chat = createAiChatState();
	let open = $state(false);
	let inputElement: HTMLTextAreaElement | null = $state(null);
	let lastScopeKey: string | null = null;

	$effect(() => {
		const scopeKey = active ? `${organizationId ?? ''}:${classroomId ?? ''}` : 'inactive';
		if (lastScopeKey !== null && scopeKey !== lastScopeKey) {
			chat.resetConversation();
		}
		lastScopeKey = scopeKey;
	});

	const captureInput = (node: HTMLTextAreaElement) => {
		inputElement = node;

		return () => {
			if (inputElement === node) {
				inputElement = null;
			}
		};
	};

	const openWidget = async () => {
		open = true;
		await tick();
		inputElement?.focus();
	};

	const closeWidget = () => {
		open = false;
	};

	const submit = async () => {
		await chat.send({
			organizationId,
			classroomId,
			currentPage
		});
		await tick();
		inputElement?.focus();
	};
</script>

{#if active}
	<div class="fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-3">
		{#if open}
			<section
				class="flex h-[min(42rem,calc(100vh-6rem))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
				aria-label="AIサポート"
			>
				<header class="flex items-center justify-between border-b border-border bg-card px-4 py-3">
					<div class="min-w-0">
						<p class="truncate text-sm font-semibold text-foreground">AIサポート</p>
						<p class="truncate text-xs text-muted-foreground">
							根拠付きで案内します。操作は実行しません。
						</p>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onclick={closeWidget}
						aria-label="AIサポートを閉じる"
					>
						<X class="size-4" aria-hidden="true" />
					</Button>
				</header>

				<div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
					<AiMessageList
						messages={chat.messages}
						sending={chat.sending}
						onFeedback={(messageId, rating, comment) =>
							void chat.submitFeedback(messageId, rating, comment)}
					/>
				</div>

				<form
					class="space-y-2 border-t border-border bg-card px-4 py-3"
					onsubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					{#if chat.error}
						<p
							class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
						>
							{chat.error}
						</p>
					{/if}
					{#if chat.inputError}
						<p class="text-xs text-destructive">{chat.inputError}</p>
					{/if}
					<div class="flex items-end gap-2">
						<label class="sr-only" for="ai-chat-message">AIサポートへの質問</label>
						<textarea
							id="ai-chat-message"
							{@attach captureInput}
							bind:value={chat.input}
							rows="2"
							maxlength="4200"
							class="min-h-11 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
							placeholder="質問を入力"
							disabled={chat.sending}
						></textarea>
						<Button
							type="submit"
							size="icon"
							disabled={!chat.canSend}
							aria-label="AIサポートへ送信"
						>
							<Send class="size-4" aria-hidden="true" />
						</Button>
					</div>
				</form>
			</section>
		{:else}
			<Button type="button" class="shadow-lg" onclick={openWidget} aria-label="AIサポートを開く">
				<MessageCircle class="size-4" aria-hidden="true" />
				AIサポート
			</Button>
		{/if}
	</div>
{/if}
