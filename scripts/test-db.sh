#!/usr/bin/env bash
# Executa as migrações e os testes SQL em um PostgreSQL local temporário.
# Requer os binários do PostgreSQL (15+) instalados (initdb, pg_ctl, psql).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/initdb" ] || PGBIN="$(dirname "$(command -v initdb)")"
DATA="$ROOT/.tmp-pg/data"; SOCK="$ROOT/.tmp-pg"
rm -rf "$ROOT/.tmp-pg"; mkdir -p "$SOCK"
# O PostgreSQL não roda como root: nesse caso usa o usuário "postgres".
AS=()
if [ "$(id -u)" = "0" ]; then chown postgres "$SOCK"; AS=(runuser -u postgres --); fi
"${AS[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
"${AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-k $SOCK -c listen_addresses=''" -l "$SOCK/log" -w start >/dev/null
trap '"${AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null; rm -rf "$ROOT/.tmp-pg"' EXIT
PSQL=(psql -h "$SOCK" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$ROOT/tests/db/00_bootstrap_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ migração $(basename "$f")"; "${PSQL[@]}" -f "$f"
done
fail=0
for f in "$ROOT"/tests/db/[1-9]*.sql; do
  if "${PSQL[@]}" -f "$f"; then echo "✓ $(basename "$f")"; else echo "✗ $(basename "$f")"; fail=1; fi
done
exit $fail
