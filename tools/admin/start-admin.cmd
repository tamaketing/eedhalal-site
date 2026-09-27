@echo off
setlocal
chcp 65001 >nul
title EED Admin - local only - closing this window stops the tools
if not defined EED_ADMIN_DATA_DIR (
  echo Private data: <repo>\demo\owner-set-builder ^(override with EED_ADMIN_DATA_DIR^)
)
node "%~dp0launcher.mjs" %*
