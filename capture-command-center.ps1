Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Width = 1440
$form.Height = 1200
$form.StartPosition = 'Manual'
$form.Left = -32000
$form.Top = -32000
$form.ShowInTaskbar = $false
$form.FormBorderStyle = 'None'
$browser = New-Object System.Windows.Forms.WebBrowser
$browser.Dock = 'Fill'
$browser.ScrollBarsEnabled = $false
$browser.ScriptErrorsSuppressed = $true
$form.Controls.Add($browser)
$completed = $false
$browser.Add_DocumentCompleted({ $script:completed = $true })
$form.Show()
$browser.Navigate('http://127.0.0.1:5173/')
$deadline = (Get-Date).AddSeconds(20)
while (-not $completed -and (Get-Date) -lt $deadline) {
  [System.Windows.Forms.Application]::DoEvents()
  Start-Sleep -Milliseconds 200
}
Start-Sleep -Seconds 3
[System.Windows.Forms.Application]::DoEvents()
$bitmap = New-Object System.Drawing.Bitmap 1440,1200
$form.DrawToBitmap($bitmap, [System.Drawing.Rectangle]::new(0,0,1440,1200))
$bitmap.Save('C:\Projects\Incident-Atlas-Pro\incident-command-center-home.png', [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
$form.Close()
