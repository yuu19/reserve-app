<script lang="ts">
	import type { AiSuggestedAction } from '$lib/ai-client';
	import { ExternalLink, LifeBuoy, UserRoundCheck } from '@lucide/svelte';

	type Props = {
		actions?: AiSuggestedAction[];
	};

	let { actions = [] }: Props = $props();

	const iconByKind = {
		open_page: ExternalLink,
		contact_owner: UserRoundCheck,
		contact_support: LifeBuoy
	};
</script>

{#if actions.length > 0}
	<div class="flex flex-wrap gap-2" aria-label="次のアクション">
		{#each actions as action (`${action.actionKind ?? 'contact_support'}-${action.label}`)}
			{@const Icon = iconByKind[action.actionKind ?? 'contact_support']}
			{#if action.actionKind === 'open_page' && action.href}
				<a
					href={action.href}
					class="inline-flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary"
				>
					<Icon class="size-3.5" aria-hidden="true" />
					<span>{action.label}</span>
				</a>
			{:else}
				<span
					class="inline-flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-secondary-foreground"
				>
					<Icon class="size-3.5" aria-hidden="true" />
					<span>{action.label}</span>
				</span>
			{/if}
		{/each}
	</div>
{/if}
