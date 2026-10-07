# Removes the outreach tick from Windows Task Scheduler. Pending emails stay in the database; they are sent by
# the next tick whenever it runs again (slots missed by more than 2 hours are moved to the next window).
param([string]$TaskName = 'OutreachTick')
$ErrorActionPreference = 'Stop'

& schtasks.exe /Query /TN $TaskName *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "No scheduled task named '$TaskName'; nothing to remove."
  exit 0
}

& schtasks.exe /Delete /TN $TaskName /F
if ($LASTEXITCODE -ne 0) { throw "schtasks /Delete failed with exit code $LASTEXITCODE" }
Write-Host "Removed '$TaskName'."
