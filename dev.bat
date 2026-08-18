@echo off
REM  רדאר קייט — תצוגה מקומית על פורט 3300
REM  .bat ולא .ps1 כי Group Policy חוסם סקריפטי PowerShell
set WRANGLER_SEND_METRICS=false
"%APPDATA%\npm\wrangler.cmd" pages dev public --port 3300
