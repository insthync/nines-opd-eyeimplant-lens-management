[CmdletBinding()]
param(
    [string]$HttpAddress = "127.0.0.1:8090",
    [string]$DataDirectory,
    [switch]$Dev,
    [switch]$SkipDownload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeDir = Join-Path $repoRoot "pocketbase"
$binaryName = if ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
    [System.Runtime.InteropServices.OSPlatform]::Windows
)) { "pocketbase.exe" } else { "pocketbase" }
$binaryPath = Join-Path $runtimeDir $binaryName
$migrationDir = Join-Path $runtimeDir "pb_migrations"
$hooksDir = Join-Path $runtimeDir "pb_hooks"
if ([string]::IsNullOrWhiteSpace($DataDirectory)) {
    $DataDirectory = Join-Path $runtimeDir "pb_data"
}
$DataDirectory = [System.IO.Path]::GetFullPath($DataDirectory)

if (-not $SkipDownload -or -not (Test-Path -LiteralPath $binaryPath)) {
    & (Join-Path $PSScriptRoot "download-pocketbase.ps1")
}
if (-not (Test-Path -LiteralPath $binaryPath)) {
    throw "PocketBase binary not found at $binaryPath"
}

New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
$globalArguments = @(
    "--dir=$DataDirectory",
    "--migrationsDir=$migrationDir",
    "--hooksDir=$hooksDir"
)

Write-Host "Applying database migrations..."
$migrationOutput = @(& $binaryPath "migrate" "up" @globalArguments 2>&1)
$migrationOutput | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0 -or (($migrationOutput -join "`n") -match '(?m)^Error:')) {
    throw "PocketBase migrations failed."
}

Write-Host "pb-crud-app-starter: http://$HttpAddress/"
Write-Host "PocketBase dashboard: http://$HttpAddress/_/"
Write-Host "Press Ctrl+C to stop."

$serveArguments = @(
    "serve",
    "--http=$HttpAddress",
    "--dir=$DataDirectory",
    "--migrationsDir=$migrationDir",
    "--hooksDir=$hooksDir",
    "--publicDir=$repoRoot/public",
    "--indexFallback=false"
)
if ($Dev) { $serveArguments += "--dev" }

& $binaryPath @serveArguments
exit $LASTEXITCODE
