import * as Dropdown from '@radix-ui/react-dropdown-menu';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const DropdownMenu = Dropdown.Root;
export const DropdownTrigger = Dropdown.Trigger;

export function DropdownContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof Dropdown.Content>) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content
        sideOffset={6}
        align="end"
        className={cn('z-50 min-w-[10rem] rounded-md border bg-card p-1 shadow-lg', className)}
        {...props}
      />
    </Dropdown.Portal>
  );
}

export function DropdownItem({ className, ...props }: React.ComponentPropsWithoutRef<typeof Dropdown.Item>) {
  return (
    <Dropdown.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-secondary data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export const DropdownSeparator = () => <Dropdown.Separator className="my-1 h-px bg-border" />;
