import React from 'react'

type Color = 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'gray' | 'orange'

interface BadgeProps {
  color?: Color
  children: React.ReactNode
  className?: string
}

const colorClasses: Record<Color, string> = {
  blue: 'bg-blue-100 text-blue-800',
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  purple: 'bg-purple-100 text-purple-800',
  gray: 'bg-gray-100 text-gray-700',
  orange: 'bg-orange-100 text-orange-800'
}

export function Badge({ color = 'blue', children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colorClasses[color]} ${className}`}
    >
      {children}
    </span>
  )
}
