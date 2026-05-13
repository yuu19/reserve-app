<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import type { AiSourceReference } from '$lib/ai-client';

	type Props = {
		sources?: AiSourceReference[];
	};

	let { sources = [] }: Props = $props();

	const sourceKindLabel: Record<AiSourceReference['sourceKind'], string> = {
		docs: 'ドキュメント',
		specs: '仕様',
		faq: 'FAQ',
		db_summary: '業務情報'
	};
</script>

{#if sources.length > 0}
	<ul class="space-y-1" aria-label="回答の参照元">
		{#each sources.slice(0, 4) as source (`${source.sourceKind}-${source.chunkId ?? source.title}`)}
			<li class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				<Badge variant="outline">{sourceKindLabel[source.sourceKind]}</Badge>
				<span class="font-medium text-secondary-foreground">{source.title}</span>
				{#if source.sourcePath}
					<span class="max-w-full truncate text-muted-foreground">{source.sourcePath}</span>
				{/if}
			</li>
		{/each}
	</ul>
{:else}
	<p class="text-xs text-muted-foreground">確認できる参照元は表示できません。</p>
{/if}
