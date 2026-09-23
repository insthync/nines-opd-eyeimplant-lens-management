[CmdletBinding()]
param(
    [string]$Version = "0.39.8",
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeDir = Join-Path $repoRoot "pocketbase"
$isWindowsHost = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
    [System.Runtime.InteropServices.OSPlatform]::Windows
)
$osName = if ($isWindowsHost) {
    "windows"
} elseif ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
    [System.Runtime.InteropServices.OSPlatform]::OSX
)) {
    "darwin"
} else {
    "linux"
}

$architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
$architecture = switch ($architecture) {
    "x64" { "amd64" }
    "arm64" { "arm64" }
    default { throw "Unsupported CPU architecture: $architecture" }
}

$binaryName = if ($isWindowsHost) { "pocketbase.exe" } else { "pocketbase" }
$binaryPath = Join-Path $runtimeDir $binaryName

if ((Test-Path -LiteralPath $binaryPath) -and -not $Force) {
    $installedVersion = (& $binaryPath --version 2>$null | Select-Object -First 1)
    if ($installedVersion -match [regex]::Escape($Version)) {
        Write-Host "PocketBase $Version is already installed at $binaryPath"
        return
    }
    throw "PocketBase is already installed with a different version. Re-run with -Force to replace only the binary."
}

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$archiveName = "pocketbase_${Version}_${osName}_${architecture}.zip"
$downloadUrl = "https://github.com/pocketbase/pocketbase/releases/download/v${Version}/${archiveName}"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "pb-crud-app-starter-pocketbase-$PID"
$archivePath = Join-Path $tempRoot $archiveName
$extractPath = Join-Path $tempRoot "extract"

New-Item -ItemType Directory -Force -Path $extractPath | Out-Null
try {
    Write-Host "Downloading PocketBase $Version for $osName/$architecture..."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force

    $downloadedBinary = Join-Path $extractPath $binaryName
    if (-not (Test-Path -LiteralPath $downloadedBinary)) {
        throw "The downloaded archive did not contain $binaryName."
    }

    Copy-Item -LiteralPath $downloadedBinary -Destination $binaryPath -Force
    if (-not $isWindowsHost) {
        & chmod +x $binaryPath
        if ($LASTEXITCODE -ne 0) { throw "Unable to mark PocketBase as executable." }
    }
} finally {
    $systemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $resolvedTempRoot = [System.IO.Path]::GetFullPath($tempRoot)
    if ($resolvedTempRoot.StartsWith($systemTemp, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedTempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "PocketBase $Version installed at $binaryPath"
