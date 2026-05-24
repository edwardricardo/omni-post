# Homelab migration — runbook

> **Nota de origen (2026-05-24):** el runbook original de la migración laptop→homelab **nunca se committeó**
> (vivía solo en la laptop) y se perdió para el repo. Este archivo lo **(re)inicia en el repo** — versionado, para
> que no se vuelva a perder — con lo **verificable hoy**. NO es una reconstrucción completa del runbook original; las
> secciones de topología se marcan "según notas de migración — verificar contra la infra actual".

## Entorno (según notas de migración — verificar contra la infra actual)

Dev corre en un homelab Proxmox (no en la laptop) desde ~2026-05-16. Dos LXC no privilegiados:

- **101 `omnipost-infra`** (~4 GB): Postgres 16 (UTF8) + Redis 7 (con auth) + MinIO + Prometheus/Grafana/Jaeger.
  Datos en SSD dedicado en `/var/lib/omnipost-data`.
- **102 `omnipost-dev`** (~9 GB): Node + pnpm + Claude Code; repo en `/root/omni-post`; `pnpm dev` en tmux `omnipost`.

Acceso vía **Tailscale MagicDNS** (`omnipost-infra` / `omnipost-dev` en el tailnet). El endpoint de DB en `.env` es el
nombre MagicDNS `omnipost-infra`. La CC shell + el dev API (`pnpm dev`, :3000) viven **dentro** de 102, así que
`curl http://localhost:3000` desde la shell de CC es canónico. DB/Redis/MinIO viven en 101.

Versiones verificadas en 102 (2026-05-24): **Node v24.15.0 · pnpm 10.16.0**.

Rollback: snapshots `pct` (101: `clean-base`/`infra-ready`; 102: `clean-base`/`dev-ready`). Tomar
`pct snapshot 102 antes-de-X` antes de sprints grandes de CC.

## Checklist de tooling post-migración

Cosas que NO viajan solas con el repo y hay que reinstalar en un LXC nuevo:

### graphify (knowledge-graph) — **faltó en esta migración**

graphify (CLI tree-sitter; ver CLAUDE.md §Knowledge Graph) **no se instaló** al migrar → todas sus reglas en
CLAUDE.md (leer `GRAPH_REPORT.md` antes de auditar, `graphify query/path/explain`) son no-op hasta instalarlo, y
`graphify-out/` está gitignored (regenerable, no viaja en el repo).

Instalar (el `python3` del LXC viene pelado, sin pip/pipx; **`uv` es lo más limpio** — trae su propio Python):

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh && source ~/.bashrc
uv tool install graphifyy          # PyPI = graphifyy (doble y); binario = graphify
graphify --version
# alternativa con pipx:  sudo apt install -y pipx && pipx ensurepath && pipx install graphifyy
```

Regenerar los 5 mapas (init la primera vez; luego el post-commit hook los mantiene):

```bash
for t in apps/api apps/workers apps/admin apps/client packages; do
  (cd "/root/omni-post/$t" && graphify update .)   # si "update" se queja por no existir: graphify .
done
```

### Otros (verificar presentes)

- Node + pnpm (ver versiones arriba) · Claude Code · tmux.

## Findings abiertos verificados (2026-05-24)

- **F-1 — ioredis `duplicate({ commandTimeout: 0 })` no desactiva el timeout** (ioredis 5.7.0) → los subscribers
  pub/sub degradan (realtime/webhook/notification). Sitios actuales: `apps/api/src/events/EventPublisher.ts:67`,
  `apps/api/src/services/AnalyticsStreamBroadcaster.ts:71`, `apps/api/src/webhooks/realtimeWebhookBroadcaster.ts:615`,
  `apps/api/src/services/NotificationBroadcaster.ts:58`. Fix: omitir la opción en vez de pasar `0`; requiere canon
  check de la semántica de ioredis + test que falle (TDD). Bug pre-existente del código, no causado por la migración.
- **Next 16 dev cross-origin** — los dev servers (client `:3200`, admin `:3100`) se acceden por el hostname Tailscale
  `omnipost-dev`, que Next 16 trata como cross-origin → bloquea HMR + Server Actions salvo `allowedDevOrigins`. Ya
  aplicado: `allowedDevOrigins: ["omnipost-dev"]` en `apps/{admin,client}/next.config.mjs` (verificado presente).
  Requiere reiniciar el dev server para tomar efecto.
