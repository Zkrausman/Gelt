# check-beads.ps1 - Beads documentation validator
param (
    [string]$IssueId
)

if (-not $IssueId) {
    Write-Host "[check-beads] No issue ID provided. Skipping."
    exit 0
}

Write-Host "[check-beads] Validating documentation for issue: $IssueId"
$showOutput = bd show $IssueId | Out-String

if ($showOutput -notmatch "RATIONALE" -or $showOutput -notmatch "EVIDENCE") {
    Write-Error "[check-beads] Task $IssueId lacks required [bd-3qwe self-doc] RATIONALE and EVIDENCE anchors. Please update notes using 'bd update $IssueId --notes ...' before closing."
    exit 1
}

Write-Host "[check-beads] Task $IssueId documentation check passed!"
exit 0
