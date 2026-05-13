# bcycle-map

Hosted live map of Santa Barbara BCycle stations, polling the GBFS feed every 120s.

See `docs/superpowers/specs/2026-05-13-bcycle-map-design.md` for the design.

## Develop

```bash
npm install
npm test
npm run dev:web      # frontend
npm run dev:worker   # workers (uses Miniflare)
```
