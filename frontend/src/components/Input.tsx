import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ label, error, className = '', ...props }, ref) => (
  <div className="flex flex-col gap-1.5">
    {label && (
      <label className="text-[12px] font-medium text-gray-500 tracking-wide uppercase">
        {label}
      </label>
    )}
    <input
      ref={ref}
      {...props}
      className={`
        w-full px-3 py-2 text-[14px] text-gray-900 bg-white/70 backdrop-blur-sm
        border rounded-xl outline-none transition-all duration-150
        placeholder:text-gray-400
        focus:border-gray-400 focus:ring-2 focus:ring-gray-200
        ${error ? 'border-red-400 focus:border-red-400 focus:ring-red-100' : 'border-gray-200'}
        ${className}
      `}
    />
    {error && <p className="text-[12px] text-red-500">{error}</p>}
  </div>
));

Input.displayName = 'Input';
