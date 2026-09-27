# EED Admin tools (local only). Run from the repo root or anywhere.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
& node (Join-Path $here 'launcher.mjs') @args
