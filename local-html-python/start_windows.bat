@echo off
setlocal
cd /d "%~dp0"
echo OpenPose Media Skeleton Reader v0.3.1
where py >nul 2>nul
if %errorlevel%==0 (
  py app.py --open
) else (
  python app.py --open
)
pause
