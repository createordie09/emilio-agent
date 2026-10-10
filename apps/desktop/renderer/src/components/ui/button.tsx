import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Button (CdC §6.1.7) : primary, secondary, ink, ghost, danger — tailles 32 / 40 / 48 px. */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap select-none transition-all duration-150 ease-soft disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] cursor-pointer',
  {
    variants: {
      variant: {
        primary:
          'rounded-full bg-primary-strong text-on-primary hover:bg-primary-hover hover:shadow-glow font-semibold',
        secondary:
          'rounded-full bg-surface text-text border border-border hover:bg-primary-softer hover:border-primary-soft',
        ink: 'rounded-[10px] bg-ink text-on-ink hover:opacity-90',
        ghost: 'rounded-full text-text-muted hover:bg-primary-softer hover:text-primary-strong',
        danger: 'rounded-full bg-danger text-on-primary hover:opacity-90 font-semibold',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-10 px-5 text-sm',
        lg: 'h-12 px-6 text-[15px]',
      },
      icon: { true: 'px-0 aspect-square', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', icon: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, icon, asChild, loading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, icon }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && (
              <Loader2 className="size-4 animate-[spin_1s_linear_infinite]" aria-hidden />
            )}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
