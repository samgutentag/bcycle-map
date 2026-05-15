import { useTheme } from '@audius/harmony'
import type { IconColors } from '@audius/harmony/dist/foundations/color/semantic'

/**
 * Custom icons for surfaces where Harmony's bundled set leans music-app
 * (e.g. IconNote is a music note) or doesn't include the glyph we need
 * (no bike, no sun, no moon). These match Harmony's `IconComponent`-style
 * surface — `size` + `color` — so they can be passed where Harmony icons go.
 */

type IconSize = 'xs' | 's' | 'm' | 'l' | 'xl'
const ICON_PX: Record<IconSize, number> = { xs: 14, s: 16, m: 20, l: 24, xl: 32 }

type IconProps = {
  size?: IconSize
  color?: IconColors | 'inherit'
  className?: string
  'aria-label'?: string
}

function useIconColor(color: IconColors | 'inherit' | undefined): string {
  const theme = useTheme()
  if (!color || color === 'inherit') return 'currentColor'
  return theme.color.icon[color]
}

export function IconBike({ size = 'm', color, className, ...rest }: IconProps) {
  const px = ICON_PX[size]
  const stroke = useIconColor(color)
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 32 32"
      fill="none"
      stroke={stroke}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={rest['aria-label'] ? undefined : true}
      role={rest['aria-label'] ? 'img' : undefined}
      {...rest}
    >
      <circle cx={7.5} cy={22} r={5.25} />
      <circle cx={24.5} cy={22} r={5.25} />
      <path d="M7.5 22 13.5 13 H21 L24.5 22" />
      <path d="M13.5 13 17 8 H21" />
      <circle cx={17} cy={8} r={0.5} fill={stroke} stroke="none" />
    </svg>
  )
}

export function IconSun({ size = 'm', color, className, ...rest }: IconProps) {
  const px = ICON_PX[size]
  const stroke = useIconColor(color)
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={rest['aria-label'] ? undefined : true}
      role={rest['aria-label'] ? 'img' : undefined}
      {...rest}
    >
      <circle cx={12} cy={12} r={4} />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

export function IconMoon({ size = 'm', color, className, ...rest }: IconProps) {
  const px = ICON_PX[size]
  const stroke = useIconColor(color)
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={rest['aria-label'] ? undefined : true}
      role={rest['aria-label'] ? 'img' : undefined}
      {...rest}
    >
      <path d="M20.5 14.4A8.5 8.5 0 1 1 9.6 3.5a7 7 0 0 0 10.9 10.9z" />
    </svg>
  )
}

export type CustomIconComponent = typeof IconBike
