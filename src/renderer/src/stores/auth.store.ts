import { create } from 'zustand'
import type { StaffMember, Shift } from '../types'

interface AuthState {
  staff: StaffMember | null
  shift: Shift | null
  isAuthenticated: boolean
  login: (staff: StaffMember) => void
  logout: () => void
  setShift: (shift: Shift | null) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  staff: null,
  shift: null,
  isAuthenticated: false,

  login: (staff) =>
    set({ staff, isAuthenticated: true }),

  logout: () =>
    set({ staff: null, shift: null, isAuthenticated: false }),

  setShift: (shift) => set({ shift })
}))
