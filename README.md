# torrent_grain

`torrent_grain` is a long-running Node.js + TypeScript service that watches HagiCode release indexes, selects cache targets with a `recent versions + pinned` policy, downloads assets with torrent-first hybrid transfer, verifies `sha256`, persists a local catalog, exposes read-only status APIs, and now includes a React dashboard for local viewing.

## What it does

- Polls the default desktop and server indexes:
  - `https://index.hagicode.com/desktop/index.json`
  - `https://index.hagicode.com/server/index.json`
- Normalizes `versions[].assets[]` and only keeps torrent-capable assets with complete hybrid metadata:
  - `torrentUrl`
  - `infoHash`
  - `webSeeds`
  - `sha256`
  - `directUrl`
- Selects cache targets by `source + channel`, then keeps the most recent versions in each channel window
- Includes all torrent-capable assets inside the selected versions and preserves extra pinned versions
- Downloads through `webtorrent` first, then falls back to `webSeeds` or `directUrl`
- Verifies `sha256` before promoting files into cache
- Persists catalog state in `catalog.json` and restores verified cache on restart
- Applies cleanup rules by capacity, entry count, retention window, and pinned whitelist
- Exposes read-only JSON endpoints for health and cache visibility
- Ships a React dashboard that visualizes service mode, active transfers, targets, cache entries, and diagnostics

## Requirements

- Node.js 20+
- npm 10+

## Install and run

```bash
cd repos/torrent_grain
npm install
npm run build
npm run start
```

After `npm run start`, open:

- `http://127.0.0.1:32101/` - React dashboard
- `http://127.0.0.1:32101/health`
- `http://127.0.0.1:32101/status`
- `http://127.0.0.1:32101/targets`

For development:

```bash
cd repos/torrent_grain
npm run dev:server
npm run dev:ui
```

Or start both together:

```bash
cd repos/torrent_grain
npm run dev:all
```

Development URLs:

- `http://127.0.0.1:32101` - backend API
- `http://127.0.0.1:32102` - React dashboard via Vite proxy

## Peer validation demo

Use the built-in peer scripts when you want to verify that node 2 can fetch from node 1 with separate ports and cache directories.

Reset the demo cache first:

```bash
cd repos/torrent_grain
npm run dev:peer:reset
```

Start both peers with one command:

```bash
cd repos/torrent_grain
npm run dev:peer:demo
```

Or start them separately:

```bash
cd repos/torrent_grain
npm run dev:peer:1
npm run dev:peer:2
```

Demo layout:

- `peer1` - `http://127.0.0.1:32101`, data dir `./.data-peer-1`
- `peer2` - `http://127.0.0.1:32111`, data dir `./.data-peer-2`, with HTTP fallback disabled

`npm run dev:peer:demo` starts `peer1` first, waits until it becomes live, then tries to wait for the first verified cache entry before launching `peer2`. `peer2` is started with `TORRENT_GRAIN_HTTP_FALLBACK_ENABLED=false`, so if it cannot get data from the torrent swarm it will fail instead of silently downloading from the origin.

Recommended checks:

- open `http://127.0.0.1:32111/status` and confirm `peerCount` grows above `0`
- open `http://127.0.0.1:32101/status` and confirm `uploadRate` rises above `0`
- open `http://127.0.0.1:32101/targets` and `http://127.0.0.1:32111/targets` to compare cache states

If you want the built React dashboard on `/`, run `npm run build` once before the peer demo so the static UI is available from each peer port.

## Configuration

Configuration is environment-variable driven.

| Variable | Default | Description |
| --- | --- | --- |
| `TORRENT_GRAIN_HOST` | `0.0.0.0` | HTTP bind host |
| `TORRENT_GRAIN_PORT` | `32101` | HTTP bind port |
| `TORRENT_GRAIN_DATA_DIR` | `.data` under project root | Root directory for cache, temp files, quarantine, and catalog |
| `TORRENT_GRAIN_POLL_INTERVAL_MS` | `300000` | Source polling interval |
| `TORRENT_GRAIN_STALL_TIMEOUT_MS` | `45000` | Torrent stall timeout before fallback |
| `TORRENT_GRAIN_CONCURRENCY` | `2` | Maximum parallel cache jobs |
| `TORRENT_GRAIN_CACHE_CAPACITY` | `50 GiB` | Cache capacity limit, supports `b/kb/kib/mb/mib/gb/gib` suffixes |
| `TORRENT_GRAIN_MAX_ENTRIES` | `20` | Maximum retained cache entries |
| `TORRENT_GRAIN_RETENTION_DAYS` | `30` | Maximum retention window for non-pinned entries |
| `TORRENT_GRAIN_SHARING_ENABLED` | `true` | Whether verified cache should reseed |
| `TORRENT_GRAIN_HTTP_FALLBACK_ENABLED` | `true` | Whether `webSeeds` / `directUrl` fallback is allowed when torrent transfer stalls or fails |
| `TORRENT_GRAIN_UPLOAD_LIMIT_KIB` | `20480` | Upload cap for the embedded torrent runtime |
| `TORRENT_GRAIN_VERSION` | `0.1.0` | Service version string |
| `TORRENT_GRAIN_SOURCES` | built-in desktop + server list | JSON array of source objects |

### `TORRENT_GRAIN_SOURCES` format

```json
[
  {
    "id": "desktop",
    "kind": "desktop",
    "label": "HagiCode Desktop",
    "indexUrl": "https://index.hagicode.com/desktop/index.json",
    "enabled": true,
    "latestPerGroup": 2,
    "pinnedVersions": ["v1.0.0"]
  },
  {
    "id": "server",
    "kind": "server",
    "label": "HagiCode Server/Web",
    "indexUrl": "https://index.hagicode.com/server/index.json",
    "enabled": true,
    "latestPerGroup": 2,
    "pinnedVersions": []
  }
]
```

`latestPerGroup` means: keep the most recent N versions for each `source + channel`, and include all torrent-capable assets in those versions.

## Data layout

Inside `TORRENT_GRAIN_DATA_DIR` the service creates:

- `cache/` - verified cache files that may be reseeded
- `temp/` - transfer scratch space
- `quarantine/` - files that fail `sha256`
- `catalog.json` - persistent catalog and service state

## Status APIs

All endpoints are read-only `GET` requests.

### `GET /health`

Returns liveness, readiness, last successful scan time, enabled source count, and recent source failures.

### `GET /status`

Returns normalized service mode and active task snapshots:

- `idle`
- `discovering`
- `downloading`
- `fallback`
- `verifying`
- `shared`
- `error`

Each active task may include progress bytes, download rate, upload rate, peer count, and last error.

### `GET /targets`

Returns:

- current target plan
- local cache entries
- retention decision per target
- metadata validation state
- stable diagnostic codes

## React dashboard

The dashboard is implemented with React + Vite and lives under `ui/`.

- `npm run build` builds both the Node service and the dashboard
- `npm run start` serves the built dashboard from `/`
- `npm run dev:ui` runs Vite with API proxying for `/health`, `/status`, and `/targets`

The dashboard focuses on:

- service readiness and current mode
- active transfer throughput and peer count
- planner targets and metadata readiness
- cache catalog state
- recent diagnostics and source failures

## Docker

Build the image:

```bash
cd repos/torrent_grain
docker build -t torrent-grain .
```

Run it with a persistent volume:

```bash
docker run --rm \
  -p 32101:32101 \
  -e TORRENT_GRAIN_DATA_DIR=/data \
  -v $(pwd)/.data:/data \
  torrent-grain
```

The container startup path is automatic:

1. load config
2. recover `catalog.json`
3. restore verified cache entries
4. run an immediate scan
5. continue background monitoring
6. serve the built dashboard at `/`

## Known assumptions

- The current server/web cache target is discovered from `https://index.hagicode.com/server/index.json`.
- Hybrid cache eligibility depends on complete metadata in the index; incomplete assets are ignored entirely and do not appear in the dashboard.
- The fallback path currently refetches the whole asset from `webSeeds` or `directUrl` instead of resuming piece-level gaps.
- The service is designed for a single persistent instance with a mounted volume; shared multi-instance catalog coordination is out of scope.
