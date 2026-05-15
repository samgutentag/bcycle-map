import { useStableVerb } from '../lib/spinner-verbs'

type Phase = 'init' | 'partitions' | 'query' | 'ready' | 'idle'

const PHASE_LABEL: Record<Phase, string | undefined> = {
  init: undefined,
  partitions: undefined,
  query: undefined,
  ready: '',
  idle: undefined,
}

type Props = {
  /** Aspect ratio expressed as width / height (defaults to the line chart's 600/220). */
  aspectRatio?: number
  label?: string
  phase?: Phase
}

export default function ChartSkeleton({ aspectRatio = 600 / 220, label, phase = 'idle' }: Props) {
  const verb = useStableVerb()
  const phaseOverride = PHASE_LABEL[phase]
  const text = label ?? (phaseOverride !== undefined ? phaseOverride : verb)

  return (
    <div
      className="relative w-full rounded-md overflow-hidden shimmer"
      style={{ aspectRatio: String(aspectRatio) }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs text-neutral-500 bg-white/70 px-2 py-0.5 rounded">{text}</span>
      </div>
    </div>
  )
}
