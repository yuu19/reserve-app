<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardFooter,
		CardHeader
	} from '$lib/components/ui/card';
	import { formatJaDateTime } from '$lib/date/format';
	import { loadSession, redirectToLoginWithNext } from '$lib/features/auth-session.svelte';
	import { authRpc } from '$lib/rpc-client';

	type JsonRecord = Record<string, unknown>;
	type BusyAction = null | 'accept' | 'reject';
	type ActionResult = {
		tone: 'success' | 'error';
		text: string;
	};

	let loading = $state(true);
	let busyAction = $state<BusyAction>(null);
	let invitationId = $state<string | null>(null);
	let invitation = $state<JsonRecord | null>(null);
	let message = $state<string>('');
	let actionResult = $state<ActionResult | null>(null);

	const isBusy = $derived(busyAction !== null);
	const hasCompletedAction = $derived(actionResult?.tone === 'success');
	const invitationStatus = $derived(
		invitation && typeof invitation.status === 'string' ? invitation.status : null
	);
	const isPending = $derived(invitationStatus === 'pending');

	const isRecord = (value: unknown): value is JsonRecord => {
		return typeof value === 'object' && value !== null;
	};

	const parseResponseBody = async (response: Response): Promise<unknown> => {
		const contentType = response.headers.get('content-type') ?? '';
		if (contentType.includes('application/json')) {
			return response.json();
		}

		const text = await response.text();
		if (!text) {
			return null;
		}

		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	};

	const toErrorMessage = (payload: unknown, fallback: string): string => {
		if (isRecord(payload) && typeof payload.message === 'string') {
			return payload.message;
		}

		if (isRecord(payload) && typeof payload.error === 'string') {
			return payload.error;
		}

		if (typeof payload === 'string' && payload.length > 0) {
			return payload;
		}

		return fallback;
	};

	const formatTimestamp = (value: unknown): string => {
		if (typeof value !== 'string') {
			return '-';
		}
		return formatJaDateTime(value, value);
	};

	const getOrganizationName = (payload: JsonRecord | null): string => {
		if (!payload) {
			return '-';
		}

		if (typeof payload.organizationName === 'string' && payload.organizationName.length > 0) {
			return payload.organizationName;
		}

		if (typeof payload.organizationId === 'string' && payload.organizationId.length > 0) {
			return payload.organizationId;
		}

		return '-';
	};

	const requireSessionAndLoadInvitation = async () => {
		if (typeof window === 'undefined') {
			return;
		}

		const searchParams = new URLSearchParams(window.location.search);
		const nextInvitationId = searchParams.get('invitationId');
		if (!nextInvitationId) {
			message = 'invitationId が見つかりません。';
			return;
		}

		invitationId = nextInvitationId;

		const { session } = await loadSession();
		if (!session) {
			const next = `${window.location.pathname}${window.location.search}`;
			redirectToLoginWithNext(next);
			return;
		}

		const detailResponse = await authRpc.getParticipantInvitationDetail(nextInvitationId);
		const detailPayload = await parseResponseBody(detailResponse);
		if (!detailResponse.ok) {
			message = toErrorMessage(detailPayload, '参加者招待情報の取得に失敗しました。');
			return;
		}

		if (!isRecord(detailPayload)) {
			message = '参加者招待情報の形式が不正です。';
			return;
		}

		invitation = detailPayload;
		message = '';
	};

	const submitAcceptInvitation = async () => {
		if (!invitationId) {
			message = 'invitationId が見つかりません。';
			return;
		}
		if (!isPending) {
			actionResult = {
				tone: 'error',
				text: 'この招待はすでに処理済みです。'
			};
			return;
		}

		busyAction = 'accept';
		try {
			const response = await authRpc.acceptParticipantInvitation({ invitationId });
			const payload = await parseResponseBody(response);
			if (!response.ok) {
				actionResult = {
					tone: 'error',
					text: toErrorMessage(payload, '参加者招待の承諾に失敗しました。')
				};
				return;
			}

			actionResult = {
				tone: 'success',
				text: '参加者招待を承諾しました。'
			};
			if (invitation) {
				invitation.status = 'accepted';
			}
		} catch {
			actionResult = {
				tone: 'error',
				text: '参加者招待承諾中に通信エラーが発生しました。'
			};
		} finally {
			busyAction = null;
		}
	};

	const submitRejectInvitation = async () => {
		if (!invitationId) {
			message = 'invitationId が見つかりません。';
			return;
		}
		if (!isPending) {
			actionResult = {
				tone: 'error',
				text: 'この招待はすでに処理済みです。'
			};
			return;
		}
		if (typeof window !== 'undefined' && !window.confirm('この参加者招待を辞退しますか？')) {
			return;
		}

		busyAction = 'reject';
		try {
			const response = await authRpc.rejectParticipantInvitation({ invitationId });
			const payload = await parseResponseBody(response);
			if (!response.ok) {
				actionResult = {
					tone: 'error',
					text: toErrorMessage(payload, '参加者招待の辞退に失敗しました。')
				};
				return;
			}

			actionResult = {
				tone: 'success',
				text: '参加者招待を辞退しました。'
			};
			if (invitation) {
				invitation.status = 'rejected';
			}
		} catch {
			actionResult = {
				tone: 'error',
				text: '参加者招待辞退中に通信エラーが発生しました。'
			};
		} finally {
			busyAction = null;
		}
	};

	onMount(() => {
		void (async () => {
			loading = true;
			try {
				await requireSessionAndLoadInvitation();
			} finally {
				loading = false;
			}
		})();
	});
</script>

<a
	href="#main-content"
	class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
>
	メインコンテンツへスキップ
</a>

<main id="main-content" class="min-h-screen">
	<div class="mx-auto flex min-h-screen w-full max-w-3xl items-center px-4 py-8 md:px-6">
		<Card class="surface-panel w-full border-border/80 shadow-lg">
			<CardHeader class="space-y-3">
				<Badge variant="outline">参加者招待</Badge>
				<h1 class="text-2xl font-semibold text-foreground md:text-3xl">招待内容の確認</h1>
				<CardDescription>
					内容を確認し、承諾または辞退を選択してください。未ログイン時はサインイン後にこの画面へ戻ります。
				</CardDescription>
			</CardHeader>

			<CardContent class="space-y-4">
				{#if loading}
					<p class="text-sm text-muted-foreground" aria-live="polite">招待情報を読み込み中…</p>
				{:else if invitation}
					<div class="space-y-2 rounded-lg border border-border/80 bg-card/80 p-4">
						<div class="flex items-center justify-between gap-2">
							<h2 class="text-sm font-semibold text-foreground">
								{getOrganizationName(invitation)}
							</h2>
							<Badge variant={isPending ? 'outline' : 'secondary'}>{invitationStatus ?? '-'}</Badge>
						</div>
						<p class="text-xs text-muted-foreground">
							参加者名: {typeof invitation.participantName === 'string'
								? invitation.participantName
								: '-'}
						</p>
						<p class="text-xs text-muted-foreground">
							期限: {formatTimestamp(invitation.expiresAt)}
						</p>
						{#if !isPending}
							<p class="text-xs text-muted-foreground">
								この招待はすでに処理済みのため、操作できません。
							</p>
						{/if}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">表示できる招待情報がありません。</p>
				{/if}

				{#if message.length > 0}
					<p class="text-sm text-destructive" role="status" aria-live="polite">{message}</p>
				{/if}
				{#if actionResult}
					<p
						role="status"
						aria-live="polite"
						class={actionResult.tone === 'success'
							? 'text-sm text-success'
							: 'text-sm text-destructive'}
					>
						{actionResult.text}
					</p>
				{/if}
			</CardContent>

			<CardFooter class="flex flex-wrap items-center justify-end gap-2">
				<Button href={resolve('/')} variant="outline" disabled={isBusy}>ダッシュボードへ戻る</Button
				>

				<Button
					type="button"
					variant="secondary"
					onclick={submitRejectInvitation}
					disabled={loading || isBusy || !invitation || !isPending || hasCompletedAction}
				>
					辞退
				</Button>

				<Button
					type="button"
					onclick={submitAcceptInvitation}
					disabled={loading || isBusy || !invitation || !isPending || hasCompletedAction}
				>
					承諾
				</Button>
			</CardFooter>
		</Card>
	</div>
</main>
