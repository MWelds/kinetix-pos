import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  selected?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

const paddingClasses = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6'
}

export function Card({ children, className = '', onClick, selected, padding = 'md' }: CardProps) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      className={[
        'bg-white rounded-xl border shadow-sm',
        selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:border-gray-300',
        onClick ? 'cursor-pointer transition-all hover:shadow-md active:scale-[0.98]' : '',
        paddingClasses[padding],
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  )
}
