import { Link } from 'react-router-dom'
import {
  Flex,
  IconExternalLink,
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  Text,
  useTheme,
} from '@audius/harmony'
import { BikeGlyph } from './BrandMark'
import UnitSystemToggle from './UnitSystemToggle'
import { useSystem } from '../context/SystemContext'

type Props = {
  open: boolean
  onClose: () => void
}

type LinkCard = {
  href: string
  label: string
  desc: string
  internal?: boolean
}

function LinkTile({ link, onClose }: { link: LinkCard; onClose: () => void }) {
  const theme = useTheme()
  const sharedCss = {
    all: 'unset' as const,
    cursor: 'pointer',
    aspectRatio: '1 / 1',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    padding: theme.spacing.s,
    textAlign: 'center' as const,
    borderRadius: theme.cornerRadius.m,
    background: theme.color.background.surface1,
    border: `1px solid ${theme.color.border.default}`,
    color: theme.color.text.default,
    transition: `background ${theme.motion.quick}, border-color ${theme.motion.quick}`,
    '&:hover': {
      background: theme.color.background.white,
      borderColor: theme.color.border.strong,
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.color.focus.default}`,
      outlineOffset: 2,
    },
  }
  const body = (
    <>
      <Text variant="title" size="s" strength="strong" color="heading">
        {link.label}
      </Text>
      <Text variant="body" size="xs" color="subdued">
        {link.desc}
      </Text>
    </>
  )
  return link.internal ? (
    <Link to={link.href} onClick={onClose} css={sharedCss}>
      {body}
    </Link>
  ) : (
    <a href={link.href} target="_blank" rel="noopener noreferrer" css={sharedCss}>
      {body}
    </a>
  )
}

export default function AboutModal({ open, onClose }: Props) {
  const theme = useTheme()
  const { activeSystem } = useSystem()
  const LINKS: LinkCard[] = [
    { href: '/user-guide.html', label: 'User guide', desc: 'How to read the map' },
    { href: 'https://github.com/samgutentag/bcycle-map', label: 'GitHub', desc: 'View the code' },
    { href: activeSystem?.gbfsUrl ?? 'https://gbfs.bcycle.com/bcycle_santabarbara/gbfs.json', label: 'GBFS feed', desc: 'Live data origin' },
    { href: '/activity', label: 'Activity', desc: 'Recent rides', internal: true },
    { href: activeSystem?.rentalUrl ?? 'https://santabarbara.bcycle.com', label: 'BCycle', desc: 'Rent a real bike' },
    { href: 'mailto:bcycle-map@samgutentag.com', label: 'Contact', desc: 'Feedback & corrections' },
  ]
  return (
    <Modal isOpen={open} onClose={onClose} dismissOnClickOutside>
      <ModalHeader onClose={onClose}>
        <Flex direction="column" alignItems="center" gap="s" css={{ width: '100%' }}>
          <Flex
            alignItems="center"
            justifyContent="center"
            css={{
              width: 56,
              height: 56,
              borderRadius: theme.cornerRadius.l,
              background: theme.color.background.surface1,
              border: `1px solid ${theme.color.border.default}`,
              color: theme.color.text.heading,
            }}
          >
            <BikeGlyph size={32} />
          </Flex>
          <ModalTitle title="bcycle-map" />
          <Text variant="label" size="s" color="warning" strength="strong">
            {activeSystem?.name ?? 'Santa Barbara BCycle'}
          </Text>
        </Flex>
      </ModalHeader>
      <ModalContent>
        <Flex direction="column" gap="l" css={{ paddingBottom: theme.spacing.l }}>
          <Text variant="body" size="m" color="default" textAlign="center">
            A live map of {activeSystem?.name ?? 'Santa Barbara'} bike share, with historical patterns, a route planner, and a feed
            of recent activity. Find an available bike or an open dock before you walk over.
          </Text>

          <Flex
            css={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: theme.spacing.s,
            }}
          >
            {LINKS.map((l) => (
              <LinkTile key={l.href} link={l} onClose={onClose} />
            ))}
          </Flex>

          <Flex
            justifyContent="space-between"
            alignItems="center"
            gap="m"
            css={{
              paddingTop: theme.spacing.m,
              borderTop: `1px solid ${theme.color.border.default}`,
            }}
          >
            <UnitSystemToggle />
          </Flex>

          <Flex
            justifyContent="center"
            alignItems="center"
            gap="xs"
            css={{
              paddingTop: theme.spacing.m,
              borderTop: `1px solid ${theme.color.border.default}`,
            }}
          >
            <Text variant="body" size="s" color="subdued">
              Made by
            </Text>
            <a
              href="https://www.gutentag.world"
              target="_blank"
              rel="noopener noreferrer"
              css={{
                color: theme.color.text.warning,
                textDecoration: 'none',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              Sam Gutentag <IconExternalLink size="xs" color="warning" />
            </a>
            <Text variant="body" size="s" color="subdued">
              in {activeSystem?.name ?? 'Santa Barbara'}
            </Text>
          </Flex>
        </Flex>
      </ModalContent>
    </Modal>
  )
}
