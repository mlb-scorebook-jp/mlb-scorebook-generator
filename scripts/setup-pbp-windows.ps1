$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeDir = Join-Path $scriptDir "pbp-runtime"
$startScript = Join-Path $scriptDir "start-pbp-windows.ps1"

$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
    Write-Host "Node.js LTS が必要です。https://nodejs.org/ からインストール後、もう一度実行してください。" -ForegroundColor Yellow
    Read-Host "Enterキーで閉じる"
    exit 1
}

Write-Host "PBP撮影機能を準備しています。初回だけ数分かかる場合があります。"
& $npm.Source install --prefix $runtimeDir --omit=dev
if ($LASTEXITCODE -ne 0) {
    Write-Host "必要なファイルを取得できませんでした。ネットワーク接続を確認してください。" -ForegroundColor Red
    Read-Host "Enterキーで閉じる"
    exit $LASTEXITCODE
}

$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "MLB Scorebook PBP.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`""
$shortcut.WorkingDirectory = $scriptDir
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,21"
$shortcut.Save()

$running = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
if (-not $running) {
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$startScript`""
    )
}

Start-Sleep -Seconds 2
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 3
    if ($health.ok) {
        Write-Host "設定完了。今後はWindowsへログインすると自動で利用できます。" -ForegroundColor Green
    }
} catch {
    Write-Host "設定は保存しましたが、起動確認に失敗しました。PCを再起動して確認してください。" -ForegroundColor Yellow
}

Read-Host "Enterキーで閉じる"
