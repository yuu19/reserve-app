<script lang="ts">
	import { parseDate, type DateValue } from '@internationalized/date';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import { Button } from '$lib/components/ui/button';
	import { Calendar } from '$lib/components/ui/calendar';
	import { formatJaDate } from '$lib/date/format';
	import { Label } from '$lib/components/ui/label';
	import * as Popover from '$lib/components/ui/popover';

	type DatePickerProps = {
		id: string;
		name: string;
		label: string;
		value?: string;
		placeholder?: string;
		required?: boolean;
		disabled?: boolean;
	};

	let {
		id,
		name,
		label,
		value = $bindable(''),
		placeholder = '日付を選択',
		required = false,
		disabled = false
	}: DatePickerProps = $props();

	let open = $state(false);

	const parseDateValue = (date: string): DateValue | undefined => {
		if (!date) {
			return undefined;
		}

		try {
			return parseDate(date);
		} catch {
			return undefined;
		}
	};

	const parsedDate = $derived(parseDateValue(value));

	const displayValue = $derived.by(() => {
		if (!value) {
			return placeholder;
		}
		return formatJaDate(value, value);
	});

	const onDateChange = (next: DateValue | undefined) => {
		value = next?.toString() ?? '';
		if (next) {
			open = false;
		}
	};

</script>

<div class="space-y-2">
	<Label for={id}>{required ? `${label}*` : label}</Label>
	<input type="hidden" {name} value={value} />
	<Popover.Root bind:open>
		<Popover.Trigger class="w-full">
			<Button
				type="button"
				variant="outline"
				class={`w-full justify-between text-left ${!value ? 'text-muted-foreground' : ''}`}
				{disabled}
				{id}
				aria-haspopup="dialog"
			>
				{displayValue}
				<CalendarIcon class="size-4 opacity-70" aria-hidden="true" />
			</Button>
		</Popover.Trigger>
		<Popover.Content class="w-auto p-3" align="start">
			<Calendar value={parsedDate} onValueChange={onDateChange} />
		</Popover.Content>
	</Popover.Root>
</div>
