# Test upload script: logs in, uploads a multipart survey with owner PAN/Aadhaar, then GETs surveys
$base = 'http://192.168.15.121:5000'
try {
  Write-Output "Logging in..."
  $login = Invoke-RestMethod -Method Post -Uri "$base/api/login" -Body (ConvertTo-Json @{ email = 'admin@survey.com'; password = 'admin2026'; role = 'admin' }) -ContentType 'application/json'
  $token = $login.token
  Write-Output "Got token length: $($token.Length)"

  $owner = @{ name='Automation Test'; guardian='Auto'; relation='self'; gender='Male'; aadhar='123412341234'; pan='ABCDE1234F'; electricityCA='CA123'; mobile='9999999999' }
  $ownerJson = ConvertTo-Json @($owner) -Compress

  # Resolve assets directory relative to this script. The repo's assets/ lives at the parent of backend
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $repoRoot = Resolve-Path -LiteralPath (Join-Path $scriptDir '..')
  $assetDir = Join-Path $repoRoot 'assets'

  $c1 = Join-Path $assetDir 'onboarding1.png'
  $c2 = Join-Path $assetDir 'onboarding2.png'
  $fallback1 = Join-Path $assetDir 'logo.png'
  $fallback2 = Join-Path $assetDir 'logo_bihargov.png'

  $file1 = if (Test-Path $c1) { Resolve-Path -LiteralPath $c1 } elseif (Test-Path $fallback1) { Write-Output 'assets/onboarding1.png not found, trying assets/logo.png'; Resolve-Path -LiteralPath $fallback1 } else { Write-Output "No first image found in $assetDir"; $null }
  $file2 = if (Test-Path $c2) { Resolve-Path -LiteralPath $c2 } elseif (Test-Path $fallback2) { Write-Output 'assets/onboarding2.png not found, trying assets/logo_bihargov.png'; Resolve-Path -LiteralPath $fallback2 } else { Write-Output "No second image found in $assetDir"; $null }

  if ($file1 -or $file2) {
    $f1p = if ($file1) { $file1.Path } else { '<none>' }
    $f2p = if ($file2) { $file2.Path } else { '<none>' }
    Write-Output "Using files: $f1p; $f2p"
  } else {
    Write-Output "No images found to attach (checked $assetDir). Continuing without image files."
  }

  Add-Type -AssemblyName System.Net.Http
  $handler = New-Object System.Net.Http.HttpClientHandler
  $client = New-Object System.Net.Http.HttpClient($handler)
  $client.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $token)

  $multipart = New-Object System.Net.Http.MultipartFormDataContent

  $fields = @{ 
    email = 'automation@test.com';
    name = 'Auto Test';
    mobile = '9999999999';
    ward = '1';
    road = 'Test Road';
    propertyType = 'Residential';
    ownershipType = 'Single Owner';
    numberOfFloors = '1';
    plotArea = '100';
    builtUpArea = '80';
    geoLat = '26.0';
    geoLng = '85.0';
    ownerDetails = $ownerJson;
  }
  foreach ($k in $fields.Keys) { $multipart.Add((New-Object System.Net.Http.StringContent($fields[$k])), $k) }

  function Add-FileToMultipart($multipart, $fieldName, $path) {
    if (-not (Test-Path $path)) { Write-Output "File not found: $path"; return }
    $stream = [System.IO.File]::OpenRead($path)
    $content = New-Object System.Net.Http.StreamContent($stream)
    $content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("image/png")
    $multipart.Add($content, $fieldName, [System.IO.Path]::GetFileName($path))
  }

  Add-FileToMultipart $multipart 'images' $file1.Path
  Add-FileToMultipart $multipart 'images' $file2.Path

  Write-Output "Sending upload request..."
  $response = $client.PostAsync("$base/api/surveys/upload", $multipart).Result
  $status = [int]$response.StatusCode
  $body = $response.Content.ReadAsStringAsync().Result
  Write-Output "Upload HTTP status: $status"
  Write-Output "Upload response body:`n$body"

  Write-Output "Fetching /api/surveys..."
  $get = $client.GetAsync("$base/api/surveys").Result
  $getBody = $get.Content.ReadAsStringAsync().Result
  Write-Output "GET /api/surveys response:`n$getBody"
} catch {
  Write-Output "Error: $($_.Exception.Message)"
  if ($_.Exception.InnerException) { Write-Output "Inner: $($_.Exception.InnerException.Message)" }
}
