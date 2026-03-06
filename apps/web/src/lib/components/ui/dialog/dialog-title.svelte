<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChild<DialogPrimitive.TitleProps> = $props();
</script>

<DialogPrimitive.Title
	bind:ref
	data-slot="dialog-title"
	class={cn('text-lg font-semibold leading-none', className)}
	{...restProps}
>
	{@render children?.()}
</DialogPrimitive.Title>
