import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types'
import { pollOnce } from './poller'
import { fileIssueIfNoneOpen } from './lib/github'
import { getSystems, SystemConfig } from '../shared/systems'
import type { Env } from '../../worker-configuration'

type SmokeDeps = {
  fetchImpl?: typeof fetch
  fileIssue?: (args: {
    label: string
    title: string
    body: string
  }) => Promise<unknown>
}

export async function runSmoke(systems: SystemConfig[], deps: SmokeDeps): Promise<void> {
  const fileIssue = deps.fileIssue ?? (async () => {})
  for (const sys of systems) {
    try {
      await pollOnce(sys, { fetchImpl: deps.fetchImpl })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await fileIssue({
        label: 'smoke-failure',
        title: `Smoke check failed for ${sys.system_id}`,
        body: `Smoke poll failed.\n\nSystem: ${sys.system_id}\nURL: ${sys.gbfs_url}\nError: ${message}`,
      })
    }
  }
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
      console.warn('smoke: GITHUB_TOKEN/GITHUB_REPO not set, skipping issue filing')
    }
    await runSmoke(getSystems(), {
      fileIssue: async (args) => {
        if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return
        await fileIssueIfNoneOpen({
          token: env.GITHUB_TOKEN,
          repo: env.GITHUB_REPO,
          ...args,
        })
      },
    })
  },
}
