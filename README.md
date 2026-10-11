# Student Attendance Management System

Built with Python, HTML, CSS, JavaScript and SQLite. It does not use Streamlit, Flask, Django, Node.js or third-party Python packages.

## Run on Windows
1. Install Python 3.10+ from https://www.python.org/downloads/.
2. Extract this ZIP file.
3. Open the extracted `student_attendance_web` folder in File Explorer.
4. Click the address bar, type `cmd`, and press Enter.
5. Run `python server.py`.
6. Open http://127.0.0.1:8000 in your browser.
7. Login with username `admin` and password `Admin@123`.
8. Use Change password to set your own password.

Stop the server with Ctrl+C in the terminal. The `attendance.db` file is created automatically and stores student and attendance records.

## Features
- Admin login and password change
- Add, search, and delete students
- Mark Present/Absent for a date, with editing for existing dates
- Attendance percentages and date-filtered reports
- CSV exports (Excel-compatible CSV)
- SQLite storage

## Important
This is a local learning/demo project. Do not expose it to the public internet or use for sensitive real student records without production-grade security, HTTPS, CSRF protections, and server hardening. Sessions are held in memory and will be cleared when the server restarts.

Optional initial credentials before the first run (PowerShell):
`$env:ATTENDANCE_ADMIN_USER = "teacher"`
`$env:ATTENDANCE_ADMIN_PASSWORD = "Choose-A-Strong-Password"`
