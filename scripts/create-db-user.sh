#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${DB_NAME:-qiudanbu}"
APP_DB_USER="${APP_DB_USER:-qiudanbu}"
APP_DB_HOST="${APP_DB_HOST:-localhost}"
ADMIN_DB_HOST="${ADMIN_DB_HOST:-127.0.0.1}"
ADMIN_DB_PORT="${ADMIN_DB_PORT:-3306}"
ADMIN_DB_USER="${ADMIN_DB_USER:-root}"
MYSQL_BIN="${MYSQL_BIN:-mysql}"
USE_SUDO="${USE_SUDO:-0}"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/create-db-user.sh

Environment options:
  DB_NAME=qiudanbu             Database name to create
  APP_DB_USER=qiudanbu         App MySQL user to create
  APP_DB_HOST=localhost        MySQL host part for the app user
  ADMIN_DB_HOST=127.0.0.1      Admin connection host
  ADMIN_DB_PORT=3306           Admin connection port
  ADMIN_DB_USER=root           Admin MySQL user
  ADMIN_DB_PASSWORD=...        Admin MySQL password
  APP_DB_PASSWORD=...          App user password
  USE_SUDO=1                   Use sudo mysql, useful on Ubuntu local MySQL root socket auth

Examples:
  bash scripts/create-db-user.sh
  USE_SUDO=1 bash scripts/create-db-user.sh
  APP_DB_HOST=% bash scripts/create-db-user.sh
USAGE
}

for arg in "$@"; do
  case "$arg" in
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

if [[ ! "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "DB_NAME may only contain letters, numbers, and underscores: $DB_NAME" >&2
  exit 1
fi

if [[ ! "$APP_DB_USER" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "APP_DB_USER may only contain letters, numbers, and underscores: $APP_DB_USER" >&2
  exit 1
fi

if ! command -v "$MYSQL_BIN" >/dev/null 2>&1; then
  echo "mysql client not found. Install it first, e.g. sudo apt install mysql-client." >&2
  exit 1
fi

if [[ -z "${APP_DB_PASSWORD:-}" ]]; then
  read -rsp "App DB password for ${APP_DB_USER}: " APP_DB_PASSWORD
  echo
fi

if [[ "$USE_SUDO" != "1" && -z "${ADMIN_DB_PASSWORD:-}" ]]; then
  read -rsp "Admin MySQL password for ${ADMIN_DB_USER}: " ADMIN_DB_PASSWORD
  echo
fi

escape_sql_string() {
  printf "%s" "$1" | sed "s/'/''/g"
}

APP_DB_PASSWORD_SQL="$(escape_sql_string "$APP_DB_PASSWORD")"
APP_DB_HOST_SQL="$(escape_sql_string "$APP_DB_HOST")"
APP_DB_USER_SQL="$(escape_sql_string "$APP_DB_USER")"

SQL="
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${APP_DB_USER_SQL}'@'${APP_DB_HOST_SQL}' IDENTIFIED BY '${APP_DB_PASSWORD_SQL}';
ALTER USER '${APP_DB_USER_SQL}'@'${APP_DB_HOST_SQL}' IDENTIFIED BY '${APP_DB_PASSWORD_SQL}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON \`${DB_NAME}\`.* TO '${APP_DB_USER_SQL}'@'${APP_DB_HOST_SQL}';
FLUSH PRIVILEGES;
"

if [[ "$USE_SUDO" == "1" ]]; then
  echo "$SQL" | sudo "$MYSQL_BIN" --default-character-set=utf8mb4
else
  export MYSQL_PWD="$ADMIN_DB_PASSWORD"
  echo "$SQL" | "$MYSQL_BIN" \
    --protocol=TCP \
    --default-character-set=utf8mb4 \
    -h "$ADMIN_DB_HOST" \
    -P "$ADMIN_DB_PORT" \
    -u "$ADMIN_DB_USER"
fi

cat <<EOF
Database and user are ready.

Put these values in .env:
DB_HOST=$ADMIN_DB_HOST
DB_PORT=$ADMIN_DB_PORT
DB_USER=$APP_DB_USER
DB_PASSWORD=$APP_DB_PASSWORD
DB_NAME=$DB_NAME

If the app runs on the same server as MySQL, use DB_HOST=127.0.0.1 in .env.
EOF
