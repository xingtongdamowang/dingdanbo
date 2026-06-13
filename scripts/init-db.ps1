param(
  [switch]$Seed,
  [switch]$CreateDb,
  [string]$EnvFile
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $OutputEncoding
$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $EnvFile) {
  $EnvFile = Join-Path $RootDir ".env"
}

function Read-DotEnvValue {
  param([string]$Path, [string]$Key)

  $line = Get-Content -LiteralPath $Path |
    Where-Object { $_ -match "^\s*$([regex]::Escape($Key))=" } |
    Select-Object -Last 1

  if (-not $line) { return "" }
  $value = ($line -replace "^\s*$([regex]::Escape($Key))=", "").Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  return $value
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  throw "Env file not found: $EnvFile. Copy .env.example to .env and fill database settings first."
}

$DbHost = if ($env:DB_HOST) { $env:DB_HOST } else { Read-DotEnvValue $EnvFile "DB_HOST" }
$DbPort = if ($env:DB_PORT) { $env:DB_PORT } else { Read-DotEnvValue $EnvFile "DB_PORT" }
$DbUser = if ($env:DB_USER) { $env:DB_USER } else { Read-DotEnvValue $EnvFile "DB_USER" }
$DbPassword = if ($env:DB_PASSWORD) { $env:DB_PASSWORD } else { Read-DotEnvValue $EnvFile "DB_PASSWORD" }
$DbName = if ($env:DB_NAME) { $env:DB_NAME } else { Read-DotEnvValue $EnvFile "DB_NAME" }
$MysqlBin = if ($env:MYSQL_BIN) { $env:MYSQL_BIN } else { "mysql" }

if (-not $DbHost) { $DbHost = "127.0.0.1" }
if (-not $DbPort) { $DbPort = "3306" }
if (-not $DbUser -or -not $DbName) {
  throw "DB_USER and DB_NAME are required. Check $EnvFile."
}
if ($DbName -notmatch "^[A-Za-z0-9_]+$") {
  throw "DB_NAME may only contain letters, numbers, and underscores: $DbName"
}
if (-not (Get-Command $MysqlBin -ErrorAction SilentlyContinue)) {
  throw "mysql client not found. Install MySQL Client or set MYSQL_BIN to mysql.exe."
}

$env:MYSQL_PWD = $DbPassword
$MysqlArgs = @("--protocol=TCP", "--default-character-set=utf8mb4", "-h", $DbHost, "-P", $DbPort, "-u", $DbUser)

Write-Host "Connecting to MySQL: $DbHost`:$DbPort / $DbName"
& $MysqlBin @MysqlArgs -e "SELECT 1;" | Out-Null

if ($CreateDb) {
  Write-Host "Ensuring database exists: $DbName"
  & $MysqlBin @MysqlArgs -e "CREATE DATABASE IF NOT EXISTS ``$DbName`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
}

$SchemaPath = Join-Path $RootDir "sql/schema.sql"
Write-Host "Applying schema: $SchemaPath"
Get-Content -LiteralPath $SchemaPath -Encoding UTF8 -Raw | & $MysqlBin @MysqlArgs $DbName

if ($Seed) {
  $SeedPath = Join-Path $RootDir "sql/seed.sql"
  Write-Host "Importing seed data: $SeedPath"
  Get-Content -LiteralPath $SeedPath -Encoding UTF8 -Raw | & $MysqlBin @MysqlArgs $DbName
}

Write-Host "Database initialization complete."
