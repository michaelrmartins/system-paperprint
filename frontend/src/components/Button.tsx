import { ReactNode, ButtonHTMLAttributes, forwardRef } from 'react';
import { Spinner } from './Spinner';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  children: ReactNode;
  size?: 'sm' | 'md';
}

const variants = {
  primary: 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 active:bg-gray-950 dark:active:bg-gray-200 shadow-sm',
  secondary: 'bg-white/80 dark:bg-gray-800/80 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/80 active:bg-gray-100 dark:active:bg-gray-700',
  danger: 'bg-red-500 text-white hover:bg-red-600 active:bg-red-700',
  ghost: 'text-gray-600 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-800/80 active:bg-gray-200/80 dark:active:bg-gray-700/80',
};

const sizes = {
  sm: 'px-3.5 py-2 text-[14px]',
  md: 'px-5 py-2.5 text-[15px]',
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

Button.displayName = 'Button';
