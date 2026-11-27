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
let started = false;                                    // true once the schedule has started loading
let search = '', roomPick = '', profPick = '';          // search box, room and professor filters (kept across days)

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

// ── Dark mode (same key as the staff page, so the choice follows the user) ──
if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
    $('darkModeToggle').classList.add('dark-mode-on');
}
$('darkModeToggle').addEventListener('click', () => {
    const on = document.body.classList.toggle('dark-mode');
    $('darkModeToggle').classList.toggle('dark-mode-on', on);
    localStorage.setItem('darkMode', on);
});

// ── Sidebar ──
function openSidebar() {
    $('sidebar').classList.add('open');
    $('sidebarOverlay').classList.add('show');
    document.body.style.overflow = 'hidden';
}
function closeSidebar() {
    $('sidebar').classList.remove('open');
    $('sidebarOverlay').classList.remove('show');
    document.body.style.overflow = '';
}
$('hamburgerBtn').addEventListener('click', openSidebar);
$('sidebarOverlay').addEventListener('click', closeSidebar);

$('sidebarLogoutBtn').addEventListener('click', async () => {
    closeSidebar();
    await db.auth.signOut();
    location.replace('index.html');
});
$('refreshBtn').addEventListener('click', () => load());

// ── About ──
const openAbout  = () => { $('aboutModal').classList.add('show'); };
const closeAbout = () => { $('aboutModal').classList.remove('show'); };
$('aboutBtn').addEventListener('click', () => { closeSidebar(); openAbout(); });
$('aboutCloseBtn').addEventListener('click', closeAbout);
$('aboutXBtn').addEventListener('click', closeAbout);
$('aboutModal').addEventListener('click', e => { if (e.target === $('aboutModal')) closeAbout(); });

// ── Terms & Conditions ──
// Accept mode (first login): the accept button unlocks after scrolling to the bottom and the page stays blocked until accepted.
// View mode (sidebar): read only, with a Close button.
let afterAccept = null;
function termsAtBottom() {
    const b = $('termsBody');
    return b.scrollTop + b.clientHeight >= b.scrollHeight - 10;
}
function checkTermsScroll() {
    if (!afterAccept) return;                   // only matters in accept mode
    const done = termsAtBottom();
    $('termsAcceptBtn').disabled = !done;
    if (done) $('termsScrollHint').innerHTML = '<i class="fa-solid fa-check" style="color:#22c55e;"></i><span style="color:#22c55e;">You may now accept the terms</span>';
}
$('termsBody').addEventListener('scroll', checkTermsScroll);

function openTerms(onAccept) {
    afterAccept = onAccept || null;
    const accepting = !!onAccept;
    $('termsAcceptBtn').style.display    = accepting ? '' : 'none';
    $('termsScrollHint').style.display   = accepting ? '' : 'none';
    $('termsViewCloseBtn').style.display = accepting ? 'none' : 'flex';
    $('termsIntro').textContent = accepting
        ? 'Please read carefully and scroll to the bottom to accept before using CCSRMS.'
        : 'These are the terms you accepted when you first used CCSRMS.';
    if (accepting) {
        $('termsAcceptBtn').disabled = true;
        $('termsScrollHint').innerHTML = '<i class="fa-solid fa-arrow-down"></i><span>Scroll to the bottom to enable acceptance</span>';
    }
    $('termsModal').classList.add('show');
    $('termsBody').scrollTop = 0;
    checkTermsScroll();
}
function closeTerms() { $('termsModal').classList.remove('show'); }

$('termsBtn').addEventListener('click', () => { closeSidebar(); openTerms(null); });
$('termsViewCloseBtn').addEventListener('click', closeTerms);
$('termsAcceptBtn').addEventListener('click', async () => {
    if (!afterAccept) return;
    const btn = $('termsAcceptBtn');
    const go = afterAccept;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    try {
        const { error } = await db.auth.updateUser({ data: { terms_accepted: true } });
        if (error) throw error;
    } catch (e) {
        console.warn('Could not save terms acceptance:', e.message);   // same as the staff page: continue anyway
    }
    btn.innerHTML = '<i class="fa-solid fa-check"></i> I Accept';
    afterAccept = null;
    closeTerms();
    go();
});

// ── Change password ──
const PW_REQS = {
    length:  v => v.length >= 8,
    upper:   v => /[A-Z]/.test(v),
    lower:   v => /[a-z]/.test(v),
    number:  v => /[0-9]/.test(v),
    special: v => /[^A-Za-z0-9]/.test(v)
};
function resetPwMeter() {
    $('pwStrengthWrap').style.display = 'none';
    ['pwBar1', 'pwBar2', 'pwBar3', 'pwBar4'].forEach(id => $(id).style.background = '#e2e8f0');
    Object.keys(PW_REQS).forEach(k => {
        const el = $('req-' + k);
        el.querySelector('i').className = 'fa-solid fa-circle-xmark';
        el.querySelector('i').style.color = '#ef4444';
        el.querySelector('span').style.color = 'var(--muted)';
    });
}
const closePassword = () => $('changePasswordModal').classList.remove('show');
$('changePasswordBtn').addEventListener('click', () => {
    closeSidebar();
    ['currentPassword', 'newPassword', 'confirmPassword'].forEach(id => $(id).value = '');
    $('changePasswordError').style.display = 'none';
    $('changePasswordSuccess').style.display = 'none';
    resetPwMeter();
    $('changePasswordModal').classList.add('show');
});
$('cpCloseBtn').addEventListener('click', closePassword);
$('cpCancelBtn').addEventListener('click', closePassword);
$('changePasswordModal').addEventListener('click', e => { if (e.target === $('changePasswordModal')) closePassword(); });

$('newPassword').addEventListener('input', function () {
    const val = this.value;
    $('pwStrengthWrap').style.display = val ? 'block' : 'none';
    let score = 0;
    Object.entries(PW_REQS).forEach(([k, test]) => {
        const met = test(val);
        if (met) score++;
        const el = $('req-' + k);
        el.querySelector('i').className = 'fa-solid ' + (met ? 'fa-circle-check' : 'fa-circle-xmark');
        el.querySelector('i').style.color = met ? '#10b981' : '#ef4444';
        el.querySelector('span').style.color = met ? '#10b981' : 'var(--muted)';
    });
    const colors = ['#ef4444', '#f59e0b', '#ED7117', '#10b981'];
    const labels = ['Weak', 'Fair', 'Good', 'Strong'];
    const i = score <= 1 ? 0 : score === 2 ? 1 : score <= 4 ? 2 : 3;
    ['pwBar1', 'pwBar2', 'pwBar3', 'pwBar4'].forEach((id, n) => $(id).style.background = n < score ? colors[i] : '#e2e8f0');
    $('pwStrengthLabel').textContent = 'Strength: ' + labels[i];
    $('pwStrengthLabel').style.color = colors[i];
});

$('changePasswordConfirmBtn').addEventListener('click', async () => {
    const current = $('currentPassword').value;
    const newPass = $('newPassword').value;
    const confirm = $('confirmPassword').value;
    const errEl = $('changePasswordError'), okEl = $('changePasswordSuccess');
    errEl.style.display = 'none';
    okEl.style.display = 'none';
    const fail = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };

    if (!current || !newPass || !confirm) return fail('Please fill in all fields.');
    if (!Object.values(PW_REQS).every(test => test(newPass))) return fail('Password does not meet the strength requirements.');
    if (newPass !== confirm) return fail('New passwords do not match.');

    const btn = $('changePasswordConfirmBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating...';
    try {
        const { data: { session } } = await db.auth.getSession();
        if (!session) { location.replace('index.html'); return; }
        // Re-check the current password first
        const { error: authErr } = await db.auth.signInWithPassword({ email: session.user.email, password: current });
        if (authErr) {
            fail('Current password is incorrect.');
        } else {
            const { error: upErr } = await db.auth.updateUser({ password: newPass });
            if (upErr) {
                fail('Failed to update password: ' + upErr.message);
            } else {
                okEl.textContent = 'Password updated successfully!';
                okEl.style.display = 'block';
                ['currentPassword', 'newPassword', 'confirmPassword'].forEach(id => $(id).value = '');
                resetPwMeter();
                setTimeout(closePassword, 1800);
            }
        }
    } catch (e) {
        fail('An error occurred. Please try again.');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Update Password';
});

// ── Start the schedule (runs once, after the terms are accepted) ──
function startApp() {
    if (started) return;
    started = true;
    buildControls();
    setView(view);                             // loads the data for whichever view is showing
    setInterval(refresh, 90000);               // keeps the view fresh without realtime connections
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}

// ── Auth guard ──
(async () => {
    const { data: { session } } = await db.auth.getSession();
    if (!session) return location.replace('index.html');

    const { data: p, error } = await db.from('profiles').select('role, program').eq('id', session.user.id).maybeSingle();
    if (error || !p) return stop('Your account is not set up yet. Please contact the department head.');
    if (p.role !== 'student') return location.replace('home.html');

    program = p.program;                       // locked: shown, never editable here
    const email = session.user.email;
    const roleLabel = 'Student · ' + program;
    $('userName').textContent = email;
    $('userRole').textContent = roleLabel;
    $('sidebarFooterName').textContent = email;
    $('sidebarFooterRole').textContent = roleLabel;

    if (session.user.user_metadata?.terms_accepted) startApp();
    else openTerms(startApp);                  // first login: must accept before the schedule loads
})();

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

// ── Views: "My Schedule" (one block's week as a list) or "All Rooms" (the day timetable) ──
const store = {
    get: k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode: just don't remember */ } }
};
let view = store.get('sv_view') === 'rooms' ? 'rooms' : 'mine';
let myYear = store.get('sv_myYear'), myBlock = store.get('sv_myBlock');
let weekRows = [], weekSeq = 0, weekLoaded = false;

function refresh() { return view === 'mine' ? loadMine() : load(); }

function setView(v) {
    view = v;
    store.set('sv_view', v);
    const mine = v === 'mine';
    $('mineCard').hidden = !mine;
    $('dayCard').hidden = mine;
    $('roomsCard').hidden = mine;
    [['viewMineBtn', mine], ['viewRoomsBtn', !mine]].forEach(([id, on]) => {
        $(id).classList.toggle('active', on);
        $(id).setAttribute('aria-selected', String(on));
    });
    refresh();
}
$('viewMineBtn').addEventListener('click', () => setView('mine'));
$('viewRoomsBtn').addEventListener('click', () => setView('rooms'));

// "BSCS 3-A" -> { year: '3', blocks: ['A'] }; merged "BSCS 3-A/B" -> blocks ['A', 'B']
function parseSection(section) {
    const m = (section || '').trim().toUpperCase().match(/^\S+\s+(\d+)\s*-\s*([A-Z])(?:\s*\/\s*([A-Z]))?/);
    return m ? { year: m[1], blocks: [m[2], m[3]].filter(Boolean) } : null;
}

// Both BSEMC tracks are stored with a "BSEMC" prefix; programOf() tells them apart afterwards
const SECTION_PREFIX = { 'BSCS': 'BSCS', 'BSIT': 'BSIT', 'BSEMC-DAT': 'BSEMC', 'BSEMC-GD': 'BSEMC' };

async function loadMine() {
    const mine = ++weekSeq;
    const { data, error } = await db.from('schedules')
        .select('id, room, course_name, section, faculty, day, start_time, end_time')
        .in('room', ROOMS)
        .ilike('section', (SECTION_PREFIX[program] || program) + '%');
    if (mine !== weekSeq) return;
    if (error) return toast('Could not load your schedule. Check your connection and try again.', 'error');
    weekRows = (data || []).filter(s => programOf(s.section) === program);
    weekLoaded = true;
    buildBlockOptions();
    renderMine();
}

function buildBlockOptions() {
    $('myYear').value = myYear;
    const sel = $('myBlock');
    const found = new Set();
    weekRows.forEach(s => { const p = parseSection(s.section); if (p && p.year === myYear) p.blocks.forEach(b => found.add(b)); });
    if (myBlock) found.add(myBlock);
    sel.innerHTML = '';
    sel.add(new Option('—', ''));
    [...found].sort().forEach(b => sel.add(new Option(b, b)));
    sel.value = myBlock;
    sel.disabled = !myYear;
}

$('myYear').addEventListener('change', e => {
    myYear = e.target.value;
    myBlock = '';                               // blocks differ per year, so pick again
    store.set('sv_myYear', myYear);
    store.set('sv_myBlock', '');
    buildBlockOptions();
    renderMine();
    const opts = $('myBlock').options;
    if (myYear && opts.length === 2) {         // only one block that year: pick it for them
        $('myBlock').value = opts[1].value;
        $('myBlock').dispatchEvent(new Event('change'));
    }
});
$('myBlock').addEventListener('change', e => {
    myBlock = e.target.value;
    store.set('sv_myBlock', myBlock);
    renderMine();
});

const typeTag = n => ({ Lecture: ' (Lec)', Laboratory: ' (Lab)' })[(n.match(/\((Lecture|Laboratory)\)/) || [])[1]] || '';

function renderMine() {
    const label = program + (myYear && myBlock ? ' ' + myYear + '-' + myBlock : '');
    $('mineTitle').textContent = 'My Schedule' + (myYear && myBlock ? ' — ' + label : '');
    const week = $('myWeek'), msg = $('mineMsg');
    week.innerHTML = '';

    let note = '';
    if (!weekLoaded) note = 'Loading…';
    else if (!myYear || !myBlock) note = 'Pick your year and block to see your classes for the week.';
    const classes = note ? [] : weekRows.filter(s => {
        const p = parseSection(s.section);
        return p && p.year === myYear && p.blocks.includes(myBlock);
    });
    if (!note && !classes.length) note = 'No classes found for ' + label + ' in the CCS rooms.';
    msg.hidden = !note;
    msg.textContent = note;
    if (note) return;

    const now = new Date();
    const today = DAYS[now.getDay() - 1];
    const nowMins = now.getHours() * 60 + now.getMinutes();

    DAYS.forEach(d => {
        const list = classes.filter(s => s.day === d).sort((a, b) => toMins(a.start_time) - toMins(b.start_time));
        if (!list.length && d === 'Saturday') return;      // most blocks have no Saturday classes
        const card = document.createElement('div');
        card.className = 'my-day' + (d === today ? ' today' : '');
        const head = document.createElement('div');
        head.className = 'my-day-head';
        const count = document.createElement('span');
        count.textContent = (d === today ? 'Today · ' : '') + (list.length ? list.length + (list.length === 1 ? ' class' : ' classes') : 'No classes');
        head.append(d, count);
        card.appendChild(head);

        list.forEach(s => {
            const start = toMins(s.start_time), end = toMins(s.end_time);
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'my-class';
            const bar = document.createElement('span');
            bar.className = 'bar' + (/\[Major\]/.test(s.course_name) ? ' major' : /\[Minor\]/.test(s.course_name) ? ' minor' : '');
            const body = document.createElement('div');
            const time = document.createElement('div');
            time.className = 'time';
            time.textContent = to12(start) + ' – ' + to12(end);
            if (d === today && nowMins >= start && nowMins < end) {
                const tag = document.createElement('span');
                tag.className = 'now';
                tag.textContent = 'NOW';
                time.appendChild(tag);
            }
            const name = document.createElement('div');
            name.className = 'name';
            name.textContent = cleanName(s.course_name) + typeTag(s.course_name);
            const meta = document.createElement('div');
            meta.className = 'meta';
            const merged = parseSection(s.section).blocks.length > 1;   // say so when it's a merged class
            meta.textContent = 'Room ' + s.room + ' · ' + (s.faculty || 'TBA') + (merged ? ' · ' + s.section : '');
            body.append(time, name, meta);
            b.append(bar, body);
            b.addEventListener('click', () => showDetails(s));
            card.appendChild(b);
        });
        week.appendChild(card);
    });
}

// ── Search and filters: subject, professor, section or room ──
const cleanName = n => (n || '').replace(/\s*\[.*?\]/g, '').replace(/\s*\((Lecture|Laboratory|None)\)/, '').trim();

function matchesSearch(s) {
    if (profPick && (s.faculty || '') !== profPick) return false;
    if (!search) return true;
    const hay = [cleanName(s.course_name), s.faculty, s.section, 'room ' + s.room].join(' ').toLowerCase();
    return search.split(/\s+/).every(w => hay.includes(w));   // every word must match somewhere
}

function fillSelect(el, values, current, allLabel, fmt) {
    el.innerHTML = '';
    el.add(new Option(allLabel, ''));
    values.forEach(v => el.add(new Option(fmt(v), v)));
    // keep the user's pick even if it has no classes on this day
    if (current && !values.includes(current)) el.add(new Option(fmt(current) + ' (none today)', current));
    el.value = current;
}

function buildFilterOptions() {
    fillSelect($('svRoomFilter'), ROOMS, roomPick, 'All rooms', r => 'Room ' + r);
    const profs = [...new Set(rows.map(s => (s.faculty || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    fillSelect($('svProfFilter'), profs, profPick, 'All professors', p => p);
}

let searchTimer;
$('svSearch').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { search = e.target.value.trim().toLowerCase(); render(); }, 150);
});
$('svRoomFilter').addEventListener('change', e => { roomPick = e.target.value; render(); });
$('svProfFilter').addEventListener('change', e => { profPick = e.target.value; render(); });
$('svClear').addEventListener('click', () => {
    search = roomPick = profPick = '';
    $('svSearch').value = '';
    buildFilterOptions();
    render();
    $('svSearch').focus();
});

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
    buildFilterOptions();
    $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    render();
}

// ── Timetable ──
function render() {
    const searching = !!(search || profPick);
    const hits = rows.filter(s => (!roomPick || s.room === roomPick) && matchesSearch(s));
    // A room pick shows one column; a search shows only rooms with a match
    let rooms = roomPick ? [roomPick] : ROOMS;
    if (searching && !roomPick) rooms = ROOMS.filter(r => hits.some(s => s.room === r));

    $('scheduleTitle').textContent = day + ' — ' + (roomPick ? 'Room ' + roomPick : 'All Rooms');
    $('svClear').hidden = !(searching || roomPick);
    $('svCount').textContent = (searching || roomPick)
        ? hits.length + (hits.length === 1 ? ' class' : ' classes') + ' found' : '';

    let empty = '';
    if (!rows.length) empty = 'No classes scheduled on ' + day + '.';
    else if (!hits.length) empty = 'No classes match your search on ' + day + '. Try another day or clear the filters.';
    $('emptyMsg').hidden = !empty;
    $('emptyMsg').textContent = empty;
    if (!rooms.length) { $('timetableHead').innerHTML = ''; $('timetableBody').innerHTML = ''; return; }
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
    if (!matchesSearch(s))       state = ' slot-filtered-out';          // search / professor filter
    else if (search || profPick) state = state.replace(' dim', '');     // matches stay fully visible
    td.className = 'scheduled-slot ' + (COLOR[p] || '') + state;

    // course_name carries [Major]/[Minor] and (Lecture)/(Laboratory) tags; show only Lec/Lab
    const type = (s.course_name.match(/\((Lecture|Laboratory)\)/) || [])[1];
    const name = cleanName(s.course_name);
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

// Escape closes whatever is open (the first-login terms can't be dismissed this way)
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    hideDetails();
    closeAbout();
    closePassword();
    closeSidebar();
    if (!afterAccept) closeTerms();
});