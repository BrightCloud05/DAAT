# Execute the real installer path-resolution entry point in a disposable profile.
# Compatible with Windows PowerShell 5.1 and PowerShell 7. Running on macOS
# exercises the script policy only, not Windows filesystem/registry behavior.
$ErrorActionPreference = 'Stop'
$installer = Join-Path (Split-Path -Parent $PSScriptRoot) 'install.ps1'
$psExe = (Get-Process -Id $PID).Path
$sandbox = Join-Path ([IO.Path]::GetTempPath()) ('daat-paths-' + [Guid]::NewGuid().ToString('N'))
# Build Hangul without non-ASCII source bytes, for Windows PowerShell 5.1.
$profile = Join-Path $sandbox ('Test User ' + [char]0xD55C + [char]0xAE00)
$local = Join-Path $profile 'AppData/Local'
$custom = Join-Path $profile 'Chosen DAAT'
$other = Join-Path $profile 'Other installation'
$environmentHome = Join-Path $profile 'Environment home'
$testEnv = @{
    HOME = $profile; USERPROFILE = $profile
    LOCALAPPDATA = $local; APPDATA = (Join-Path $profile 'AppData/Roaming')
    TEMP = (Join-Path $sandbox 'temp'); TMP = (Join-Path $sandbox 'temp')
    HERMES_HOME = ''; HERMES_DESKTOP_USER_DATA_DIR = ''
    POWERSHELL_TELEMETRY_OPTOUT = '1'
}
$saved = @{}
foreach ($key in $testEnv.Keys) { $saved[$key] = [Environment]::GetEnvironmentVariable($key) }
$failures = 0
$cases = @(
    @{ Name = 'fresh DAAT defaults'; EnvHome = ''; Args = @(); Home = "$local\daat"; Install = "$local\daat\hermes-agent" },
    @{ Name = 'environment home'; EnvHome = $environmentHome; Args = @(); Home = $environmentHome; Install = "$environmentHome\hermes-agent" },
    @{ Name = 'explicit home alone'; EnvHome = ''; Args = @('-HermesHome', $custom); Home = $custom; Install = "$custom\hermes-agent" },
    @{ Name = 'explicit home overrides environment'; EnvHome = $environmentHome; Args = @('-HermesHome', $custom); Home = $custom; Install = "$custom\hermes-agent" },
    @{ Name = 'explicit install directory'; EnvHome = ''; Args = @('-InstallDir', $other); Home = "$local\daat"; Install = $other },
    @{ Name = 'both explicit paths'; EnvHome = $environmentHome; Args = @('-HermesHome', $custom, '-InstallDir', $other); Home = $custom; Install = $other }
)
try {
    New-Item -ItemType Directory -Force -Path $profile, $testEnv.TEMP | Out-Null
    foreach ($key in $testEnv.Keys) { [Environment]::SetEnvironmentVariable($key, $testEnv[$key]) }
    foreach ($case in $cases) {
        [Environment]::SetEnvironmentVariable('HERMES_HOME', $case.EnvHome)
        $callArgs = @('-NoProfile', '-File', $installer, '-ShowResolvedPaths') + $case.Args
        $raw = & $psExe @callArgs
        if ($LASTEXITCODE -ne 0) { throw "Installer query failed: $($case.Name)" }
        $report = ($raw -join "`n") | ConvertFrom-Json
        # PowerShell may create its own profile cache; the installer must not
        # create either of the runtime paths it reports in diagnostic mode.
        if ((Test-Path -LiteralPath $report.hermes_home) -or (Test-Path -LiteralPath $report.install_dir)) {
            throw "Path query initialized a runtime: $($case.Name)"
        }
        if ($report.hermes_home -ne $case.Home -or $report.install_dir -ne $case.Install) {
            Write-Host "FAIL: $($case.Name)"
            Write-Host "  expected home=$($case.Home) install=$($case.Install)"
            Write-Host "  actual   home=$($report.hermes_home) install=$($report.install_dir)"
            $failures++
        } else {
            Write-Host "PASS: $($case.Name)"
        }
    }
} finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key]) }
    Remove-Item -LiteralPath $sandbox -Recurse -Force
}
if ($failures -gt 0) { throw "$failures installer path cases failed" }
Write-Host "PASS: all $($cases.Count) installer path cases; disposable profile cleaned up"
