@echo off
REM  רדאר קייט — תצוגה מקומית על פורט 3300, כולל /api/obs החי.
REM  .bat ולא .ps1 כי Group Policy חוסם סקריפטי PowerShell.
node "%~dp0dev-server.js"
