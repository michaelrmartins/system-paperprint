import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/20 dark:bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className={`relative w-full ${sizeClasses[size]} animate-scaleIn`}>
        <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-white/60 dark:border-white/10 rounded-2xl shadow-glass dark:shadow-glass-dark overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-black/6 dark:border-white/8">
            <h2 className="text-[16px] font-semibold text-gray-900 dark:text-white tracking-tight">{title}</h2>
            {onClose && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-800/80 transition-colors"
              >
                <X size={18} />
              </button>
            )}
          </div>
          <div className="px-6 py-5">{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
}
