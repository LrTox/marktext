'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'

export function useNavShrink(): [RefObject<HTMLElement | null>, boolean] {
  const navRef = useRef<HTMLElement>(null)
  const [shrunk, setShrunk] = useState(false)

  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    let last = -1
    const onScroll = () => {
      const y = window.scrollY > 20 ? 1 : 0
      if (y === last) return
      last = y
      setShrunk(y === 1)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return [navRef, shrunk]
}
