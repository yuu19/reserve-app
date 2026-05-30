<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { Label } from '$lib/components/ui/label';
	import { cancelPublicBooking } from '$lib/features/public-site.svelte';
	import { toast } from 'svelte-sonner';

	const orgSlug = $derived(page.params.orgSlug ?? '');
	const storeSlug = $derived(page.params.storeSlug ?? '');
	const bookingPublicId = $derived(page.params.bookingPublicId ?? '');
	const token = $derived(page.url.searchParams.get('token') ?? '');

	let busy = $state(false);
	let completed = $state(false);
	let reason = $state('');

	const submitCancel = async () => {
		if (busy || !token) {
			return;
		}

		busy = true;
		try {
			const result = await cancelPublicBooking(
				{ orgSlug, storeSlug, bookingPublicId },
				{ token, reason }
			);
			if (!result.ok) {
				toast.error(result.message);
				return;
			}
			completed = true;
			toast.success(result.message);
		} finally {
			busy = false;
		}
	};
</script>

<main class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold text-foreground">予約キャンセル</h1>
		<p class="text-sm text-muted-foreground">
			予約番号 <span class="font-mono text-foreground">{bookingPublicId}</span>
		</p>
	</header>

	<Card class="surface-panel border-border/80 shadow-lg">
		<CardHeader>
			<h2 class="text-xl font-semibold text-foreground">キャンセル確認</h2>
			<CardDescription>メールに記載されたキャンセルURLからのみ操作できます。</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			{#if completed}
				<div class="rounded-md border border-primary/25 bg-primary/10 p-4">
					<p class="text-sm font-semibold text-foreground">予約をキャンセルしました。</p>
				</div>
			{:else if !token}
				<p class="text-sm text-destructive">キャンセルトークンがありません。</p>
			{:else}
				<form
					class="space-y-4"
					onsubmit={(event) => {
						event.preventDefault();
						void submitCancel();
					}}
				>
					<div class="space-y-2">
						<Label for="public-cancel-reason">キャンセル理由</Label>
						<textarea
							id="public-cancel-reason"
							name="reason"
							class="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
							bind:value={reason}
							disabled={busy}
							maxlength={500}
						></textarea>
					</div>
					<Button type="submit" variant="destructive" disabled={busy}>
						{busy ? '処理中…' : '予約をキャンセルする'}
					</Button>
				</form>
			{/if}
		</CardContent>
	</Card>
</main>
