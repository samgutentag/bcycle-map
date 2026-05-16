import { Flex, Text } from '@audius/harmony'

/**
 * Inline bike SVG that picks up `currentColor`, so it tints to whatever heading
 * color the active theme uses. Custom geometry tuned to read at 20–24px;
 * Harmony does not ship a bicycle icon.
 */
export function BikeGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="7.5" cy="22" r="5.25" />
      <circle cx="24.5" cy="22" r="5.25" />
      <path d="M7.5 22 13.5 13 H21 L24.5 22" />
      <path d="M13.5 13 17 8 H21" />
      <circle cx="17" cy="8" r="0.5" fill="currentColor" />
    </svg>
  )
}

export default function BrandMark() {
  return (
    <Flex alignItems="center" gap="s" aria-label="bcycle-map home">
      <Flex
        alignItems="center"
        justifyContent="center"
        css={(theme) => ({
          width: 36,
          height: 36,
          borderRadius: theme.cornerRadius.s,
          background: theme.color.background.surface1,
          color: theme.color.text.heading,
          border: `1px solid ${theme.color.border.default}`,
        })}
      >
        <BikeGlyph size={22} />
      </Flex>
      <Flex direction="column" gap="2xs">
        <Text variant="title" size="m" strength="strong" color="heading" lineHeight="single">
          bcycle-map
        </Text>
        <Text
          variant="label"
          size="xs"
          color="subdued"
          lineHeight="single"
          css={{ '@media (max-width: 600px)': { display: 'none' } }}
        >
          Santa Barbara · Live
        </Text>
      </Flex>
    </Flex>
  )
}
