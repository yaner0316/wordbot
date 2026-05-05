@echo off
echo ===================================
echo   WordBot 开发环境启动脚本
echo ===================================
echo.

echo [1/2] 启动后端服务...
cd /d "%~dp0backend"
start "WordBot Backend" cmd /k "node server.js"

timeout /t 2 /nobreak > nul

echo [2/2] 启动前端服务...
cd /d "%~dp0WordBot"
start "WordBot Frontend" cmd /k "npm start"

echo.
echo ===================================
echo   启动完成！
echo ===================================
echo.
echo 后端服务：http://localhost:3000
echo 前端服务：请查看新的终端窗口
echo.
pause
