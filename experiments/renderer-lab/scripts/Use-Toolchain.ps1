$ErrorActionPreference = 'Stop'
$portableMsvcSetup = Join-Path $env:LOCALAPPDATA 'PigeonCoop\tools\msvc\setup_x64.bat'
if (-not (Test-Path -LiteralPath $portableMsvcSetup)) { throw 'Portable MSVC setup_x64.bat is missing.' }
# Import only this child command's environment; never echo environment contents.
$compilerEnvironment = & $env:ComSpec /d /c "call `"$portableMsvcSetup`" && set"
if ($LASTEXITCODE -ne 0) { throw 'Portable MSVC setup failed.' }
foreach ($compilerSetting in $compilerEnvironment) {
    if ($compilerSetting -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1],$Matches[2],'Process') }
}
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = Join-Path $env:VCToolsInstallDir 'bin\Hostx64\x64\link.exe'
if (-not (Test-Path -LiteralPath $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER)) { throw 'MSVC linker is missing.' }
