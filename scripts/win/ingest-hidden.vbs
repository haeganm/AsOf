' Runs the AsOf ingest with no visible window, and appends the output to a log.
'
' A scheduled task pointed at a .cmd or at powershell.exe flashes a console
' window every time it fires, which on a daily schedule is a daily interruption.
' WScript.Shell.Run with intWindowStyle 0 is the one reliable way to avoid that
' on Windows.
'
' The project directory is derived from this script's own location, so nothing
' here contains a machine-specific path.

Option Explicit

Dim fso, shell, scriptDir, projectDir, logDir, logFile, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)   ' ...\scripts\win
projectDir = fso.GetParentFolderName(fso.GetParentFolderName(scriptDir))

logDir = fso.BuildPath(projectDir, "data")
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
logFile = fso.BuildPath(logDir, "ingest.log")

' cmd /c so the redirection is handled by the shell; 0 = hidden, True = wait.
cmd = "cmd /c cd /d """ & projectDir & """ && npm run ingest >> """ & logFile & """ 2>&1"
shell.Run cmd, 0, True
