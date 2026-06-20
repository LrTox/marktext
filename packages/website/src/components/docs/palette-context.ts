'use client'

import { createContext, useContext } from 'react'

type PaletteContextValue = {
  open: boolean
  openPalette: () => void
  closePalette: () => void
}

export const PaletteContext = createContext<PaletteContextValue | null>(null)

export function usePalette(): PaletteContextValue {
  const ctx = useContext(PaletteContext)
  if (!ctx) throw new Error('usePalette must be used within <PaletteContext.Provider>')
  return ctx
}
