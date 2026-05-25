import { create } from 'zustand'

interface LogoState {
  /** Base64 data URI of the store logo, or null if none set */
  logoBase64: string | null
  setLogo: (logo: string | null) => void
}

export const useLogoStore = create<LogoState>((set) => ({
  logoBase64: null,
  setLogo: (logo) => set({ logoBase64: logo })
}))
