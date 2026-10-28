@echo off
REM Builds SEL_Trip_Analyzer.exe (single file, no console window)
REM Needs Python 3.9+ from python.org (tick "Add python.exe to PATH" when installing)
cd /d "%~dp0"
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m PyInstaller --noconfirm --onefile --windowed ^
  --name SEL_Trip_Analyzer ^
  --collect-all tkinterdnd2 ^
  --collect-data sv_ttk --collect-data docx --collect-all reportlab --hidden-import olefile ^
  --icon assets\icon.ico --add-data "assets\icon.ico;assets" --add-data "assets\icon.png;assets" --add-data "sample_files;sample_files" ^
  sel_trip_analyzer.py
echo.
echo Done. Your program is at: %~dp0dist\SEL_Trip_Analyzer.exe
pause
