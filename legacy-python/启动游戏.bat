@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    py -m venv .venv || goto error
)
".venv\Scripts\python.exe" -c "import cv2, mediapipe, PIL" >nul 2>&1
if errorlevel 1 (
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt || goto error
)
".venv\Scripts\python.exe" app.py
if errorlevel 1 goto error
exit /b 0
:error
echo.
echo 启动失败，请查看上方错误信息。
pause
exit /b 1
