type FileIssueArgs = {
  token: string
  repo: string
  label: string
  title: string
  body: string
  fetchImpl?: typeof fetch
}

export async function fileIssueIfNoneOpen(args: FileIssueArgs): Promise<{ number: number } | null> {
  const fetchFn = args.fetchImpl ?? fetch
  const headers = {
    authorization: `Bearer ${args.token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'bcycle-map-smoke',
  }

  const q = encodeURIComponent(`repo:${args.repo} is:issue is:open label:${args.label}`)
  const search = await fetchFn(`https://api.github.com/search/issues?q=${q}`, { headers })
  if (!search.ok) throw new Error(`github search failed: ${search.status}`)
  const { items } = await search.json() as { items: unknown[] }
  if (items.length > 0) return null

  const create = await fetchFn(`https://api.github.com/repos/${args.repo}/issues`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ title: args.title, body: args.body, labels: [args.label] }),
  })
  if (!create.ok) throw new Error(`github create failed: ${create.status}`)
  return await create.json() as { number: number }
}
