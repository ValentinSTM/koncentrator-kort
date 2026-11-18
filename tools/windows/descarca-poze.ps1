# Descarca fotografiile din exportul Google My Maps (KMZ sau KML).
# Porneste-l cu dublu-clic pe "Descarca-poze.bat". Nu trebuie instalat nimic (PowerShell vine cu Windows).
# Nu foloseste parole, cookie-uri sau login Google. Daca o fotografie cere login,
# o lista HTML iti arata exact ce concentrator sa deschizi si ce nume sa dai fisierului.
param([string]$Sursa = "")

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try { [System.Net.WebRequest]::DefaultWebProxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials } catch {}
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Web

$aici = Split-Path -Parent $MyInvocation.MyCommand.Path

# ---------- 1. alege fisierul ----------
if (-not $Sursa) {
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Title = "Alege exportul din Google My Maps (.kmz sau .kml)"
    $dlg.Filter = "Export My Maps (*.kmz;*.kml)|*.kmz;*.kml|Toate fisierele (*.*)|*.*"
    $dlg.InitialDirectory = [Environment]::GetFolderPath("UserProfile") + "\Downloads"
    if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { Write-Host "Anulat."; exit 1 }
    $Sursa = $dlg.FileName
}
Write-Host "Fisier: $Sursa"

# ---------- 2. citeste KML (din KMZ = arhiva zip) ----------
if ($Sursa.ToLower().EndsWith(".kmz")) {
    $zip = [IO.Compression.ZipFile]::OpenRead($Sursa)
    try {
        $intrare = $zip.Entries | Where-Object { $_.FullName -eq "doc.kml" } | Select-Object -First 1
        if (-not $intrare) { $intrare = $zip.Entries | Where-Object { $_.FullName.ToLower().EndsWith(".kml") } | Select-Object -First 1 }
        $sr = New-Object IO.StreamReader($intrare.Open(), [Text.Encoding]::UTF8)
        $text = $sr.ReadToEnd(); $sr.Close()
    } finally { $zip.Dispose() }
} else {
    $text = [IO.File]::ReadAllText($Sursa, [Text.Encoding]::UTF8)
}
$xml = New-Object Xml.XmlDocument
$xml.LoadXml($text)
$ns = New-Object Xml.XmlNamespaceManager($xml.NameTable)
$ns.AddNamespace("k", "http://www.opengis.net/kml/2.2")

if ($xml.SelectNodes("//k:Placemark", $ns).Count -eq 0) {
    [System.Windows.Forms.MessageBox]::Show("Fisierul nu contine locatii. Probabil e un export cu 'Keep data up to date with network link'. Exporta din nou fara aceasta optiune.", "Export gol") | Out-Null
    exit 1
}

# ---------- 3. gaseste toate fotografiile ----------
$lista = New-Object System.Collections.ArrayList
foreach ($pm in $xml.SelectNodes("//k:Placemark", $ns)) {
    $nume = ""; $n = $pm.SelectSingleNode("k:name", $ns); if ($n) { $nume = $n.InnerText.Trim() }
    $id = $nume -replace '\.0$', ''
    $id = $id -replace '[^\w\-]', '_'
    if (-not $id) { $id = "fara_id" }
    $strat = ""; $f = $pm.SelectSingleNode("ancestor::k:Folder[1]/k:name", $ns); if ($f) { $strat = $f.InnerText.Trim() }
    $loc = ""; $d = $pm.SelectSingleNode("k:ExtendedData/k:Data[@name='ADR']/k:value", $ns); if ($d) { $loc = $d.InnerText.Trim() }
    $urls = @()
    $m = $pm.SelectSingleNode("k:ExtendedData/k:Data[@name='gx_media_links']/k:value", $ns)
    if ($m) { $urls += ($m.InnerText -split '\s+' | Where-Object { $_ -match '^https?://' }) }
    $desc = $pm.SelectSingleNode("k:description", $ns)
    if ($desc) { foreach ($x in [regex]::Matches($desc.InnerText, '<img[^>]+src="([^"]+)"')) { $urls += [System.Web.HttpUtility]::HtmlDecode($x.Groups[1].Value) } }
    $vazute = @{}; $i = 0
    foreach ($u in $urls) {
        $cheie = ($u -split '\?')[0]
        if ($vazute.ContainsKey($cheie)) { continue }
        $vazute[$cheie] = 1; $i++
        [void]$lista.Add([pscustomobject]@{ Id = $id; Nr = $i; Strat = $strat; Loc = $loc; Url = $u; Status = ""; Fisier = ""; Sha256 = ""; Eroare = "" })
    }
}
$nrConc = ($lista | Select-Object -ExpandProperty Id -Unique).Count
Write-Host ("Gasite {0} fotografii la {1} locatii." -f $lista.Count, $nrConc)

# ---------- 4. descarca (fara login; reluarea sare peste ce exista deja) ----------
$baza = Join-Path (Split-Path -Parent $Sursa) "poze_concentratoare"
New-Item -ItemType Directory -Force -Path $baza | Out-Null
$k = 0
foreach ($p in $lista) {
    $k++
    $dir = Join-Path $baza $p.Id
    $existent = Get-ChildItem -Path $dir -Filter ("{0}_{1}.*" -f $p.Id, $p.Nr) -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existent) {
        $p.Status = "deja_descarcata"; $p.Fisier = $existent.FullName; $p.Sha256 = (Get-FileHash $existent.FullName -Algorithm SHA256).Hash
        continue
    }
    $url = $p.Url -replace 'authuser=\d+&?', ''
    $url = $url -replace '[?&]$', ''
    $tmp = Join-Path $baza "_temp.download"
    $ok = $false; $pauza = 2
    for ($incercare = 1; $incercare -le 4 -and -not $ok; $incercare++) {
        try {
            $r = Invoke-WebRequest -Uri $url -OutFile $tmp -PassThru -UseBasicParsing -TimeoutSec 60 -MaximumRedirection 5
            $tip = "" + $r.Headers["Content-Type"]
            if ($tip -notlike "image/*") { $p.Status = "cere_login"; $p.Eroare = "raspuns $tip (nu e imagine)"; break }
            $ext = ".jpg"
            if ($tip -like "image/png*") { $ext = ".png" } elseif ($tip -like "image/webp*") { $ext = ".webp" } elseif ($tip -like "image/gif*") { $ext = ".gif" }
            New-Item -ItemType Directory -Force -Path $dir | Out-Null
            $tinta = Join-Path $dir ("{0}_{1}{2}" -f $p.Id, $p.Nr, $ext)
            Move-Item -Force $tmp $tinta
            $p.Status = "ok"; $p.Fisier = $tinta; $p.Sha256 = (Get-FileHash $tinta -Algorithm SHA256).Hash; $ok = $true
        } catch {
            $cod = 0
            try { $cod = [int]$_.Exception.Response.StatusCode } catch {}
            if ($cod -eq 429 -or $cod -ge 500 -or $cod -eq 0) {
                $p.Status = "eroare_retea"; $p.Eroare = $_.Exception.Message
                Start-Sleep -Seconds $pauza; $pauza = $pauza * 2
            } else {
                if ($cod -in 401, 403) { $p.Status = "cere_login" } else { $p.Status = "inaccesibila" }
                $p.Eroare = "HTTP $cod"; break
            }
        }
    }
    if (Test-Path $tmp) { Remove-Item -Force $tmp }
    Write-Host ("[{0}/{1}] {2} foto {3}: {4}" -f $k, $lista.Count, $p.Id, $p.Nr, $p.Status)
    Start-Sleep -Milliseconds 500
}

# ---------- 5. raport CSV + pagina HTML pentru ce nu s-a putut descarca ----------
$csv = Join-Path $baza "raport_poze.csv"
$lista | Select-Object Id, Nr, Strat, Status, Fisier, Sha256, Eroare | Export-Csv -Path $csv -NoTypeInformation -Delimiter ";" -Encoding UTF8

function HtmlEnc([string]$s) { return [System.Web.HttpUtility]::HtmlEncode($s) }
$sb = New-Object Text.StringBuilder
[void]$sb.Append('<!DOCTYPE html><html lang="ro"><head><meta charset="utf-8"><title>Poze concentratoare</title><style>body{font:16px system-ui,sans-serif;margin:16px;background:#f4f6f7}h1{font-size:20px}.c{background:#fff;border:1px solid #ccd;border-radius:10px;padding:12px;margin:10px 0}.c h2{margin:0 0 4px;font-size:18px}.f{display:inline-block;margin:6px 10px 6px 0;text-align:center;vertical-align:top}.f img{max-width:260px;max-height:200px;display:block;border-radius:6px;background:#ddd}.ok{color:#1b7a35;font-weight:700}.no{color:#b00;font-weight:700}code{background:#eef;padding:1px 4px}</style></head><body>')
$okN = @($lista | Where-Object { $_.Status -eq "ok" -or $_.Status -eq "deja_descarcata" }).Count
[void]$sb.Append("<h1>Poze concentratoare: $okN din $($lista.Count) descarcate automat</h1>")
[void]$sb.Append("<p>Pentru cele marcate cu rosu: fii logat in Google in acest browser, apasa <b>Deschide originalul</b>, apoi <b>Ctrl+S</b> si salveaza cu numele aratat, in folderul <code>poze_concentratoare\ID</code>. Apoi porneste din nou scriptul: le recunoaste si le trece in raport.</p>")
foreach ($g in ($lista | Group-Object Id)) {
    $prim = $g.Group[0]
    [void]$sb.Append("<div class='c'><h2>" + (HtmlEnc $g.Name) + "</h2><div>" + (HtmlEnc $prim.Loc) + " <small>(" + (HtmlEnc $prim.Strat) + ")</small></div>")
    foreach ($p in $g.Group) {
        $nume = "{0}_{1}.jpg" -f $p.Id, $p.Nr
        if ($p.Status -eq "ok" -or $p.Status -eq "deja_descarcata") {
            $src = "file:///" + ($p.Fisier -replace '\\', '/')
            [void]$sb.Append("<div class='f'><img src='" + (HtmlEnc $src) + "' alt=''><span class='ok'>salvata: " + (HtmlEnc (Split-Path -Leaf $p.Fisier)) + "</span></div>")
        } else {
            [void]$sb.Append("<div class='f'><img src='" + (HtmlEnc $p.Url) + "' alt='(se incarca doar daca esti logat)'><a href='" + (HtmlEnc $p.Url) + "' target='_blank' rel='noopener'>Deschide originalul</a><br><span class='no'>salveaza ca: " + (HtmlEnc $nume) + "</span></div>")
        }
    }
    [void]$sb.Append("</div>")
}
[void]$sb.Append("</body></html>")
$html = Join-Path $baza "poze_lista.html"
[IO.File]::WriteAllText($html, $sb.ToString(), [Text.Encoding]::UTF8)

$fail = $lista.Count - $okN
Write-Host ""
Write-Host "Gata. Descarcate: $okN. Nedescarcate: $fail."
Write-Host "Folder: $baza"
Start-Process $html
Start-Process $baza
