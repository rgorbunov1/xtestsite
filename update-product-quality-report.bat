@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Отчет по товарам — без синхронизации сайта
echo Создание Excel-отчета. Сайт и файлы на сервер не синхронизируются.
node scripts/create-product-quality-report.js
if errorlevel 1 (
    echo ОШИБКА: отчет не обновлен.
    exit /b 1
)
echo Готово. Отчет: reports\product-quality-report.xlsx
