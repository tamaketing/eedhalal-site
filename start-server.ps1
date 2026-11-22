# Compatibility alias — see start-server.bat / tools\line\start-line.cmd.
# Both now start the same single stack: Internal API + Owner Console + LINE gateway.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $here 'tools\line\start-line.cmd') @args
$code = $LASTEXITCODE
exit $code
