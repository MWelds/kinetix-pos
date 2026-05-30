import { create } from 'zustand'
import { api } from '../lib/api'
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

  logout: () => {
    // Clear the main-process session so role-gated IPC handlers reject subsequent calls
    api.staff.logout().catch(() => { /* non-fatal — renderer state is still cleared */ })
    set({ staff: null, shift: null, isAuthenticated: false })
  },

  setShift: (shift) => set({ shift })
}))
