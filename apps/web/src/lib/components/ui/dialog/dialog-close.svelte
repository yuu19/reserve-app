<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChild<DialogPrimitive.CloseProps> = $props();
</script>

<DialogPrimitive.Close
	bind:ref
	data-slot="dialog-close"
	class={cn(className)}
	{...restProps}
>
	{@render children?.()}
</DialogPrimitive.Close>
