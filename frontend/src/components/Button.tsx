import { ReactNode, ButtonHTMLAttributes, forwardRef } from 'react';
import { Spinner } from './Spinner';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  children: ReactNode;
  size?: 'sm' | 'md';
}

const variants = {
  primary: 'bg-gray-900 text-white hover:bg-gray-800 active:bg-gray-950 shadow-sm',
  secondary: 'bg-white/80 text-gray-700 border border-gray-200 hover:bg-gray-50 active:bg-gray-100',
  danger: 'bg-red-500 text-white hover:bg-red-600 active:bg-red-700',
  ghost: 'text-gray-600 hover:bg-gray-100/80 active:bg-gray-200/80',
};

const sizes = {
  sm: 'px-3 py-1.5 text-[13px]',
  md: 'px-4 py-2 text-[14px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', loading, children, className = '', size = 'md', disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        {...props}
        disabled={disabled || loading}
        className={`
          inline-flex items-center gap-2 font-medium rounded-xl
          transition-all duration-150 ease-out focus:outline-none
          focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1
          disabled:opacity-50 disabled:cursor-not-allowed
          ${variants[variant]} ${sizes[size]} ${className}
        `}
      >
        {loading && <Spinner size="sm" />}
        {children}
      </button>
    );
  }
);
