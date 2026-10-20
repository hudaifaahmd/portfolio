param([Parameter(Mandatory=$true)][string]$CsvPath)
$ErrorActionPreference = 'Stop'
$rows = @(Import-Csv -LiteralPath $CsvPath)
if ($rows.Count -ne 1568) { throw 'Expected 1,568 individual checks.' }
$months = @($rows | Group-Object source_period | Sort-Object Name | ForEach-Object {
    $checks = $_.Group
    if ($checks.Count -ne 49 -or @($checks | Group-Object check_name).Count -ne 49) { throw 'Missing or duplicate monthly checks.' }
    if (@($checks | Where-Object check_status -eq PASS).Count -ne 48 -or @($checks | Where-Object check_status -eq WARN).Count -ne 1) { throw 'Unexpected check result.' }
    $map = @{}
    foreach ($check in $checks) { $map[$check.check_name] = $check }
    if ($map.silver_pickup_date_outside_source_month.check_status -ne 'WARN') { throw 'Unexpected warning.' }
    $b = [long]$map.bronze_equals_silver_plus_quarantine.actual_value
    $s = [long]$map.silver_equals_gold_rows.expected_value
    $g = [long]$map.silver_equals_gold_rows.actual_value
    if ($g -ne $s) { throw 'Silver and Gold do not reconcile.' }
    [pscustomobject][ordered]@{
        period = $_.Name; bronze = $b; silver = $s; gold = $g; quarantine = $b - $s
        amountCents = ([decimal]$map.silver_gold_total_amount_cents.actual_value).ToString('0', [cultureinfo]::InvariantCulture)
        boundary = [long]$map.silver_pickup_date_outside_source_month.actual_value
    }
})
if ($months.Count -ne 32 -or $months[0].period -ne '2024-01' -or $months[-1].period -ne '2026-08') { throw 'Unexpected coverage.' }
$amount = [decimal]0
foreach ($month in $months) { $amount += [decimal]$month.amountCents }
if (($months | Measure-Object bronze -Sum).Sum -ne 119595677 -or ($months | Measure-Object gold -Sum).Sum -ne 115842411 -or ($months | Measure-Object quarantine -Sum).Sum -ne 3753266 -or $amount -ne 338815859579) { throw 'Export differs from independently verified SQL totals.' }
$snapshot = [ordered]@{
    verifiedOn = '2026-10-18'; evidenceDate = '2026-10-17'; publicFeedConnected = $false
    publicationMode = 'verified_snapshot'; months = $months
}
$destination = Join-Path $PSScriptRoot '../src/_data/taxiProject.json'
[IO.File]::WriteAllText([IO.Path]::GetFullPath($destination), ($snapshot | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
Write-Output 'Validated 32 months against exact SQL totals. Public-safe snapshot generated.'
