const $ = (id) => document.getElementById(id);
let students = [],
  reportDetails = [],
  reportSummary = [];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[c])
  );

function msg(id, text, type = 'success') {
  $(id).textContent = text;
  $(id).className = 'message ' + type;
}

async function api(url, options = {}) {
  const r = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || 'Request failed');
  return d;
}

function signedIn(yes, user = 'admin') {
  $('loginPage').classList.toggle('hidden', yes);
  $('appPage').classList.toggle('hidden', !yes);$('adminName').textContent = user;
}

function nav(page) {
  document
    .querySelectorAll('.page')
    .forEach((p) => p.classList.add('hidden'));
  $(page + 'Page').classList.remove('hidden');
  document
    .querySelectorAll('[data-page]')
    .forEach((b) =>
      b.classList.toggle('active', b.dataset.page === page)
    );
  $('pageTitle').textContent = {
    dashboard: 'Dashboard',
    students: 'Student management',
    mark: 'Mark attendance',
    reports: 'Reports & exports',
    settings: 'Settings',
  }[page];

  if (page === 'dashboard') dashboard();
  if (page === 'students') loadStudents();
  if (page === 'mark') loadMark();
  if (page === 'reports') loadReports();
}

document
  .querySelectorAll('[data-page]')
  .forEach((b) => b.addEventListener('click', () => nav(b.dataset.page)));

document
  .querySelectorAll('[data-go]')
  .forEach((b) => b.addEventListener('click', () => nav(b.dataset.go)));

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('username').value,
        password: $('password').value,
      }),
    });
    signedIn(true, $('username').value.trim());$('loginForm').reset();
    nav('dashboard');
  } catch (err) {
    msg('loginMessage', err.message, 'error');
  }
});

$('logoutButton').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST', body: '{}' });
  } catch {}
  signedIn(false);
});

async function loadStudents() {
  try {
    students = await api('/api/students');
    renderStudents();
    renderMarkList();
  } catch (e) {
    msg('globalMessage', e.message, 'error');
  }
}

function renderStudents() {
  const q = $('studentSearch').value.toLowerCase();
  const list = students.filter((s) =>
    Object.values(s).some((v) =>
      String(v || '')
        .toLowerCase()
        .includes(q)
    )
  );

  $('studentCount').textContent = students.length;
  $('studentRows').innerHTML = list.length
    ? list
        .map(
          (s) =>
            `<tr><td><b>${esc(s.student_id)}</b></td><td>${esc(
              s.name
            )}</td><td>${esc(s.department)}</td><td>${esc(
              s.year
            )}</td><td>${esc(
              s.email || '—'
            )}</td><td><button class="delete-button" data-delete="${esc(
              s.student_id
            )}">Delete</button></td></tr>`
        )
        .join('')
    : `<tr><td colspan="6" class="empty-row">${
        students.length ? 'No matching students' : 'No students added yet'
      }</td></tr>`;

  document.querySelectorAll('[data-delete]').forEach(
    (b) =>
      (b.onclick = async () => {
        if (
          !confirm(`Delete ${b.dataset.delete} and their attendance history?`)
        )
          return;
        try {
          await api('/api/delete-student', {
            method: 'POST',
            body: JSON.stringify({ student_id: b.dataset.delete }),
          });
          await loadStudents();
          msg('globalMessage', 'Student deleted');
        } catch (e) {
          msg('globalMessage', e.message, 'error');
        }
      })
  );
}

$('studentSearch').addEventListener('input', renderStudents);

$('studentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/students', {
      method: 'POST',
      body: JSON.stringify({
        student_id: $('studentId').value.trim(),
        name: $('studentName').value.trim(),
        department: $('department').value.trim(),
        year: $('year').value,
        email: $('email').value.trim(),
      }),
    });
    $('studentForm').reset();
    msg('studentMessage', 'Student added successfully');
    await loadStudents();
  } catch (err) {
    msg('studentMessage', err.message, 'error');
  }
});

async function dashboard() {
  try {
    students = await api('/api/students');
    const rows = await api('/api/attendance');

    $('totalStudents').textContent = students.length;
    $('totalEntries').textContent = rows.length;
    $('presentEntries').textContent = rows.filter(
      (r) => r.status === 'Present'
    ).length;
    $('absentEntries').textContent = rows.filter(
      (r) => r.status === 'Absent'
    ).length;

    $('recentRows').innerHTML = rows.length
      ? rows
          .slice(0, 8)
          .map(
            (r) =>
              `<tr><td>${esc(r.date)}</td><td>${esc(r.name)}</td><td>${esc(
                r.student_id
              )}</td><td>${esc(r.department)}</td><td><span class="status-pill ${
                r.status === 'Present' ? 'present' : 'absent'
              }">${esc(r.status)}</span></td></tr>`
          )
          .join('')
      : '<tr><td colspan="5" class="empty-row">No attendance records yet.</td></tr>';
  } catch (e) {
    msg('globalMessage', e.message, 'error');
  }
}

async function loadMark() {
  $('attendanceDate').value =$('attendanceDate').value || today();
  await loadStudents();
  await renderMarkList();
}

async function renderMarkList() {
  if (!$('attendanceList')) return;
  if (!students.length) {
    $('attendanceList').innerHTML = '<div class="empty-row">Add students first.</div>';
    counts();
    return;
  }

  let old = [];
  try {
    let d = $('attendanceDate').value || today();
    old = await api(`/api/attendance?start=${d}&end=${d}`);
  } catch {}

  const map = Object.fromEntries(old.map((r) => [r.student_id, r.status]));

  $('attendanceList').innerHTML = students
    .map((s) => {
      let st = map[s.student_id] || 'Present';
      return `<div class="attendance-row"><div class="student-meta"><b>${esc(
        s.name
      )}</b><small>${esc(s.student_id)} · ${esc(
        s.department
      )}</small></div><div class="choice-group"><label><input type="radio" name="st_${esc(
        s.student_id
      )}" value="Present" ${
        st === 'Present' ? 'checked' : ''
      }> Present</label><label><input type="radio" name="st_${esc(
        s.student_id
      )}" value="Absent" ${
        st === 'Absent' ? 'checked' : ''
      }> Absent</label></div></div>`;
    })
    .join('');

  document
    .querySelectorAll('#attendanceList input')
    .forEach((x) => x.addEventListener('change', counts));
  counts();
}

function counts() {
  let p = 0,
    a = 0;
  students.forEach((s) => {
    let x = document.querySelector(
      `input[name="st_${CSS.escape(s.student_id)}"]:checked`
    );
    if (x?.value === 'Present') p++;
    if (x?.value === 'Absent') a++;
  });
  $('markedPresent').textContent = p;
  $('markedAbsent').textContent = a;
}

$('attendanceDate').addEventListener('change', renderMarkList);

$('saveAttendance').addEventListener('click', async () => {
  if (!students.length) {
    msg('attendanceMessage', 'Add students first', 'error');
    return;
  }
  try {
    for (const s of students) {
      const x = document.querySelector(
        `input[name="st_${CSS.escape(s.student_id)}"]:checked`
      );
      if (x)
        await api('/api/attendance', {
          method: 'POST',
          body: JSON.stringify({
            student_id: s.student_id,
            date: $('attendanceDate').value,
            status: x.value,
          }),
        });
    }
    msg('attendanceMessage', 'Attendance saved successfully');
    await dashboard();
    await renderMarkList();
  } catch (e) {
    msg('attendanceMessage', e.message, 'error');
  }
});

function dates() {
  return {
    start: $('reportStart').value || '0001-01-01',
    end: $('reportEnd').value || today(),
  };
}

async function loadReports() {
  let { start, end } = dates();
  if (start > end) {
    msg('globalMessage', 'From date must be on or before To date', 'error');
    return;
  }
  try {
    [reportDetails, reportSummary] = await Promise.all([
      api(`/api/attendance?start=${start}&end=${end}`),
      api(`/api/summary?start=${start}&end=${end}`),
    ]);

    $('reportEntries').textContent = reportDetails.length;
    $('reportPresent').textContent = reportDetails.filter(
      (r) => r.status === 'Present'
    ).length;
    $('reportAbsent').textContent = reportDetails.filter(
      (r) => r.status === 'Absent'
    ).length;

    $('summaryRows').innerHTML = reportSummary.length
      ? reportSummary
          .map(
            (s) =>
              `<tr><td>${esc(s.student_id)}</td><td>${esc(s.name)}</td><td>${
                s.present
              }</td><td>${s.absent}</td><td>${s.total}</td><td><b>${s.percentage.toFixed(
                2
              )}%</b></td></tr>`
          )
          .join('')
      : '<tr><td colspan="6" class="empty-row">No students found.</td></tr>';

    $('detailRows').innerHTML = reportDetails.length
      ? reportDetails
          .map(
            (r) =>
              `<tr><td>${esc(r.date)}</td><td>${esc(r.student_id)}</td><td>${esc(
                r.name
              )}</td><td>${esc(r.department)}</td><td>${esc(
                r.year
              )}</td><td><span class="status-pill ${
                r.status === 'Present' ? 'present' : 'absent'
              }">${esc(r.status)}</span></td></tr>`
          )
          .join('')
      : '<tr><td colspan="6" class="empty-row">No records for this date range.</td></tr>';
  } catch (e) {
    msg('globalMessage', e.message, 'error');
  }
}

$('applyFilters').addEventListener('click', loadReports);

function csv(filename, rows, cols) {
  const quote = (x) => '"' + String(x ?? '').replace(/"/g, '""') + '"';
  const text =
    '\ufeff' +
    [
      cols.map((c) => quote(c.label)).join(','),
      ...rows.map((r) => cols.map((c) => quote(r[c.key])).join(',')),
    ].join('\r\n');
  const url = URL.createObjectURL(
    new Blob([text], { type: 'text/csv;charset=utf-8;' })
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const detailCols = [
  { key: 'date', label: 'Date' },
  { key: 'student_id', label: 'Student ID' },
  { key: 'name', label: 'Name' },
  { key: 'department', label: 'Department' },
  { key: 'year', label: 'Year' },
  { key: 'status', label: 'Status' },
];

$('summaryCsv').addEventListener('click', () =>
  csv(
    'attendance_summary.csv',
    reportSummary.map((s) => ({ ...s, percentage: s.percentage + '%' })),
    [
      { key: 'student_id', label: 'Student ID' },
      { key: 'name', label: 'Name' },
      { key: 'present', label: 'Present' },
      { key: 'absent', label: 'Absent' },
      { key: 'total', label: 'Total' },
      { key: 'percentage', label: 'Attendance %' },
    ]
  )
);

$('detailCsv').addEventListener('click', () =>
  csv('attendance_records.csv', reportDetails, detailCols)
);

$('detailExcel').addEventListener('click', () =>
  csv('attendance_records_excel.csv', reportDetails, detailCols)
);

$('passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('newPassword').value !==$('confirmPassword').value) {
    msg('passwordMessage', 'New passwords do not match', 'error');
    return;
  }
  try {
    let d = await api('/api/change-password', {
      method: 'POST',
      body: JSON.stringify({
        current: $('currentPassword').value,
        new: $('newPassword').value,
      }),
    });
    msg('passwordMessage', d.message);
    $('passwordForm').reset();
  } catch (e) {
    msg('passwordMessage', e.message, 'error');
  }
});

async function init() {
  const d = new Date();
  $('todayLabel').textContent = d.toLocaleDateString(undefined, {     weekday: 'short',     month: 'short',     day: 'numeric',     year: 'numeric',   });$('attendanceDate').value = today();
  $('reportEnd').value = today();$('reportStart').value = d.getFullYear() + '-01-01';

  try {
    const me = await api('/api/me');
    signedIn(me.loggedIn, me.username || 'admin');
    if (me.loggedIn) nav('dashboard');
  } catch {
    signedIn(false);
  }
}

init();