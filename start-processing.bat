@echo off
cd /d "%~dp0"
echo Starting FullVideoTool's local processing service.
echo Keep this window open while using https://full-video-tool.vercel.app
echo.
call npm.cmd run server
pause
