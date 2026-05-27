import { useCallback, useEffect, useRef } from 'react'
import { Flex, Text, useTheme } from '@audius/harmony'

type Props = {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}

export default function MobileSettingsSheet({ open, onClose, children }: Props) {
  const theme = useTheme()
  const sheetRef = useRef<HTMLDivElement>(null)

  const onBackdropClick = useCallback(
    (ev: React.MouseEvent) => {
      if (ev.target === ev.currentTarget) onClose()
    },
    [onClose],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      onClick={onBackdropClick}
      css={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-label="Map settings"
        css={{
          width: '100%',
          maxWidth: 480,
          maxHeight: '60dvh',
          overflow: 'auto',
          background: theme.color.background.white,
          borderRadius: `${theme.cornerRadius.l}px ${theme.cornerRadius.l}px 0 0`,
          padding: theme.spacing.l,
          paddingBottom: `calc(${theme.spacing.l}px + env(safe-area-inset-bottom, 0px))`,
          boxShadow: theme.shadows.far,
        }}
      >
        <Flex direction="column" gap="m">
          <Flex alignItems="center" justifyContent="space-between">
            <Text variant="title" size="s" strength="strong" color="heading">
              Settings
            </Text>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              css={{
                all: 'unset',
                cursor: 'pointer',
                fontSize: 20,
                width: 32,
                height: 32,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: theme.cornerRadius.s,
                color: theme.color.text.subdued,
                '&:hover': { background: theme.color.background.surface1 },
              }}
            >
              ✕
            </button>
          </Flex>
          {children}
        </Flex>
      </div>
    </div>
  )
}
