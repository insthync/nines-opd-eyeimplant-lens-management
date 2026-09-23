#!/usr/bin/env bash

set -Eeuo pipefail

http_address="${PB_HTTP_ADDRESS:-127.0.0.1:8090}"
data_directory="${PB_DATA_DIRECTORY:-}"
skip_download=0
dev_mode=0

usage() {
  cat <<'EOF'
Usage: bash scripts/start-pocketbase.sh [options]

Options:
  --http ADDR        Listen address in HOST:PORT form (default: 127.0.0.1:8090)
  --data-dir PATH    PocketBase data directory (default: pocketbase/pb_data)
  --skip-download    Do not run the download script when the binary exists
  --dev              Enable PocketBase development mode
  -h, --help         Show this help
EOF
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

run_migrations() {
  local output
  local status

  set +e
  output="$("$binary_path" migrate up "${global_args[@]}" 2>&1)"
  status=$?
  set -e
  [[ -z "$output" ]] || printf '%s\n' "$output"

  if ((status != 0)) || grep -q '^Error:' <<<"$output"; then
    die "PocketBase migrations failed."
  fi
}

while (($# > 0)); do
  case "$1" in
    --http)
      (($# >= 2)) || die "--http requires a value."
      http_address="$2"
      shift 2
      ;;
    --data-dir)
      (($# >= 2)) || die "--data-dir requires a value."
      data_directory="$2"
      shift 2
      ;;
    --skip-download)
      skip_download=1
      shift
      ;;
    --dev)
      dev_mode=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$script_dir/.." && pwd -P)"
runtime_dir="$repo_root/pocketbase"
binary_path="$runtime_dir/pocketbase"
migration_dir="$runtime_dir/pb_migrations"
hooks_dir="$runtime_dir/pb_hooks"

if [[ -z "$data_directory" ]]; then
  data_directory="$runtime_dir/pb_data"
fi
mkdir -p "$data_directory"
data_directory="$(cd "$data_directory" && pwd -P)"

if ((skip_download == 0)) || [[ ! -x "$binary_path" ]]; then
  bash "$script_dir/download-pocketbase.sh"
fi
[[ -x "$binary_path" ]] || die "PocketBase binary not found or not executable at $binary_path"

global_args=(
  "--dir=$data_directory"
  "--migrationsDir=$migration_dir"
  "--hooksDir=$hooks_dir"
)

printf 'Applying database migrations...\n'
run_migrations

printf 'pb-crud-app-starter: http://%s/\n' "$http_address"
printf 'PocketBase dashboard: http://%s/_/\n' "$http_address"
printf 'Press Ctrl+C to stop.\n'

serve_args=(
  serve
  "--http=$http_address"
  "--dir=$data_directory"
  "--migrationsDir=$migration_dir"
  "--hooksDir=$hooks_dir"
  "--publicDir=$repo_root/public"
  "--indexFallback=false"
)
if ((dev_mode == 1)); then
  serve_args+=(--dev)
fi

exec "$binary_path" "${serve_args[@]}"
