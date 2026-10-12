# Fixed packaged entrypoint. Requests and secrets are stdin only; never evaluate input.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# No module discovery from user profiles, working directory or inherited paths.
$PSModuleAutoloadingPreference = 'None'
$compileDir = $null
$scratchOwned = $false
$stage = 'START'
$failure = $null
$result = $null
function Set-GeltStage([string]$value) {
  $script:stage = $value
  # Closed vocabulary only. No exceptions, paths, request values or tool output.
  [Console]::Error.Write($value + "`n")
}
try {
  Set-GeltStage 'START'
  if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw 'version' }
  Set-GeltStage 'FRAME'
  Set-GeltStage 'FRAME_PATH'
  $reader = [IO.Path]::Combine($PSScriptRoot, 'read-frame.ps1')
  Set-GeltStage 'FRAME_PATH_DONE'
  Set-GeltStage 'FRAME_SOURCE'
  . $reader
  Set-GeltStage 'FRAME_SOURCE_DONE'
  $json = Read-GeltFrame -Trace
  Set-GeltStage 'MODULE'
  if ($PSHOME -cne 'C:\Windows\System32\WindowsPowerShell\v1.0') { throw 'installation' }
  Microsoft.PowerShell.Core\Import-Module -Name 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
  Set-GeltStage 'MODULE_DONE'
  Set-GeltStage 'FRAME_JSON'
  $r = $json | Microsoft.PowerShell.Utility\ConvertFrom-Json
  Set-GeltStage 'FRAME_SCHEMA'
  $names = [string[]]@($r.PSObject.Properties.Name)
  [Array]::Sort($names, [StringComparer]::Ordinal)
  if (($names -join ',') -cne 'data,max,op,path,version' -or $r.version -ne 1) { throw 'request' }
  if ($r.op -isnot [string] -or $r.path -isnot [string] -or $r.data -isnot [string] -or ($r.max -isnot [int] -and $r.max -isnot [long]) -or ($r.version -isnot [int] -and $r.version -isnot [long])) { throw 'types' }

  Set-GeltStage 'ROOT'
  # No inherited TEMP/TMP, home lookup or ACL repair. The owner must explicitly
  # choose a supported parent. Only a new random application scratch child is made.
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $trusted = @($sid.Value, 'S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  $temp = $env:GELT_WINDOWS_PRIVATE_PARENT
  if ([string]::IsNullOrEmpty($temp) -or $temp.Length -gt 120 -or $temp -cnotmatch '^C:\\' -or $temp.IndexOf(':', 2) -ge 0 -or $temp.Contains('/') -or $temp.Contains('\\') -or $temp.Contains('~') -or [IO.Path]::GetFullPath($temp) -cne $temp) { throw 'root' }
  if ($temp.Length -gt 3) {
    foreach ($part in $temp.Substring(3).Split('\')) {
      if ($part.Length -eq 0 -or $part.EndsWith('.') -or $part.EndsWith(' ') -or $part.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or $part -match '^(CON|PRN|AUX|NUL|COM[0-9]+|LPT[0-9]+)(\.|$)') { throw 'root' }
    }
  }
  $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($temp))
  if ($drive.DriveType -ne 'Fixed' -or $drive.DriveFormat -ne 'NTFS') { throw 'root' }
  # Validate root-to-leaf: once validated, untrusted principals cannot replace an
  # existing child/change this ancestor's identity or ACL. Same-user/admin excluded.
  $ancestors = @(); $ancestor = [IO.DirectoryInfo]$temp
  while ($null -ne $ancestor) { $ancestors = @($ancestor) + $ancestors; $ancestor = $ancestor.Parent }
  foreach ($ancestor in $ancestors) {
    if (-not $ancestor.Exists -or ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'root' }
    $acl = $ancestor.GetAccessControl()
    $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
    if ($null -eq $raw.DiscretionaryAcl -or $null -eq $raw.Owner -or $trusted -notcontains $raw.Owner.Value) { throw 'root' }
    foreach ($ace in $raw.DiscretionaryAcl) {
      if ($ace -isnot [System.Security.AccessControl.CommonAce] -or $ace.IsCallback -or $ace.AceQualifier -notin @('AccessAllowed', 'AccessDenied')) { throw 'root' }
      if ($ace.AceQualifier -eq 'AccessAllowed' -and (([int]$ace.AceFlags) -band 8) -eq 0 -and $trusted -notcontains $ace.SecurityIdentifier.Value -and ($ace.AccessMask -band 0x500D0150) -ne 0) { throw 'root' }
    }
  }
  $security = [System.Security.AccessControl.DirectorySecurity]::new()
  $security.SetOwner($sid); $security.SetAccessRuleProtection($true, $false)
  $security.AddAccessRule(([System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  $compileDir = [IO.Path]::Combine($temp, 'gelt-compile-' + [Guid]::NewGuid().ToString('N'))
  if ([IO.Directory]::Exists($compileDir)) { throw 'root' }
  $created = [IO.Directory]::CreateDirectory($compileDir, $security)
  if (($created.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $created.GetFileSystemInfos().Length -ne 0) { throw 'root' }
  $actual = $created.GetAccessControl()
  $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($actual.GetSecurityDescriptorBinaryForm(), 0)
  if ($raw.Owner.Value -ne $sid.Value -or -not $actual.AreAccessRulesProtected -or $null -eq $raw.DiscretionaryAcl -or $raw.DiscretionaryAcl.Count -ne 1) { throw 'root' }
  $ace = $raw.DiscretionaryAcl[0]
  if ($ace -isnot [System.Security.AccessControl.CommonAce] -or $ace.IsCallback -or $ace.AceQualifier -ne 'AccessAllowed' -or $ace.SecurityIdentifier.Value -ne $sid.Value -or $ace.AccessMask -ne 0x1f01ff -or [int]$ace.AceFlags -ne 3) { throw 'root' }
  $scratchOwned = $true
  $env:TEMP = $compileDir; $env:TMP = $compileDir
  Set-GeltStage 'COMPILE'
  Microsoft.PowerShell.Utility\Add-Type -Path ([IO.Path]::Combine($PSScriptRoot, 'PrivateStorage.cs')) -ReferencedAssemblies @('System.dll', 'System.Core.dll', 'System.Security.dll') -WarningAction Stop
  Set-GeltStage 'OPERATION'
  $result = [Gelt.PrivateStorage]::Run([string]$r.op, [string]$r.path, [string]$r.data, [int]$r.max)
  # Only the compiled enum representation may cross this seam, never an exception.
  if ($result.StartsWith('FAIL:')) {
    if ($result.Length -gt 80 -or $result -cnotmatch '\AFAIL:OPERATION:(REQUEST|PATH|OPEN|CREATE|METADATA|TYPE|REPARSE|LINKS|SIZE|CANONICAL|FILESYSTEM|SECURITY|OWNER|DACL|ACCESS|READ|WRITE|FLUSH|MOVE|DELETE|DPAPI|INTERNAL)(:(parent|main|wal|shm|journal))?\z') { throw 'protocol' }
    $failure = $result.Substring(5)
  }
} catch {
  $failure = $stage
} finally {
  try {
    Set-GeltStage 'CLEANUP'
    if ($scratchOwned -and [IO.Directory]::Exists($compileDir)) { [IO.Directory]::Delete($compileDir, $true) }
  } catch { $failure = 'CLEANUP' }
}
# Never report a successful persistence/session operation before scratch cleanup.
if ($null -ne $failure) { [Console]::Out.Write('FAIL:' + $failure); exit 1 }
Set-GeltStage 'DONE'
[Console]::Out.Write($result)
