import type { ReactElement } from 'react'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { ThemeProvider } from '@audius/harmony'
import { AppThemeProvider } from './theme'

/**
 * Wraps the rendered tree in Harmony's `ThemeProvider` and the project's
 * `AppThemeProvider`, so components that call `useTheme()` or `useAppTheme()`
 * resolve to the day-mode token palette.
 */
export function renderWithTheme(ui: ReactElement, options?: RenderOptions): RenderResult {
  return render(
    <AppThemeProvider>
      <ThemeProvider theme="day">{ui}</ThemeProvider>
    </AppThemeProvider>,
    options,
  )
}
