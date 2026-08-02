import * as Select from '@radix-ui/react-select';
import { CaretDownIcon, CheckIcon } from '@phosphor-icons/react';

export interface SelectOption<T extends string> {
  readonly label: string;
  readonly value: T;
}

interface SelectControlProps<T extends string> {
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly onValueChange: (value: T) => void;
  readonly options: readonly SelectOption<T>[];
  readonly value: T;
}

export const SelectControl = <T extends string>({
  ariaLabel,
  disabled = false,
  onValueChange,
  options,
  value,
}: SelectControlProps<T>) => (
  <Select.Root disabled={disabled} onValueChange={onValueChange} value={value}>
    <Select.Trigger
      aria-label={ariaLabel}
      className="group flex h-10 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-800 shadow-sm outline-none transition hover:border-zinc-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-zinc-950/80 dark:text-zinc-100 dark:shadow-none dark:hover:border-white/20"
    >
      <Select.Value />
      <Select.Icon asChild>
        <CaretDownIcon
          aria-hidden="true"
          className="shrink-0 text-zinc-500 transition duration-200 group-hover:translate-y-0.5 group-hover:text-emerald-600 group-data-[state=open]:rotate-180 group-data-[state=open]:text-emerald-600 dark:group-hover:text-emerald-400 dark:group-data-[state=open]:text-emerald-400"
          size={15}
        />
      </Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content
        className="z-[100] max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-zinc-200 bg-white p-1.5 text-zinc-800 shadow-xl data-[state=open]:animate-[menu-in_120ms_ease-out] dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100"
        collisionPadding={12}
        position="popper"
        sideOffset={6}
      >
        <Select.Viewport>
          {options.map((option) => (
            <Select.Item
              className="relative flex cursor-pointer select-none items-center rounded-lg py-2 pl-8 pr-3 text-sm outline-none data-[highlighted]:bg-zinc-100 data-[state=checked]:font-medium data-[highlighted]:text-zinc-950 dark:data-[highlighted]:bg-zinc-800 dark:data-[highlighted]:text-white"
              key={option.value}
              value={option.value}
            >
              <Select.ItemIndicator className="absolute left-2.5 grid place-items-center text-emerald-600 dark:text-emerald-400">
                <CheckIcon aria-hidden="true" size={14} weight="bold" />
              </Select.ItemIndicator>
              <Select.ItemText>{option.label}</Select.ItemText>
            </Select.Item>
          ))}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
);
