import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  message: string
  type: ToastType
}

interface UiState {
  toasts: Toast[]
  activeModal: string | null
  sidebarOpen: boolean

  showToast: (message: string, type?: ToastType) => void
  dismissToast: (id: string) => void
  openModal: (name: string) => void
  closeModal: () => void
  setSidebarOpen: (open: boolean) => void
}

let toastIdCounter = 0

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],
  activeModal: null,
  sidebarOpen: true,

  showToast: (message, type = 'info') => {
    const id = String(++toastIdCounter)
    set({ toasts: [...get().toasts, { id, message, type }] })
    setTimeout(() => get().dismissToast(id), 4000)
  },

  dismissToast: (id) =>
    set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  openModal: (name) => set({ activeModal: name }),
  closeModal: () => set({ activeModal: null }),
  setSidebarOpen: (open) => set({ sidebarOpen: open })
}))
