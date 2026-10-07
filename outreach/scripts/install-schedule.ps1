# Registers the outreach tick in Windows Task Scheduler: every 5 minutes, forever, while you are signed in.
# Built from XML (not `schtasks /SC MINUTE`) because only XML can set StartWhenAvailable: if the PC was off or
# asleep at a trigger time, the missed run starts as soon as it is back, instead of being skipped.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-schedule.ps1
#
# Re-running replaces the task. Remove it with uninstall-schedule.ps1. The PC must be on for emails to go out.
param(
  [string]$TaskName = 'OutreachTick',
  [int]$EveryMinutes = 5
)
$ErrorActionPreference = 'Stop'

$tickScript = Join-Path $PSScriptRoot 'tick.ps1'
if (-not (Test-Path -LiteralPath $tickScript)) { throw "tick.ps1 not found next to this script: $tickScript" }
$workingDirectory = Split-Path -Parent $PSScriptRoot
$powershell = (Get-Command powershell.exe).Source
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

function Escape-Xml([string]$text) { [System.Security.SecurityElement]::Escape($text) }

$arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $tickScript
$startBoundary = (Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss')

# A tick sends only what is due in the next ~4 minutes, so it ends well inside the 10-minute limit. IgnoreNew keeps a slow
# tick from overlapping the next one (the database lease is the second line of defence).
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Cold-outreach tick: sync replies, schedule and send due emails.</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>PT${EveryMinutes}M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>$startBoundary</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$(Escape-Xml $userId)</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowHardTerminate>true</AllowHardTerminate>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Enabled>true</Enabled>
    <WakeToRun>false</WakeToRun>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$(Escape-Xml $powershell)</Command>
      <Arguments>$(Escape-Xml $arguments)</Arguments>
      <WorkingDirectory>$(Escape-Xml $workingDirectory)</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

# schtasks reads the XML file as UTF-16.
$xmlFile = Join-Path ([System.IO.Path]::GetTempPath()) "$TaskName.xml"
try {
  Set-Content -LiteralPath $xmlFile -Value $xml -Encoding Unicode
  & schtasks.exe /Create /TN $TaskName /XML $xmlFile /F
  if ($LASTEXITCODE -ne 0) { throw "schtasks /Create failed with exit code $LASTEXITCODE" }
}
finally {
  Remove-Item -LiteralPath $xmlFile -Force -ErrorAction SilentlyContinue
}

Write-Host "Installed '$TaskName': every $EveryMinutes minutes while $userId is signed in."
Write-Host "Check: schtasks /Query /TN $TaskName /V /FO LIST    Run now: schtasks /Run /TN $TaskName"
Write-Host "Remove: task outreach:uninstall-schedule"
