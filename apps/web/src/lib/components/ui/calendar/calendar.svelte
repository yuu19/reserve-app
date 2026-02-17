<script lang="ts">
	import { Calendar as CalendarPrimitive } from 'bits-ui';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { cn } from '$lib/utils.js';
	import type { DateValue } from '@internationalized/date';

	let {
		value,
		placeholder,
		onValueChange,
		locale = 'ja-JP',
		class: className
	}: {
		value?: DateValue;
		placeholder?: DateValue;
		onValueChange?: (value: DateValue | undefined) => void;
		locale?: string;
		class?: string;
	} = $props();

	type CalendarMonth = {
		value: DateValue;
		weeks: DateValue[][];
	};
</script>

<CalendarPrimitive.Root
	type="single"
	{value}
	{placeholder}
	{onValueChange}
	{locale}
	fixedWeeks
	class={cn('rounded-md', className)}
>
	{#snippet children({ months, weekdays })}
		<CalendarPrimitive.Header class="mb-2 flex items-center justify-between gap-2">
			<CalendarPrimitive.PrevButton
				class="hover:bg-accent inline-flex size-8 items-center justify-center rounded-md border"
			>
				<ChevronLeftIcon class="size-4" />
			</CalendarPrimitive.PrevButton>
			<CalendarPrimitive.Heading class="text-sm font-semibold" />
			<CalendarPrimitive.NextButton
				class="hover:bg-accent inline-flex size-8 items-center justify-center rounded-md border"
			>
				<ChevronRightIcon class="size-4" />
			</CalendarPrimitive.NextButton>
		</CalendarPrimitive.Header>

		{#each months as month (month.value.toString())}
			{@const typedMonth = month as CalendarMonth}
			<CalendarPrimitive.Grid class="w-full border-collapse">
				<CalendarPrimitive.GridHead>
					<CalendarPrimitive.GridRow class="grid grid-cols-7">
						{#each weekdays as weekday, weekdayIndex (`weekday-${weekdayIndex}`)}
							<CalendarPrimitive.HeadCell class="text-muted-foreground p-1 text-center text-xs">
								{weekday}
							</CalendarPrimitive.HeadCell>
						{/each}
					</CalendarPrimitive.GridRow>
				</CalendarPrimitive.GridHead>
				<CalendarPrimitive.GridBody>
					{#each typedMonth.weeks as week, index (`${typedMonth.value.toString()}-${index}`)}
						<CalendarPrimitive.GridRow class="grid grid-cols-7 gap-y-1">
							{#each week as date, dayIndex (`${typedMonth.value.toString()}-${index}-${dayIndex}-${date.toString()}`)}
								<CalendarPrimitive.Cell {date} month={typedMonth.value} class="p-0.5">
									<CalendarPrimitive.Day
										class="hover:bg-accent data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[outside-month]:text-muted-foreground inline-flex size-8 items-center justify-center rounded-md text-sm outline-none focus-visible:ring-2"
									/>
								</CalendarPrimitive.Cell>
							{/each}
						</CalendarPrimitive.GridRow>
					{/each}
				</CalendarPrimitive.GridBody>
			</CalendarPrimitive.Grid>
		{/each}
	{/snippet}
</CalendarPrimitive.Root>
