#!/usr/bin/env bash

set -Eeuo pipefail

version="${PB_VERSION:-0.39.8}"
force=0

usage() {
  cat <<'EOF'
Usage: bash scripts/download-pocketbase.sh [options]

Options:
  --version VERSION  PocketBase version to install (default: 0.39.8)
  --force            Replace an existing PocketBase binary
  -h, --help         Show this help
EOF
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

while (($# > 0)); do
  case "$1" in
    --version)
      (($# >= 2)) || die "--version requires a value."
      version="$2"
      shift 2
      ;;
    --force)
      force=1
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

require_command uname
require_command mktemp
require_command unzip
require_command chmod

case "$(uname -s)" in
  Linux) os_name="linux" ;;
  Darwin) os_name="darwin" ;;
  *) die "Unsupported operating system: $(uname -s)" ;;
esac

case "$(uname -m)" in
  x86_64|amd64) architecture="amd64" ;;
  arm64|aarch64) architecture="arm64" ;;
  *) die "Unsupported CPU architecture: $(uname -m)" ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$script_dir/.." && pwd -P)"
runtime_dir="$repo_root/pocketbase"
binary_path="$runtime_dir/pocketbase"

if [[ -x "$binary_path" && $force -eq 0 ]]; then
  installed_version="$("$binary_path" --version 2>/dev/null | head -n 1 || true)"
  if [[ "$installed_version" == *"$version"* ]]; then
    printf 'PocketBase %s is already installed at %s\n' "$version" "$binary_path"
    exit 0
  fi
  die "PocketBase is already installed with a different version. Re-run with --force to replace only the binary."
fi

mkdir -p "$runtime_dir"

archive_name="pocketbase_${version}_${os_name}_${architecture}.zip"
download_url="https://github.com/pocketbase/pocketbase/releases/download/v${version}/${archive_name}"
temp_base="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
temp_dir="$(mktemp -d "$temp_base/pb-crud-app-starter-pocketbase.XXXXXX")"
archive_path="$temp_dir/$archive_name"
extract_dir="$temp_dir/extract"

cleanup() {
  if [[ -n "${temp_dir:-}" && -d "$temp_dir" ]]; then
    case "$temp_dir" in
      "$temp_base"/pb-crud-app-starter-pocketbase.*) rm -rf "$temp_dir" ;;
      *) printf 'Refusing to remove unexpected temporary path: %s\n' "$temp_dir" >&2 ;;
    esac
  fi
}
trap cleanup EXIT

mkdir -p "$extract_dir"
printf 'Downloading PocketBase %s for %s/%s...\n' "$version" "$os_name" "$architecture"

if command -v curl >/dev/null 2>&1; then
  curl --fail --location --retry 3 --connect-timeout 15 \
    --output "$archive_path" "$download_url"
elif command -v wget >/dev/null 2>&1; then
  wget --tries=3 --timeout=15 --output-document="$archive_path" "$download_url"
else
  die "Either curl or wget is required to download PocketBase."
fi

unzip -q "$archive_path" -d "$extract_dir"
[[ -f "$extract_dir/pocketbase" ]] || die "The downloaded archive did not contain the PocketBase binary."

cp "$extract_dir/pocketbase" "$binary_path"
chmod 0755 "$binary_path"

printf 'PocketBase %s installed at %s\n' "$version" "$binary_path"
