# One outreach tick: sync replies, schedule, send what is due. Task Scheduler runs this every 5 minutes
# (see install-schedule.ps1). The tick keeps its own structured log in logs\tick-YYYY-MM-DD.log; this wrapper
# only captures console output (startup errors such as a missing .env) with a timestamp per line, and returns
# npm's exit code so Task Scheduler shows a failed tick as a failed run.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$console = Join-Path $logs 'tick-console.log'

# Windows PowerShell 5.1 turns every line a native command writes to stderr into an error record when it is
# redirected with 2>&1, and under 'Stop' that terminates the script before the exit code is read. npm and the
# tick print warnings and failures to stderr, so run it under 'Continue' and stringify each record.
$ErrorActionPreference = 'Continue'
& npm.cmd run outreach --silent -- tick 2>&1 |
  ForEach-Object { '{0} {1}' -f (Get-Date -Format 'o'), "$_" } |
  Add-Content -LiteralPath $console -Encoding UTF8
$exitCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'

exit $exitCode
