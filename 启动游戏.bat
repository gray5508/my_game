@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1 || goto missing_node
if not exist "node_modules\vite" (
    call npm install || goto error
)
call npm run dev -- --open
if errorlevel 1 goto error
exit /b 0
:missing_node
echo 请先安装 Node.js 20.19+ 或 22.12+，然后重新运行。
goto error
:error
echo.
echo 启动失败，请查看上方错误信息。
pause
exit /b 1
