param(
    [string]$Installer = ''
)

$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if ([string]::IsNullOrWhiteSpace($Installer)) {
    $package = Get-Content -LiteralPath (Join-Path $repository 'apps/desktop/package.json') -Raw | ConvertFrom-Json
    $Installer = Join-Path $repository ("release/AgentDeck-{0}-x64-setup.exe" -f $package.version)
}
$installerPath = [IO.Path]::GetFullPath($Installer)
$nodeExecutable = (Get-Command node).Source
$uninstallRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
function Find-AgentDeckInstall {
    foreach ($registryRoot in $uninstallRoots) {
        Get-ChildItem -LiteralPath $registryRoot -ErrorAction SilentlyContinue |
            Get-ItemProperty -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -match '^AgentDeck(?:\s+\d|$)' }
    }
}

# 安装器会登记卸载入口和开始菜单；发现任何既有安装或同名产物就拒绝覆盖。
$menuLink = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs/AgentDeck.lnk'
$desktopLink = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'AgentDeck.lnk'
$installerCache = Join-Path $env:LOCALAPPDATA '@agentdeckdesktop-updater'
if ((Find-AgentDeckInstall) -or (Test-Path -LiteralPath $menuLink) -or
    (Test-Path -LiteralPath $desktopLink) -or (Test-Path -LiteralPath $installerCache)) {
    throw '发现已有 AgentDeck 安装或快捷方式/缓存，停止验收以保留现有内容'
}
if (!(Test-Path -LiteralPath $installerPath -PathType Leaf)) { throw '找不到待验收安装包' }

$temporary = Join-Path ([IO.Path]::GetTempPath()) ('agentdeck-installer-smoke-' + [Guid]::NewGuid().ToString('N'))
$installDirectory = Join-Path $temporary 'installed'
$smokeProfile = Join-Path $temporary 'profile'
$isolated = @{
    SystemRoot = $env:SystemRoot
    WINDIR = $env:SystemRoot
    COMSPEC = (Join-Path $env:SystemRoot 'System32/cmd.exe')
    PATH = (Join-Path $env:SystemRoot 'System32')
    TEMP = (Join-Path $temporary 'temp')
    TMP = (Join-Path $temporary 'temp')
    USERPROFILE = $smokeProfile
    APPDATA = (Join-Path $smokeProfile 'AppData/Roaming')
    LOCALAPPDATA = (Join-Path $smokeProfile 'AppData/Local')
    AGENTDECK_CONFIG_DIR = (Join-Path $temporary 'configuration')
}
foreach ($directory in @($temporary, $smokeProfile, $isolated.TEMP, $isolated.APPDATA, $isolated.LOCALAPPDATA)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
function Invoke-IsolatedInstaller([string]$Executable, [string]$Arguments) {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $Executable
    $start.Arguments = $Arguments
    $start.WorkingDirectory = $temporary
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $start.EnvironmentVariables.Clear()
    foreach ($name in $isolated.Keys) { $start.EnvironmentVariables[$name] = $isolated[$name] }
    $child = [Diagnostics.Process]::Start($start)
    if (!$child.WaitForExit(60000)) { $child.Kill(); throw '安装器执行超时' }
    if ($child.ExitCode -ne 0) { throw "安装器退出码：$($child.ExitCode)" }
}

$installed = $false
try {
    Invoke-IsolatedInstaller $installerPath "/S /currentuser --no-desktop-shortcut /D=$installDirectory"
    $installed = $true
    if (!(Test-Path -LiteralPath (Join-Path $installDirectory 'AgentDeck.exe') -PathType Leaf)) {
        throw '安装目标目录缺少应用程序'
    }
    $registered = @(Find-AgentDeckInstall)
    if ($registered.Count -ne 1) {
        throw '安装登记位置与隔离目标不一致'
    }
    # NSIS 的卸载项没有 InstallLocation；该字段位于自己的安装键，按卸载程序路径核对实际位置。
    $registeredExecutable = [regex]::Match($registered[0].UninstallString, '^"([^"]+)"')
    if (!$registeredExecutable.Success) { throw '安装登记缺少可核对的卸载路径' }
    & $nodeExecutable -e "const fs=require('node:fs'); process.exit(fs.realpathSync.native(process.argv[1]).toLowerCase()===fs.realpathSync.native(process.argv[2]).toLowerCase()?0:1)" $registeredExecutable.Groups[1].Value (Join-Path $installDirectory 'Uninstall AgentDeck.exe')
    if ($LASTEXITCODE -ne 0) { throw '安装登记的卸载程序不属于隔离目标' }
    & $nodeExecutable --import tsx (Join-Path $PSScriptRoot 'smoke.ts') --installed $installDirectory
    if ($LASTEXITCODE -ne 0) { throw '已安装版本启动验收失败' }
}
finally {
    if ($installed) {
        $uninstaller = Join-Path $installDirectory 'Uninstall AgentDeck.exe'
        if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
            Invoke-IsolatedInstaller $uninstaller "/S /currentuser _?=$installDirectory"
        }
        if (Find-AgentDeckInstall) { throw '卸载登记仍存在，保留验收目录供检查' }
    }
    if (Test-Path -LiteralPath $installerCache) {
        $cacheFile = Join-Path $installerCache 'installer.exe'
        if (!(Test-Path -LiteralPath $cacheFile -PathType Leaf) -or
            (Get-FileHash -LiteralPath $cacheFile -Algorithm SHA256).Hash -ne
            (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash) {
            throw '安装器缓存不属于本次产物，保留原文件'
        }
        Remove-Item -LiteralPath $cacheFile
        if (!(Get-ChildItem -LiteralPath $installerCache -Force)) { Remove-Item -LiteralPath $installerCache }
    }
    $verified = [IO.Path]::GetFullPath($temporary)
    if ([IO.Path]::GetDirectoryName($verified) -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -or
        ![IO.Path]::GetFileName($verified).StartsWith('agentdeck-installer-smoke-')) {
        throw '验收目录不在预定临时范围内'
    }
    Remove-Item -LiteralPath $verified -Recurse -Force
}
if ((Test-Path -LiteralPath $menuLink) -or (Test-Path -LiteralPath $desktopLink)) { throw '卸载后快捷方式仍存在' }
$report = @{ install = $true; launch = $true; uninstall = $true; existingInstallOverwritten = $false }
$reportPath = Join-Path $repository 'release/verification/installer-smoke.json'
[IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json) + "`n", (New-Object Text.UTF8Encoding($false)))
$report | ConvertTo-Json -Compress
