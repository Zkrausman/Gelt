<#
.SYNOPSIS
    Gelt Shadow Engine - Remote Telemetry Extraction Tool (PowerShell)
.DESCRIPTION
    Pulls persistent trade journals, AI thesis logs, and executive reports from the remote GCP VM to the local machine.
.PARAMETER RemoteUser
    The SSH user on the remote host (default: gelt)
.PARAMETER RemoteHost
    The IP address or hostname of the remote GCP VM
.PARAMETER IdentityFile
    Path to the SSH private key (optional)
#>
param(
    [string]$RemoteUser = "gelt",
    [Parameter(Mandatory=$true)]
    [string]$RemoteHost,
    [string]$IdentityFile = ""
)

$ErrorActionPreference = "Stop"

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$LocalBackupDir = Join-Path -Path ".\cloud-telemetry-backup" -ChildPath $Timestamp

Write-Host "Creating local backup directory: $LocalBackupDir"
New-Item -ItemType Directory -Force -Path $LocalBackupDir | Out-Null

$SshOpts = @()
if ($IdentityFile -ne "") {
    $SshOpts += "-i", $IdentityFile
}

Write-Host "Syncing shadow trade journal from $RemoteHost..."
try {
    scp $SshOpts "$RemoteUser@$RemoteHost`:~/.gelt/journals/shadow_journal.json" $LocalBackupDir
} catch {
    Write-Warning "shadow_journal.json not found or could not be copied."
}

Write-Host "Syncing AI thesis logs from $RemoteHost..."
try {
    scp $SshOpts "$RemoteUser@$RemoteHost`:~/.gelt/journals/ai_theses.json" $LocalBackupDir
} catch {
    Write-Warning "ai_theses.json not found or could not be copied."
}

Write-Host "Syncing daemon status logs from $RemoteHost..."
try {
    scp $SshOpts "$RemoteUser@$RemoteHost`:~/.gelt/daemon/status.json" $LocalBackupDir
} catch {
    Write-Warning "daemon/status.json not found or could not be copied."
}

Write-Host "Syncing shadow telemetry logs from $RemoteHost..."
try {
    scp $SshOpts "$RemoteUser@$RemoteHost`:~/.gelt/telemetry/shadow_telemetry.json" $LocalBackupDir
} catch {
    Write-Warning "telemetry/shadow_telemetry.json not found or could not be copied."
}

Write-Host "Syncing executive reports from $RemoteHost..."
try {
    scp $SshOpts "$RemoteUser@$RemoteHost`:~/.gelt/*.md" $LocalBackupDir
} catch {
    Write-Host "No markdown reports found."
}

Write-Host "Telemetry extraction complete. Files saved to: $LocalBackupDir"
Get-ChildItem -Path $LocalBackupDir
