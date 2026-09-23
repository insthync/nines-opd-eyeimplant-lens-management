#!/usr/bin/env bash

set -Eeuo pipefail

data_directory="${PB_DATA_DIRECTORY:-}"
bootstrap_http="${PB_BOOTSTRAP_HTTP:-127.0.0.1:8091}"
skip_download=0
non_interactive=0

usage() {
  cat <<'EOF'
Usage: bash scripts/setup-pocketbase.sh [options]

Creates/updates the PocketBase superuser, applies migrations, and upserts one
staff account from the PB_* environment variables.

Options:
  --data-dir PATH       PocketBase data directory (default: pocketbase/pb_data)
  --bootstrap-http ADDR Temporary HOST:PORT used during setup (default: 127.0.0.1:8091)
  --skip-download       Do not run the download script when the binary exists
  --non-interactive     Fail instead of prompting for missing required values
  -h, --help            Show this help

Environment variables:
  PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD
  PB_STAFF_EMAIL, PB_STAFF_PASSWORD
  PB_STAFF_NAME (default: App Administrator)
  PB_STAFF_ROLE (viewer, editor, or admin; default: admin)
EOF
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

prompt_required() {
  local variable_name="$1"
  local prompt_text="$2"
  local secret="${3:-0}"
  local current_value="${!variable_name:-}"

  if [[ -n "$current_value" ]]; then
    return
  fi
  ((non_interactive == 0)) || die "$prompt_text is required in non-interactive mode."

  if ((secret == 1)); then
    read -r -s -p "$prompt_text: " current_value
    printf '\n' >&2
  else
    read -r -p "$prompt_text: " current_value
  fi
  [[ -n "$current_value" ]] || die "$prompt_text cannot be empty."
  printf -v "$variable_name" '%s' "$current_value"
}

run_checked() {
  local description="$1"
  shift
  local output
  local status

  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e
  [[ -z "$output" ]] || printf '%s\n' "$output"

  if ((status != 0)) || grep -q '^Error:' <<<"$output"; then
    die "$description failed."
  fi
}

http_request() {
  local method="$1"
  local url="$2"
  local output_file="$3"
  local payload="${4:-}"
  local token="${5:-}"
  local args=(-sS -o "$output_file" -w '%{http_code}' -X "$method")

  if [[ -n "$token" ]]; then
    args+=(-H "Authorization: $token")
  fi
  if [[ -n "$payload" ]]; then
    args+=(-H 'Content-Type: application/json' --data-binary "$payload")
  fi
  curl "${args[@]}" "$url"
}

show_api_error() {
  local action="$1"
  local response_file="$2"
  printf 'PocketBase response while trying to %s:\n' "$action" >&2
  sed -n '1,20p' "$response_file" >&2
  die "Unable to $action."
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\b'/\\b}"
  value="${value//$'\f'/\\f}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  if LC_ALL=C grep -q '[[:cntrl:]]' <<<"$value"; then
    die "A credential or staff field contains an unsupported control character."
  fi
  printf '%s' "$value"
}

cleanup() {
  if [[ -n "${bootstrap_pid:-}" ]] && kill -0 "$bootstrap_pid" 2>/dev/null; then
    kill "$bootstrap_pid" 2>/dev/null || true
    wait "$bootstrap_pid" 2>/dev/null || true
  fi
  [[ -z "${bootstrap_log:-}" || ! -f "$bootstrap_log" ]] || rm -f "$bootstrap_log"
  [[ -z "${response_file:-}" || ! -f "$response_file" ]] || rm -f "$response_file"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

while (($# > 0)); do
  case "$1" in
    --data-dir)
      (($# >= 2)) || die "--data-dir requires a value."
      data_directory="$2"
      shift 2
      ;;
    --bootstrap-http)
      (($# >= 2)) || die "--bootstrap-http requires a value."
      bootstrap_http="$2"
      shift 2
      ;;
    --skip-download)
      skip_download=1
      shift
      ;;
    --non-interactive)
      non_interactive=1
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

require_command curl
require_command grep
require_command sed

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

superuser_email="${PB_SUPERUSER_EMAIL:-}"
superuser_password="${PB_SUPERUSER_PASSWORD:-}"
staff_email="${PB_STAFF_EMAIL:-}"
staff_password="${PB_STAFF_PASSWORD:-}"
staff_name="${PB_STAFF_NAME:-App Administrator}"
staff_role="${PB_STAFF_ROLE:-admin}"

prompt_required superuser_email "PocketBase superuser email"
prompt_required superuser_password "PocketBase superuser password" 1
prompt_required staff_email "Initial staff email"
prompt_required staff_password "Initial staff password" 1

((${#superuser_password} >= 8)) || die "The superuser password must contain at least 8 characters."
((${#staff_password} >= 8)) || die "The staff password must contain at least 8 characters."
case "$staff_role" in
  viewer|editor|admin) ;;
  *) die "PB_STAFF_ROLE must be viewer, editor, or admin." ;;
esac

global_args=(
  "--dir=$data_directory"
  "--migrationsDir=$migration_dir"
  "--hooksDir=$hooks_dir"
)

printf 'Applying PocketBase migrations...\n'
run_checked "PocketBase migrations" "$binary_path" migrate up "${global_args[@]}"

printf 'Creating or updating the bootstrap superuser...\n'
run_checked "PocketBase superuser upsert" \
  "$binary_path" superuser upsert "$superuser_email" "$superuser_password" "${global_args[@]}"

[[ "$bootstrap_http" == *:* ]] || die "--bootstrap-http must use HOST:PORT format."
bootstrap_host="${bootstrap_http%:*}"
bootstrap_port="${bootstrap_http##*:}"
[[ "$bootstrap_host" != *:* && "$bootstrap_port" =~ ^[0-9]+$ ]] || \
  die "--bootstrap-http must use an IPv4-or-hostname HOST:PORT value."
health_host="$bootstrap_host"
case "$health_host" in
  0.0.0.0|'') health_host="127.0.0.1" ;;
esac
base_url="http://${health_host}:${bootstrap_port}"
health_url="$base_url/api/health"

if curl -fsS --max-time 1 "$health_url" >/dev/null 2>&1; then
  die "Bootstrap port $bootstrap_http is already serving PocketBase. Choose another --bootstrap-http value."
fi

bootstrap_log="$(mktemp "${TMPDIR:-/tmp}/pb-crud-app-starter-bootstrap.XXXXXX")"
response_file="$(mktemp "${TMPDIR:-/tmp}/pb-crud-app-starter-response.XXXXXX")"

"$binary_path" serve \
  "--http=$bootstrap_http" \
  "--dir=$data_directory" \
  "--migrationsDir=$migration_dir" \
  "--hooksDir=$hooks_dir" \
  "--publicDir=$repo_root/public" \
  >"$bootstrap_log" 2>&1 &
bootstrap_pid=$!

ready=0
for ((attempt = 1; attempt <= 60; attempt += 1)); do
  if ! kill -0 "$bootstrap_pid" 2>/dev/null; then
    sed -n '1,80p' "$bootstrap_log" >&2
    die "The temporary PocketBase bootstrap server exited before it became ready."
  fi
  if curl -fsS --max-time 1 "$health_url" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done
((ready == 1)) || die "The temporary PocketBase bootstrap server did not become ready."

auth_payload="$(printf '{"identity":"%s","password":"%s"}' \
  "$(json_escape "$superuser_email")" \
  "$(json_escape "$superuser_password")")"

if ! auth_status="$(http_request POST \
  "$base_url/api/collections/_superusers/auth-with-password" "$response_file" "$auth_payload")"; then
  show_api_error "authenticate the bootstrap superuser" "$response_file"
fi
[[ "$auth_status" == "200" ]] || show_api_error "authenticate the bootstrap superuser" "$response_file"
auth_token="$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' "$response_file")"
[[ -n "$auth_token" ]] || show_api_error "read the bootstrap authentication token" "$response_file"

filter_email="$(json_escape "$staff_email")"
if ! list_status="$(curl -sS -o "$response_file" -w '%{http_code}' -G \
  -H "Authorization: $auth_token" \
  --data-urlencode 'perPage=1' \
  --data-urlencode 'fields=id' \
  --data-urlencode "filter=email = \"$filter_email\"" \
  "$base_url/api/collections/users/records")"; then
  show_api_error "look up the staff account" "$response_file"
fi
[[ "$list_status" == "200" ]] || show_api_error "look up the staff account" "$response_file"
record_id="$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' "$response_file")"

staff_payload="$(printf '%s' \
  "{\"email\":\"$(json_escape "$staff_email")\"," \
  '"emailVisibility":true,"verified":true,' \
  "\"name\":\"$(json_escape "$staff_name")\"," \
  "\"role\":\"$(json_escape "$staff_role")\",\"active\":true," \
  "\"password\":\"$(json_escape "$staff_password")\"," \
  "\"passwordConfirm\":\"$(json_escape "$staff_password")\"}")"

if [[ -n "$record_id" ]]; then
  if ! staff_status="$(http_request PATCH \
    "$base_url/api/collections/users/records/$record_id" \
    "$response_file" "$staff_payload" "$auth_token")"; then
    show_api_error "update the staff account" "$response_file"
  fi
  [[ "$staff_status" == "200" ]] || show_api_error "update the staff account" "$response_file"
  printf 'Updated staff account %s with role %s.\n' "$staff_email" "$staff_role"
else
  if ! staff_status="$(http_request POST \
    "$base_url/api/collections/users/records" \
    "$response_file" "$staff_payload" "$auth_token")"; then
    show_api_error "create the staff account" "$response_file"
  fi
  [[ "$staff_status" == "200" ]] || show_api_error "create the staff account" "$response_file"
  printf 'Created staff account %s with role %s.\n' "$staff_email" "$staff_role"
fi

printf 'PocketBase setup is complete. Run bash scripts/start-pocketbase.sh to launch the application.\n'
