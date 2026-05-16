import { useTheme } from '@audius/harmony'

/**
 * Small pulsing emerald dot used as the "this data is live" indicator.
 * Sits next to a label like "Right now" on tiles that read from the
 * polled snapshot rather than historical/cached data.
 */
export default function LiveDot({ size = 8 }: { size?: number }) {
  const theme = useTheme()
  return (
    <span
      aria-hidden
      css={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: theme.color.status.success,
        boxShadow: `0 0 0 2px color-mix(in srgb, ${theme.color.status.success} 30%, transparent)`,
        animation: 'liveDotPulse 2s ease-out infinite',
        '@keyframes liveDotPulse': {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.4 },
        },
      }}
    />
  )
}
