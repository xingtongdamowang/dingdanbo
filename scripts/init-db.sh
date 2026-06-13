#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-"$ROOT_DIR/.env"}"
SEED=0
CREATE_DB=0

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/init-db.sh [--seed] [--create-db]

Options:
  --seed       Import sql/seed.sql after creating tables.
  --create-db Try to create DB_NAME before applying schema.

Environment:
  Reads .env in the project root by default.
  Override with ENV_FILE=/path/to/.env.
  Requires the mysql client on this machine.
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --seed) SEED=1 ;;
    --create-db) CREATE_DB=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  echo "Copy .env.example to .env and fill DB_USER / DB_PASSWORD / DB_NAME first." >&2
  exit 1
fi

get_env() {
  local key="$1"
  local line
  line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%$'\r'}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf '%s' "$line"
}

DB_HOST="${DB_HOST:-$(get_env DB_HOST)}"
DB_PORT="${DB_PORT:-$(get_env DB_PORT)}"
DB_USER="${DB_USER:-$(get_env DB_USER)}"
DB_PASSWORD="${DB_PASSWORD:-$(get_env DB_PASSWORD)}"
DB_NAME="${DB_NAME:-$(get_env DB_NAME)}"
MYSQL_BIN="${MYSQL_BIN:-mysql}"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"

if [[ -z "$DB_USER" || -z "$DB_NAME" ]]; then
  echo "DB_USER and DB_NAME are required. Check $ENV_FILE." >&2
  exit 1
fi

if [[ ! "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "DB_NAME may only contain letters, numbers, and underscores: $DB_NAME" >&2
  exit 1
fi

if ! command -v "$MYSQL_BIN" >/dev/null 2>&1; then
  echo "mysql client not found. Install it first, e.g. sudo apt install mysql-client." >&2
  exit 1
fi

MYSQL_ARGS=(
  --protocol=TCP
  --default-character-set=utf8mb4
  -h "$DB_HOST"
  -P "$DB_PORT"
  -u "$DB_USER"
)

export MYSQL_PWD="$DB_PASSWORD"

echo "Connecting to MySQL: $DB_HOST:$DB_PORT / $DB_NAME"
"$MYSQL_BIN" "${MYSQL_ARGS[@]}" -e "SELECT 1;" >/dev/null

if [[ "$CREATE_DB" -eq 1 ]]; then
  echo "Ensuring database exists: $DB_NAME"
  "$MYSQL_BIN" "${MYSQL_ARGS[@]}" \
    -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
fi

echo "Applying schema: sql/schema.sql"
"$MYSQL_BIN" "${MYSQL_ARGS[@]}" "$DB_NAME" < "$ROOT_DIR/sql/schema.sql"

if [[ "$SEED" -eq 1 ]]; then
  echo "Importing seed data: sql/seed.sql"
  "$MYSQL_BIN" "${MYSQL_ARGS[@]}" "$DB_NAME" < "$ROOT_DIR/sql/seed.sql"
fi

echo "Database initialization complete."
