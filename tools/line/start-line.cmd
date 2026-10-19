@echo off
setlocal
chcp 65001 >nul
title EED HALAL - LINE auto-reply server - closing this window stops everything
node "%~dp0launcher.mjs" %*
