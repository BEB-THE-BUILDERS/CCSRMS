// CCSRMS student view: read-only. Expects a `profiles` table (id, role, program).
const SUPABASE_URL      = 'https://yfeibchcqhkcsutpctiw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmZWliY2hjcWhrY3N1dHBjdGl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2OTE1NDcsImV4cCI6MjA5MjI2NzU0N30.ICh4YZv1Da5D3BdKK6oKSuBBBZ0YOor3Mnz2iLSou9o';   // anon key: public by design, same as main.js
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = id => document.getElementById(id);
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Same room list as ALL_ROOMS in main.js. If rooms are added there, add them here too.
const ROOMS = [407,408,409,410,411,412,413,503,504,505,506,507,508,509,510,517,518,519,520,521,525].map(String);
const COLOR = { 'BSCS': 'slot-bscs', 'BSIT': 'slot-bsit', 'BSEMC-DAT': 'slot-bsemc-dat', 'BSEMC-GD': 'slot-bsemc-gd' };

let filter = null, program = '', rows = [], seq = 0;   // filter: null = default view, or one legend key
let day = DAYS[new Date().getDay() - 1] || 'Monday';   // today, or Monday on Sundays

const toMins = t => { const [h, m] = t.split(':'); return +h * 60 + +m; };
const to12   = m => { const h = Math.floor(m / 60); return (h % 12 || 12) + ':' + String(m % 60).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM'); };

// Same prefix rules as the staff page (plain "BSEMC" counts as DAT)
function programOf(section) {
    const s = (section || '').trim().toUpperCase();
    if (s.startsWith('BSCS')) return 'BSCS';
    if (s.startsWith('BSIT')) return 'BSIT';
    if (s.startsWith('BSEMC-GD')) return 'BSEMC-GD';
    if (s.startsWith('BSEMC')) return 'BSEMC-DAT';
    return '';
}

function toast(msg, type = '') {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    setTimeout(() => t.classList.remove('show'), 3200);
}

function stop(msg) {
    document.querySelector('main').innerHTML = '<section class="card"><p>' + msg + '</p></section>';
}

// ── Auth guard ──
(async () => {
    const { data: { session } } = await db.auth.getSession();
    if (!session) return location.replace('index.html');

    const { data: p, error } = await db.from('profiles').select('role, program').eq('id', session.user.id).maybeSingle();
    if (error || !p) return stop('Your account is not set up yet. Please contact the department head.');
    if (p.role !== 'student') return location.replace('home.html');

    program = p.program;                       // locked: shown, never editable here
    $('userName').textContent = session.user.email;
    $('userRole').textContent = 'Student · ' + program;
    buildControls();
    load();
    setInterval(load, 90000);                  // keeps the view fresh without realtime connections
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();

$('logoutBtn').addEventListener('click', async () => { await db.auth.signOut(); location.replace('index.html'); });
$('refreshBtn').addEventListener('click', load);

// ── Controls ──
function buildControls() {
    const make = (el, items, isActive, onPick) => {
        el.innerHTML = '';
        items.forEach(([value, label]) => {
            const b = document.createElement('button');
            b.className = 'floor-btn' + (isActive(value) ? ' active' : '');
            b.textContent = label;
            b.onclick = () => { onPick(value); buildControls(); };
            el.appendChild(b);
        });
    };
    make($('dayGrid'), DAYS.map(d => [d, d]), v => v === day, v => { day = v; load(); });
    buildLegend();
}

// ── Legend: tap a chip to focus on that program (or Major / Minor); tap it again to reset ──
const CHIPS = [
    { key: 'bscs',      label: 'BSCS',      prog: 'BSCS',      bg: '#eff6ff', bd: '#93c5fd', fg: '#1e40af', dot: '#3b82f6' },
    { key: 'bsit',      label: 'BSIT',      prog: 'BSIT',      bg: '#f0fdf4', bd: '#86efac', fg: '#166534', dot: '#22c55e' },
    { key: 'bsemc-dat', label: 'BSEMC-DAT', prog: 'BSEMC-DAT', bg: '#fff1f2', bd: '#fca5a5', fg: '#9f1239', dot: '#ef4444' },
    { key: 'bsemc-gd',  label: 'BSEMC-GD',  prog: 'BSEMC-GD',  bg: '#fff7ed', bd: '#fdba74', fg: '#9a3412', dot: '#f97316' },
    { key: 'major',     label: 'Major',     bg: '#fefce8', bd: '#fde047', fg: '#854d0e', dot: '#eab308' },
    { key: 'minor',     label: 'Minor',     bg: '#fdf4ff', bd: '#f0abfc', fg: '#86198f', dot: '#d946ef' }
];

function buildLegend() {
    const bar = $('legendBar');
    bar.innerHTML = '';
    CHIPS.forEach(c => {
        const chip = document.createElement('div');
        chip.className = 'mini-legend-item' + (filter ? (filter === c.key ? ' legend-active' : ' legend-dimmed') : '');
        chip.style.cssText = 'display:flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;cursor:pointer;' +
            'font-size:0.72rem;font-weight:700;transition:opacity 0.2s,box-shadow 0.2s;' +
            'background:' + c.bg + ';border:1.5px solid ' + c.bd + ';color:' + c.fg + ';';
        const dot = document.createElement('span');
        dot.style.cssText = 'width:8px;height:8px;border-radius:50%;flex-shrink:0;display:inline-block;background:' + c.dot + ';';
        chip.append(dot, c.label + (c.prog === program ? ' \u2605' : ''));
        if (c.prog === program) chip.title = 'Your program';
        chip.onclick = () => { filter = filter === c.key ? null : c.key; buildLegend(); render(); };
        bar.appendChild(chip);
    });
    const active = CHIPS.find(c => c.key === filter);
    $('legendHint').textContent = active
        ? 'Showing ' + active.label + ' only. Tap it again to see everything.'
        : '\u2605 ' + program + ' is highlighted. Tap a program to focus on it.';
}

// ── Data ──
async function load() {
    const mine = ++seq;                        // ignore stale responses after quick clicks
    const { data, error } = await db.from('schedules')
        .select('id, room, course_name, section, faculty, day, start_time, end_time')
        .eq('day', day).in('room', ROOMS);
    if (mine !== seq) return;
    if (error) return toast('Could not load schedules. Check your connection and try again.', 'error');
    rows = data || [];
    $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    render();
}

// ── Timetable ──
function render() {
    const rooms = ROOMS;
    $('scheduleTitle').textContent = day + ' — All Rooms';
    $('emptyMsg').hidden = rows.length > 0;
    $('emptyMsg').textContent = 'No classes scheduled on ' + day + '.';
    $('timetableHead').innerHTML = '<tr><th>Time</th>' + rooms.map(r => '<th>Room ' + r + '</th>').join('') + '</tr>';

    const byRoom = {};                          // room -> { startMins: schedule }
    rooms.forEach(r => byRoom[r] = {});
    rows.forEach(s => { if (byRoom[s.room]) byRoom[s.room][toMins(s.start_time)] = s; });

    const times = [];
    for (let m = 7 * 60; m <= 21 * 60; m += 30) times.push(m);
    const slotRows = times.length - 1;          // the 21:00 row only marks the end of the day
    const covered = rooms.map(() => 0);         // rows still covered by a rowspan, per column
    const body = $('timetableBody');
    body.innerHTML = '';

    times.forEach((m, i) => {
        const tr = document.createElement('tr');
        const label = document.createElement('td');
        label.className = 'time-col';
        label.textContent = to12(m);
        tr.appendChild(label);

        rooms.forEach((room, col) => {
            if (covered[col] > 0) { covered[col]--; return; }
            const s = i < slotRows ? byRoom[room][m] : null;
            if (!s) { tr.appendChild(document.createElement('td')); return; }

            const span = Math.max(1, Math.min(Math.round((toMins(s.end_time) - m) / 30), slotRows - i));
            covered[col] = span - 1;
            tr.appendChild(slotCell(s, span));
        });
        body.appendChild(tr);
    });
}

function slotCell(s, span) {
    const p = programOf(s.section);
    const own = p === program;
    const td = document.createElement('td');
    td.rowSpan = span;
    const isMajor = /\[Major\]/.test(s.course_name);
    const isMinor = /\[Minor\]/.test(s.course_name);
    let state;
    if (filter === 'major')      state = isMajor ? ' slot-highlight-major' : ' slot-filtered-out';
    else if (filter === 'minor') state = isMinor ? ' slot-highlight-minor' : ' slot-filtered-out';
    else if (filter)             state = p.toLowerCase() === filter ? '' : ' slot-filtered-out';
    else                         state = own ? ' mine' : ' dim';        // default: your program stands out
    td.className = 'scheduled-slot ' + (COLOR[p] || '') + state;

    // course_name carries [Major]/[Minor] and (Lecture)/(Laboratory) tags; show only Lec/Lab
    const type = (s.course_name.match(/\((Lecture|Laboratory)\)/) || [])[1];
    const name = s.course_name.replace(/\s*\[.*?\]/g, '').replace(/\s*\((Lecture|Laboratory|None)\)/, '').trim();
    const title = document.createElement('strong');
    title.textContent = name + (type ? ' (' + (type === 'Lecture' ? 'Lec' : 'Lab') + ')' : '');

    const info = document.createElement('div');
    info.className = 'class-info';
    info.append(title, s.section || '', document.createElement('br'), s.faculty || '');
    td.appendChild(info);
    td.tabIndex = 0;                            // keyboard users can open the card too
    td.setAttribute('role', 'button');
    td.addEventListener('click', () => showDetails(s));
    td.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetails(s); } });
    td.title = name + '\n' + (s.section || '') + '\n' + (s.faculty || '') + '\n' +
        to12(toMins(s.start_time)) + ' – ' + to12(toMins(s.end_time));
    return td;
}

// ── Details card (view only: no edit, move or remove) ──
function showDetails(s) {
    const kinds = [];
    const tag = (s.course_name.match(/\[(Major|Minor)\]/) || [])[1];
    const type = (s.course_name.match(/\((Lecture|Laboratory)\)/) || [])[1];
    if (tag) kinds.push(tag);
    if (type) kinds.push(type);
    const name = s.course_name.replace(/\s*\[.*?\]/g, '').replace(/\s*\((Lecture|Laboratory|None)\)/, '').trim();

    $('svName').textContent    = name;
    $('svRoom').textContent    = 'Room ' + s.room + ' · ' + s.day;
    $('svSection').textContent = s.section || '—';
    $('svFaculty').textContent = s.faculty || '—';
    $('svDay').textContent     = s.day;
    $('svTime').textContent    = to12(toMins(s.start_time)) + ' – ' + to12(toMins(s.end_time));
    $('svKind').textContent    = kinds.join(' · ');
    $('svKindRow').classList.toggle('is-hidden', kinds.length === 0);

    $('svDetails').classList.add('show');
    $('svDetails').setAttribute('aria-hidden', 'false');
    $('svClose').focus();
}
function hideDetails() {
    $('svDetails').classList.remove('show');
    $('svDetails').setAttribute('aria-hidden', 'true');
}
$('svClose').addEventListener('click', hideDetails);
$('svDetails').addEventListener('click', e => { if (e.target === $('svDetails')) hideDetails(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideDetails(); });
