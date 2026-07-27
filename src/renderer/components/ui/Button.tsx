import * as React from 'react';
import { cn } from '../../lib/utils';

type Variant = 'default' | 'secondary' | 'ghost' | 'outline';
type Size = 'default' | 'sm' | 'lg' | 'icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClass: Record<Variant, string> = {
  default: 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300',
  secondary: 'bg-slate-200 text-slate-900 hover:bg-slate-300 disabled:bg-slate-100 disabled:text-slate-400',
  ghost: 'text-slate-700 hover:bg-slate-100',
  outline: 'border border-slate-300 text-slate-700 hover:bg-slate-50',
};

const sizeClass: Record<Size, string> = {
  default: 'px-3 py-1.5 text-sm',
  sm: 'px-2 py-1 text-xs',
  lg: 'px-4 py-2 text-base',
  icon: 'p-2',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-1 rounded font-medium transition-colors disabled:cursor-not-allowed',
        variantClass[variant],
        sizeClass[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = 'Button';
