[CmdletBinding()]
param(
    [string]$SuperuserEmail = $env:PB_SUPERUSER_EMAIL,
    [string]$SuperuserPassword = $env:PB_SUPERUSER_PASSWORD,
    [string]$StaffEmail = $env:PB_STAFF_EMAIL,
    [string]$StaffPassword = $env:PB_STAFF_PASSWORD,
    [string]$StaffName = $(if ($env:PB_STAFF_NAME) { $env:PB_STAFF_NAME } else { "App Administrator" }),
    [ValidateSet("viewer", "editor", "admin")]
    [string]$StaffRole = $(if ($env:PB_STAFF_ROLE) { $env:PB_STAFF_ROLE } else { "admin" }),
    [string]$DataDirectory,
    [string]$BootstrapHttpAddress = "127.0.0.1:8091",
    [switch]$SkipDownload,
    [switch]$NonInteractive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Read-RequiredValue {
    param([string]$Value, [string]$Prompt, [switch]$Secret)
    if (-not [string]::IsNullOrWhiteSpace($Value)) { return $Value }
    if ($NonInteractive) { throw "$Prompt is required in non-interactive mode." }
    if (-not $Secret) { return (Read-Host $Prompt) }

    $secureValue = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Quote-ProcessArgument {
    param([string]$Value)
    if ($Value -notmatch '[\s"]') { return $Value }
    return '"' + $Value.Replace('"', '\"') + '"'
}

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

$SuperuserEmail = Read-RequiredValue $SuperuserEmail "PocketBase superuser email"
$SuperuserPassword = Read-RequiredValue $SuperuserPassword "PocketBase superuser password" -Secret
$StaffEmail = Read-RequiredValue $StaffEmail "Initial staff email"
$StaffPassword = Read-RequiredValue $StaffPassword "Initial staff password" -Secret

if ($SuperuserPassword.Length -lt 8) { throw "The superuser password must contain at least 8 characters." }
if ($StaffPassword.Length -lt 8) { throw "The staff password must contain at least 8 characters." }

New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
$globalArguments = @(
    "--dir=$DataDirectory",
    "--migrationsDir=$migrationDir",
    "--hooksDir=$hooksDir"
)

Write-Host "Applying PocketBase migrations..."
$migrationOutput = @(& $binaryPath "migrate" "up" @globalArguments 2>&1)
$migrationOutput | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0 -or (($migrationOutput -join "`n") -match '(?m)^Error:')) {
    throw "PocketBase migrations failed."
}

Write-Host "Creating or updating the bootstrap superuser..."
$superuserOutput = @(& $binaryPath "superuser" "upsert" $SuperuserEmail $SuperuserPassword @globalArguments 2>&1)
$superuserOutput | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0 -or (($superuserOutput -join "`n") -match '(?m)^Error:')) {
    throw "Unable to create or update the PocketBase superuser."
}

$healthUrl = "http://$BootstrapHttpAddress/api/health"
try {
    Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1 | Out-Null
    throw "Bootstrap port $BootstrapHttpAddress is already in use. Choose another -BootstrapHttpAddress."
} catch {
    if ($_.Exception.Message -like "Bootstrap port*") { throw }
}

$serverArguments = @(
    "serve",
    "--http=$BootstrapHttpAddress",
    "--dir=$DataDirectory",
    "--migrationsDir=$migrationDir",
    "--hooksDir=$hooksDir",
    "--publicDir=$repoRoot/public"
)
$processInfo = [System.Diagnostics.ProcessStartInfo]::new()
$processInfo.FileName = $binaryPath
$processInfo.WorkingDirectory = $repoRoot
$processInfo.Arguments = (($serverArguments | ForEach-Object { Quote-ProcessArgument $_ }) -join " ")
$processInfo.UseShellExecute = $false
$processInfo.CreateNoWindow = $true
$processInfo.RedirectStandardOutput = $true
$processInfo.RedirectStandardError = $true
$bootstrapProcess = [System.Diagnostics.Process]::Start($processInfo)

try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
        if ($bootstrapProcess.HasExited) { break }
        try {
            Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1 | Out-Null
            $ready = $true
            break
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $ready) {
        throw "The temporary PocketBase bootstrap server did not become ready."
    }

    $baseUrl = "http://$BootstrapHttpAddress"
    $authPayload = @{ identity = $SuperuserEmail; password = $SuperuserPassword } | ConvertTo-Json
    $authRequest = @{
        Uri = "$baseUrl/api/collections/_superusers/auth-with-password"
        Method = "Post"
        ContentType = "application/json"
        Body = $authPayload
    }
    $auth = Invoke-RestMethod @authRequest
    $headers = @{ Authorization = $auth.token }

    $escapedEmail = $StaffEmail.Replace("'", "\\'")
    $encodedFilter = [Uri]::EscapeDataString("email = '$escapedEmail'")
    $existingRequest = @{
        Uri = "$baseUrl/api/collections/users/records?perPage=1&filter=$encodedFilter"
        Headers = $headers
        Method = "Get"
    }
    $existing = Invoke-RestMethod @existingRequest

    $staffPayload = @{
        email = $StaffEmail
        emailVisibility = $true
        verified = $true
        name = $StaffName
        role = $StaffRole
        active = $true
        password = $StaffPassword
        passwordConfirm = $StaffPassword
    } | ConvertTo-Json

    if ($existing.items.Count -gt 0) {
        $recordId = $existing.items[0].id
        $updateRequest = @{
            Uri = "$baseUrl/api/collections/users/records/$recordId"
            Headers = $headers
            Method = "Patch"
            ContentType = "application/json"
            Body = $staffPayload
        }
        Invoke-RestMethod @updateRequest | Out-Null
        Write-Host "Updated staff account $StaffEmail with role $StaffRole."
    } else {
        $createRequest = @{
            Uri = "$baseUrl/api/collections/users/records"
            Headers = $headers
            Method = "Post"
            ContentType = "application/json"
            Body = $staffPayload
        }
        Invoke-RestMethod @createRequest | Out-Null
        Write-Host "Created staff account $StaffEmail with role $StaffRole."
    }
} finally {
    if ($bootstrapProcess -and -not $bootstrapProcess.HasExited) {
        $bootstrapProcess.Kill()
        $bootstrapProcess.WaitForExit()
    }
    if ($bootstrapProcess) { $bootstrapProcess.Dispose() }
}

Write-Host "PocketBase setup is complete. Run scripts/start-pocketbase.ps1 to launch the application."
