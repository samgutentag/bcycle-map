import type { ReactElement } from 'react'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { ThemeProvider } from '@audius/harmony'

/**
 * Wraps the rendered tree in Harmony's `ThemeProvider` so components that call
 * `useTheme()` resolve to the day-mode token palette. Use this in any test
 * that touches Harmony primitives (Paper, Text, SegmentedControl, …).
 */
export function renderWithTheme(ui: ReactElement, options?: RenderOptions): RenderResult {
  return render(<ThemeProvider theme="day">{ui}</ThemeProvider>, options)
}
