$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeDir = Join-Path $scriptDir "pbp-runtime"
$nodeModules = Join-Path $runtimeDir "node_modules"
$server = Join-Path $scriptDir "pbp-capture-server.mjs"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        "PBP資料機能にはNode.jsが必要です。最初にWindows用セットアップを実行してください。",
        "MLBスコアブック"
    ) | Out-Null
    exit 1
}

if (-not (Test-Path (Join-Path $nodeModules "playwright")) -or
    -not (Test-Path (Join-Path $nodeModules "pdf-lib"))) {
    exit 2
}

$env:NODE_PATH = $nodeModules
& $node.Source $server
