# Native semantic/negative fixtures ONLY. Called on newly created private test paths.
$ErrorActionPreference = 'Stop'
$PSModuleAutoloadingPreference = 'None'
try {
  . ([IO.Path]::Combine($PSScriptRoot, 'read-frame.ps1'))
  foreach ($module in @('Utility', 'Security', 'Management')) {
    Microsoft.PowerShell.Core\Import-Module -Name ('C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.' + $module + '\Microsoft.PowerShell.' + $module + '.psd1') -ErrorAction Stop
  }
  $r = (Read-GeltFrame) | Microsoft.PowerShell.Utility\ConvertFrom-Json
  if ($r.path -notmatch '\\gelt-native-[a-f0-9]{32}(\\|$)') { throw 'test root required' }
  switch ($r.op) {
    'owner-policy' {
      # Give Add-Type an operation-owned private child. Compiler scratch must not
      # be placed directly in the fixture root or repaired/suppressed on cleanup.
      $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
      $security = [Security.AccessControl.DirectorySecurity]::new()
      $security.SetOwner($sid); $security.SetAccessRuleProtection($true, $false)
      $security.AddAccessRule(([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
      $scratch = [IO.Path]::Combine($r.path, 'gelt-owner-policy-' + [Guid]::NewGuid().ToString('N'))
      $scratchOwned = $false
      try {
        if ([IO.Directory]::Exists($scratch)) { throw 'scratch exists' }
        $created = [IO.Directory]::CreateDirectory($scratch, $security)
        $scratchOwned = $true
        if (($created.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $created.GetFileSystemInfos().Length -ne 0) { throw 'scratch create' }
        $actualSecurity = $created.GetAccessControl()
        $raw = [Security.AccessControl.RawSecurityDescriptor]::new($actualSecurity.GetSecurityDescriptorBinaryForm(), 0)
        if ($raw.Owner.Value -ne $sid.Value -or -not $actualSecurity.AreAccessRulesProtected -or $null -eq $raw.DiscretionaryAcl -or $raw.DiscretionaryAcl.Count -ne 1) { throw 'scratch security' }
        $ace = $raw.DiscretionaryAcl[0]
        if ($ace -isnot [Security.AccessControl.CommonAce] -or $ace.IsCallback -or $ace.AceQualifier -ne 'AccessAllowed' -or $ace.SecurityIdentifier.Value -ne $sid.Value -or $ace.AccessMask -ne 0x1f01ff -or [int]$ace.AceFlags -ne 3) { throw 'scratch access' }
        $env:TEMP = $scratch; $env:TMP = $scratch
        Microsoft.PowerShell.Utility\Add-Type -Path ([IO.Path]::Combine($PSScriptRoot, 'PrivateStorage.cs')) -ReferencedAssemblies @('System.dll', 'System.Core.dll', 'System.Security.dll') -WarningAction Stop
        $flags = [Reflection.BindingFlags]'Static,NonPublic'
        $type = [Gelt.PrivateStorage]
        $method = $type.GetMethod('PrivateOwner', $flags)
        $kindType = $type.GetNestedType('ObjectKind', [Reflection.BindingFlags]::NonPublic)
        $user = $sid.Value
        $trusted = @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
        $owners = @($user) + $trusted + @('S-1-1-0', 'S-1-5-21-1-2-3-1001', 'S-1-5-19', 'S-1-5-20', '', $null)
        foreach ($owner in $owners) {
          foreach ($sqlite in @($false, $true)) {
            foreach ($name in @('none', 'parent', 'main', 'wal', 'shm', 'journal', '-1', '6', '2147483647')) {
              $kind = [Enum]::Parse($kindType, $name)
              $valid = $name -in @('none', 'parent', 'main', 'wal', 'shm', 'journal')
              $expected = $valid -and ($owner -ceq $user -or ($sqlite -and $name -in @('wal', 'shm', 'journal') -and $trusted -ccontains $owner))
              $actual = $method.Invoke($null, [object[]]@($owner, $sqlite, $kind))
              if ($actual -ne $expected) { throw 'policy' }
            }
          }
        }
        $classifier = $type.GetMethod('SQLiteFileKind', $flags)
        foreach ($case in @($r.cases)) {
          if ($case.path -isnot [string] -or $case.expected -notin @('main', 'wal', 'shm', 'journal', 'reject')) { throw 'classification case' }
          try { $actual = $classifier.Invoke($null, [object[]]@($case.path)).ToString() }
          catch { $actual = 'reject' }
          if ($actual -cne $case.expected) { throw 'classification' }
        }
      } finally {
        $env:TEMP = $null; $env:TMP = $null
        if ($scratchOwned -and [IO.Directory]::Exists($scratch)) { [IO.Directory]::Delete($scratch, $true) }
        if ([IO.Directory]::Exists($scratch)) { throw 'scratch cleanup' }
      }
    }
    'try-owner' {
      # Some tokens cannot assign owners; deterministic production-predicate cases
      # above are mandatory regardless. No ACL repair, only disposable test files.
      if ($r.target -notin @('trusted', 'untrusted')) { throw 'owner case' }
      $owner = if ($r.target -eq 'trusted') { 'S-1-5-32-544' } else { 'S-1-5-21-1-2-3-1001' }
      $acl = Microsoft.PowerShell.Security\Get-Acl -LiteralPath $r.path
      $before = [Convert]::ToBase64String($acl.GetSecurityDescriptorBinaryForm())
      $acl.SetOwner([Security.Principal.SecurityIdentifier]$owner)
      try { Microsoft.PowerShell.Security\Set-Acl -LiteralPath $r.path -AclObject $acl }
      catch {
        # The OS may refuse assignment (including ERROR_INVALID_OWNER wrapped by
        # .NET). Do not parse/localize exception messages. Only unchanged metadata
        # can make this optional mutation unavailable; partial changes fail closed.
        $after = Microsoft.PowerShell.Security\Get-Acl -LiteralPath $r.path
        if ([Convert]::ToBase64String($after.GetSecurityDescriptorBinaryForm()) -cne $before) { throw 'partial owner mutation' }
        [Console]::Out.Write('UNAVAILABLE'); exit 0
      }
      $actual = (Microsoft.PowerShell.Security\Get-Acl -LiteralPath $r.path).GetOwner([Security.Principal.SecurityIdentifier]).Value
      if ($actual -cne $owner) { throw 'owner not applied' }
    }
    'public' {
      $acl = Microsoft.PowerShell.Security\Get-Acl -LiteralPath $r.path
      $rule = [System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]'S-1-1-0', 'FullControl', 'Allow')
      $acl.AddAccessRule($rule)
      Microsoft.PowerShell.Security\Set-Acl -LiteralPath $r.path -AclObject $acl
    }
    'children' {
      $acl = Microsoft.PowerShell.Security\Get-Acl -LiteralPath $r.path
      $rule = [System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]'S-1-1-0', 'FullControl', 'ContainerInherit,ObjectInherit', 'InheritOnly', 'Allow')
      $acl.AddAccessRule($rule); Microsoft.PowerShell.Security\Set-Acl -LiteralPath $r.path -AclObject $acl
    }
    'inherit' { $acl = Microsoft.PowerShell.Security\Get-Acl -LiteralPath $r.path; $acl.SetAccessRuleProtection($false, $true); Microsoft.PowerShell.Security\Set-Acl -LiteralPath $r.path -AclObject $acl }
    'owner' { $acl = Microsoft.PowerShell.Security\Get-Acl -LiteralPath $r.path; $acl.SetOwner([System.Security.Principal.SecurityIdentifier]'S-1-5-32-544'); Microsoft.PowerShell.Security\Set-Acl -LiteralPath $r.path -AclObject $acl }
    'hold' {
      $stream = [IO.File]::Open($r.path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      try { [Console]::Out.Write('READY'); [Console]::Out.Flush(); [Threading.Thread]::Sleep(30000) }
      finally { $stream.Dispose() }
    }
    'symlink' { $null = Microsoft.PowerShell.Management\New-Item -ItemType SymbolicLink -Path $r.path -Target $r.target }
    'junction' { $null = Microsoft.PowerShell.Management\New-Item -ItemType Junction -Path $r.path -Target $r.target }
    default { throw 'operation' }
  }
  [Console]::Out.Write('OK')
} catch { [Console]::Out.Write('FAIL'); exit 1 }
