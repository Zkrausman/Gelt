# Fixed synthetic prerequisites only. No script, path, environment or secret input.
param([ValidateSet('path', 'source', 'stdin', 'array', 'join-path', 'new-object', 'json', 'add-type', 'enum-mask')][string]$Probe)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Mark([string]$value) { [Console]::Error.Write($value + "`n") }
try {
  Mark 'START'
  if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or $PSHOME -cne 'C:\Windows\System32\WindowsPowerShell\v1.0') { throw 'installation' }
  # Only these two independent legacy probes deliberately measure autoload.
  # The production helper disables it and imports a fixed system manifest.
  if ($Probe -notin @('join-path', 'new-object')) { $PSModuleAutoloadingPreference = 'None' }
  if ($Probe -in @('json', 'add-type')) {
    Mark 'MODULE'
    Microsoft.PowerShell.Core\Import-Module -Name 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
    Mark 'MODULE_DONE'
  }
  Mark 'BEFORE'
  switch ($Probe) {
    'path' { $value = [IO.Path]::Combine($PSScriptRoot, 'read-frame.ps1'); if ([string]::IsNullOrEmpty($value)) { throw 'path' } }
    'source' { . ([IO.Path]::Combine($PSScriptRoot, 'read-frame.ps1')) }
    'stdin' { $stream = [Console]::OpenStandardInput(); if (-not $stream.CanRead) { throw 'stdin' }; $stream.Dispose() }
    'array' { $value = [byte[]]::new(4); if ($value.Length -ne 4) { throw 'array' } }
    'enum-mask' {
      # PowerShell5.1 cannot reliably apply numeric masks to an enum operand.
      # Exercise real CommonAce flags, including both inheritance-only and flags
      # which apply to this directory. The production security masks stay exact.
      $sid = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')
      foreach ($flags in @(0, 1, 2, 3, 8, 9, 10, 11, 16, 19, 24, 27)) {
        $ace = [System.Security.AccessControl.CommonAce]::new([System.Security.AccessControl.AceFlags]$flags, [System.Security.AccessControl.AceQualifier]::AccessAllowed, 0x1f01ff, $sid, $false, $null)
        if ((([int]$ace.AceFlags) -band 8) -ne ($flags -band 8)) { throw 'enum' }
        if (($ace.AccessMask -band 0x500D0150) -eq 0) { throw 'mask' }
      }
      $container = [System.Security.AccessControl.AceFlags]::ContainerInherit
      $only = [System.Security.AccessControl.AceFlags]::InheritOnly
      if ((([int]$container) -band 8) -ne 0 -or (([int]$only) -band 8) -ne 8) { throw 'enum' }
      # Other shipped masks pair like-typed FileAttributes, or integer rights.
      if (([IO.FileAttributes]::Directory -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ([IO.FileAttributes]::ReparsePoint -band [IO.FileAttributes]::ReparsePoint) -eq 0) { throw 'attributes' }
      if ((0x120089 -band 0x500D0150) -ne 0) { throw 'read' }
    }
    'join-path' { $value = Join-Path $PSScriptRoot 'read-frame.ps1'; if ([string]::IsNullOrEmpty($value)) { throw 'path' } }
    'new-object' { $value = New-Object byte[] 4; if ($value.Length -ne 4) { throw 'array' } }
    'json' { $value = '{"version":1}' | Microsoft.PowerShell.Utility\ConvertFrom-Json; if ($value.version -ne 1) { throw 'json' } }
    'add-type' {
      # Resolve only: actual compilation MUST wait for validated private scratch
      # in private-storage.ps1. Never compile into an ambient temp directory.
      $value = $ExecutionContext.InvokeCommand.GetCommand('Microsoft.PowerShell.Utility\Add-Type', [System.Management.Automation.CommandTypes]::Cmdlet)
      if ($null -eq $value -or $value.ImplementingType.FullName -cne 'Microsoft.PowerShell.Commands.AddTypeCommand') { throw 'cmdlet' }
    }
    default { throw 'probe' }
  }
  Mark 'AFTER'
  Mark 'DONE'
  [Console]::Out.Write('OK')
} catch { [Console]::Out.Write('FAIL'); exit 1 }
