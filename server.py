import hashlib, hmac, json, os, secrets, sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, 'attendance.db')
SESSIONS = {}
USER = os.getenv('ATTENDANCE_ADMIN_USER', 'admin')
PASSWORD = os.getenv('ATTENDANCE_ADMIN_PASSWORD', 'Admin@123')

def connect():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    return db

def hash_password(password, salt=None):
    salt = salt or os.urandom(16)
    value = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 200000)
    return salt.hex() + ':' + value.hex()

def verify(password, saved):
    try:
        salt, expected = saved.split(':')
        actual = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 200000).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False

def init_db():
    with connect() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS admins(username TEXT PRIMARY KEY, password_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS students(student_id TEXT PRIMARY KEY, name TEXT NOT NULL, department TEXT NOT NULL, year TEXT NOT NULL, email TEXT DEFAULT '');
        CREATE TABLE IF NOT EXISTS attendance(id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, attendance_date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('Present','Absent')), UNIQUE(student_id,attendance_date), FOREIGN KEY(student_id) REFERENCES students(student_id) ON DELETE CASCADE);
        ''')
        if not db.execute('SELECT 1 FROM admins WHERE username=?', (USER,)).fetchone():
            db.execute('INSERT INTO admins VALUES (?,?)', (USER, hash_password(PASSWORD)))

def json_body(handler):
    length = int(handler.headers.get('Content-Length', '0'))
    if length > 1000000: raise ValueError('Request too large')
    return json.loads(handler.rfile.read(length).decode() or '{}')

class Handler(BaseHTTPRequestHandler):
    def send_data(self, code, data, content_type='application/json; charset=utf-8', headers=None):
        body = data if isinstance(data, bytes) else json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(body)
    def session(self):
        token = None
        for part in self.headers.get('Cookie','').split(';'):
            k,_,v = part.strip().partition('=')
            if k == 'attendance_session': token = v
        return SESSIONS.get(token), token
    def auth(self):
        session,_ = self.session()
        if not session: self.send_data(401, {'error':'Please log in first.'}); return False
        return True
    def do_GET(self):
        path = urlparse(self.path).path
        files = {'/':'index.html','/style.css':'static/style.css','/app.js':'static/app.js'}
        if path in files:
            types = {'/':'text/html; charset=utf-8','/style.css':'text/css; charset=utf-8','/app.js':'application/javascript; charset=utf-8'}
            try:
                with open(os.path.join(BASE, files[path]),'rb') as f: self.send_data(200,f.read(),types[path])
            except OSError: self.send_data(404, {'error':'File not found'})
            return
        if path == '/api/me':
            session,_ = self.session(); self.send_data(200, {'loggedIn':bool(session),'username':session['username'] if session else None}); return
        if path.startswith('/api/') and not self.auth(): return
        params = parse_qs(urlparse(self.path).query)
        if path == '/api/students':
            with connect() as db: rows = db.execute('SELECT student_id,name,department,year,email FROM students ORDER BY student_id').fetchall()
            self.send_data(200,[dict(r) for r in rows])
        elif path in ('/api/attendance','/api/summary'):
            start=params.get('start',['0001-01-01'])[0]; end=params.get('end',['9999-12-31'])[0]
            with connect() as db:
                if path == '/api/attendance':
                    rows=db.execute('''SELECT a.attendance_date AS date,s.student_id,s.name,s.department,s.year,a.status FROM attendance a JOIN students s ON s.student_id=a.student_id WHERE a.attendance_date>=? AND a.attendance_date<=? ORDER BY a.attendance_date DESC,s.student_id''',(start,end)).fetchall()
                    result=[dict(r) for r in rows]
                else:
                    rows=db.execute('''SELECT s.student_id,s.name,SUM(CASE WHEN a.status='Present' THEN 1 ELSE 0 END) present,SUM(CASE WHEN a.status='Absent' THEN 1 ELSE 0 END) absent,COUNT(a.id) total FROM students s LEFT JOIN attendance a ON a.student_id=s.student_id AND a.attendance_date>=? AND a.attendance_date<=? GROUP BY s.student_id,s.name ORDER BY s.student_id''',(start,end)).fetchall()
                    result=[]
                    for r in rows:
                        x=dict(r); x['present']=x['present'] or 0; x['absent']=x['absent'] or 0; x['total']=x['total'] or 0
                        x['percentage']=round(x['present']/x['total']*100,2) if x['total'] else 0
                        result.append(x)
            self.send_data(200,result)
        else: self.send_data(404, {'error':'API endpoint not found'})
    def do_POST(self):
        path=urlparse(self.path).path
        try: data=json_body(self)
        except Exception: self.send_data(400, {'error':'Invalid request data'}); return
        if path == '/api/login':
            username=str(data.get('username','')).strip(); password=str(data.get('password',''))
            with connect() as db: row=db.execute('SELECT password_hash FROM admins WHERE username=?',(username,)).fetchone()
            if row and verify(password,row['password_hash']):
                token=secrets.token_urlsafe(32); SESSIONS[token]={'username':username}
                self.send_data(200,{'message':'Login successful' },headers={'Set-Cookie':f'attendance_session={token}; HttpOnly; SameSite=Strict; Path=/'})
            else: self.send_data(401,{'error':'Incorrect username or password'})
            return
        if path == '/api/logout':
            _,token=self.session()
            if token: SESSIONS.pop(token,None)
            self.send_data(200,{'message':'Logged out'},headers={'Set-Cookie':'attendance_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'}); return
        if not self.auth(): return
        if path == '/api/students':
            sid=str(data.get('student_id','')).strip(); name=str(data.get('name','')).strip(); dept=str(data.get('department','')).strip(); year=str(data.get('year','')).strip(); email=str(data.get('email','')).strip()
            if not sid or not name or not dept or not year: self.send_data(400,{'error':'Student ID, name, department, and year are required'}); return
            if email and ('@' not in email or '.' not in email.split('@')[-1]): self.send_data(400,{'error':'Enter a valid email or leave it blank'}); return
            try:
                with connect() as db: db.execute('INSERT INTO students VALUES (?,?,?,?,?)',(sid,name,dept,year,email))
                self.send_data(201,{'message':'Student added'})
            except sqlite3.IntegrityError: self.send_data(409,{'error':'That Student ID already exists'})
        elif path == '/api/delete-student':
            with connect() as db: cur=db.execute('DELETE FROM students WHERE student_id=?',(str(data.get('student_id','')),))
            self.send_data(200 if cur.rowcount else 404,{'message':'Student deleted'} if cur.rowcount else {'error':'Student not found'})
        elif path == '/api/attendance':
            sid=str(data.get('student_id','')).strip(); day=str(data.get('date','')).strip(); status=str(data.get('status','')).strip()
            try:
                from datetime import date
                if date.fromisoformat(day).isoformat()!=day: raise ValueError()
            except ValueError: self.send_data(400,{'error':'Date must be YYYY-MM-DD'}); return
            if status not in ('Present','Absent'): self.send_data(400,{'error':'Status must be Present or Absent'}); return
            try:
                with connect() as db: db.execute('''INSERT INTO attendance(student_id,attendance_date,status) VALUES(?,?,?) ON CONFLICT(student_id,attendance_date) DO UPDATE SET status=excluded.status''',(sid,day,status))
                self.send_data(200,{'message':'Attendance saved'})
            except sqlite3.IntegrityError: self.send_data(404,{'error':'Student not found'})
        elif path == '/api/change-password':
            session,_=self.session(); current=str(data.get('current','')); new=str(data.get('new',''))
            if len(new)<8: self.send_data(400,{'error':'New password must be at least 8 characters'}); return
            with connect() as db:
                row=db.execute('SELECT password_hash FROM admins WHERE username=?',(session['username'],)).fetchone()
                if not row or not verify(current,row['password_hash']): self.send_data(400,{'error':'Current password is incorrect'}); return
                db.execute('UPDATE admins SET password_hash=? WHERE username=?',(hash_password(new),session['username']))
            self.send_data(200,{'message':'Password changed'})
        else: self.send_data(404,{'error':'API endpoint not found'})
    def log_message(self, fmt, *args): print('%s - %s'%(self.address_string(),fmt%args))

if __name__ == '__main__':
    init_db()
    print('Student Attendance System: http://127.0.0.1:8000')
    print(f'Initial login: {USER} / {PASSWORD}')
    print('Press Ctrl+C to stop.')
    port = int(os.environ.get("PORT", 8000))
    print(f"Student Attendance System: port {port}")
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
