import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    variant: {
      default: 'border-transparent bg-accent text-accent-foreground',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      success: 'border-transparent bg-emerald-100 dark:bg-emerald-200/10 text-emerald-800 dark:text-emerald-200',
      warning: 'border-transparent bg-amber-50 dark:bg-amber-200/10 text-amber-800 dark:text-amber-200',
      destructive: 'border-transparent bg-red-100 dark:bg-red-200/10 text-red-800 dark:text-red-200',
      outline: 'text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
