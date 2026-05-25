import React from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, leftIcon, rightIcon, className = '', id, ...rest }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-gray-700">
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={[
              'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm',
              'placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
              'disabled:bg-gray-50 disabled:text-gray-500',
              'min-h-[44px]',
              error ? 'border-red-400 focus:ring-red-500' : '',
              leftIcon ? 'pl-10' : '',
              rightIcon ? 'pr-10' : '',
              className
            ]
              .filter(Boolean)
              .join(' ')}
            {...rest}
          />
          {rightIcon && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              {rightIcon}
            </span>
          )}
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    )
  }
)
Input.displayName = 'Input'
