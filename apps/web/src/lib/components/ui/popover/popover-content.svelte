<script lang="ts">
	import { Popover as PopoverPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 8,
		children,
		...restProps
	}: WithoutChild<PopoverPrimitive.ContentProps> = $props();
</script>

<PopoverPrimitive.Portal>
	<PopoverPrimitive.Content
		bind:ref
		data-slot="popover-content"
		{sideOffset}
		class={cn(
			"bg-popover text-popover-foreground z-50 w-fit rounded-md border p-2 shadow-md outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
			className
		)}
		{...restProps}
	>
		{@render children?.()}
	</PopoverPrimitive.Content>
</PopoverPrimitive.Portal>
