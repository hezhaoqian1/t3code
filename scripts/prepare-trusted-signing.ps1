$ErrorActionPreference = "Stop"

$moduleVersion = "0.5.0"
$expectedSha256 = "dd6bc36b20a7c3de8db24f1cd6bef89c9453a9bbcded52478705aa33a6fc2f4e"
$packagePath = Join-Path $env:RUNNER_TEMP "TrustedSigning.$moduleVersion.nupkg"
$moduleRoot = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "PowerShell/Modules/TrustedSigning/$moduleVersion"
$builderPath = Get-ChildItem -Path "node_modules/.pnpm" -Filter "windowsSignAzureManager.js" -Recurse |
  Where-Object { $_.FullName -match "app-builder-lib@26\.15\.6" } |
  Select-Object -First 1 -ExpandProperty FullName

if (-not $builderPath) {
  throw "Unable to locate electron-builder's Azure signing manager."
}

Invoke-WebRequest `
  -Uri "https://www.powershellgallery.com/api/v2/package/TrustedSigning/$moduleVersion" `
  -OutFile $packagePath
$actualSha256 = (Get-FileHash -Path $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) {
  throw "TrustedSigning package hash mismatch: $actualSha256"
}

New-Item -ItemType Directory -Path $moduleRoot -Force | Out-Null
if (Test-Path $moduleRoot) {
  Remove-Item -Path $moduleRoot -Recurse -Force
}
[System.IO.Compression.ZipFile]::ExtractToDirectory($packagePath, $moduleRoot)
Import-Module TrustedSigning -RequiredVersion $moduleVersion -Force
Get-Command Invoke-TrustedSigning -ErrorAction Stop | Out-Null

$builderSource = Get-Content -Path $builderPath -Raw
$dynamicProviderInstall = "Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser"
$dynamicInstall = "Install-Module -Name TrustedSigning -MinimumVersion 0.5.0 -Force -Repository PSGallery -Scope CurrentUser"
$pinnedImport = "Import-Module TrustedSigning -RequiredVersion $moduleVersion -Force -ErrorAction Stop"
if (-not $builderSource.Contains($dynamicProviderInstall) -or -not $builderSource.Contains($dynamicInstall)) {
  throw "electron-builder Azure signing bootstrap no longer matches the audited implementation."
}
$builderSource.Replace($dynamicProviderInstall, "Write-Output 'NuGet provider preinstalled by release workflow'").Replace($dynamicInstall, $pinnedImport) |
  Set-Content -Path $builderPath -NoNewline

if ((Get-Content -Path $builderPath -Raw).Contains("Install-Module -Name TrustedSigning")) {
  throw "Failed to disable electron-builder's dynamic TrustedSigning install."
}
