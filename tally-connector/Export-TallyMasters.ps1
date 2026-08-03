# =====================================================================
#  Export-TallyMasters.ps1   (READ-ONLY)
#  Pulls Parties, Stock Items and Price Levels OUT of TallyPrime.
#  It only READS from Tally — it never writes or changes anything.
#
#  HOW TO RUN (on the Tally-on-Cloud desktop):
#    1. Make sure TallyPrime is open with your company loaded, and that
#       Tally is acting as a server on port 9000 (see README.txt).
#    2. Right-click this file  ->  "Run with PowerShell"
#       (or open PowerShell and run:  .\Export-TallyMasters.ps1 )
#    3. Read the summary it prints, and send it back to the developer.
#       Full details are saved next to this script in a folder named
#       TallyExport_<timestamp>.
# =====================================================================

param(
    # Where Tally's gateway is. Default is this same machine (run on the RDP server).
    # If you were given a specific address/port to reach Tally, pass it, e.g.:
    #   .\Export-TallyMasters.ps1 -TallyHost 192.168.1.50 -TallyPort 9000
    [string]$TallyHost = 'localhost',
    [int]$TallyPort = 9000
)

$ErrorActionPreference = 'Stop'
$TallyUrl = "http://$($TallyHost):$($TallyPort)"

# --- output folder -------------------------------------------------
$stamp   = Get-Date -Format 'yyyyMMdd_HHmmss'
$outDir  = Join-Path $PSScriptRoot ("TallyExport_" + $stamp)
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  TallyPrime master export  (read-only)" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "Tally address : $TallyUrl"
Write-Host "Saving to     : $outDir"
Write-Host ""

# --- helper: build a Collection export request ---------------------
function New-CollectionRequest {
    param([string]$Name, [string]$Type, [string]$Fetch)
@"
<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>$Name</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>`$`$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="$Name" ISMODIFY="No" ISFIXED="No" ISINITIALIZE="No" ISOPTION="No" ISINTERNAL="No">
      <TYPE>$Type</TYPE>
      <FETCH>$Fetch</FETCH>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>
"@
}

# --- helper: send a request to Tally -------------------------------
function Invoke-Tally {
    param([string]$Xml)
    return Invoke-WebRequest -Uri $TallyUrl -Method Post -Body $Xml `
        -ContentType 'text/xml; charset=utf-8' -UseBasicParsing -TimeoutSec 60
}

# --- preflight: is Tally reachable? --------------------------------
$companyReq = @"
<ENVELOPE>
 <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>Cmp</ID></HEADER>
 <BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>`$`$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
 <TDL><TDLMESSAGE><COLLECTION NAME="Cmp" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY>
</ENVELOPE>
"@

try {
    $ping = Invoke-Tally -Xml $companyReq
} catch {
    Write-Host "COULD NOT CONNECT TO TALLY." -ForegroundColor Red
    Write-Host ""
    Write-Host "Checklist:" -ForegroundColor Yellow
    Write-Host "  * TallyPrime is open with a company loaded."
    Write-Host "  * Tally is acting as a server on port 9000:"
    Write-Host "      F1 (Help) > Settings > Connectivity >"
    Write-Host "      Client/Server configuration > TallyPrime acts as = Server, Port = 9000"
    Write-Host "  * Then re-run this script."
    Write-Host ""
    Write-Host ("Technical detail: " + $_.Exception.Message) -ForegroundColor DarkGray
    Read-Host "Press Enter to close"
    exit 1
}

$companies = [regex]::Matches($ping.Content, '<NAME>(.*?)</NAME>') | ForEach-Object { $_.Groups[1].Value }
$companyName = if ($companies.Count) { $companies[0] } else { "(unknown)" }
Write-Host ("Connected. Active company: " + $companyName) -ForegroundColor Green
Write-Host ""

# --- the three master pulls ----------------------------------------
$jobs = @(
    @{ Key='parties';     Label='Parties (Ledgers)';   Type='Ledger';
       Fetch='NAME, PARENT, LEDGERMOBILE, LEDGERPHONE, EMAIL, PARTYGSTIN, GSTREGISTRATIONTYPE, STATENAME, COUNTRYNAME';
       Tag='LEDGER' }
    @{ Key='items';       Label='Stock Items';         Type='StockItem';
       Fetch='NAME, PARENT, BASEUNITS, GSTAPPLICABLE, HSNCODE, GSTHSNNAME, OPENINGRATE';
       Tag='STOCKITEM' }
    @{ Key='pricelevels'; Label='Price Levels';        Type='PriceLevel';
       Fetch='NAME';
       Tag='PRICELEVEL' }
)

$summary = New-Object System.Collections.ArrayList
[void]$summary.Add("TallyPrime master export summary")
[void]$summary.Add("Company : $companyName")
[void]$summary.Add("When    : " + (Get-Date))
[void]$summary.Add("")

foreach ($j in $jobs) {
    Write-Host ("Fetching " + $j.Label + " ...") -NoNewline
    try {
        $xml = New-CollectionRequest -Name $j.Key -Type $j.Type -Fetch $j.Fetch
        $resp = Invoke-Tally -Xml $xml
        $content = $resp.Content
        $file = Join-Path $outDir ($j.Key + ".xml")
        # save raw response for the developer
        [System.IO.File]::WriteAllText($file, $content, [System.Text.Encoding]::UTF8)

        $count = ([regex]::Matches($content, ('<' + $j.Tag + '\b'))).Count
        Write-Host ("  " + $count + " found") -ForegroundColor Green

        # show a few sample names
        $names = [regex]::Matches($content, '<NAME[^>]*>(.*?)</NAME>') |
                 ForEach-Object { $_.Groups[1].Value } | Select-Object -First 5
        [void]$summary.Add(($j.Label + ": " + $count))
        foreach ($n in $names) { [void]$summary.Add("    - " + $n) }
        if ($count -gt 5) { [void]$summary.Add("    ... (" + ($count-5) + " more)") }
        [void]$summary.Add("")
    } catch {
        Write-Host "  FAILED" -ForegroundColor Red
        [void]$summary.Add(($j.Label + ": FAILED - " + $_.Exception.Message))
        [void]$summary.Add("")
    }
}

# --- write + show summary ------------------------------------------
$summaryPath = Join-Path $outDir "SUMMARY.txt"
$summary -join [Environment]::NewLine | Set-Content -Path $summaryPath -Encoding UTF8

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  DONE - summary below" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Get-Content $summaryPath | Write-Host
Write-Host ""
Write-Host ("Files saved in: " + $outDir) -ForegroundColor Yellow
Write-Host "Send the developer the SUMMARY.txt (and the .xml files if you can)." -ForegroundColor Yellow
Write-Host ""
Read-Host "Press Enter to close"
