<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import type { AiSuggestedAction, AiSuggestedActionKind } from '@repo/saas-chatbot-core';
	import { ExternalLink, LifeBuoy, UserRoundCheck } from '@lucide/svelte';

	type Props = {
		actions?: AiSuggestedAction[];
	};

	let { actions = [] }: Props = $props();

	const iconByKind: Record<AiSuggestedActionKind, typeof ExternalLink> = {
		open_page: ExternalLink,
		contact_owner: UserRoundCheck,
		contact_support: LifeBuoy
	};
</script>

{#if actions.length > 0}
	<div class="flex flex-wrap gap-2" aria-label="次のアクション">
		{#each actions as action (`${action.actionKind}-${action.label}`)}
			{@const Icon = iconByKind[action.actionKind]}
			{#if action.actionKind === 'open_page' && action.href}
				<a
					href={resolve(action.href as Pathname)}
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
