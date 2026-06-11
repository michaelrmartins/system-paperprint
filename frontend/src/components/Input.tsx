import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ label, error, className = '', ...props }, ref) => (
  <div className="flex flex-col gap-1.5">
    {label && (
      <label className="text-[13px] font-medium text-gray-500 dark:text-gray-400 tracking-wide uppercase">
        {label}
      </label>
    )}
    <input
      ref={ref}
      {...props}
      className={`
        w-full px-3.5 py-2.5 text-[15px] text-gray-900 dark:text-white bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm
        border rounded-xl outline-none transition-all duration-150
        placeholder:text-gray-400 dark:placeholder:text-gray-600
        focus:border-gray-400 dark:focus:border-gray-500 focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700
        ${error ? 'border-red-400 focus:border-red-400 focus:ring-red-100' : 'border-gray-200 dark:border-gray-700'}
        ${className}
      `}
    />
    {error && <p className="text-[13px] text-red-500">{error}</p>}
  </div>
));

Input.displayName = 'Input';
