# Prove the real repository stage preserves the source seeded by the desktop.
$ErrorActionPreference = 'Stop'
$installer = Join-Path (Split-Path -Parent $PSScriptRoot) 'install.ps1'
$psExe = (Get-Process -Id $PID).Path
$root = Join-Path ([IO.Path]::GetTempPath()) ('daat-bundle-' + [Guid]::NewGuid().ToString('N'))
$source = Join-Path $root 'Bundled source'
$runtime = Join-Path $root 'runtime'
try {
    New-Item -ItemType Directory -Force -Path (Join-Path $source 'hermes_cli') | Out-Null
    Set-Content -LiteralPath (Join-Path $source 'pyproject.toml') -Value '[project]' -Encoding ascii
    Set-Content -LiteralPath (Join-Path $source 'hermes_cli/main.py') -Value '# bundled sentinel' -Encoding ascii
    Set-Content -LiteralPath (Join-Path $source '.daat-bundle-id') -Value 'fixture-bundle' -Encoding ascii
    Set-Content -LiteralPath (Join-Path $source '.daat-bundle-stamp') -Value '{"version":2,"bundle":"fixture-bundle","files":{}}' -Encoding ascii
    $wrapper = Join-Path $root 'run.ps1'
    @'
param($Installer, $Source, $Runtime)
function global:git { throw 'Bundled source must not invoke Git or use the network' }
& $Installer -Stage repository -NonInteractive -Json -InstallDir $Source -HermesHome $Runtime
exit $LASTEXITCODE
'@ | Set-Content -LiteralPath $wrapper -Encoding ascii
    & $psExe -NoProfile -File $wrapper $installer $source $runtime
    if ($LASTEXITCODE -ne 0) { throw 'Bundled repository stage failed' }
    if ((Get-Content -LiteralPath (Join-Path $source 'hermes_cli/main.py') -Raw).Trim() -ne '# bundled sentinel') {
        throw 'Bundled source changed'
    }
    if (@(Get-ChildItem -LiteralPath $root -Filter '*.broken-*').Count -ne 0) { throw 'Bundled source was moved aside' }
    Write-Host 'PASS: bundled source preserved without Git or network access'
    Set-Content -LiteralPath (Join-Path $source '.daat-bundle-id') -Value 'mismatched-bundle' -Encoding ascii
    & $psExe -NoProfile -File $wrapper $installer $source $runtime
    if ($LASTEXITCODE -eq 0) { throw 'Mismatched bundle was accepted' }
    if (!(Test-Path -LiteralPath (Join-Path $source 'hermes_cli/main.py'))) { throw 'Invalid source was removed' }
    if (@(Get-ChildItem -LiteralPath $root -Filter '*.broken-*').Count -ne 0) { throw 'Invalid source was moved aside' }
    Write-Host 'PASS: mismatched bundle rejected with original files preserved'
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}
