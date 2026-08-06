<#
    Registers (or removes) a daily windowless AsOf data refresh.

        powershell -ExecutionPolicy Bypass -File scripts\win\install-task.ps1
        powershell -ExecutionPolicy Bypass -File scripts\win\install-task.ps1 -At 07:15
        powershell -ExecutionPolicy Bypass -File scripts\win\install-task.ps1 -Remove

    Monitors are only honest if something checks them. Without a schedule, a
    falsifier that is supposed to fire on its own still waits for you to remember
    to run a command, which is the problem monitors exist to solve.

    Runs at logon as well as daily, so a machine that was off at the scheduled
    time catches up rather than silently skipping a day.

    Registers by importing an XML definition through schtasks.exe rather than
    Register-ScheduledTask: the cmdlet wants elevation on some machines even for
    a task that runs as the current user with least privilege, while the XML
    import path does not.

    Kept deliberately ASCII-only: PowerShell 5.1 reads .ps1 files as ANSI, and a
    stray em dash is enough to break string parsing.
#>
[CmdletBinding()]
param(
    [string]$TaskName = 'AsOf-ingest',
    [string]$At = '07:10',
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

if ($Remove) {
    schtasks.exe /delete /tn $TaskName /f 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "Removed scheduled task '$TaskName'." }
    else { Write-Host "No scheduled task named '$TaskName' (nothing to remove)." }
    return
}

if ($At -notmatch '^\d{2}:\d{2}$') { throw "-At must look like 07:10" }

$vbs = Join-Path $PSScriptRoot 'ingest-hidden.vbs'
if (-not (Test-Path $vbs)) { throw "Cannot find $vbs" }
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name

# XML escaping for the two values that come from the filesystem.
function Esc([string]$s) { [Security.SecurityElement]::Escape($s) }

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>AsOf: refresh prices and filings, then evaluate monitors. Windowless.</Description>
    <URI>\$TaskName</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-01-01T${At}:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$(Esc $me)</UserId>
      <Delay>PT2M</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$(Esc $me)</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>"$(Esc $vbs)"</Arguments>
      <WorkingDirectory>$(Esc $projectDir)</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

# schtasks requires the XML file to be Unicode.
$tmp = Join-Path $env:TEMP "asof-task-$PID.xml"
[IO.File]::WriteAllText($tmp, $xml, [Text.Encoding]::Unicode)
try {
    $out = schtasks.exe /create /tn $TaskName /xml $tmp /f 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($out | Out-String) }
} finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

Write-Host "Registered '$TaskName': daily at $At and two minutes after logon, with no visible window."
Write-Host "Output appends to data\ingest.log, which is gitignored."
Write-Host "Run it once now:  schtasks /run /tn $TaskName"
Write-Host "Check it:         schtasks /query /tn $TaskName /v /fo list"
Write-Host "Remove it later:  powershell -File scripts\win\install-task.ps1 -Remove"
