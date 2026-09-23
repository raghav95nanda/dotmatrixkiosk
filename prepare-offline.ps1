$ErrorActionPreference = "Stop"

$Version = "0.1.1675465747"
$Base = "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@$Version"
$Target = Join-Path $PSScriptRoot "mediapipe"

New-Item -ItemType Directory -Force -Path $Target | Out-Null

$Files = @(
  "selfie_segmentation.js",
  "selfie_segmentation.binarypb",
  "selfie_segmentation.tflite",
  "selfie_segmentation_landscape.tflite",
  "selfie_segmentation_solution_simd_wasm_bin.js",
  "selfie_segmentation_solution_simd_wasm_bin.wasm",
  "selfie_segmentation_solution_wasm_bin.js",
  "selfie_segmentation_solution_wasm_bin.wasm"
)

Write-Host "Downloading MediaPipe Selfie Segmentation $Version for offline use..."
foreach ($File in $Files) {
  $Url = "$Base/$File"
  $Dest = Join-Path $Target $File
  Write-Host "  $File"
  Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing
}

# The package contains this zero-byte companion file. Creating it locally is sufficient.
$DataFile = Join-Path $Target "selfie_segmentation_solution_simd_wasm_bin.data"
New-Item -ItemType File -Force -Path $DataFile | Out-Null

Write-Host ""
Write-Host "Verifying offline assets..."
$MinimumSizes = @{
  "selfie_segmentation.js" = 10000
  "selfie_segmentation.binarypb" = 1
  "selfie_segmentation.tflite" = 100000
  "selfie_segmentation_landscape.tflite" = 100000
  "selfie_segmentation_solution_simd_wasm_bin.js" = 100000
  "selfie_segmentation_solution_simd_wasm_bin.wasm" = 1000000
  "selfie_segmentation_solution_simd_wasm_bin.data" = 0
  "selfie_segmentation_solution_wasm_bin.js" = 100000
  "selfie_segmentation_solution_wasm_bin.wasm" = 1000000
}

foreach ($Name in $MinimumSizes.Keys) {
  $Path = Join-Path $Target $Name
  if (-not (Test-Path $Path)) { throw "Missing $Name" }
  $Size = (Get-Item $Path).Length
  if ($Size -lt $MinimumSizes[$Name]) { throw "$Name looks incomplete ($Size bytes)" }
}

$IndexText = Get-Content (Join-Path $PSScriptRoot "index.html") -Raw
$ScriptText = Get-Content (Join-Path $PSScriptRoot "script.js") -Raw
if ($IndexText -match "cdn\.jsdelivr|unpkg\.com" -or $ScriptText -match "cdn\.jsdelivr|unpkg\.com") {
  throw "A remote CDN reference remains in the app code."
}

Write-Host "Offline verification passed."
Write-Host "Done. You can now copy this whole folder to the Raspberry Pi and run it without Wi-Fi."
