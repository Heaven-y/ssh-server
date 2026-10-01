# 安装本项目开发用的 Agent skill（只装到当前项目，不装到全局）
#
# 用法（在仓库根目录执行）：
#   powershell -ExecutionPolicy Bypass -File scripts\dev\install-skills.ps1
#
# 说明：
# - 使用 vercel-labs/skills（npx skills）统一管理，版本固定为 $SkillsCliVersion。
# - 真实文件放在 .agents/skills/（Codex 读取），.claude/skills/ 下为指向它的目录链接（Claude Code 读取）。
# - skill 文件与 skills-lock.json 均不提交到仓库，已在 .gitignore 中忽略。
# - 默认关闭 npx skills 的匿名统计。
# - 本文件需保存为带 BOM 的 UTF-8，否则 Windows PowerShell 5.1 会把中文读成乱码。

$ErrorActionPreference = 'Stop'
$SkillsCliVersion = '1.7.0'
$env:DISABLE_TELEMETRY = '1'

# 调用 npx.cmd，避开 npx.ps1 包装脚本对数组参数的错误展开
$Npx = 'npx.cmd'

# 安装目标：Claude Code 与 Codex
$Agents = @('-a', 'claude-code', '-a', 'codex')

# 要安装的 skill：来源 + 选择的 skill 名（'*' 表示该来源下全部；空数组表示来源本身就是单个 skill）
$Sources = @(
    @{ Source = 'obra/superpowers'; Skills = @('*') },
    @{ Source = 'vercel-labs/agent-skills'; Skills = @('vercel-react-best-practices') },
    @{ Source = 'anthropics/skills'; Skills = @('webapp-testing') },
    @{ Source = 'https://github.com/anthropics/claude-plugins-official/tree/main/plugins/mcp-server-dev/skills/build-mcp-server'; Skills = @() },
    @{ Source = 'nextlevelbuilder/ui-ux-pro-max-skill'; Skills = @('ui-ux-pro-max') }
)

# 脚本位于 scripts/dev/，仓库根目录在上两级
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $RepoRoot
try {
    foreach ($item in $Sources) {
        $cliArgs = @('-y', "skills@$SkillsCliVersion", 'add', $item.Source)
        foreach ($name in $item.Skills) { $cliArgs += @('-s', $name) }
        $cliArgs += $Agents + @('-y')

        Write-Host "==> 安装 $($item.Source)" -ForegroundColor Cyan
        & $Npx @cliArgs
        if ($LASTEXITCODE -ne 0) { throw "安装失败：$($item.Source)（退出码 $LASTEXITCODE）" }
    }

    Write-Host "`n==> 已安装的项目级 skill" -ForegroundColor Cyan
    & $Npx -y "skills@$SkillsCliVersion" ls -a claude-code -a codex
}
finally {
    Pop-Location
}
