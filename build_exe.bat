@echo off
REM Builds Relay_Trip_Analyzer.exe (single file, no console window)
REM Needs Python 3.9+ from python.org (tick "Add python.exe to PATH" when installing)
cd /d "%~dp0"
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python scripts\build_html.py || goto :error
python -m PyInstaller --noconfirm --onefile --windowed ^
  --name Relay_Trip_Analyzer ^
  --icon assets\icon.ico ^
  --add-data "dist\Relay_Trip_Analyzer.html;app" --add-data "sample_files;sample_files" ^
  sel_trip_analyzer.py || goto :error
dist\Relay_Trip_Analyzer.exe --selftest
echo.
echo Done. Your program is at: %~dp0dist\Relay_Trip_Analyzer.exe
pause
exit /b 0
:error
echo Build failed.
pause
exit /b 1
