    const SUPABASE_URL      = 'https://yfeibchcqhkcsutpctiw.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmZWliY2hjcWhrY3N1dHBjdGl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2OTE1NDcsImV4cCI6MjA5MjI2NzU0N30.ICh4YZv1Da5D3BdKK6oKSuBBBZ0YOor3Mnz2iLSou9o';

    const { createClient } = supabase;
    const _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // ── STATE ──
    let coordinatorCourse = null; // 'BSCS' | 'BSIT' | 'BSEMC-DAT' | 'BSEMC-GD'

    function getCourseFromEmail(email) {
        if (!email) return null;
        const e = email.toLowerCase();
        if (e.includes('bsemc_dat') || e.includes('bsemc-dat')) return 'BSEMC-DAT';
        if (e.includes('bsemc_gd')  || e.includes('bsemc-gd'))  return 'BSEMC-GD';
        if (e.includes('bscs')) return 'BSCS';
        if (e.includes('bsit')) return 'BSIT';
        return null;
    }

    function getRoleLabel(email) {
        if (!email) return '';
        const e = email.toLowerCase();
        if (e.includes('bsemc_dat') || e.includes('bsemc-dat')) return 'BSEMC-DAT Coordinator';
        if (e.includes('bsemc_gd')  || e.includes('bsemc-gd'))  return 'BSEMC-GD Coordinator';
        if (e.includes('bscs')) return 'BSCS Coordinator';
        if (e.includes('bsit')) return 'BSIT Coordinator';
        if (e.includes('dept_head') || e.includes('depthead') || e.includes('dept-head') || e.includes('department_head') || e.includes('departmenthead')) return 'Department Head';
        return ''; // unknown account — show nothing
    }

    // Returns true if the logged-in coordinator is allowed to edit/move/delete this slot
    function canOwnSection(section) {
        if (!coordinatorCourse) return true; // no role detected = full access (admin / demo)
        if (!section) return false;
        const sec = section.trim().toUpperCase();
        const c   = coordinatorCourse.toUpperCase();
        // BSEMC-DAT and BSEMC-GD must be checked before plain BSEMC
        if (c === 'BSEMC-DAT') return sec.startsWith('BSEMC-DAT');
        if (c === 'BSEMC-GD')  return sec.startsWith('BSEMC-GD');
        return sec.startsWith(c);
    }

    function lockSectionDropdowns(course) {
        ['sectionCourse', 'editSectionCourse'].forEach(function(id) {
            var sel = document.getElementById(id);
            if (!sel || !course) return;
            sel.value = course;
            Array.from(sel.options).forEach(function(opt) {
                opt.disabled = (opt.value !== course && opt.value !== '');
                opt.hidden   = (opt.value !== course && opt.value !== '');
            });
            sel.disabled = true;
            sel.style.opacity = '0.7';
            sel.style.cursor  = 'not-allowed';
            sel.title = 'Locked to ' + course;
        });
    }

    let currentDay      = 'Monday';
    let currentRoom     = '407';
    let schedules       = [];
    let pendingDeleteId = null;
    let pendingNewEntry = null;
    let pendingMoveData = null;
    let pendingReplaceCtx = null;
    let currentDetailId = null;
    const dragState = { id: null, day: null, startM: 0, endM: 0, durMins: 0 };

    // ── UNDO STACK ──
    const undoStack = [];
    const MAX_UNDO  = 20;
    function pushUndo(label) {
        undoStack.push({ room: currentRoom, snapshot: JSON.parse(JSON.stringify(schedules)), label });
        if (undoStack.length > MAX_UNDO) undoStack.shift();
    }
    async function performUndo() {
        let idx = -1;
        for (let i = undoStack.length - 1; i >= 0; i--) {
            if (undoStack[i].room === currentRoom) { idx = i; break; }
        }
        if (idx === -1) { showToast('Nothing to undo', ''); return; }
        const { snapshot, label } = undoStack.splice(idx, 1)[0];
        if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
            schedules = snapshot;
            localStorage.setItem('schedules_' + currentRoom, JSON.stringify(schedules));
            renderTimetable();
            showToast('Undo: ' + label, 'success');
            return;
        }
        const { error: de } = await _supabase.from('schedules').delete().eq('room', currentRoom);
        if (de) { showToast('Undo failed', 'error'); return; }
        if (snapshot.length > 0) {
            const { error: ie } = await _supabase.from('schedules').insert(
                snapshot.map(s => ({ room: s.room, course_name: s.course_name, section: s.section, faculty: s.faculty, day: s.day, start_time: s.start_time, end_time: s.end_time }))
            );
            if (ie) { showToast('Undo failed', 'error'); return; }
        }
        showToast('Undo: ' + label, 'success');
        loadSchedules();
    }
    document.addEventListener('keydown', (e) => {
        const tag = document.activeElement.tagName;
        if ((tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') &&
            !document.activeElement.closest('.schedule-card')) return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); performUndo(); }
    });

    const ALL_ROOMS = [407,408,409,410,411,412,413,503,504,505,506,507,508,509,510,517,518,519,520,521,525];
    const HOURS   = [];
    for (let m = 7*60; m <= 21*60; m += 30) {
        HOURS.push(String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0'));
    }
    const DAYS    = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const DAY_MAP = { Mon:'Monday', Tue:'Tuesday', Wed:'Wednesday', Thu:'Thursday', Fri:'Friday', Sat:'Saturday' };
    const DAY_REV = Object.fromEntries(Object.entries(DAY_MAP).map(([k,v])=>[v,k]));

    // ── SECTION CONFLICT HELPER ──
    // Returns the first slot where the same section is already scheduled in a DIFFERENT room
    // at an overlapping time on the given day. Excludes excludeRoom and optionally excludeId.
    function findSectionConflict(section, day, startMins, endMins, excludeRoom, excludeId) {
        const secNorm = (section||'').trim().toUpperCase();
        for (const [room, slots] of Object.entries(allRoomSchedules)) {
            if (String(room) === String(excludeRoom)) continue;
            for (const s of slots) {
                if (excludeId && String(s.id) === String(excludeId)) continue;
                if (s.day !== day) continue;
                if ((s.section||'').trim().toUpperCase() !== secNorm) continue;
                const sM = timeToMins(s.start_time), eM = timeToMins(s.end_time);
                if (startMins < eM && endMins > sM) return s;
            }
        }
        return null;
    }

    // ── BLOCK CONFLICT HELPER ──
    // Checks ALL rooms (including the given room) for same-section time overlaps.
    // Returns the conflicting slot if found, or null. Used when adding a new schedule.
    function findBlockConflict(section, day, startMins, endMins, excludeRoom, excludeId) {
        const secNorm = (section||'').trim().toUpperCase();
        for (const [room, slots] of Object.entries(allRoomSchedules)) {
            // Skip the same room entirely — same-room overlaps are handled as room conflicts
            if (String(room) === String(excludeRoom)) continue;
            for (const s of slots) {
                if (excludeId && String(s.id) === String(excludeId)) continue;
                if (s.day !== day) continue;
                if ((s.section||'').trim().toUpperCase() !== secNorm) continue;
                // Minor subjects can run in parallel for the same section across rooms
                if (/\[Minor\]/i.test(s.course_name)) continue;
                const sM = timeToMins(s.start_time), eM = timeToMins(s.end_time);
                if (startMins < eM && endMins > sM) return { ...s, room };
            }
        }
        return null;
    }

    // ── SCAN ALL EXISTING BLOCK CONFLICTS ──
    // Returns array of conflict pairs: [{ a, b, section, day }]
    // where a and b are slots (with .room) that overlap for the same section.
    function getAllBlockConflicts() {
        const conflicts = [];
        const seen = new Set();

        // Collect all slots across all rooms
        const allSlots = [];
        for (const [room, slots] of Object.entries(allRoomSchedules)) {
            (slots || []).forEach(s => allSlots.push({ ...s, room: String(room) }));
        }

        for (let i = 0; i < allSlots.length; i++) {
            const a = allSlots[i];
            const secA = (a.section||'').trim().toUpperCase();
            if (!secA) continue;
            // Minor subjects can legitimately run in parallel for different students in the same section
            if (/\[Minor\]/i.test(a.course_name)) continue;
            const aStart = timeToMins(a.start_time), aEnd = timeToMins(a.end_time);

            for (let j = i + 1; j < allSlots.length; j++) {
                const b = allSlots[j];
                // Skip pairs in the same room — those are room-level conflicts, not block conflicts
                if (String(a.room) === String(b.room)) continue;
                if (b.day !== a.day) continue;
                const secB = (b.section||'').trim().toUpperCase();
                if (secA !== secB) continue;
                // Skip if the other slot is also a minor subject
                if (/\[Minor\]/i.test(b.course_name)) continue;
                const bStart = timeToMins(b.start_time), bEnd = timeToMins(b.end_time);
                if (aStart < bEnd && aEnd > bStart) {
                    const key = [String(a.id), String(b.id)].sort().join('|');
                    if (!seen.has(key)) {
                        seen.add(key);
                        conflicts.push({ a, b, section: a.section, day: a.day });
                    }
                }
            }
        }
        return conflicts;
    }


    // ── TOAST ──
    function showToast(msg, type='') {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.className = 'toast show ' + type;
        setTimeout(() => t.classList.remove('show'), 3200);
    }

    function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function timeToMins(t) { const [h,m] = t.split(':').map(Number); return h*60+(m||0); }
    function minsToTime(m) { return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'); }
    function to12hr(t) {
        const [h,m] = t.split(':').map(Number);
        return (h%12||12)+':'+String(m).padStart(2,'0')+' '+(h<12?'AM':'PM');
    }

    // ── AUDIT LOG ──
    let _currentUserEmail = 'Unknown';

    async function logAudit(action, scheduleId, room, details) {
        if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
            // localStorage fallback for demo mode
            const logs = JSON.parse(localStorage.getItem('audit_log') || '[]');
            logs.unshift({
                id: Date.now(),
                action,
                performed_by: _currentUserEmail,
                schedule_id: String(scheduleId || ''),
                room: String(room || ''),
                details: details || {},
                created_at: new Date().toISOString()
            });
            // keep max 500 entries in demo
            localStorage.setItem('audit_log', JSON.stringify(logs.slice(0, 500)));
            return;
        }
        try {
            await _supabase.from('audit_log').insert({
                action,
                performed_by: _currentUserEmail,
                schedule_id: String(scheduleId || ''),
                room: String(room || ''),
                details: details || {},
            });
        } catch(e) { console.warn('Audit log failed:', e); }
    }

    // ── AUDIT MODAL UI ──
    let _auditAllEntries  = [];
    let _auditDisplayed   = 0;
    const AUDIT_PAGE_SIZE = 30;

    function getAuditBadge(action) {
        const a = (action || '').toLowerCase();
        if (a.includes('added') || a.includes('insert'))   return { cls: 'badge-add',     icon: 'fa-plus' };
        if (a.includes('edit') || a.includes('update'))    return { cls: 'badge-edit',    icon: 'fa-pen' };
        if (a.includes('delet') || a.includes('remov'))    return { cls: 'badge-delete',  icon: 'fa-trash' };
        if (a.includes('replac'))                          return { cls: 'badge-replace', icon: 'fa-arrows-rotate' };
        if (a.includes('mov'))                             return { cls: 'badge-move',    icon: 'fa-arrow-right-arrow-left' };
        return { cls: 'badge-edit', icon: 'fa-circle-dot' };
    }

    function formatAuditTime(iso) {
        try {
            const d = new Date(iso);
            return d.toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' })
                + ' ' + d.toLocaleTimeString('en-PH', { hour:'numeric', minute:'2-digit', hour12:true });
        } catch(e) { return iso; }
    }

    function buildAuditEntryHTML(entry) {
        const { cls, icon } = getAuditBadge(entry.action);
        const d = entry.details || {};
        const coursePart = d.course_name ? escHtml(d.course_name) : '';
        const secPart    = d.section     ? ' · ' + escHtml(d.section) : '';
        const roomPart   = entry.room    ? ' · Room ' + escHtml(entry.room) : '';
        const dayPart    = d.day         ? ' · ' + escHtml(d.day) : '';
        const timePart   = (d.start_time && d.end_time)
            ? ' · ' + to12hr(d.start_time.slice(0,5)) + '–' + to12hr(d.end_time.slice(0,5))
            : '';
        const detailLine = (coursePart || secPart || roomPart)
            ? (coursePart + secPart + roomPart + dayPart + timePart)
            : (entry.schedule_id ? 'ID: ' + entry.schedule_id : '—');
        const userChip = entry.performed_by
            ? `<span class="audit-user-chip">${escHtml(entry.performed_by)}</span>`
            : '';
        return `
        <div class="audit-entry">
            <div class="audit-badge ${cls}"><i class="fa-solid ${icon}"></i></div>
            <div class="audit-info">
                <div class="audit-action-line">${escHtml(entry.action)}</div>
                <div class="audit-detail-line" title="${escHtml(detailLine)}">${detailLine}</div>
            </div>
            <div class="audit-meta">
                ${userChip}
                <div>${formatAuditTime(entry.created_at)}</div>
            </div>
        </div>`;
    }

    function renderAuditEntries(entries, append) {
        const body = document.getElementById('auditModalBody');
        if (!append) body.innerHTML = '';
        if (entries.length === 0 && !append) {
            body.innerHTML = '<div class="audit-empty"><i class="fa-solid fa-clock-rotate-left"></i>No history found.</div>';
            document.getElementById('auditCountLabel').textContent = '0 entries';
            document.getElementById('auditLoadMoreBtn').style.display = 'none';
            return;
        }
        body.insertAdjacentHTML('beforeend', entries.map(buildAuditEntryHTML).join(''));
    }

    function getFilteredAuditEntries() {
        const search = (document.getElementById('auditSearchInput').value || '').toLowerCase();
        const action = (document.getElementById('auditActionFilter').value || '').toLowerCase();
        const room   = (document.getElementById('auditRoomFilter').value || '');
        return _auditAllEntries.filter(e => {
            const d = e.details || {};
            const hay = [e.action, e.performed_by, e.room, e.schedule_id,
                         d.course_name, d.section, d.faculty, d.day].join(' ').toLowerCase();
            if (search && !hay.includes(search)) return false;
            if (action && !e.action.toLowerCase().includes(action)) return false;
            if (room && e.room !== room) return false;
            return true;
        });
    }

    function refreshAuditView() {
        _auditDisplayed = 0;
        const filtered = getFilteredAuditEntries();
        const page = filtered.slice(0, AUDIT_PAGE_SIZE);
        _auditDisplayed = page.length;
        renderAuditEntries(page, false);
        const total = filtered.length;
        document.getElementById('auditCountLabel').textContent = total + ' entr' + (total === 1 ? 'y' : 'ies');
        const moreBtn = document.getElementById('auditLoadMoreBtn');
        moreBtn.style.display = _auditDisplayed < total ? 'inline-block' : 'none';
    }

    async function openAuditModal() {
        document.getElementById('auditModal').classList.add('show');
        document.getElementById('auditModalBody').innerHTML =
            '<div class="audit-empty"><i class="fa-solid fa-spinner fa-spin"></i><br>Loading history…</div>';

        // Populate room filter
        const roomSel = document.getElementById('auditRoomFilter');
        const allRooms = ALL_ROOMS.map(String).sort((a,b)=>parseInt(a)-parseInt(b));
        roomSel.innerHTML = '<option value="">All Rooms</option>' +
            allRooms.map(r => `<option value="${r}">Room ${r}</option>`).join('');

        if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
            _auditAllEntries = JSON.parse(localStorage.getItem('audit_log') || '[]');
        } else {
            try {
                const { data, error } = await _supabase
                    .from('audit_log')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .limit(2000);
                if (error) { showToast('Failed to load audit log', 'error'); return; }
                _auditAllEntries = data || [];
            } catch(e) {
                showToast('Failed to load audit log', 'error'); return;
            }
        }
        refreshAuditView();
    }

    document.addEventListener('DOMContentLoaded', () => {
        // ── AUDIT MODAL BUTTON LISTENERS (need DOM to be ready) ──
        document.getElementById('auditLoadMoreBtn').addEventListener('click', () => {
            const filtered = getFilteredAuditEntries();
            const page = filtered.slice(_auditDisplayed, _auditDisplayed + AUDIT_PAGE_SIZE);
            _auditDisplayed += page.length;
            renderAuditEntries(page, true);
            const moreBtn = document.getElementById('auditLoadMoreBtn');
            moreBtn.style.display = _auditDisplayed < filtered.length ? 'inline-block' : 'none';
        });

        ['auditSearchInput','auditActionFilter','auditRoomFilter'].forEach(id => {
            document.getElementById(id).addEventListener('input', refreshAuditView);
            document.getElementById(id).addEventListener('change', refreshAuditView);
        });

        document.getElementById('auditLogBtn').addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('open');
            document.getElementById('sidebarOverlay').classList.remove('show');
            openAuditModal();
        });

        document.getElementById('auditModalCloseBtn').addEventListener('click', () =>
            document.getElementById('auditModal').classList.remove('show'));
        document.getElementById('auditModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('auditModal'))
                document.getElementById('auditModal').classList.remove('show');
        });
    });

    // ── AUTH ──
    (async () => {
        if (SUPABASE_URL === 'YOUR_SUPABASE_URL') { init(); return; }
        try {
            const { data: { session } } = await _supabase.auth.getSession();
            if (!session) { window.location.href = 'index.html'; return; }
            const email = session.user.email;
            _currentUserEmail = email;
            document.getElementById('userName').textContent = email;
            if (document.getElementById('userNameMobile'))
                document.getElementById('userNameMobile').textContent = email;
            if (document.getElementById('sidebarFooterName'))
                document.getElementById('sidebarFooterName').textContent = email;

            // Detect coordinator role from email pattern
            coordinatorCourse = getCourseFromEmail(email);
            const roleLabel = getRoleLabel(email);
            // Update all role display elements (only show if we know the role)
            ['userRole', 'userRoleMobile', 'sidebarFooterRole'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el) el.textContent = roleLabel;
            });
            if (coordinatorCourse) {
                lockSectionDropdowns(coordinatorCourse);

            }
            // Check if user has accepted terms
            const termsAccepted = session.user.user_metadata?.terms_accepted;
            if (!termsAccepted) {
                showTermsModal();
                return; // don't call init() until terms are accepted
            }
        } catch(e) { console.warn('Auth failed, demo mode'); }
        init();
    })();

    // Supabase sign-out is handled in the sidebarLogoutBtn click above

    // ── TERMS & CONDITIONS ──
    function showTermsModal() {
        document.getElementById('termsModal').classList.add('show');
        const body   = document.getElementById('termsBody');
        const btn    = document.getElementById('termsAcceptBtn');
        const hint   = document.getElementById('termsScrollHint');

        // Check scroll on load (in case content is short)
        function checkScroll() {
            const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 10;
            btn.disabled = !atBottom;
            if (atBottom) {
                hint.innerHTML = '<i class="fa-solid fa-check" style="color:#22c55e;"></i><span style="color:#22c55e;">You may now accept the terms</span>';
            }
        }
        body.addEventListener('scroll', checkScroll);
        checkScroll();

        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
            try {
                const { error } = await _supabase.auth.updateUser({
                    data: { terms_accepted: true }
                });
                if (error) throw error;
            } catch(e) {
                console.warn('Could not save terms acceptance:', e.message);
            }
            document.getElementById('termsModal').classList.remove('show');
            init();
        }, { once: true });
    }

    function init() { loadSchedules(); initRealtime(); }

    // ── REALTIME COLLABORATION ──
    var _realtimeChannel  = null;
    var _presenceChannel  = null;
    var _presenceKey      = null; // unique key for this tab session
    var _myPresenceState  = {};   // what we last broadcast

    // ── Colour palette for presence avatars ──
    var PRESENCE_COLORS = [
        '#3b82f6','#8b5cf6','#ec4899','#f97316',
        '#10b981','#06b6d4','#eab308','#ef4444'
    ];
    function presenceColor(email) {
        var hash = 0;
        for (var i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
        return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
    }
    function presenceInitials(email) {
        var name = email.split('@')[0].replace(/[._-]/g,' ').trim();
        var parts = name.split(' ').filter(Boolean);
        if (parts.length >= 2) return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
        return name.slice(0,2).toUpperCase();
    }

    function renderPresenceAvatars(stateMap) {
        var container = document.getElementById('presenceAvatars');
        if (!container) return;
        var myEmail = _currentUserEmail || '';

        // Collect one entry per unique email (dedupe multiple tabs), keep latest
        var byEmail = {};
        Object.values(stateMap).forEach(function(presences) {
            var p = Array.isArray(presences) ? presences[0] : presences;
            if (!p || !p.email) return;
            if (!byEmail[p.email] || p.online_at > byEmail[p.email].online_at) {
                byEmail[p.email] = p;
            }
        });

        var allEmails = Object.keys(byEmail);
        if (allEmails.length === 0) { container.innerHTML = ''; return; }

        // Sort: self first, then others sorted by join time
        allEmails.sort(function(a, b) {
            if (a === myEmail) return -1;
            if (b === myEmail) return 1;
            return (byEmail[a].online_at || '').localeCompare(byEmail[b].online_at || '');
        });

        var MAX_VISIBLE = 4;
        var visible  = allEmails.slice(0, MAX_VISIBLE);
        var overflow = allEmails.slice(MAX_VISIBLE);

        var html = visible.map(function(email, idx) {
            var p      = byEmail[email];
            var color  = presenceColor(email);
            var initls = presenceInitials(email);
            var isSelf    = (email === myEmail);
            var isEditing = !!p.editing_room;
            var tip = isSelf ? 'You (' + email.split('@')[0] + ')' : email.split('@')[0];
            if (p.role)         tip += ' (' + p.role + ')';
            if (p.editing_room) tip += ' — editing Room ' + p.editing_room;
            return '<div class="presence-avatar"'
                 + ' data-editing="' + isEditing + '"'
                 + ' data-self="' + isSelf + '"'
                 + ' style="background:' + color + ';z-index:' + (MAX_VISIBLE + 2 - idx) + ';"'
                 + ' title="">'
                 + initls
                 + '<span class="presence-tooltip">' + tip + '</span>'
                 + '</div>';
        }).join('');

        if (overflow.length > 0) {
            var overflowTip = overflow.map(function(e) { return e.split('@')[0]; }).join(', ');
            html += '<div class="presence-overflow" style="z-index:1;">'
                  + '+' + overflow.length
                  + '<span class="presence-tooltip">Also online: ' + overflowTip + '</span>'
                  + '</div>';
        }

        container.innerHTML = html;
    }

    function broadcastPresence(extraState) {
        if (!_presenceChannel || !_presenceKey) return;
        _myPresenceState = Object.assign({
            email:      _currentUserEmail || 'Unknown',
            role:       (document.getElementById('userRole') || {}).textContent || '',
            online_at:  new Date().toISOString(),
            editing_room: null
        }, extraState || {});
        _presenceChannel.track(_myPresenceState);
    }

    function initPresence() {
        if (SUPABASE_URL === 'YOUR_SUPABASE_URL') return;
        if (_presenceChannel) { _supabase.removeChannel(_presenceChannel); }
        _presenceKey = 'user-' + Math.random().toString(36).slice(2);
        _presenceChannel = _supabase.channel('ccsrms-presence', {
            config: { presence: { key: _presenceKey } }
        });
        _presenceChannel
            .on('presence', { event: 'sync' }, function() {
                renderPresenceAvatars(_presenceChannel.presenceState());
            })
            .on('presence', { event: 'join' }, function() {
                renderPresenceAvatars(_presenceChannel.presenceState());
            })
            .on('presence', { event: 'leave' }, function() {
                renderPresenceAvatars(_presenceChannel.presenceState());
            })
            .subscribe(function(status) {
                if (status === 'SUBSCRIBED') broadcastPresence();
            });
    }

    function initRealtime() {
        if (SUPABASE_URL === 'YOUR_SUPABASE_URL') return;
        if (_realtimeChannel) { _supabase.removeChannel(_realtimeChannel); }
        _realtimeChannel = _supabase
            .channel('schedules-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, function(payload) {
                handleRealtimeChange(payload);
            })
            .subscribe(function(status) {
                updateRealtimeIndicator(status);
            });
        initPresence();
    }

    function handleRealtimeChange(payload) {
        var eventType = payload.eventType;
        var newRow = payload.new;
        var oldRow = payload.old;

        if (eventType === 'INSERT' && newRow) {
            var room = String(newRow.room);
            if (!allRoomSchedules[room]) allRoomSchedules[room] = [];
            if (!allRoomSchedules[room].find(function(s) { return String(s.id) === String(newRow.id); })) {
                allRoomSchedules[room].push(newRow);
            }
            refreshAfterRealtime(room, 'New schedule added by another coordinator');
        }
        if (eventType === 'UPDATE' && newRow) {
            var room = String(newRow.room);
            if (!allRoomSchedules[room]) allRoomSchedules[room] = [];
            allRoomSchedules[room] = allRoomSchedules[room].map(function(s) {
                return String(s.id) === String(newRow.id) ? newRow : s;
            });
            if (oldRow && String(oldRow.room) !== room) {
                var oldRoom = String(oldRow.room);
                if (allRoomSchedules[oldRoom]) {
                    allRoomSchedules[oldRoom] = allRoomSchedules[oldRoom].filter(function(s) {
                        return String(s.id) !== String(oldRow.id);
                    });
                }
            }
            refreshAfterRealtime(room, 'Schedule updated by another coordinator');
        }
        if (eventType === 'DELETE' && oldRow) {
            var room = String(oldRow.room);
            if (allRoomSchedules[room]) {
                allRoomSchedules[room] = allRoomSchedules[room].filter(function(s) {
                    return String(s.id) !== String(oldRow.id);
                });
            }
            refreshAfterRealtime(room, 'Schedule removed by another coordinator');
        }
    }

    function refreshAfterRealtime(changedRoom, toastMsg) {
        if (String(changedRoom) === String(currentRoom)) {
            schedules = allRoomSchedules[currentRoom] || [];
        }
        if (currentTab === 'room') { renderTimetable(); }
        if (currentTab !== 'room' && COURSE_TABS[currentTab]) renderCourseView(currentTab);
        if (currentTab === 'major-minor') renderMajorMinorView();
        showToast(toastMsg, 'info');
    }

    function updateRealtimeIndicator(status) {
        var dot   = document.getElementById('realtimeDot');
        var label = document.getElementById('realtimeLabel');
        if (!dot || !label) return;
        if (status === 'SUBSCRIBED') {
            dot.style.background = '#10b981';
            dot.style.boxShadow  = '0 0 0 3px rgba(16,185,129,0.25)';
            label.textContent    = 'Live';
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            dot.style.background = '#ef4444';
            dot.style.boxShadow  = '0 0 0 3px rgba(239,68,68,0.25)';
            label.textContent    = 'Offline';
        } else {
            dot.style.background = '#f59e0b';
            dot.style.boxShadow  = '0 0 0 3px rgba(245,158,11,0.25)';
            label.textContent    = 'Connecting...';
        }
    }

    // ── DAY ──
    document.getElementById('dayGrid').addEventListener('click', (e) => {
        const btn = e.target.closest('.floor-btn');
        if (!btn) return;
        document.querySelectorAll('#dayGrid .floor-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentDay = btn.dataset.day;
        loadSchedules();
    });



    // ── LOAD SCHEDULES (all rooms) ──
    let allRoomSchedules = {}; // { '407': [...], '408': [...], ... }

    async function loadSchedules() {
        const ov = document.getElementById('scheduleLoading');
        ov.classList.add('show');
        const rooms = ALL_ROOMS;

        // Update thead with room columns
        const thead = document.getElementById('timetableHead');
        const LAB_ROOMS = new Set([507,508,509,510,517,518,519,520,521]);
        thead.innerHTML = '<tr><th>Time</th>' +
            rooms.map(r => {
                const isLab = LAB_ROOMS.has(r);
                return '<th>Room ' + r + (isLab ? '<br><span style="font-size:0.65rem;font-weight:500;opacity:0.75;letter-spacing:0.03em;">🔬 Lab</span>' : '') + '</th>';
            }).join('') +
            '</tr>';

        // Update title
        document.getElementById('scheduleTitle').textContent =
            'CCS Rooms — ' + currentDay + ' Schedule';

        // Populate print room dropdown
        const printRoomSel = document.getElementById('printRoomSelect');
        if (printRoomSel) {
            const prev = printRoomSel.value;
            printRoomSel.innerHTML = '<option value="">— Select Room —</option>' +
                rooms.map(r => '<option value="'+r+'"'+(String(r)===String(prev)?' selected':'')+'>Room '+r+'</option>').join('');
        }

        if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
            rooms.forEach(r => {
                allRoomSchedules[String(r)] = JSON.parse(localStorage.getItem('schedules_'+r)||'[]');
            });
            // keep schedules pointing to current room for form submit compatibility
            schedules = allRoomSchedules[currentRoom] || [];
            if (currentTab === 'room') { renderTimetable(); }
            ov.classList.remove('show');
            if (currentTab !== 'room' && COURSE_TABS[currentTab]) renderCourseView(currentTab);
            if (currentTab === 'major-minor') renderMajorMinorView();
            return;
        }

        try {
            const roomStrs = rooms.map(r => String(r));
            const { data, error } = await _supabase.from('schedules').select('*').in('room', roomStrs);
            if (error) { showToast('Failed to load schedules','error'); return; }
            // Refresh all rooms so the cache stays consistent
            rooms.forEach(r => { allRoomSchedules[String(r)] = []; });
            (data||[]).forEach(s => {
                if (allRoomSchedules[s.room] !== undefined) allRoomSchedules[s.room].push(s);
            });
            schedules = allRoomSchedules[currentRoom] || [];
            if (currentTab === 'room') { renderTimetable(); }
            if (currentTab !== 'room' && COURSE_TABS[currentTab]) renderCourseView(currentTab);
            if (currentTab === 'major-minor') renderMajorMinorView();
        } catch(e) {
            showToast('Failed to load schedules','error');
        } finally {
            ov.classList.remove('show');
        }
    }

    // ── TABS ──
    let currentTab = 'room';
    const COURSE_TABS = {
        'bscs':     { tabId: 'tabBscsView',     panelId: 'panelBscsView',     filterId: 'bscsDayFilter',     searchId: 'bscsSearchFilter',     roomFiltId: 'bscsRoomFilter',     timeFiltId: 'bscsTimeFilter',     sortFiltId: 'bscsSortFilter',     contentId: 'bscsViewContent',     prefix: 'BSCS',      label: 'BSCS' },
        'bsit':     { tabId: 'tabBsitView',     panelId: 'panelBsitView',     filterId: 'bsitDayFilter',     searchId: 'bsitSearchFilter',     roomFiltId: 'bsitRoomFilter',     timeFiltId: 'bsitTimeFilter',     sortFiltId: 'bsitSortFilter',     contentId: 'bsitViewContent',     prefix: 'BSIT',      label: 'BSIT' },
        'bsemc-dat':{ tabId: 'tabBsemcDatView', panelId: 'panelBsemcDatView', filterId: 'bsemcDatDayFilter', searchId: 'bsemcDatSearchFilter', roomFiltId: 'bsemcDatRoomFilter', timeFiltId: 'bsemcDatTimeFilter', sortFiltId: 'bsemcDatSortFilter', contentId: 'bsemcDatViewContent', prefix: 'BSEMC-DAT', label: 'BSEMC-DAT' },
        'bsemc-gd': { tabId: 'tabBsemcGdView',  panelId: 'panelBsemcGdView',  filterId: 'bsemcGdDayFilter',  searchId: 'bsemcGdSearchFilter',  roomFiltId: 'bsemcGdRoomFilter',  timeFiltId: 'bsemcGdTimeFilter',  sortFiltId: 'bsemcGdSortFilter',  contentId: 'bsemcGdViewContent',  prefix: 'BSEMC-GD',  label: 'BSEMC-GD' },
    };

    // ── LOAD ALL SCHEDULES for course/major-minor tabs ──
    async function loadAllSchedules() {
        const allRooms = ALL_ROOMS.map(String);

        if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
            // Demo / localStorage mode
            allRooms.forEach(r => {
                allRoomSchedules[r] = JSON.parse(localStorage.getItem('schedules_' + r) || '[]');
            });
            return;
        }

        // Supabase mode — always fetch all rooms so we never show stale data
        try {
            const { data, error } = await _supabase.from('schedules').select('*').in('room', allRooms);
            if (error) { showToast('Failed to load all-floor schedules', 'error'); return; }
            allRooms.forEach(r => { allRoomSchedules[r] = []; });
            (data || []).forEach(s => {
                if (allRoomSchedules[s.room]) allRoomSchedules[s.room].push(s);
            });
        } catch(e) {
            showToast('Failed to load all-floor schedules', 'error');
        }
    }

    function switchTab(tab) {
        currentTab = tab;
        document.getElementById('tabRoomView').classList.toggle('active', tab === 'room');
        Object.entries(COURSE_TABS).forEach(([key, cfg]) => {
            document.getElementById(cfg.tabId).classList.toggle('active', tab === key);
            document.getElementById(cfg.panelId).style.display = (tab === key) ? '' : 'none';
        });
        document.getElementById('tabMajorMinorView').classList.toggle('active', tab === 'major-minor');
        document.getElementById('panelMajorMinorView').style.display = (tab === 'major-minor') ? '' : 'none';
        document.getElementById('panelRoomView').style.display = tab === 'room' ? '' : 'none';
        document.getElementById('legendCard').style.display = tab !== 'room' ? 'none' : '';
        if (tab !== 'room' && COURSE_TABS[tab]) {
            loadAllSchedules().then(() => renderCourseView(tab));
        }
        if (tab === 'major-minor') {
            loadAllSchedules().then(() => renderMajorMinorView());
        }
    }

    function onTabFilterChange(tabKey) {
        if (currentTab === tabKey) renderCourseView(tabKey);
    }

    // Legacy per-element listeners for day filters (kept for compatibility)
    Object.entries(COURSE_TABS).forEach(([key, cfg]) => {
        const el = document.getElementById(cfg.filterId);
        if (el) el.addEventListener('change', () => { if (currentTab === key) renderCourseView(key); });
    });
    document.getElementById('majorMinorTypeFilter').addEventListener('change', () => { if (currentTab === 'major-minor') renderMajorMinorView(); });
    document.getElementById('majorMinorDayFilter').addEventListener('change',  () => { if (currentTab === 'major-minor') renderMajorMinorView(); });

    // ── COURSE VIEW (generalized for all courses) ──
    function renderCourseView(tab) {
        const cfg = COURSE_TABS[tab];
        if (!cfg) return;
        const container  = document.getElementById(cfg.contentId);
        const dayFilter  = document.getElementById(cfg.filterId)?.value || 'all';
        const searchQ    = (document.getElementById(cfg.searchId)?.value || '').trim().toLowerCase();
        const roomFilt   = document.getElementById(cfg.roomFiltId)?.value || 'all';
        const timeFilt   = document.getElementById(cfg.timeFiltId)?.value || 'all';
        const sortFilt   = document.getElementById(cfg.sortFiltId)?.value || 'day-time';
        const WEEKDAYS   = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const days       = dayFilter === 'all' ? WEEKDAYS : [dayFilter];
        const prefix     = cfg.prefix.toUpperCase();

        // Collect ALL matching schedules across every room/floor
        const courseSchedules = [];
        Object.values(allRoomSchedules).forEach(roomSlots => {
            roomSlots.forEach(s => {
                const sec = (s.section||'').trim().toUpperCase();
                // Match exact prefix (e.g. BSEMC-DAT must not match BSEMC-GD)
                if (sec.startsWith(prefix + ' ') || sec.startsWith(prefix + '-') || sec === prefix) {
                    courseSchedules.push(s);
                }
            });
        });

        // Also load from all rooms if not yet loaded (demo mode)
        if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
            ALL_ROOMS.forEach(r => {
                const key = String(r);
                if (!allRoomSchedules[key]) {
                    const stored = JSON.parse(localStorage.getItem('schedules_'+key)||'[]');
                    stored.forEach(s => {
                        const sec = (s.section||'').trim().toUpperCase();
                        if (sec.startsWith(prefix + ' ') || sec.startsWith(prefix + '-') || sec === prefix) {
                            if (!courseSchedules.find(x => String(x.id) === String(s.id))) {
                                courseSchedules.push(s);
                            }
                        }
                    });
                }
            });
        }

        // Apply search / room / time filters
        const filteredSchedules = courseSchedules.filter(s => {
            if (roomFilt !== 'all' && String(s.room) !== String(roomFilt)) return false;
            if (timeFilt !== 'all' && timeToMins(s.start_time) < timeToMins(timeFilt)) return false;
            if (timeFilt !== 'all' && timeToMins(s.start_time) >= timeToMins(timeFilt) + 60) return false;
            if (searchQ) {
                const courseLower = (s.course_name||'').toLowerCase();
                const profLower   = (s.faculty||'').toLowerCase();
                const secLower    = (s.section||'').toLowerCase();
                if (!courseLower.includes(searchQ) && !profLower.includes(searchQ) && !secLower.includes(searchQ)) return false;
            }
            return true;
        });

        if (filteredSchedules.length === 0) {
            const hasFilters = searchQ || roomFilt !== 'all' || timeFilt !== 'all';
            container.innerHTML = `<div style="text-align:center;padding:40px 0;color:var(--muted);font-size:0.88rem;"><i class="fa-solid fa-calendar-xmark" style="font-size:2rem;margin-bottom:10px;display:block;opacity:0.4;"></i>${hasFilters ? 'No results match your filters.' : 'No ' + cfg.label + ' schedules found.'}</div>`;
            return;
        }

        // Parse section → { year, block }
        function parseSection(sec) {
            // Match "BSCS 1-A" or "BSCS 1-A/B" (merged)
            const escaped = prefix.replace(/-/g, '\\-');
            const m = (sec||'').trim().match(new RegExp('^' + escaped + '\\s+(\\d+)-([A-F])(?:\\/([A-F]))?$', 'i'));
            if (!m) return null;
            const blocks = m[3] ? [m[2].toUpperCase(), m[3].toUpperCase()] : [m[2].toUpperCase()];
            return { year: parseInt(m[1]), blocks };
        }

        // Group: year → block → day → [schedules]
        // Merged classes (e.g. BSCS 1-A/B) appear in BOTH blocks
        const grouped = {};
        filteredSchedules.forEach(s => {
            const p = parseSection(s.section);
            if (!p) return;
            if (!grouped[p.year]) grouped[p.year] = {};
            p.blocks.forEach(block => {
                if (!grouped[p.year][block]) grouped[p.year][block] = {};
                days.forEach(d => { if (!grouped[p.year][block][d]) grouped[p.year][block][d] = []; });
                if (days.includes(s.day)) {
                    grouped[p.year][block][s.day].push({ ...s, _isMerged: p.blocks.length > 1, _mergedWith: p.blocks.filter(b => b !== block) });
                }
            });
        });

        // Sort each day's slots by start time
        Object.values(grouped).forEach(blocks =>
            Object.values(blocks).forEach(dayMap =>
                Object.values(dayMap).forEach(slots =>
                    slots.sort((a,b) => timeToMins(a.start_time) - timeToMins(b.start_time))
                )
            )
        );

        const years = Object.keys(grouped).map(Number).sort();
        let html = '';

        years.forEach(year => {
            const yearLabel = ['','1st','2nd','3rd','4th'][year] || year+'th';
            html += `<div class="bscs-year-section">
                <div class="bscs-year-header"><i class="fa-solid fa-layer-group" style="margin-right:7px;opacity:0.7;"></i>Year ${yearLabel} — ${cfg.label}</div>
                <div class="bscs-blocks-grid">`;

            const blocks = Object.keys(grouped[year]).sort();
            blocks.forEach(block => {
                const dayMap = grouped[year][block];
                const allSlots = [];
                days.forEach(d => { (dayMap[d]||[]).forEach(s => allSlots.push(s)); });

                // Merge same class appearing on multiple days into one row
                const mergedMap = {};
                const DAY_SHORT = { Monday:'Mon', Tuesday:'Tue', Wednesday:'Wed', Thursday:'Thu', Friday:'Fri', Saturday:'Sat' };
                allSlots.forEach(s => {
                    const name = s.course_name.replace(/\s*\[.*?\]/g,'').replace(/\s*\(.*?\)/g,'').trim();
                    const typeM = s.course_name.match(/\((Lecture|Laboratory)\)/);
                    const type = typeM ? (typeM[1] === 'Lecture' ? 'Lec' : 'Lab') : '';
                    const key = name + '||' + (s.faculty||'') + '||' + s.room + '||' + s.start_time + '||' + s.end_time;
                    if (!mergedMap[key]) {
                        mergedMap[key] = { name, type, faculty: s.faculty||'—', room: s.room, start_time: s.start_time, end_time: s.end_time, days: [], isMerged: s._isMerged, mergedWith: s._mergedWith||[] };
                    }
                    if (!mergedMap[key].days.includes(s.day)) mergedMap[key].days.push(s.day);
                });

                // Sort by selected sort option
                const DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
                const merged = Object.values(mergedMap);
                merged.sort((a,b) => {
                    if (sortFilt === 'course')    return a.name.localeCompare(b.name);
                    if (sortFilt === 'professor') return (a.faculty||'').localeCompare(b.faculty||'');
                    if (sortFilt === 'room')      return String(a.room).localeCompare(String(b.room), undefined, {numeric:true});
                    if (sortFilt === 'time')      return timeToMins(a.start_time) - timeToMins(b.start_time);
                    // default: day-time
                    const da = Math.min(...a.days.map(d => DAY_ORDER.indexOf(d)));
                    const db = Math.min(...b.days.map(d => DAY_ORDER.indexOf(d)));
                    return da !== db ? da - db : timeToMins(a.start_time) - timeToMins(b.start_time);
                });

                html += `<div class="bscs-block-card">
                    <div class="bscs-block-header">Block ${block}</div>
                    <div style="overflow-x:auto;">
                    <table class="bscs-block-table">
                        <thead><tr>
                            <th style="text-align:left;">Class Name</th>
                            <th>Professor</th>
                            <th>Day</th>
                            <th>Start Time</th>
                            <th>End Time</th>
                            <th>Room</th>
                        </tr></thead><tbody>`;

                if (merged.length === 0) {
                    html += `<tr><td colspan="6" class="bscs-empty">No classes scheduled.</td></tr>`;
                } else {
                    merged.forEach(r => {
                        const dayLabel = r.days.sort((a,b) => DAY_ORDER.indexOf(a)-DAY_ORDER.indexOf(b)).map(d => DAY_SHORT[d]||d).join('-');
                        const firstDay = r.days.sort((a,b) => DAY_ORDER.indexOf(a)-DAY_ORDER.indexOf(b))[0];
                        html += `<tr class="bscs-table-row" data-room="${escHtml(String(r.room))}" data-day="${escHtml(firstDay)}" data-start="${escHtml(r.start_time.slice(0,5))}" style="cursor:pointer;transition:background 0.15s;" title="Click to view on timetable">
                            <td><span style="font-weight:600;">${escHtml(r.name)}</span>${r.type ? ` <span style="display:inline-block;margin-left:5px;padding:1px 6px;border-radius:4px;font-size:0.7rem;font-weight:700;background:${r.type==='Lec'?'#eff6ff':'#f0fdf4'};color:${r.type==='Lec'?'#1d4ed8':'#15803d'};border:1px solid ${r.type==='Lec'?'#bfdbfe':'#86efac'};">${r.type}</span>` : ''}${r.isMerged ? ` <span class="merge-badge"><i class="fa-solid fa-code-merge" style="font-size:0.6rem;"></i> w/ Block ${r.mergedWith.join('+')}</span>` : ''}</td>
                            <td style="text-align:center;">${escHtml(r.faculty)}</td>
                            <td style="text-align:center;">${escHtml(dayLabel)}</td>
                            <td style="text-align:center;">${to12hr(r.start_time.slice(0,5))}</td>
                            <td style="text-align:center;">${to12hr(r.end_time.slice(0,5))}</td>
                            <td style="text-align:center;">${escHtml(String(r.room))}</td>
                        </tr>`;
                    });
                }

                html += `</tbody></table></div></div>`;
            });

            html += `</div></div>`;
        });

        container.innerHTML = html;

        // Wire up row clicks → jump to timetable
        container.querySelectorAll('.bscs-table-row').forEach(tr => {
            tr.addEventListener('mouseenter', () => tr.style.background = 'var(--light-bg)');
            tr.addEventListener('mouseleave', () => tr.style.background = '');
            tr.addEventListener('click', () => {
                const room  = tr.dataset.room;
                const day   = tr.dataset.day;
                const start = tr.dataset.start;

                switchTab('room');

                if (day !== currentDay) {
                    currentDay = day;
                    document.querySelectorAll('#dayGrid .floor-btn').forEach(b => {
                        b.classList.toggle('active', b.dataset.day === day);
                    });
                }

                renderTimetable();

                setTimeout(() => {
                    const startMins = timeToMins(start);
                    const target = document.querySelector(
                        `.scheduled-slot[data-room="${room}"][data-start-mins="${startMins}"]`
                    );
                    if (!target) return;
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    target.classList.add('bscs-highlight');
                    setTimeout(() => target.classList.remove('bscs-highlight'), 2000);
                }, 80);
            });
        });
    }

    // Keep renderBscsView as an alias for backward compatibility
    function renderBscsView() { renderCourseView('bscs'); }

    function printCourseView(tab) {
        const cfg = COURSE_TABS[tab];
        if (!cfg) return;
        const content = document.getElementById(cfg.contentId).innerHTML;
        const w = window.open('','_blank');
        w.document.write(`\x3C!DOCTYPE html>\x3Chtml>\x3Chead><title>${cfg.label} Schedule</title>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Sora:wght@600;700&display=swap" rel="stylesheet">
        <\style>
            body { font-family: 'DM Sans', sans-serif; padding: 24px; color: #1e293b; }
            h1 { font-family: 'Sora', sans-serif; font-size: 1.1rem; margin-bottom: 20px; color: #0d1b3e; }
            .bscs-year-section { margin-bottom: 28px; }
            .bscs-year-header { font-family: 'Sora', sans-serif; font-size: 0.9rem; font-weight: 700; color: #0d1b3e; padding: 7px 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 0 6px 6px 0; margin-bottom: 10px; }
            .bscs-block-card { border: 1.5px solid #e2e8f0; border-radius: 8px; overflow: hidden; margin-bottom: 10px; }
            .bscs-block-header { padding: 6px 12px; background: #f1f5f9; font-size: 0.78rem; font-weight: 700; color: #64748b; border-bottom: 1px solid #e2e8f0; }
            .bscs-block-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
            .bscs-block-table th { padding: 6px 8px; background: #f8fafc; border-bottom: 1.5px solid #e2e8f0; border-right: 1px solid #e2e8f0; font-weight: 700; color: #0d1b3e; text-align: center; }
            .bscs-block-table th:first-child { text-align: left; }
            .bscs-block-table td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; vertical-align: top; }
            .bscs-block-table tr:last-child td { border-bottom: none; }
            .bscs-block-table td:last-child, .bscs-block-table th:last-child { border-right: none; }
            .bscs-subject-chip { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; margin: 1px; line-height: 1.4; }
            .chip-time, .chip-room { display: block; font-size: 0.65rem; opacity: 0.75; }
        <\/style>\x3C/head>\x3Cbody>
        <h1>${cfg.label} — All Classes</h1>${content}\x3C/body>\x3C/html>`);
        w.document.close();
        w.print();
    }

    function printBscsView() { printCourseView('bscs'); }

    // ── MAJOR / MINOR VIEW ──
    function renderMajorMinorView() {
        const container  = document.getElementById('majorMinorViewContent');
        const typeFilter  = document.getElementById('majorMinorTypeFilter').value;
        const dayFilter   = document.getElementById('majorMinorDayFilter').value;
        const searchQ     = (document.getElementById('majorMinorSearchFilter')?.value || '').trim().toLowerCase();
        const roomFilt    = document.getElementById('majorMinorRoomFilter')?.value || 'all';
        const timeFilt    = document.getElementById('majorMinorTimeFilter')?.value || 'all';
        const sortFilt    = document.getElementById('majorMinorSortFilter')?.value || 'day-time';
        const WEEKDAYS   = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const days       = dayFilter === 'all' ? WEEKDAYS : [dayFilter];
        const DAY_ORDER  = WEEKDAYS;
        const DAY_SHORT  = { Monday:'Mon', Tuesday:'Tue', Wednesday:'Wed', Thursday:'Thu', Friday:'Fri', Saturday:'Sat' };

        // Collect all slots that have [Major] or [Minor] in course_name
        const allSlots = [];
        Object.values(allRoomSchedules).forEach(roomSlots => {
            roomSlots.forEach(s => {
                const mm = (s.course_name||'').match(/\[(Major|Minor)\]/);
                if (!mm) return;
                if (typeFilter !== 'all' && mm[1] !== typeFilter) return;
                if (!days.includes(s.day)) return;
                if (roomFilt !== 'all' && String(s.room) !== String(roomFilt)) return;
                if (timeFilt !== 'all' && (timeToMins(s.start_time) < timeToMins(timeFilt) || timeToMins(s.start_time) >= timeToMins(timeFilt) + 60)) return;
                if (searchQ) {
                    const cL = (s.course_name||'').toLowerCase(), pL = (s.faculty||'').toLowerCase(), sL = (s.section||'').toLowerCase();
                    if (!cL.includes(searchQ) && !pL.includes(searchQ) && !sL.includes(searchQ)) return;
                }
                allSlots.push({ ...s, _type: mm[1] });
            });
        });

        // Demo mode: pull from localStorage for rooms not yet loaded
        if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
            ALL_ROOMS.forEach(r => {
                const key = String(r);
                if (!allRoomSchedules[key]) {
                    const stored = JSON.parse(localStorage.getItem('schedules_'+key)||'[]');
                    stored.forEach(s => {
                        const mm = (s.course_name||'').match(/\[(Major|Minor)\]/);
                        if (!mm) return;
                        if (typeFilter !== 'all' && mm[1] !== typeFilter) return;
                        if (!days.includes(s.day)) return;
                        if (!allSlots.find(x => String(x.id) === String(s.id)))
                            allSlots.push({ ...s, _type: mm[1] });
                    });
                }
            });
        }

        if (allSlots.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:40px 0;color:var(--muted);font-size:0.88rem;"><i class="fa-solid fa-calendar-xmark" style="font-size:2rem;margin-bottom:10px;display:block;opacity:0.4;"></i>No ${typeFilter === 'all' ? 'Major/Minor' : typeFilter} subjects found.</div>`;
            return;
        }

        // Merge multi-day entries: group by clean name + faculty + room + start + end + type
        const mergedMap = {};
        allSlots.forEach(s => {
            const cleanName = s.course_name.replace(/\s*\[.*?\]/g,'').replace(/\s*\(.*?\)/g,'').trim();
            const typeM = s.course_name.match(/\((Lecture|Laboratory)\)/);
            const lec = typeM ? (typeM[1] === 'Lecture' ? 'Lec' : 'Lab') : '';
            const key = cleanName + '||' + (s.faculty||'') + '||' + s.room + '||' + s.start_time + '||' + s.end_time + '||' + s._type;
            if (!mergedMap[key]) {
                mergedMap[key] = { name: cleanName, lec, faculty: s.faculty||'—', room: s.room, start_time: s.start_time, end_time: s.end_time, type: s._type, days: [], section: s.section||'' };
            }
            if (!mergedMap[key].days.includes(s.day)) mergedMap[key].days.push(s.day);
        });

        const merged = Object.values(mergedMap);
        merged.sort((a, b) => {
            if (sortFilt === 'course')    return a.name.localeCompare(b.name);
            if (sortFilt === 'professor') return (a.faculty||'').localeCompare(b.faculty||'');
            if (sortFilt === 'room')      return String(a.room).localeCompare(String(b.room), undefined, {numeric:true});
            if (sortFilt === 'time')      return timeToMins(a.start_time) - timeToMins(b.start_time);
            // default day-time: Major first, then day, then time
            if (a.type !== b.type) return a.type === 'Major' ? -1 : 1;
            const nc = a.name.localeCompare(b.name);
            if (nc !== 0) return nc;
            const da = Math.min(...a.days.map(d => DAY_ORDER.indexOf(d)));
            const db = Math.min(...b.days.map(d => DAY_ORDER.indexOf(d)));
            return da !== db ? da - db : timeToMins(a.start_time) - timeToMins(b.start_time);
        });

        // Group by type for display
        const groups = typeFilter === 'all'
            ? [{ label: 'Major Subjects', key: 'Major', color: '#854d0e', bg: '#fefce8', border: '#fde047', dot: '#eab308' },
               { label: 'Minor Subjects', key: 'Minor', color: '#86198f', bg: '#fdf4ff', border: '#f0abfc', dot: '#d946ef' }]
            : typeFilter === 'Major'
                ? [{ label: 'Major Subjects', key: 'Major', color: '#854d0e', bg: '#fefce8', border: '#fde047', dot: '#eab308' }]
                : [{ label: 'Minor Subjects', key: 'Minor', color: '#86198f', bg: '#fdf4ff', border: '#f0abfc', dot: '#d946ef' }];

        let html = '';
        groups.forEach(g => {
            const rows = merged.filter(r => r.type === g.key);
            if (rows.length === 0) return;

            html += `<div class="bscs-year-section">
                <div class="bscs-year-header" style="background:${g.bg};border-color:${g.dot};color:${g.color};">
                    <i class="fa-solid fa-circle" style="font-size:0.6rem;margin-right:8px;opacity:0.8;"></i>${g.label}
                    <span style="font-size:0.8rem;font-weight:400;margin-left:8px;opacity:0.75;">(${rows.length} subject${rows.length !== 1 ? 's' : ''})</span>
                </div>
                <div style="overflow-x:auto;">
                <table class="bscs-block-table" style="border:1.5px solid var(--border);border-radius:10px;overflow:hidden;">
                    <thead><tr>
                        <th style="text-align:left;">Subject Name</th>
                        <th>Section</th>
                        <th>Professor</th>
                        <th>Day</th>
                        <th>Start Time</th>
                        <th>End Time</th>
                        <th>Room</th>
                    </tr></thead><tbody>`;

            rows.forEach(r => {
                const dayLabel = r.days.sort((a,b) => DAY_ORDER.indexOf(a)-DAY_ORDER.indexOf(b)).map(d => DAY_SHORT[d]||d).join('-');
                const firstDay = r.days.sort((a,b) => DAY_ORDER.indexOf(a)-DAY_ORDER.indexOf(b))[0];
                const lecBadge = r.lec ? ` <span style="display:inline-block;margin-left:5px;padding:1px 6px;border-radius:4px;font-size:0.7rem;font-weight:700;background:${r.lec==='Lec'?'#eff6ff':'#f0fdf4'};color:${r.lec==='Lec'?'#1d4ed8':'#15803d'};border:1px solid ${r.lec==='Lec'?'#bfdbfe':'#86efac'};">${r.lec}</span>` : '';
                html += `<tr class="bscs-table-row" data-room="${escHtml(String(r.room))}" data-day="${escHtml(firstDay)}" data-start="${escHtml(r.start_time.slice(0,5))}" style="cursor:pointer;transition:background 0.15s;" title="Click to view on timetable">
                    <td><span style="font-weight:600;">${escHtml(r.name)}</span>${lecBadge}</td>
                    <td style="text-align:center;font-size:0.78rem;">${escHtml(r.section)}</td>
                    <td style="text-align:center;">${escHtml(r.faculty)}</td>
                    <td style="text-align:center;">${escHtml(dayLabel)}</td>
                    <td style="text-align:center;">${to12hr(r.start_time.slice(0,5))}</td>
                    <td style="text-align:center;">${to12hr(r.end_time.slice(0,5))}</td>
                    <td style="text-align:center;">${escHtml(String(r.room))}</td>
                </tr>`;
            });

            html += `</tbody></table></div></div>`;
        });

        container.innerHTML = html;

        // Row click → jump to timetable
        container.querySelectorAll('.bscs-table-row').forEach(tr => {
            tr.addEventListener('mouseenter', () => tr.style.background = 'var(--light-bg)');
            tr.addEventListener('mouseleave', () => tr.style.background = '');
            tr.addEventListener('click', () => {
                const room  = tr.dataset.room;
                const day   = tr.dataset.day;
                const start = tr.dataset.start;
                switchTab('room');
                if (day !== currentDay) {
                    currentDay = day;
                    document.querySelectorAll('#dayGrid .floor-btn').forEach(b => b.classList.toggle('active', b.dataset.day === day));
                }
                renderTimetable();
                setTimeout(() => {
                    const startMins = timeToMins(start);
                    const target = document.querySelector(`.scheduled-slot[data-room="${room}"][data-start-mins="${startMins}"]`);
                    if (!target) return;
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    target.classList.add('bscs-highlight');
                    setTimeout(() => target.classList.remove('bscs-highlight'), 2000);
                }, 80);
            });
        });
    }

    function printMajorMinorView() {
        const content = document.getElementById('majorMinorViewContent').innerHTML;
        const w = window.open('','_blank');
        w.document.write(`\x3C!DOCTYPE html>\x3Chtml>\x3Chead><title>Major / Minor Schedule</title>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Sora:wght@600;700&display=swap" rel="stylesheet">
        <\style>
            body { font-family: 'DM Sans', sans-serif; padding: 24px; color: #1e293b; }
            h1 { font-family: 'Sora', sans-serif; font-size: 1.1rem; margin-bottom: 20px; color: #0d1b3e; }
            .bscs-year-section { margin-bottom: 28px; }
            .bscs-year-header { font-family: 'Sora', sans-serif; font-size: 0.9rem; font-weight: 700; padding: 7px 12px; border-left: 4px solid; border-radius: 0 6px 6px 0; margin-bottom: 10px; }
            .bscs-block-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; border: 1.5px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
            .bscs-block-table th { padding: 6px 8px; background: #f8fafc; border-bottom: 1.5px solid #e2e8f0; border-right: 1px solid #e2e8f0; font-weight: 700; color: #0d1b3e; text-align: center; }
            .bscs-block-table th:first-child { text-align: left; }
            .bscs-block-table td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; vertical-align: top; }
            .bscs-block-table tr:last-child td { border-bottom: none; }
            .bscs-block-table td:last-child, .bscs-block-table th:last-child { border-right: none; }
        <\/style>\x3C/head>\x3Cbody>
        <h1>Major &amp; Minor Subjects — All Classes</h1>${content}\x3C/body>\x3C/html>`);
        w.document.close();
        w.print();
    }

    // ── BLOCK CONFLICT BANNER + SLOT BADGES ──
    function renderBlockConflictBanner() {
        const conflicts = getAllBlockConflicts();
        const banner    = document.getElementById('blockConflictBanner');
        const body      = document.getElementById('blockConflictBannerBody');
        const title     = document.getElementById('blockConflictBannerTitle');

        if (conflicts.length === 0) {
            banner.style.display = 'none';
            return;
        }

        const n = conflicts.length;
        title.textContent = n + ' block schedule conflict' + (n > 1 ? 's' : '') + ' detected — same block has overlapping subjects';
        banner.style.display = 'block';

        body.innerHTML = conflicts.map(({ a, b, section, day }) => {
            const timeA = to12hr(a.start_time.slice(0,5)) + ' – ' + to12hr(a.end_time.slice(0,5));
            const timeB = to12hr(b.start_time.slice(0,5)) + ' – ' + to12hr(b.end_time.slice(0,5));
            const nameA = escHtml(a.course_name.replace(/\s*\[.*?\]/g,'').replace(/\s*\(.*?\)/g,'').trim());
            const nameB = escHtml(b.course_name.replace(/\s*\[.*?\]/g,'').replace(/\s*\(.*?\)/g,'').trim());
            return `<div class="bcb-conflict-row"
                        data-slot-a-id="${escHtml(String(a.id))}" data-slot-a-room="${escHtml(String(a.room))}"
                        data-slot-b-id="${escHtml(String(b.id))}" data-slot-b-room="${escHtml(String(b.room))}"
                        data-day="${escHtml(day)}"
                        onclick="navigateToBannerConflict(this)">
                <strong>${escHtml(section)} · ${escHtml(day)}</strong>
                <div class="bcb-subjects">
                    <div class="bcb-subject-line"><span class="bcb-room-badge">Room ${a.room}</span> ${nameA} <span style="opacity:0.7;">${timeA}</span></div>
                    <div style="font-size:0.68rem;color:#dc2626;padding-left:2px;font-weight:700;">⟷ overlaps with</div>
                    <div class="bcb-subject-line"><span class="bcb-room-badge">Room ${b.room}</span> ${nameB} <span style="opacity:0.7;">${timeB}</span></div>
                </div>
                <div class="bcb-goto-hint"><i class="fa-solid fa-arrow-right"></i> Click to go to conflict &amp; suggest a fix</div>
            </div>`;
        }).join('');

        // Wire up each row after rendering
        body.querySelectorAll('.bcb-conflict-row').forEach(row => {
            row.addEventListener('click', () => navigateToBannerConflict(row));
        });
    }

    // ── TIMETABLE ──
    function renderTimetable() {
        const tbody = document.getElementById('timetableBody');
        tbody.innerHTML = '';
        const rooms = ALL_ROOMS.map(r => String(r));

        // Build per-room schedule map filtered by currentDay: roomStr → { startMins → slot }
        const roomMap = {};
        rooms.forEach(r => { roomMap[r] = {}; });
        rooms.forEach(r => {
            (allRoomSchedules[r] || []).filter(s => s.day === currentDay).forEach(s => {
                const sM = timeToMins(s.start_time);
                roomMap[r][sM] = { ...s, startMins: sM, endMins: timeToMins(s.end_time) };
            });
        });

        // Pre-compute which slot IDs are in a block conflict (for badge rendering)
        const conflictingIds = new Set();
        getAllBlockConflicts().forEach(({ a, b }) => {
            conflictingIds.add(String(a.id));
            conflictingIds.add(String(b.id));
        });

        const slotRows = HOURS.slice(0,-1);
        const used = {}; // used[rowIdx][colIdx]

        HOURS.forEach((hr, rowIdx) => {
            const rowMins  = timeToMins(hr);
            const isEndRow = rowIdx === HOURS.length-1;
            const tr = document.createElement('tr');
            const td0 = document.createElement('td');
            td0.className = 'time-col';
            td0.textContent = to12hr(hr);
            tr.appendChild(td0);

            rooms.forEach((room, colIdx) => {
                if (used[rowIdx] && used[rowIdx][colIdx]) return;
                if (isEndRow) { tr.appendChild(document.createElement('td')); return; }

                const slot = roomMap[room][rowMins];
                if (slot) {
                    const rawSpan = Math.round((slot.endMins-slot.startMins)/30);
                    const maxSpan = slotRows.length - rowIdx;
                    const span    = Math.max(1, Math.min(rawSpan, maxSpan));
                    const td = document.createElement('td');
                    const courseKey = (slot.section||'').trim().toUpperCase();
                    const slotColorClass = courseKey.startsWith('BSCS') ? 'slot-bscs'
                        : courseKey.startsWith('BSIT') ? 'slot-bsit'
                        : courseKey.startsWith('BSEMC-GD') ? 'slot-bsemc-gd'
                        : courseKey.startsWith('BSEMC') ? 'slot-bsemc-dat'
                        : 'slot-other';
                    td.className          = 'scheduled-slot ' + slotColorClass;
                    td.draggable          = canOwnSection(slot.section); // only draggable if coordinator owns it
                    td.rowSpan            = span;
                    td.dataset.scheduleId = slot.id;
                    td.dataset.room       = room;
                    td.dataset.startMins  = slot.startMins;
                    td.dataset.endMins    = slot.endMins;
                    // Strip [Major]/[Minor] tag; only show (Lecture)/(Laboratory) type as short label
                    const _rawName   = slot.course_name;
                    const _typeMatch = _rawName.match(/\((Lecture|Laboratory)\)/);
                    const _typeShort = _typeMatch ? (_typeMatch[1] === 'Lecture' ? 'Lec' : 'Lab') : '';
                    const _typeLabel = _typeShort ? ' <span style="opacity:0.75;font-size:0.65rem;">('+_typeShort+')</span>' : '';
                    const _dispName  = escHtml(_rawName.replace(/\s*\[.*?\]/g, '').replace(/\s*\(.*?\)/g, '').trim());
                    const _isMergedSection = /\//.test(slot.section);
                    const _mergedLabel = _isMergedSection
                        ? '<br><span class="merge-badge"><i class="fa-solid fa-code-merge" style="font-size:0.6rem;"></i> Merged</span>'
                        : '';
                    td.innerHTML =
                        '<div class="class-info">'+
                            '<strong>'+_dispName+_typeLabel+'</strong>'+
                            escHtml(slot.section)+'<br>'+
                            escHtml(slot.faculty)+
                            _mergedLabel+
                            (conflictingIds.has(String(slot.id)) ? '<br><span class="slot-conflict-badge"><i class="fa-solid fa-triangle-exclamation"></i> Block conflict</span>' : '')+
                        '</div>'+
                        '<span class="slot-id" data-id="'+slot.id+'" style="display:none"></span>';
                    tr.appendChild(td);
                    for (let r=1; r<span; r++) {
                        const ri = rowIdx+r;
                        if (ri < slotRows.length) { if (!used[ri]) used[ri]={}; used[ri][colIdx]=true; }
                    }
                } else {
                    const emptyTd = document.createElement('td');
                    emptyTd.dataset.room = room;
                    emptyTd.dataset.time = hr;
                    emptyTd.title = 'Click to schedule Room '+room+' at '+to12hr(hr);
                    emptyTd.addEventListener('click', () => {
                        currentRoom = room;
                        schedules   = allRoomSchedules[room] || [];
                        openScheduleModal(room, hr);
                    });
                    tr.appendChild(emptyTd);
                }
            });
            tbody.appendChild(tr);
        });

        // Update block conflict banner
        renderBlockConflictBanner();

        // ── SLOT CLICK → details modal (or suggest modal if block-conflict slot) ──
        tbody.querySelectorAll('.scheduled-slot').forEach(td => {
            td.addEventListener('click', () => {
                const id   = td.querySelector('.slot-id').dataset.id;
                const room = td.dataset.room;
                const s    = (allRoomSchedules[room]||[]).find(x => String(x.id)===String(id));
                if (!s) return;

                // If this slot has a block conflict badge, open suggest-move directly
                if (td.querySelector('.slot-conflict-badge')) {
                    openSuggestMoveForSlot(id, room);
                    return;
                }
                currentDetailId = String(s.id);
                currentRoom     = room;
                schedules       = allRoomSchedules[room] || [];
                document.getElementById('detailCourseName').textContent = s.course_name;
                document.getElementById('detailRoom').textContent = 'Room '+room+' · '+s.day;
                document.getElementById('detailSection').textContent = s.section;
                document.getElementById('detailFaculty').textContent = s.faculty;
                document.getElementById('detailDay').textContent = s.day;
                document.getElementById('detailTime').textContent = to12hr(s.start_time.slice(0,5))+' – '+to12hr(s.end_time.slice(0,5));
                // Show/hide Edit & Delete based on ownership
                const canEdit = canOwnSection(s.section);
                document.getElementById('detailEditBtn').style.display   = canEdit ? '' : 'none';
                document.getElementById('detailDeleteBtn').style.display = canEdit ? '' : 'none';
                document.getElementById('detailsModal').classList.add('show');
            });
        });

        // ── DRAG SOURCE ──
        tbody.querySelectorAll('.scheduled-slot[draggable]').forEach(slot => {
            slot.addEventListener('dragstart', (e) => {
                // Block drag if this slot belongs to another coordinator's course
                const draggedRoom    = slot.dataset.room;
                const draggedId      = slot.dataset.scheduleId;
                const draggedSlot    = (allRoomSchedules[draggedRoom]||[]).find(s => String(s.id)===String(draggedId));
                if (draggedSlot && !canOwnSection(draggedSlot.section)) {
                    e.preventDefault();
                    showToast('You can only move your own course\'s schedules', 'error');
                    return;
                }
                dragState.id      = slot.dataset.scheduleId;
                dragState.room    = slot.dataset.room;
                dragState.startM  = parseInt(slot.dataset.startMins);
                dragState.endM    = parseInt(slot.dataset.endMins);
                dragState.durMins = dragState.endM - dragState.startM;
                slot.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            slot.addEventListener('dragend', () => {
                slot.classList.remove('dragging');
                document.querySelectorAll('.drag-over,.drag-over-invalid')
                    .forEach(el => el.classList.remove('drag-over','drag-over-invalid'));
            });
        });

        // ── DROP TARGETS (empty cells) ──
        tbody.querySelectorAll('td[data-time]').forEach(cell => {
            cell.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (!dragState.id) return;
                const tM  = timeToMins(cell.dataset.time);
                const eM  = tM + dragState.durMins;
                const inv = eM > 21*60 ||
                    (cell.dataset.room===dragState.room && tM===dragState.startM);
                cell.classList.toggle('drag-over', !inv);
                cell.classList.toggle('drag-over-invalid', inv);
                e.dataTransfer.dropEffect = inv ? 'none' : 'move';
            });
            cell.addEventListener('dragleave', () => {
                cell.classList.remove('drag-over','drag-over-invalid');
            });
            cell.addEventListener('drop', (e) => {
                e.preventDefault();
                cell.classList.remove('drag-over','drag-over-invalid');
                if (!dragState.id) return;

                const selfId    = dragState.id;
                const srcRoom   = dragState.room;
                const destRoom  = cell.dataset.room;
                const newStartM = timeToMins(cell.dataset.time);
                const newEndM   = newStartM + dragState.durMins;

                if (destRoom===srcRoom && newStartM===dragState.startM) return;
                if (newEndM > 21*60) { showToast('Cannot extend past 9:00 PM','error'); return; }

                const newStart24 = minsToTime(newStartM);
                const newEnd24   = minsToTime(newEndM);

                const dragged = (allRoomSchedules[srcRoom]||[]).find(s => String(s.id)===String(selfId));
                if (!dragged) return;
                // Ownership check on drop
                if (!canOwnSection(dragged.section)) {
                    showToast('You can only move your own course\'s schedules', 'error');
                    return;
                }

                // Set currentRoom context to destination
                currentRoom = destRoom;
                schedules   = allRoomSchedules[destRoom] || [];

                // Conflict check in dest room — exclude self, same day only
                const conflict = schedules.find(s => {
                    if (String(s.id)===String(selfId)) return false;
                    if (s.day !== dragged.day) return false;
                    const sM=timeToMins(s.start_time), eM=timeToMins(s.end_time);
                    return newStartM < eM && newEndM > sM;
                });

                // Section conflict: same section already in another room at the same time (exclude self)
                const secConflict = !conflict
                    ? findSectionConflict(dragged.section, dragged.day, newStartM, newEndM, destRoom, selfId)
                    : null;

                document.getElementById('moveFromCard').innerHTML =
                    '<strong>'+escHtml(dragged.course_name)+'</strong>'+
                    escHtml(dragged.section)+'<br>'+escHtml(dragged.faculty)+'<br>'+
                    '<span class="move-time">Room '+srcRoom+', '+to12hr(dragged.start_time.slice(0,5))+' – '+to12hr(dragged.end_time.slice(0,5))+'</span>';
                document.getElementById('moveToCard').innerHTML =
                    '<strong>'+escHtml(dragged.course_name)+'</strong>'+
                    escHtml(dragged.section)+'<br>'+escHtml(dragged.faculty)+'<br>'+
                    '<span class="move-time">Room '+destRoom+', '+to12hr(newStart24)+' – '+to12hr(newEnd24)+'</span>';

                if (secConflict) {
                    // Section conflict on drag: block entirely — can't "replace" a different room's class for the same section
                    showToast('Section conflict: "'+dragged.section+'" is already scheduled in Room '+secConflict.room+' at that time','error');
                } else if (conflict) {
                    pendingNewEntry = {
                        courseName: dragged.course_name, section: dragged.section,
                        faculty:    dragged.faculty,     day:     dragged.day,
                        startTime:  newStart24,          endTime: newEnd24,
                        conflictId: conflict.id,
                        dragMoveId: selfId
                    };
                    pendingReplaceCtx = { srcRoom, destRoom };
                    document.getElementById('conflictSlotCard').innerHTML =
                        '<strong>'+escHtml(conflict.course_name)+'</strong>'+
                        escHtml(conflict.section)+'<br>'+escHtml(conflict.faculty)+'<br>'+
                        '<span class="slot-time">'+to12hr(conflict.start_time.slice(0,5))+' – '+to12hr(conflict.end_time.slice(0,5))+'</span>';
                    document.getElementById('conflictModal').classList.add('show');
                } else {
                    pendingMoveData = { id: selfId, srcRoom, destRoom, start_time: newStart24+':00', end_time: newEnd24+':00', day: dragged.day };
                    document.getElementById('moveModal').classList.add('show');
                }
            });
        });

        // Re-apply active legend filter after re-render
        if (typeof activeFilter !== 'undefined') applyLegendFilter(activeFilter);
    }

    // ── DETAILS MODAL ──
    document.getElementById('detailsCloseBtn').addEventListener('click', () =>
        document.getElementById('detailsModal').classList.remove('show'));
    document.getElementById('detailsModal').addEventListener('click', (e) => {
        if (e.target===document.getElementById('detailsModal'))
            document.getElementById('detailsModal').classList.remove('show');
    });
    document.getElementById('detailDeleteBtn').addEventListener('click', () => {
        const _sDel = schedules.find(x => String(x.id)===String(currentDetailId));
        if (_sDel && !canOwnSection(_sDel.section)) {
            showToast('You can only delete your own course\'s schedules', 'error'); return;
        }
        document.getElementById('detailsModal').classList.remove('show');
        pendingDeleteId = currentDetailId;
        const s = schedules.find(x => String(x.id)===String(pendingDeleteId));
        document.getElementById('deleteModalMsg').textContent =
            s ? 'Remove "'+s.course_name+'" ('+s.day+') from Room '+currentRoom+'?' : 'Remove this schedule?';
        document.getElementById('deleteModal').classList.add('show');
    });
    document.getElementById('detailEditBtn').addEventListener('click', () => {
        const s = schedules.find(x => String(x.id)===String(currentDetailId));
        if (!s) return;
        if (!canOwnSection(s.section)) {
            showToast('You can only edit your own course\'s schedules', 'error'); return;
        }
        document.getElementById('detailsModal').classList.remove('show');
        const typeMatch = s.course_name.match(/ \((Lecture|Laboratory|None)\)/);
        const majorMinorMatch = s.course_name.match(/ \[(Major|Minor)\]/);
        document.getElementById('editCourseName').value  = s.course_name.replace(/ \[(Major|Minor)\]/, '').replace(/ \((Lecture|Laboratory|None)\)/, '').trim();
        document.getElementById('editCourseType').value  = typeMatch ? typeMatch[1] : '';
        document.getElementById('editCourseMajorMinor').value = majorMinorMatch ? majorMinorMatch[1] : '';
        const isMinor = majorMinorMatch && majorMinorMatch[1] === 'Minor';
        document.getElementById('editCourseType').disabled = isMinor;
        document.getElementById('editCourseType').style.opacity = isMinor ? '0.5' : '1';
        document.getElementById('editCourseType').style.cursor = isMinor ? 'not-allowed' : '';
        // Parse stored section e.g. "BSCS 2-A" or "BSCS 2-A/B" into parts
        const secParts = (s.section || '').match(/^(\S+)\s+(\d+)-([A-F])(?:\/([A-F]))?$/);
        const scEl = document.getElementById('editSectionCourse');
        const syEl = document.getElementById('editSectionYear');
        const sbEl = document.getElementById('editSectionBlock');
        scEl.value = secParts ? secParts[1] : ''; if (!scEl.value) scEl.selectedIndex = 0;
        syEl.value = secParts ? secParts[2] : ''; if (!syEl.value) syEl.selectedIndex = 0;
        sbEl.value = secParts ? secParts[3] : ''; if (!sbEl.value) sbEl.selectedIndex = 0;
        // Handle merged block
        const block2 = secParts ? secParts[4] : null;
        setEditMerge(!!block2);
        if (block2) document.getElementById('editSectionBlock2').value = block2;
        document.getElementById('editFaculty').value    = s.faculty;
        setEditDays([s.day]);
        document.getElementById('editDayError').style.display = 'none';
        document.getElementById('editStartTime').value  = s.start_time.slice(0,5);
        document.getElementById('editEndTime').value    = s.end_time.slice(0,5);
        document.getElementById('editSubtitle').textContent = 'Room '+currentRoom+' · '+s.day;
        renderEditStartTimePill(s.start_time.slice(0,5));
        document.getElementById('editModal').classList.add('show');
    });
    document.getElementById('editCancelBtn').addEventListener('click', () =>
        document.getElementById('editModal').classList.remove('show'));
    document.getElementById('editModal').addEventListener('click', (e) => {
        if (e.target===document.getElementById('editModal'))
            document.getElementById('editModal').classList.remove('show');
    });
    // ── EDIT DAY TOGGLE LOGIC ──
    document.getElementById('editDayGroup').addEventListener('click', (e) => {
        const btn = e.target.closest('.day-toggle-btn');
        if (!btn) return;
        btn.classList.toggle('active');
        document.getElementById('editDayError').style.display = 'none';
    });

    function getEditSelectedDays() {
        return [...document.querySelectorAll('#editDayGroup .day-toggle-btn.active')]
            .map(b => b.dataset.day);
    }

    function setEditDays(days) {
        document.querySelectorAll('#editDayGroup .day-toggle-btn').forEach(b => {
            b.classList.toggle('active', days.includes(b.dataset.day));
        });
    }

    document.getElementById('editSaveBtn').addEventListener('click', async () => {
        const id         = currentDetailId;
        const courseName  = document.getElementById('editCourseName').value.trim();
        const editCourseType = document.getElementById('editCourseType').value;
        const editCourseMajorMinor = document.getElementById('editCourseMajorMinor').value;
        const editSecCourse = document.getElementById('editSectionCourse').value;
        const editSecYear   = document.getElementById('editSectionYear').value;
        const editSecBlock  = document.getElementById('editSectionBlock').value;
        const editSecBlock2 = editMergeActive ? document.getElementById('editSectionBlock2').value : '';
        const editBlockStr  = editSecBlock2 ? editSecBlock+'/'+editSecBlock2 : editSecBlock;
        const section       = editSecCourse && editSecYear && editBlockStr ? editSecCourse+' '+editSecYear+'-'+editBlockStr : '';
        const faculty    = document.getElementById('editFaculty').value.trim();
        const selectedDays = getEditSelectedDays();
        const startTime  = document.getElementById('editStartTime').value;
        const endTime    = document.getElementById('editEndTime').value;

        if (selectedDays.length === 0) { document.getElementById('editDayError').style.display = 'block'; return; }
        if (!courseName||!section||!faculty||!startTime||!endTime) { showToast('Please fill in all fields','error'); return; }
        if (editMergeActive && !editSecBlock2) { showToast('Please select the 2nd block for merged class','error'); return; }
        if (editMergeActive && editSecBlock2 === editSecBlock) { showToast('Merged blocks must be different','error'); return; }
        if (!editCourseMajorMinor) { showToast('Please select Major or Minor','error'); return; }
        if (!editCourseType) { showToast('Please select a class type (Lec/Lab)','error'); return; }
        if (!editSecCourse||!editSecYear||!editSecBlock) { showToast('Please complete the section fields','error'); return; }
        if (startTime>=endTime) { showToast('End time must be after start time','error'); return; }

        const sM=timeToMins(startTime), eM=timeToMins(endTime);
        const fullCourseName = courseName+(editCourseMajorMinor?' ['+editCourseMajorMinor+']':'')+(editCourseType&&editCourseType!=='None'?' ('+editCourseType+')':'');

        // Check conflicts on all selected days (skip the record being edited)
        for (const day of selectedDays) {
            // Room conflict in current room
            const roomConflict = schedules.find(s => {
                if (String(s.id)===String(id)||s.day!==day) return false;
                return sM < timeToMins(s.end_time) && eM > timeToMins(s.start_time);
            });
            if (roomConflict) { showToast('Room conflict with "'+roomConflict.course_name+'" on '+day,'error'); return; }

            // Section conflict across all other rooms (exclude self)
            const secConflict = findSectionConflict(section, day, sM, eM, currentRoom, id);
            if (secConflict) {
                showToast('Section conflict: "'+section+'" is already in Room '+secConflict.room+' on '+day+' at that time','error');
                return;
            }
        }

        const updatedFields = { course_name: fullCourseName, section, faculty, start_time:startTime+':00', end_time:endTime+':00' };

        pushUndo('Schedule edited');
        if (SUPABASE_URL==='YOUR_SUPABASE_URL') {
            // Update the original record (first selected day) and insert extras
            const [firstDay, ...extraDays] = selectedDays;
            schedules = schedules.map(s => String(s.id)===String(id) ? {...s,...updatedFields, day: firstDay} : s);
            logAudit('Schedule edited', id, currentRoom, { ...updatedFields, day: firstDay });
            for (const day of extraDays) {
                const ne = { ...updatedFields, id: Date.now()+Math.random(), room: currentRoom, day };
                schedules.push(ne);
                logAudit('Schedule added', ne.id, currentRoom, ne);
            }
            allRoomSchedules[currentRoom] = schedules;
            localStorage.setItem('schedules_'+currentRoom, JSON.stringify(schedules));
            renderTimetable();
            document.getElementById('editModal').classList.remove('show');
            showToast(selectedDays.length > 1 ? 'Schedule updated for '+selectedDays.length+' days!' : 'Schedule updated!','success'); return;
        }
        // Supabase: update original record, insert any extra days
        const { error } = await _supabase.from('schedules').update({...updatedFields, day: selectedDays[0]}).eq('id', id);
        if (error) { showToast('Failed to save changes','error'); return; }
        logAudit('Schedule edited', id, currentRoom, { ...updatedFields, day: selectedDays[0] });
        if (selectedDays.length > 1) {
            const extras = selectedDays.slice(1).map(day => ({ room: currentRoom, ...updatedFields, day }));
            const { error: ie, data: extraData } = await _supabase.from('schedules').insert(extras).select();
            if (ie) { showToast('Saved main day but failed to add extra days','error'); loadSchedules(); return; }
            (extraData || extras).forEach(entry => logAudit('Schedule added', entry.id, currentRoom, entry));
        }
        document.getElementById('editModal').classList.remove('show');
        showToast(selectedDays.length > 1 ? 'Schedule updated for '+selectedDays.length+' days!' : 'Schedule updated!','success');
        loadSchedules();
    });

    // ── DELETE MODAL ──
    document.getElementById('deleteCancelBtn').addEventListener('click', () =>
        document.getElementById('deleteModal').classList.remove('show'));
    document.getElementById('deleteConfirmBtn').addEventListener('click', async () => {
        document.getElementById('deleteModal').classList.remove('show');
        if (!pendingDeleteId) return;
        pushUndo('Schedule removed');
        if (SUPABASE_URL==='YOUR_SUPABASE_URL') {
            const deleted = schedules.find(s => String(s.id)===String(pendingDeleteId));
            schedules = schedules.filter(s => String(s.id)!==String(pendingDeleteId));
            allRoomSchedules[currentRoom] = schedules;
            localStorage.setItem('schedules_'+currentRoom, JSON.stringify(schedules));
            logAudit('Schedule deleted', pendingDeleteId, currentRoom, deleted || {});
            renderTimetable(); showToast('Schedule removed','success'); pendingDeleteId=null; return;
        }
        const delTarget = schedules.find(s => String(s.id)===String(pendingDeleteId));
        const { error } = await _supabase.from('schedules').delete().eq('id',pendingDeleteId);
        if (error) { showToast('Failed to delete','error'); return; }
        logAudit('Schedule deleted', pendingDeleteId, currentRoom, delTarget || {});
        showToast('Schedule removed','success'); pendingDeleteId=null; loadSchedules();
    });

    // ── ADD SCHEDULE FORM ──
    // ── SCHEDULE MODAL OPEN/CLOSE ──
    // ── AUTO-SET TYPE TO NONE WHEN MINOR IS SELECTED ──
    document.getElementById('courseMajorMinor').addEventListener('change', function() {
        const typeSelect = document.getElementById('courseType');
        if (this.value === 'Minor') {
            typeSelect.value = 'None';
            typeSelect.disabled = true;
            typeSelect.style.opacity = '0.5';
            typeSelect.style.cursor = 'not-allowed';
        } else {
            typeSelect.disabled = false;
            typeSelect.style.opacity = '1';
            typeSelect.style.cursor = '';
        }
    });

    document.getElementById('editCourseMajorMinor').addEventListener('change', function() {
        const typeSelect = document.getElementById('editCourseType');
        if (this.value === 'Minor') {
            typeSelect.value = 'None';
            typeSelect.disabled = true;
            typeSelect.style.opacity = '0.5';
            typeSelect.style.cursor = 'not-allowed';
        } else {
            typeSelect.disabled = false;
            typeSelect.style.opacity = '1';
            typeSelect.style.cursor = '';
        }
    });

    // ── START TIME PILL ──
    (function injectStartTimePillStyles() {
        const s = document.createElement('style');
        s.textContent = `
            .start-time-pill {
                display: inline-flex; align-items: center; gap: 5px;
                background: rgba(255,255,255,0.18);
                border: 1.5px solid rgba(255,255,255,0.35);
                border-radius: 20px;
                padding: 2px 10px 2px 8px;
                font-size: 0.78rem; font-weight: 600;
                color: inherit;
                cursor: pointer;
                transition: background 0.15s, border-color 0.15s;
                position: relative;
                white-space: nowrap;
            }
            .start-time-pill:hover {
                background: rgba(255,255,255,0.28);
                border-color: rgba(255,255,255,0.6);
            }
            .start-time-pill i { font-size: 0.68rem; opacity: 0.8; }
            .start-time-pill .pill-caret { font-size: 0.6rem; opacity: 0.7; margin-left: 1px; }
            .start-time-dropdown {
                position: absolute;
                top: calc(100% + 6px);
                left: 0;
                z-index: 9999;
                background: var(--white);
                border: 1.5px solid var(--border);
                border-radius: 10px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.14);
                max-height: 220px;
                overflow-y: auto;
                min-width: 140px;
                padding: 4px 0;
            }
            .start-time-dropdown-option {
                padding: 8px 14px;
                font-size: 0.82rem;
                font-weight: 500;
                color: var(--text);
                cursor: pointer;
                transition: background 0.12s;
                font-family: 'DM Sans', sans-serif;
            }
            .start-time-dropdown-option:hover { background: var(--light-bg); }
            .start-time-dropdown-option.selected {
                background: var(--navy);
                color: white;
                font-weight: 700;
            }
            body.dark-mode .start-time-dropdown { background: #1e293b; border-color: #334155; }
            body.dark-mode .start-time-dropdown-option { color: #e2e8f0; }
            body.dark-mode .start-time-dropdown-option:hover { background: #334155; }
            body.dark-mode .start-time-dropdown-option.selected { background: var(--accent); color: white; }
        `;
        document.head.appendChild(s);
    })();

    const TIME_OPTIONS = [
        {v:'07:00',l:'7:00 AM'},{v:'07:30',l:'7:30 AM'},
        {v:'08:00',l:'8:00 AM'},{v:'08:30',l:'8:30 AM'},
        {v:'09:00',l:'9:00 AM'},{v:'09:30',l:'9:30 AM'},
        {v:'10:00',l:'10:00 AM'},{v:'10:30',l:'10:30 AM'},
        {v:'11:00',l:'11:00 AM'},{v:'11:30',l:'11:30 AM'},
        {v:'12:00',l:'12:00 PM'},{v:'12:30',l:'12:30 PM'},
        {v:'13:00',l:'1:00 PM'},{v:'13:30',l:'1:30 PM'},
        {v:'14:00',l:'2:00 PM'},{v:'14:30',l:'2:30 PM'},
        {v:'15:00',l:'3:00 PM'},{v:'15:30',l:'3:30 PM'},
        {v:'16:00',l:'4:00 PM'},{v:'16:30',l:'4:30 PM'},
        {v:'17:00',l:'5:00 PM'},{v:'17:30',l:'5:30 PM'},
        {v:'18:00',l:'6:00 PM'},{v:'18:30',l:'6:30 PM'},
        {v:'19:00',l:'7:00 PM'},{v:'19:30',l:'7:30 PM'},
        {v:'20:00',l:'8:00 PM'},{v:'20:30',l:'8:30 PM'},
        {v:'21:00',l:'9:00 PM'}
    ];

    let startTimePillDropdownOpen = false;

    function renderStartTimePill(time) {
        const sub = document.getElementById('scheduleModalSub');
        sub.innerHTML = '';
        if (!time) return;

        // "Starting at" label
        const label = document.createElement('span');
        label.textContent = 'Starting at';
        sub.appendChild(label);

        // Pill wrapper (position:relative for dropdown anchor)
        const wrapper = document.createElement('span');
        wrapper.style.position = 'relative';

        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'start-time-pill';
        pill.innerHTML = `<i class="fa-solid fa-clock"></i><span id="pillTimeLabel">${to12hr(time)}</span><i class="fa-solid fa-chevron-down pill-caret"></i>`;

        const dropdown = document.createElement('div');
        dropdown.className = 'start-time-dropdown';
        dropdown.style.display = 'none';

        TIME_OPTIONS.forEach(opt => {
            const item = document.createElement('div');
            item.className = 'start-time-dropdown-option' + (opt.v === time ? ' selected' : '');
            item.textContent = opt.l;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault(); // prevent blur firing first
                selectStartTime(opt.v, opt.l, dropdown, pill);
            });
            dropdown.appendChild(item);
        });

        pill.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.style.display !== 'none';
            dropdown.style.display = isOpen ? 'none' : 'block';
            startTimePillDropdownOpen = !isOpen;
            if (!isOpen) {
                // Scroll selected option into view
                const sel = dropdown.querySelector('.selected');
                if (sel) sel.scrollIntoView({ block: 'nearest' });
            }
        });

        wrapper.appendChild(pill);
        wrapper.appendChild(dropdown);
        sub.appendChild(wrapper);

        // Close on outside click
        document.addEventListener('click', function closePillDropdown(e) {
            if (!wrapper.contains(e.target)) {
                dropdown.style.display = 'none';
                startTimePillDropdownOpen = false;
                document.removeEventListener('click', closePillDropdown);
            }
        });
    }

    let editStartTimePillDropdownOpen = false;

    function renderEditStartTimePill(time) {
        const sub = document.getElementById('editModalSub');
        // Remove any existing pill wrapper (keep the editSubtitle span)
        [...sub.children].forEach(c => { if (c.id !== 'editSubtitle') c.remove(); });
        if (!time) return;

        const sep = document.createElement('span');
        sep.textContent = '·';
        sep.style.opacity = '0.5';
        sub.appendChild(sep);

        const label = document.createElement('span');
        label.textContent = 'Starting at';
        sub.appendChild(label);

        const wrapper = document.createElement('span');
        wrapper.style.position = 'relative';

        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'start-time-pill';
        pill.innerHTML = `<i class="fa-solid fa-clock"></i><span id="editPillTimeLabel">${to12hr(time)}</span><i class="fa-solid fa-chevron-down pill-caret"></i>`;

        const dropdown = document.createElement('div');
        dropdown.className = 'start-time-dropdown';
        dropdown.style.display = 'none';

        TIME_OPTIONS.forEach(opt => {
            const item = document.createElement('div');
            item.className = 'start-time-dropdown-option' + (opt.v === time ? ' selected' : '');
            item.textContent = opt.l;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                selectEditStartTime(opt.v, opt.l, dropdown, pill);
            });
            dropdown.appendChild(item);
        });

        pill.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.style.display !== 'none';
            dropdown.style.display = isOpen ? 'none' : 'block';
            editStartTimePillDropdownOpen = !isOpen;
            if (!isOpen) {
                const sel = dropdown.querySelector('.selected');
                if (sel) sel.scrollIntoView({ block: 'nearest' });
            }
        });

        wrapper.appendChild(pill);
        wrapper.appendChild(dropdown);
        sub.appendChild(wrapper);

        document.getElementById('editStartTime').value = time;

        document.addEventListener('click', function closeEditPillDropdown(e) {
            if (!wrapper.contains(e.target)) {
                dropdown.style.display = 'none';
                editStartTimePillDropdownOpen = false;
                document.removeEventListener('click', closeEditPillDropdown);
            }
        });
    }

    function selectEditStartTime(value, label, dropdown, pill) {
        document.getElementById('editStartTime').value = value;
        pill.querySelector('#editPillTimeLabel').textContent = label;
        dropdown.querySelectorAll('.start-time-dropdown-option').forEach(opt => {
            opt.classList.toggle('selected', opt.textContent === label);
        });
        dropdown.style.display = 'none';
        editStartTimePillDropdownOpen = false;
        // Auto-update end time if it's before or equal to new start
        const endSel = document.getElementById('editEndTime');
        const newEndM = timeToMins(value) + 60;
        const curEndM = endSel.value ? timeToMins(endSel.value) : 0;
        if (!endSel.value || curEndM <= timeToMins(value)) {
            endSel.value = newEndM <= 21*60 ? minsToTime(newEndM) : '';
        }
    }

    function selectStartTime(value, label, dropdown, pill) {
        // Update hidden input
        document.getElementById('startTime').value = value;
        // Update pill label
        pill.querySelector('#pillTimeLabel').textContent = label;
        // Update selected state in dropdown
        dropdown.querySelectorAll('.start-time-dropdown-option').forEach(opt => {
            opt.classList.toggle('selected', opt.textContent === label);
        });
        // Close dropdown
        dropdown.style.display = 'none';
        startTimePillDropdownOpen = false;
        // Auto-update end time to +1hr if end time hasn't been manually set or is before new start
        const endSel = document.getElementById('endTime');
        const newEndM = timeToMins(value) + 60;
        const curEndM = endSel.value ? timeToMins(endSel.value) : 0;
        if (!endSel.value || curEndM <= timeToMins(value)) {
            endSel.value = newEndM <= 21*60 ? minsToTime(newEndM) : '';
        }
        // Re-validate end time against the new start time
        if (typeof validateEndTime === 'function') validateEndTime();
    }

    // ── MERGED CLASS TOGGLE (ADD MODAL) ──
    let mergeActive = false;
    function setMerge(active) {
        mergeActive = active;
        document.getElementById('mergeTrack').style.background  = active ? '#3b82f6' : '#cbd5e1';
        document.getElementById('mergeThumb').style.left        = active ? '18px'   : '2px';
        document.getElementById('sectionBlock2').style.display  = active ? ''       : 'none';
        document.getElementById('mergeToggleText').textContent  = active ? 'On'     : 'Off';
        if (!active) document.getElementById('sectionBlock2').value = '';
    }
    document.getElementById('mergeTrack').addEventListener('click', () => setMerge(!mergeActive));

    // ── MERGED CLASS TOGGLE (EDIT MODAL) ──
    let editMergeActive = false;
    function setEditMerge(active) {
        editMergeActive = active;
        document.getElementById('editMergeTrack').style.background  = active ? '#3b82f6' : '#cbd5e1';
        document.getElementById('editMergeThumb').style.left        = active ? '18px'   : '2px';
        document.getElementById('editSectionBlock2').style.display  = active ? ''       : 'none';
        document.getElementById('editMergeToggleText').textContent  = active ? 'On'     : 'Off';
        if (!active) document.getElementById('editSectionBlock2').value = '';
    }
    document.getElementById('editMergeTrack').addEventListener('click', () => setEditMerge(!editMergeActive));

    // ── DAY TOGGLE BUTTON LOGIC ──
    document.getElementById('dayOfWeekGroup').addEventListener('click', (e) => {
        const btn = e.target.closest('.day-toggle-btn');
        if (!btn) return;
        btn.classList.toggle('active');
        document.getElementById('dayOfWeekError').style.display = 'none';
    });

    function getSelectedDays() {
        return [...document.querySelectorAll('#dayOfWeekGroup .day-toggle-btn.active')]
            .map(b => b.dataset.day);
    }

    function setSelectedDays(days) {
        document.querySelectorAll('#dayOfWeekGroup .day-toggle-btn').forEach(b => {
            b.classList.toggle('active', days.includes(b.dataset.day));
        });
    }

    function openScheduleModal(room, time) {
        currentRoom = room || currentRoom;
        schedules   = allRoomSchedules[currentRoom] || [];
        document.getElementById('courseName').value  = '';
        document.getElementById('courseMajorMinor').value = '';
        document.getElementById('courseType').disabled = false;
        document.getElementById('courseType').style.opacity = '1';
        document.getElementById('courseType').style.cursor = '';
        document.getElementById('sectionCourse').value = '';
        document.getElementById('sectionYear').value   = '';
        document.getElementById('sectionBlock').value  = '';
        document.getElementById('faculty').value     = '';
        setMerge(false);
        // Re-apply coordinator course lock if active (reset above clears the selection)
        if (coordinatorCourse) lockSectionDropdowns(coordinatorCourse);
        // Pre-select the currently viewed day
        setSelectedDays(currentDay ? [currentDay] : []);
        document.getElementById('dayOfWeekError').style.display = 'none';
        document.getElementById('startTime').value   = time || '';
        if (time) {
            const endM = timeToMins(time) + 60;
            document.getElementById('endTime').value = endM <= 21*60 ? minsToTime(endM) : '';
        } else {
            document.getElementById('endTime').value = '';
        }
        document.getElementById('scheduleModalTitle').textContent = 'Schedule Room ' + currentRoom;
        renderStartTimePill(time);
        // Reset end time warning state
        document.getElementById('endTimeWarning').style.display = 'none';
        document.getElementById('endTime').style.borderColor = '';
        document.getElementById('scheduleModal').classList.add('show');
        broadcastPresence({ editing_room: currentRoom });
    }
    document.getElementById('scheduleModalCloseBtn').addEventListener('click', () => {
        document.getElementById('scheduleModal').classList.remove('show'); broadcastPresence({ editing_room: null });
        broadcastPresence({ editing_room: null });
    });
    document.getElementById('scheduleModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('scheduleModal')) {
            document.getElementById('scheduleModal').classList.remove('show'); broadcastPresence({ editing_room: null });
            broadcastPresence({ editing_room: null });
        }
    });

    // ── END TIME VALIDATION ──
    function validateEndTime() {
        const startVal = document.getElementById('startTime').value;
        const endVal   = document.getElementById('endTime').value;
        const warning  = document.getElementById('endTimeWarning');
        const warnText = document.getElementById('endTimeWarningText');
        const endSel   = document.getElementById('endTime');
        if (!endVal || !startVal) { warning.style.display = 'none'; endSel.style.borderColor = ''; return true; }
        if (endVal <= startVal) {
            warnText.textContent = 'End time must be after ' + to12hr(startVal) + '. Please pick a later time.';
            warning.style.display = 'flex';
            endSel.style.borderColor = '#ef4444';
            endSel.value = ''; // reset the invalid selection
            return false;
        }
        warning.style.display = 'none';
        endSel.style.borderColor = '';
        return true;
    }
    document.getElementById('endTime').addEventListener('change', validateEndTime);

    document.getElementById('scheduleForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const courseName = document.getElementById('courseName').value.trim();
        const courseType = document.getElementById('courseType').value;
        const courseMajorMinor = document.getElementById('courseMajorMinor').value;
        const sectionCourse = document.getElementById('sectionCourse').value;
        const sectionYear   = document.getElementById('sectionYear').value;
        const sectionBlock  = document.getElementById('sectionBlock').value;
        const sectionBlock2 = mergeActive ? document.getElementById('sectionBlock2').value : '';
        const blockStr      = sectionBlock2 ? sectionBlock+'/'+sectionBlock2 : sectionBlock;
        const section       = sectionCourse && sectionYear && blockStr ? sectionCourse+' '+sectionYear+'-'+blockStr : '';
        const faculty    = document.getElementById('faculty').value.trim();
        const selectedDays = getSelectedDays();
        const startTime  = document.getElementById('startTime').value;
        const endTime    = document.getElementById('endTime').value;

        // Validate days
        if (selectedDays.length === 0) {
            document.getElementById('dayOfWeekError').style.display = 'block';
            return;
        }
        if (!courseName||!section||!faculty||!startTime||!endTime) { showToast('Please fill in all fields','error'); return; }
        if (mergeActive && !sectionBlock2) { showToast('Please select the 2nd block for merged class','error'); return; }
        if (mergeActive && sectionBlock2 === sectionBlock) { showToast('Merged blocks must be different','error'); return; }
        if (!courseMajorMinor) { showToast('Please select Major or Minor','error'); return; }
        if (!courseType) { showToast('Please select a class type (Lec/Lab)','error'); return; }
        if (startTime>=endTime) { showToast('End time must be after start time','error'); return; }

        const sM = timeToMins(startTime), eM = timeToMins(endTime);
        const fullCourseName = courseName+(courseMajorMinor?' ['+courseMajorMinor+']':'')+(courseType&&courseType!=='None'?' ('+courseType+')':'');

        // Check conflicts for ALL selected days — room conflict AND block/section conflict across all rooms
        let conflictSlot = null, conflictDay = null, conflictType = null;
        for (const day of selectedDays) {
            // 1. Room conflict: same room, same day, overlapping time
            const roomSchedules = allRoomSchedules[currentRoom] || [];
            const roomConflict = roomSchedules.find(s => {
                if (s.day!==day) return false;
                return sM < timeToMins(s.end_time) && eM > timeToMins(s.start_time);
            });
            if (roomConflict) { conflictDay = day; conflictSlot = roomConflict; conflictType = 'room'; break; }

            // 2. Block conflict: same section already has a class at this time in ANY room (hard block)
            // Minor subjects are exempt — they legitimately run in parallel for the same section
            const blockConflict = /\[Minor\]/i.test(fullCourseName) ? null : findBlockConflict(section, day, sM, eM, currentRoom, null);
            if (blockConflict) { conflictDay = day; conflictSlot = blockConflict; conflictType = 'block'; break; }

            // 3. Legacy section conflict check (different room, kept for safety)
            const secConflict = findSectionConflict(section, day, sM, eM, currentRoom, null);
            if (secConflict) { conflictDay = day; conflictSlot = secConflict; conflictType = 'section'; break; }
        }
        if (conflictSlot) {
            if (conflictType === 'block' || conflictType === 'section') {
                // Hard block — same section already occupied at this time. Show clear error, do NOT proceed.
                const conflictName = escHtml(conflictSlot.course_name.replace(/\s*\[.*?\]/g,'').replace(/\s*\(.*?\)/g,'').trim());
                const conflictTime = to12hr(conflictSlot.start_time.slice(0,5)) + ' – ' + to12hr(conflictSlot.end_time.slice(0,5));
                showToast('Block conflict: ' + section + ' already has "' + conflictSlot.course_name.replace(/\s*\[.*?\]/g,'').replace(/\s*\(.*?\)/g,'').trim() + '" on ' + conflictDay + ' at that time (Room ' + (conflictSlot.room || '') + ')', 'error');
                // Also show the block conflict modal for detail
                document.getElementById('blockConflictNewModal').style.display = 'flex';
                document.getElementById('bcnmSection').textContent = section;
                document.getElementById('bcnmDay').textContent = conflictDay;
                document.getElementById('bcnmExistingName').textContent = conflictSlot.course_name.replace(/\s*\[.*?\]/g,'').replace(/\s*\(.*?\)/g,'').trim();
                document.getElementById('bcnmExistingTime').textContent = conflictTime;
                document.getElementById('bcnmExistingRoom').textContent = 'Room ' + (conflictSlot.room || currentRoom);
                document.getElementById('bcnmNewName').textContent = courseName;
                document.getElementById('bcnmNewTime').textContent = to12hr(startTime) + ' – ' + to12hr(endTime);
                document.getElementById('bcnmNewRoom').textContent = 'Room ' + currentRoom;
                return;
            }
            pendingNewEntry = { courseName: fullCourseName, section, faculty, day: conflictDay, startTime, endTime, conflictId: conflictSlot.id, dragMoveId: null, allDays: selectedDays };
            const conflictRoomNote = '';
            document.getElementById('conflictSlotCard').innerHTML =
                '<strong>'+escHtml(conflictSlot.course_name)+'</strong>'+
                escHtml(conflictSlot.section)+'<br>'+escHtml(conflictSlot.faculty)+'<br>'+
                '<span class="slot-time">'+to12hr(conflictSlot.start_time.slice(0,5))+' – '+to12hr(conflictSlot.end_time.slice(0,5))+'</span>'+
                '<br><span style="font-size:0.75rem;color:#f59e0b;">Conflict on: '+conflictDay+'</span>';
            document.getElementById('conflictModal').classList.add('show');
            return;
        }

        const btn = document.getElementById('submitBtn');
        btn.classList.add('loading'); btn.disabled=true;

        pushUndo('Schedule added');
        if (SUPABASE_URL==='YOUR_SUPABASE_URL') {
            for (const day of selectedDays) {
                const newEntry = { id: Date.now() + Math.random(), room:currentRoom, course_name:fullCourseName, section, faculty, day, start_time:startTime+':00', end_time:endTime+':00' };
                schedules.push(newEntry);
                logAudit('Schedule added', newEntry.id, currentRoom, newEntry);
            }
            allRoomSchedules[currentRoom] = schedules;
            localStorage.setItem('schedules_'+currentRoom, JSON.stringify(schedules));
            renderTimetable(); document.getElementById('scheduleForm').reset();
            setSelectedDays([]);
            document.getElementById('courseType').value = '';
            document.getElementById('scheduleModal').classList.remove('show'); broadcastPresence({ editing_room: null });
            showToast(selectedDays.length > 1 ? 'Schedule added for '+selectedDays.length+' days!' : 'Schedule added!','success');
            btn.classList.remove('loading'); btn.disabled=false; return;
        }

        const newEntries = selectedDays.map(day => ({
            room:currentRoom, course_name:fullCourseName, section, faculty, day, start_time:startTime+':00', end_time:endTime+':00'
        }));
        const { error, data: insertedData } = await _supabase.from('schedules').insert(newEntries).select();
        btn.classList.remove('loading'); btn.disabled=false;
        if (error) { showToast('Failed to save: '+error.message,'error'); return; }
        (insertedData || newEntries).forEach(entry => logAudit('Schedule added', entry.id, currentRoom, entry));
        document.getElementById('scheduleForm').reset();
        setSelectedDays([]);
        document.getElementById('scheduleModal').classList.remove('show'); broadcastPresence({ editing_room: null });
        showToast(selectedDays.length > 1 ? 'Schedule added for '+selectedDays.length+' days!' : 'Schedule added!','success');
        loadSchedules();
    });

    // ── CONFLICT MODAL ──
    // ── SEARCH OTHER DAYS ──
    // Scans all other weekdays across all CCS rooms for a free window that fits the entry's duration
    function findFreeSlotsAcrossAllDays(entry, excludeDay) {
        const WEEKDAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const durMins  = timeToMins(entry.end_time) - timeToMins(entry.start_time);
        const allRooms = ALL_ROOMS.map(String);
        const DAY_START = timeToMins('07:00');
        const DAY_END   = timeToMins('21:00');
        const results   = [];
        for (const day of WEEKDAYS) {
            if (day === excludeDay) continue;
            for (const room of allRooms) {
                const slots = (allRoomSchedules[room] || [])
                    .filter(s => s.day === day)
                    .map(s => ({ sM: timeToMins(s.start_time), eM: timeToMins(s.end_time) }))
                    .sort((a, b) => a.sM - b.sM);
                const windows = [];
                let cursor = DAY_START;
                slots.forEach(({ sM, eM }) => {
                    if (sM > cursor) windows.push({ start: cursor, end: sM });
                    cursor = Math.max(cursor, eM);
                });
                if (cursor < DAY_END) windows.push({ start: cursor, end: DAY_END });
                for (const { start, end } of windows) {
                    const aligned = Math.ceil(start / 30) * 30;
                    for (let t = aligned; t + durMins <= end; t += 30) {
                        const secConflict = findSectionConflict(entry.section, day, t, t + durMins, '', entry.id);
                        if (!secConflict) {
                            results.push({ start: t, end: t + durMins, room, day });
                            if (results.length >= 10) return results;
                        }
                    }
                }
            }
        }
        return results;
    }

    let _suggestEntry = null; // tracks the entry currently being suggested for

    document.getElementById('conflictTryOtherDaysBtn').addEventListener('click', () => {
        if (!_suggestEntry) return;
        const otherSlots = findFreeSlotsAcrossAllDays(_suggestEntry, _suggestEntry.day);
        const listEl = document.getElementById('conflictSuggestList');
        const noneEl = document.getElementById('conflictSuggestNone');
        const tryRow = document.getElementById('conflictTryOtherDaysRow');
        document.getElementById('conflictSuggestName').textContent =
            _suggestEntry.course_name.replace(/\s*\[.*?\]/,'').replace(/\s*\(.*?\)/,'').trim();
        if (otherSlots.length === 0) {
            listEl.innerHTML = '';
            listEl.style.display = 'none';
            noneEl.textContent = '\u26a0\ufe0f No free slots found on any day across all rooms.';
            noneEl.style.display = 'block';
            tryRow.style.display = 'none';
            return;
        }
        noneEl.style.display = 'none';
        tryRow.style.display = 'none';
        listEl.style.display = 'flex';
        listEl.innerHTML = otherSlots.map((slot, i) => {
            const roomLabel = `<strong style="color:#7c3aed;">Room ${slot.room}</strong> &middot; <strong style="color:#059669;">${slot.day}</strong>`;
            return `<div class="conflict-suggest-slot" data-idx="${i}">
                <span>
                    <span class="css-time">${to12hr(minsToTime(slot.start))} \u2013 ${to12hr(minsToTime(slot.end))}</span>
                    <span class="css-room">&middot; ${roomLabel}</span>
                </span>
                <button class="css-move-btn" data-idx="${i}"><i class="fa-solid fa-arrow-right"></i> Move here</button>
            </div>`;
        }).join('');
        listEl.querySelectorAll('.css-move-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const slot = otherSlots[parseInt(btn.dataset.idx)];
                pendingNewEntry = null;
                await applyConflictMove(_suggestEntry, slot.room, slot.start, slot.end, slot.day);
            });
        });
    });

    document.getElementById('conflictCancelBtn').addEventListener('click', () => {
        document.getElementById('conflictModal').classList.remove('show');
        // Reset suggest panel state
        document.getElementById('conflictSuggestPanel').style.display = 'none';
        document.getElementById('conflictReplaceRow').style.display   = 'none';
        document.getElementById('conflictMainBtns').style.display     = 'flex';
        pendingNewEntry = null;
    });

    document.getElementById('conflictSuggestBtn').addEventListener('click', () => {
        if (!pendingNewEntry) return;
        const { conflictId } = pendingNewEntry;

        // Find the conflicting (existing) schedule across all rooms
        let conflictEntry = null;
        let conflictRoom  = null;
        for (const [r, slots] of Object.entries(allRoomSchedules)) {
            const found = slots.find(s => String(s.id) === String(conflictId));
            if (found) { conflictEntry = found; conflictRoom = r; break; }
        }
        if (!conflictEntry) return;

        const freeSlots1 = findFreeSlotsForEntry(conflictEntry, conflictRoom);

        // Update panel UI
        document.getElementById('conflictSuggestName').textContent = conflictEntry.course_name.replace(/\s*\[.*?\]/,'').replace(/\s*\(.*?\)/,'').trim();
        const listEl  = document.getElementById('conflictSuggestList');
        const noneEl  = document.getElementById('conflictSuggestNone');

        _suggestEntry = { ...conflictEntry, room: conflictRoom };
        renderSuggestSlots(listEl, noneEl, freeSlots1, conflictEntry, (slot) => {
            applyConflictMove(conflictEntry, slot.room, slot.start, slot.end);
        });

        document.getElementById('conflictSuggestPanel').style.display = 'block';
        document.getElementById('conflictMainBtns').style.display     = 'none';
        document.getElementById('conflictReplaceRow').style.display   = 'block';
    });

    // ── FREE-SLOT SEARCH HELPER ──
    // Searches the same room first, then all other CCS rooms, for slots
    // that fit the given entry's duration on the same day without conflicts.
    function findFreeSlotsForEntry(entry, preferredRoom) {
        const durMins  = timeToMins(entry.end_time) - timeToMins(entry.start_time);
        const day      = entry.day;
        const DAY_START = timeToMins('07:00');
        const DAY_END   = timeToMins('21:00');
        const allRooms  = ALL_ROOMS.map(String);

        function getFreeSlots(room) {
            const slots = (allRoomSchedules[room] || [])
                .filter(s => s.day === day)
                .map(s => ({ sM: timeToMins(s.start_time), eM: timeToMins(s.end_time) }))
                .sort((a, b) => a.sM - b.sM);
            const windows = [];
            let cursor = DAY_START;
            slots.forEach(({ sM, eM }) => {
                if (sM > cursor) windows.push({ start: cursor, end: sM });
                cursor = Math.max(cursor, eM);
            });
            if (cursor < DAY_END) windows.push({ start: cursor, end: DAY_END });
            const free = [];
            windows.forEach(({ start, end }) => {
                const aligned = Math.ceil(start / 30) * 30;
                for (let t = aligned; t + durMins <= end; t += 30) {
                    if (room === preferredRoom && t === timeToMins(entry.start_time)) continue;
                    const secConflict = findSectionConflict(entry.section, day, t, t + durMins, room, entry.id);
                    if (!secConflict) free.push({ start: t, end: t + durMins, room });
                }
            });
            return free;
        }

        // Same room first
        const sameRoom = getFreeSlots(preferredRoom);
        if (sameRoom.length > 0) return sameRoom;

        // Fall back to other rooms
        const otherRooms = allRooms.filter(r => r !== preferredRoom);
        const results = [];
        for (const room of otherRooms) {
            const slots = getFreeSlots(room);
            results.push(...slots);
            if (results.length >= 12) break;
        }
        return results;
    }

    // ── RENDER SUGGEST SLOTS (shared UI renderer) ──
    function renderSuggestSlots(listEl, noneEl, freeSlots, entry, onMove) {
        const tryRow = document.getElementById('conflictTryOtherDaysRow');
        if (freeSlots.length === 0) {
            listEl.innerHTML = '';
            noneEl.style.display = 'block';
            listEl.style.display = 'none';
            if (tryRow) tryRow.style.display = 'block';
            return;
        }
        if (tryRow) tryRow.style.display = 'none';
        noneEl.style.display = 'none';
        listEl.style.display = 'flex';
        listEl.innerHTML = freeSlots.slice(0, 10).map((slot, i) => {
            const sameRoom = slot.room === entry.room;
            const roomLabel = sameRoom
                ? `· Room ${slot.room} · ${entry.day}`
                : `· <strong style="color:#2563eb;">Room ${slot.room}</strong> · ${entry.day} <span style="font-size:0.68rem;background:#dbeafe;color:#1d4ed8;border-radius:4px;padding:1px 5px;margin-left:3px;">different room</span>`;
            return `<div class="conflict-suggest-slot" data-idx="${i}">
                    <span>
                        <span class="css-time">${to12hr(minsToTime(slot.start))} – ${to12hr(minsToTime(slot.end))}</span>
                        <span class="css-room">${roomLabel}</span>
                    </span>
                    <button class="css-move-btn" data-idx="${i}"><i class="fa-solid fa-arrow-right"></i> Move here</button>
                </div>`;
        }).join('');
        listEl.querySelectorAll('.css-move-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const idx  = parseInt(btn.dataset.idx);
                const slot = freeSlots[idx];
                await onMove(slot);
            });
        });
    }


    async function applyConflictMove(conflictEntry, room, newStartMins, newEndMins, newDay) {
        const newStart = minsToTime(newStartMins) + ':00';
        const newEnd   = minsToTime(newEndMins)   + ':00';
        const day      = newDay || conflictEntry.day;

        document.getElementById('conflictModal').classList.remove('show');
        document.getElementById('conflictSuggestPanel').style.display = 'none';
        document.getElementById('conflictReplaceRow').style.display   = 'none';
        document.getElementById('conflictMainBtns').style.display     = 'flex';

        pushUndo('Schedule moved to resolve conflict');

        if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
            // Remove from old room if moving to a different room
            const oldRoom = conflictEntry.room || room;
            if (String(oldRoom) !== String(room)) {
                allRoomSchedules[oldRoom] = (allRoomSchedules[oldRoom] || []).filter(s => String(s.id) !== String(conflictEntry.id));
                localStorage.setItem('schedules_'+oldRoom, JSON.stringify(allRoomSchedules[oldRoom]));
                if (!allRoomSchedules[room]) allRoomSchedules[room] = [];
                allRoomSchedules[room].push({ ...conflictEntry, room: String(room), start_time: newStart, end_time: newEnd, day });
            } else {
            allRoomSchedules[room] = (allRoomSchedules[room] || []).map(s =>
                String(s.id) === String(conflictEntry.id)
                    ? { ...s, start_time: newStart, end_time: newEnd, day }
                    : s
            );
            }
            localStorage.setItem('schedules_' + room, JSON.stringify(allRoomSchedules[room]));
            schedules = allRoomSchedules[currentRoom] || [];
            logAudit('Schedule moved (conflict resolve)', conflictEntry.id, room, { ...conflictEntry, start_time: newStart, end_time: newEnd });
        } else {
            const { error } = await _supabase.from('schedules').update({ start_time: newStart, end_time: newEnd }).eq('id', conflictEntry.id);
            if (error) { showToast('Failed to move schedule: ' + error.message, 'error'); return; }
            logAudit('Schedule moved (conflict resolve)', conflictEntry.id, room, { ...conflictEntry, start_time: newStart, end_time: newEnd });
            await loadSchedules();
        }

        // Now proceed to save the new entry that was originally being added
        if (pendingNewEntry) {
            const { courseName, section, faculty, allDays } = pendingNewEntry;
            const startTime = pendingNewEntry.startTime;
            const endTime   = pendingNewEntry.endTime;
            pendingNewEntry = null;

            if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
                for (const d of (allDays || [startTime])) {
                    const ne = { id: Date.now() + Math.random(), room: currentRoom, course_name: courseName, section, faculty, day: d, start_time: startTime + ':00', end_time: endTime + ':00' };
                    (allRoomSchedules[currentRoom] = allRoomSchedules[currentRoom] || []).push(ne);
                    logAudit('Schedule added', ne.id, currentRoom, ne);
                }
                localStorage.setItem('schedules_' + currentRoom, JSON.stringify(allRoomSchedules[currentRoom]));
                schedules = allRoomSchedules[currentRoom];
                renderTimetable();
                document.getElementById('scheduleForm').reset();
                setSelectedDays([]);
                document.getElementById('scheduleModal').classList.remove('show');
                broadcastPresence({ editing_room: null });
            } else {
                const newEntries = (allDays || [startTime]).map(d => ({ room: currentRoom, course_name: courseName, section, faculty, day: d, start_time: startTime + ':00', end_time: endTime + ':00' }));
                const { error: ie } = await _supabase.from('schedules').insert(newEntries);
                if (ie) { showToast('Moved existing schedule, but failed to save new one: ' + ie.message, 'error'); return; }
                document.getElementById('scheduleForm').reset();
                setSelectedDays([]);
                document.getElementById('scheduleModal').classList.remove('show');
                broadcastPresence({ editing_room: null });
                loadSchedules();
            }
        } else {
            renderTimetable();
        }

        showToast('Existing schedule moved — new schedule added!', 'success');
    }

    document.getElementById('conflictReplaceBtn').addEventListener('click', async () => {
        document.getElementById('conflictModal').classList.remove('show');
        document.getElementById('conflictSuggestPanel').style.display = 'none';
        document.getElementById('conflictReplaceRow').style.display   = 'none';
        document.getElementById('conflictMainBtns').style.display     = 'flex';
        if (!pendingNewEntry) return;
        const { courseName, section, faculty, day, startTime, endTime, conflictId, dragMoveId, allDays } = pendingNewEntry;
        pendingNewEntry = null;
        const btn = document.getElementById('submitBtn');
        btn.classList.add('loading'); btn.disabled=true;
        pushUndo(dragMoveId ? 'Schedule moved (replaced)' : 'Schedule replaced');

        const daysToInsert = allDays && allDays.length > 1 ? allDays : [day];

        if (SUPABASE_URL==='YOUR_SUPABASE_URL') {
            schedules = schedules.filter(s =>
                String(s.id) !== String(conflictId) &&
                String(s.id) !== String(dragMoveId)
            );
            logAudit(dragMoveId ? 'Schedule moved (replaced)' : 'Schedule replaced', conflictId, currentRoom, { course_name: courseName, section, faculty });
            for (const d of daysToInsert) {
                const ne = { room:currentRoom, course_name:courseName, section, faculty, day:d, start_time:startTime+':00', end_time:endTime+':00', id: Date.now()+Math.random() };
                schedules.push(ne);
                logAudit('Schedule added', ne.id, currentRoom, ne);
            }
            allRoomSchedules[currentRoom] = schedules;
            localStorage.setItem('schedules_'+currentRoom, JSON.stringify(schedules));
            renderTimetable();
            if (!dragMoveId) { document.getElementById('scheduleForm').reset(); setSelectedDays([]); document.getElementById('scheduleModal').classList.remove('show'); broadcastPresence({ editing_room: null }); }
            showToast(daysToInsert.length > 1 ? 'Schedule replaced & added for '+daysToInsert.length+' days!' : 'Schedule replaced!','success');
            btn.classList.remove('loading'); btn.disabled=false; return;
        }
        const toDelete = [conflictId];
        if (dragMoveId) toDelete.push(dragMoveId);
        for (const delId of toDelete) {
            const { error: de } = await _supabase.from('schedules').delete().eq('id', delId);
            if (de) { showToast('Failed to replace','error'); btn.classList.remove('loading'); btn.disabled=false; return; }
            logAudit(dragMoveId ? 'Schedule moved (replaced)' : 'Schedule replaced', delId, currentRoom, { course_name: courseName, section, faculty });
        }
        const newEntries = daysToInsert.map(d => ({ room:currentRoom, course_name:courseName, section, faculty, day:d, start_time:startTime+':00', end_time:endTime+':00' }));
        const { error: ie, data: replacedData } = await _supabase.from('schedules').insert(newEntries).select();
        btn.classList.remove('loading'); btn.disabled=false;
        if (ie) { showToast('Failed to save new schedule','error'); return; }
        (replacedData || newEntries).forEach(entry => logAudit('Schedule added', entry.id, currentRoom, entry));
        if (!dragMoveId) { document.getElementById('scheduleForm').reset(); setSelectedDays([]); }
        showToast(daysToInsert.length > 1 ? 'Schedule replaced & added for '+daysToInsert.length+' days!' : 'Schedule replaced!','success');
        loadSchedules();
    });

    // ── MOVE MODAL (no-conflict drag) ──
    document.getElementById('moveCancelBtn').addEventListener('click', () => {
        document.getElementById('moveModal').classList.remove('show');
        pendingMoveData = null;
    });

    // ── X CLOSE BUTTONS (added for all modals missing them) ──
    document.getElementById('deleteCloseBtn').addEventListener('click', () =>
        document.getElementById('deleteModal').classList.remove('show'));

    document.getElementById('conflictCloseBtn').addEventListener('click', () => {
        document.getElementById('conflictModal').classList.remove('show');
        document.getElementById('conflictSuggestPanel').style.display = 'none';
        document.getElementById('conflictReplaceRow').style.display   = 'none';
        document.getElementById('conflictMainBtns').style.display     = 'flex';
        pendingNewEntry = null;
    });

    document.getElementById('editCloseBtn').addEventListener('click', () =>
        document.getElementById('editModal').classList.remove('show'));

    document.getElementById('moveCloseBtn').addEventListener('click', () => {
        document.getElementById('moveModal').classList.remove('show');
        pendingMoveData = null;
    });

    // Terms modal X close (view mode from sidebar)
    document.getElementById('termsCloseBtn').addEventListener('click', () => {
        document.getElementById('termsModal').classList.remove('show');
        document.getElementById('termsModal').style.display = 'none';
    });
    document.getElementById('moveConfirmBtn').addEventListener('click', async () => {
        document.getElementById('moveModal').classList.remove('show');
        if (!pendingMoveData) return;
        const { id, srcRoom, destRoom, day, start_time, end_time } = pendingMoveData;
        pendingMoveData = null;
        pushUndo('Schedule moved');
        if (SUPABASE_URL==='YOUR_SUPABASE_URL') {
            // Remove from srcRoom, add to destRoom (may be same room, just different time)
            const srcEntry = (allRoomSchedules[srcRoom]||[]).find(s=>String(s.id)===String(id)) || {};
            const updated = { ...srcEntry, room: destRoom, start_time, end_time };
            allRoomSchedules[srcRoom] = (allRoomSchedules[srcRoom]||[]).filter(s=>String(s.id)!==String(id));
            if (!allRoomSchedules[destRoom]) allRoomSchedules[destRoom]=[];
            // If same room just update in place
            if (srcRoom===destRoom) {
                allRoomSchedules[destRoom] = allRoomSchedules[destRoom].map(s=>String(s.id)===String(id)?{...s,start_time,end_time}:s);
            } else {
                updated.id = Date.now();
                allRoomSchedules[destRoom].push(updated);
            }
            logAudit('Schedule moved', id, destRoom, { ...updated, from_room: srcRoom });
            localStorage.setItem('schedules_'+srcRoom, JSON.stringify(allRoomSchedules[srcRoom]));
            localStorage.setItem('schedules_'+destRoom, JSON.stringify(allRoomSchedules[destRoom]));
            schedules = allRoomSchedules[currentRoom]||[];
            renderTimetable(); showToast('Schedule moved!','success'); return;
        }
        // Supabase: update room + time
        const { error } = await _supabase.from('schedules').update({room:destRoom,start_time,end_time}).eq('id',id);
        if (error) { showToast('Failed to move schedule','error'); return; }
        logAudit('Schedule moved', id, destRoom, { start_time, end_time, from_room: srcRoom, to_room: destRoom });
        showToast('Schedule moved!','success'); loadSchedules();
    });

    // ── LEGEND FILTER ──
    let activeFilter = null;

    function isMajorSlot(slot) {
        const id = slot.querySelector('.slot-id') ? slot.querySelector('.slot-id').dataset.id : null;
        if (!id) return false;
        let rawName = '';
        for (const room of Object.keys(allRoomSchedules)) {
            const s = allRoomSchedules[room].find(x => String(x.id) === String(id));
            if (s) { rawName = s.course_name; break; }
        }
        return /\[Major\]/.test(rawName);
    }

    function isMinorSlot(slot) {
        const id = slot.querySelector('.slot-id') ? slot.querySelector('.slot-id').dataset.id : null;
        if (!id) return false;
        let rawName = '';
        for (const room of Object.keys(allRoomSchedules)) {
            const s = allRoomSchedules[room].find(x => String(x.id) === String(id));
            if (s) { rawName = s.course_name; break; }
        }
        return /\[Minor\]/.test(rawName);
    }

    function applyLegendFilter(filter) {
        activeFilter = filter;
        const hint = document.getElementById('legendFilterHint');

        // Sync both legend sets
        document.querySelectorAll('.legend-item').forEach(item => {
            item.classList.remove('legend-active', 'legend-dimmed');
            if (filter) {
                if (item.dataset.filter === filter) item.classList.add('legend-active');
                else item.classList.add('legend-dimmed');
            }
        });
        document.querySelectorAll('.mini-legend-item').forEach(item => {
            item.classList.remove('legend-active', 'legend-dimmed');
            if (filter) {
                if (item.dataset.filter === filter) item.classList.add('legend-active');
                else item.classList.add('legend-dimmed');
            }
        });

        hint.style.display = filter ? 'inline' : 'none';

        // Show/hide timetable slots + recolor for major/minor
        document.querySelectorAll('.scheduled-slot').forEach(slot => {
            // Always clear highlight and filtered classes first
            slot.classList.remove('slot-filtered-out', 'slot-highlight-major', 'slot-highlight-minor');

            if (!filter) return; // general view — done

            const major = isMajorSlot(slot);

            if (filter === 'major') {
                if (major) slot.classList.add('slot-highlight-major');
                else slot.classList.add('slot-filtered-out');
            } else if (filter === 'minor') {
                if (isMinorSlot(slot)) slot.classList.add('slot-highlight-minor');
                else slot.classList.add('slot-filtered-out');
            } else {
                const filterClass = 'slot-' + filter;
                const matches = filter === 'bsemc-dat' ? slot.classList.contains('slot-bsemc-dat')
                    : filter === 'bsemc-gd' ? slot.classList.contains('slot-bsemc-gd')
                    : slot.classList.contains(filterClass);
                slot.classList.toggle('slot-filtered-out', !matches);
            }
        });
    }

    // Click a main legend item → filter
    document.querySelectorAll('.legend-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            applyLegendFilter(activeFilter === item.dataset.filter ? null : item.dataset.filter);
        });
    });

    // Click blank area of main legend card → reset
    document.getElementById('legendBar').addEventListener('click', (e) => {
        if (!e.target.closest('.legend-item')) applyLegendFilter(null);
    });

    // Click a mini legend item → filter
    document.querySelectorAll('.mini-legend-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            applyLegendFilter(activeFilter === item.dataset.filter ? null : item.dataset.filter);
        });
    });

    // ── DARK MODE ──
    const darkModeToggle = document.getElementById('darkModeToggle');
    const isDark = localStorage.getItem('darkMode') === 'true';
    if (isDark) {
        document.body.classList.add('dark-mode');
        darkModeToggle.classList.add('dark-mode-on');
    }
    darkModeToggle.addEventListener('click', () => {
        const on = document.body.classList.toggle('dark-mode');
        darkModeToggle.classList.toggle('dark-mode-on', on);
        localStorage.setItem('darkMode', on);
    });

    // ── SIDEBAR ──
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');

    function openSidebar() {
        sidebar.classList.add('open');
        sidebarOverlay.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
    function closeSidebar() {
        sidebar.classList.remove('open');
        sidebarOverlay.classList.remove('show');
        document.body.style.overflow = '';
    }

    hamburgerBtn.addEventListener('click', openSidebar);
    sidebarOverlay.addEventListener('click', closeSidebar);

    sidebarLogoutBtn.addEventListener('click', async () => {
        closeSidebar();
        await _supabase.auth.signOut();
        localStorage.clear();
        window.location.href = 'index.html';
    });

    // Sync sidebar footer name with navbar username
    const sidebarFooterName = document.getElementById('sidebarFooterName');
    const userNameEl = document.getElementById('userName');
    if (userNameEl) {
        const syncName = () => {
            const name = userNameEl.textContent;
            if (sidebarFooterName) sidebarFooterName.textContent = name;
        };
        const observer = new MutationObserver(syncName);
        observer.observe(userNameEl, { childList: true, subtree: true, characterData: true });
        syncName();
    }

    // ── PRINT ROOM WEEKLY SCHEDULE ──
    function printRoomWeeklySchedule() {
        const sel  = document.getElementById('printRoomSelect');
        const room = sel ? sel.value : currentRoom;
        if (!room) { showToast('Please select a room to print.', 'warning'); return; }
        const WEEK = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const roomSlots = allRoomSchedules[room] || [];

        function slotColors(section) {
            const k = (section||'').trim().toUpperCase();
            if (k.startsWith('BSCS'))     return { bg:'#eff6ff', border:'#93c5fd', text:'#1e3a8a', dot:'#3b82f6' };
            if (k.startsWith('BSIT'))     return { bg:'#f0fdf4', border:'#86efac', text:'#14532d', dot:'#22c55e' };
            if (k.startsWith('BSEMC-GD')) return { bg:'#fff7ed', border:'#fdba74', text:'#7c2d12', dot:'#f97316' };
            if (k.startsWith('BSEMC'))    return { bg:'#fff1f2', border:'#fca5a5', text:'#881337', dot:'#ef4444' };
            return                               { bg:'#f8fafc', border:'#cbd5e1', text:'#1e293b', dot:'#94a3b8' };
        }

        // Group slots: merge same course+section+faculty+time across days
        // Key: course_name|section|faculty|start_time|end_time
        const grouped = {};
        roomSlots.forEach(s => {
            if (!WEEK.includes(s.day)) return;
            const rawName   = s.course_name || '';
            const typeMatch = rawName.match(/\((Lecture|Laboratory)\)/);
            const typeShort = typeMatch ? (typeMatch[1] === 'Lecture' ? 'Lec' : 'Lab') : '';
            const dispName  = rawName.replace(/\s*\[.*?\]/g,'').replace(/\s*\(.*?\)/g,'').trim();
            const key = dispName + '|' + (s.section||'') + '|' + (s.faculty||'') + '|' + (s.start_time||'').slice(0,5) + '|' + (s.end_time||'').slice(0,5) + '|' + typeShort;
            if (!grouped[key]) {
                grouped[key] = {
                    dispName, typeShort, section: s.section||'', faculty: s.faculty||'',
                    start_time: (s.start_time||'').slice(0,5), end_time: (s.end_time||'').slice(0,5),
                    days: []
                };
            }
            if (!grouped[key].days.includes(s.day)) grouped[key].days.push(s.day);
        });

        // Sort groups by day first, then start time
        const dayOrder = { Monday:0, Tuesday:1, Wednesday:2, Thursday:3, Friday:4, Saturday:5 };
        const groups = Object.values(grouped).sort((a, b) => {
            const dA = Math.min(...a.days.map(d => dayOrder[d]??99));
            const dB = Math.min(...b.days.map(d => dayOrder[d]??99));
            if (dA !== dB) return dA - dB;
            return timeToMins(a.start_time) - timeToMins(b.start_time);
        });

        // Sort days within each group
        groups.forEach(g => { g.days.sort((a,b) => (dayOrder[a]||0) - (dayOrder[b]||0)); });

        // Build abbreviated day labels
        const dayAbbr = { Monday:'Mon', Tuesday:'Tue', Wednesday:'Wed', Thursday:'Thu', Friday:'Fri', Saturday:'Sat' };

        let tbodyHtml = '';
        if (groups.length === 0) {
            tbodyHtml = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#94a3b8;font-style:italic;">No schedules found for this room.</td></tr>';
        } else {
            groups.forEach((g, i) => {
                const c         = slotColors(g.section);
                const isMerged  = /\//.test(g.section);
                const startStr  = to12hr(g.start_time);
                const endStr    = to12hr(g.end_time);
                const daysLabel = g.days.map(d => dayAbbr[d]||d).join(', ');
                const rowBg     = i % 2 === 0 ? 'white' : '#f8fafc';
                tbodyHtml += `<tr style="background:${rowBg};">
  <td>
    <div style="display:flex;align-items:flex-start;gap:7px;">
      <div style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c.dot};flex-shrink:0;margin-top:2px;"></div>
      <div>
        <div style="font-weight:700;font-size:8.5pt;color:${c.text};">${escHtml(g.dispName)}${g.typeShort ? ' <span style="font-weight:400;font-size:7pt;color:#64748b;">('+escHtml(g.typeShort)+')</span>' : ''}</div>
        <div style="font-size:6.5pt;color:#64748b;margin-top:2px;">${escHtml(g.section)}${isMerged ? ' &#8652;' : ''}</div>
      </div>
    </div>
  </td>
  <td style="color:#374151;">${escHtml(g.faculty) || '<span style="color:#cbd5e1;font-style:italic;">—</span>'}</td>
  <td style="text-align:center;">
    ${g.days.map(d => `<span style="display:inline-block;background:${c.bg};color:${c.text};border:1px solid ${c.border};border-radius:4px;padding:1px 6px;font-size:7pt;font-weight:600;margin:1px;">${dayAbbr[d]||d}</span>`).join('')}
  </td>
  <td style="text-align:center;font-weight:700;color:#0d1b3e;white-space:nowrap;">${escHtml(startStr)}</td>
  <td style="text-align:center;font-weight:700;color:#0d1b3e;white-space:nowrap;">${escHtml(endStr)}</td>
</tr>`;
            });
        }

        const printDate = new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
        const title = 'Room ' + room + ' \u2014 Weekly Schedule';
        const totalClasses = groups.length;

        const html = `\x3C!DOCTYPE html>
\x3Chtml>\x3Chead><meta charset="UTF-8"><title>${title}</title>
<\style>
@page { size: A4 portrait; margin: 10mm 12mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { font-family: Arial, sans-serif; font-size: 8pt; background: white; color: #1e293b; }
/* ── HEADER ── */
.ph-wrap { background:#0d1b3e; color:white; padding:10px 14px 10px; border-radius:8px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; }
.ph-school { font-size:6.5pt; color:#93c5fd; text-transform:uppercase; letter-spacing:0.8px; margin-bottom:4px; }
.ph-title { font-size:15pt; font-weight:700; color:white; margin:2px 0; letter-spacing:-0.3px; }
.ph-sub { font-size:7pt; color:#94a3b8; margin-top:3px; }
.ph-right { text-align:right; flex-shrink:0; margin-left:16px; }
.ph-room-badge { display:inline-block; background:white; color:#0d1b3e; font-size:16pt; font-weight:700; padding:6px 20px; border-radius:8px; margin-bottom:5px; letter-spacing:0.5px; }
.ph-meta { font-size:6pt; color:#94a3b8; }
/* ── SUMMARY BAR ── */
.summary-bar { display:flex; gap:16px; margin-bottom:8px; font-size:7pt; color:#475569; }
.summary-item { display:flex; align-items:center; gap:4px; }
/* ── TABLE ── */
table { width:100%; border-collapse:collapse; font-size:8pt; }
thead tr { background:#0d1b3e; }
th { color:white; font-weight:700; padding:8px 10px; border:1px solid #1a3060; text-align:left; font-size:8pt; white-space:nowrap; }
th.center { text-align:center; }
td { border:1px solid #e2e8f0; vertical-align:middle; padding:6px 10px; }
tbody tr:hover { background:#f0f7ff !important; }
/* ── FOOTER ── */
.pf { margin-top:8px; display:flex; justify-content:space-between; align-items:center; font-size:6pt; color:#94a3b8; border-top:1px solid #e2e8f0; padding-top:5px; }
.legend { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.leg-item { display:flex; align-items:center; gap:4px; }
.leg-pill { display:inline-block; padding:2px 8px; border-radius:20px; font-size:6pt; font-weight:700; letter-spacing:0.3px; }
<\/style>
\x3C/head>\x3Cbody>
<div class="ph-wrap">
  <div>
    <div class="ph-school">Gordon College &mdash; College of Computer Studies</div>
    <div class="ph-title">${title}</div>
    <div class="ph-sub">Academic Term Schedule &nbsp;&middot;&nbsp; Monday &ndash; Saturday</div>
  </div>
  <div class="ph-right">
    <div class="ph-room-badge">Room ${room}</div>
    <div class="ph-meta">Printed: ${printDate}</div>
  </div>
</div>
<div class="summary-bar">
  <div class="summary-item"><strong>${totalClasses}</strong>&nbsp;class${totalClasses !== 1 ? 'es' : ''} scheduled</div>
</div>
<table>
  <thead>
    <tr>
      <th style="width:35%;">Class Name</th>
      <th style="width:25%;">Professor</th>
      <th class="center" style="width:22%;">Day(s)</th>
      <th class="center" style="width:9%;">Start</th>
      <th class="center" style="width:9%;">End</th>
    </tr>
  </thead>
  <tbody>${tbodyHtml}</tbody>
</table>
<div class="pf">
  <div class="legend">
    <div class="leg-item"><div style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#3b82f6;"></div>&nbsp;BSCS</div>
    <div class="leg-item"><div style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#22c55e;"></div>&nbsp;BSIT</div>
    <div class="leg-item"><div style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f97316;"></div>&nbsp;BSEMC-GD</div>
    <div class="leg-item"><div style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444;"></div>&nbsp;BSEMC-DAT</div>
    <div class="leg-item"><span style="font-size:8pt;">&#8652;</span>&nbsp;Merged class</div>
  </div>
  <div>CCS Room Management System &mdash; CCSRMS</div>
</div>
\x3C/body>\x3C/html>`;

        const pw = window.open('', '_blank', 'width=900,height=1100');
        pw.document.write(html);
        pw.document.close();
        pw.focus();
        pw.onload = () => { pw.print(); pw.close(); };
    }

    // ── SUBJECT AUTOCOMPLETE ──────────────────────────────────────────────────
    (function() {
        const courseNameInput = document.getElementById('courseName');
        const dropdown        = document.getElementById('subjectAcDropdown');
        const listEl          = document.getElementById('subjectAcList');
        let focusedIdx = -1;
        let acItems    = [];

        // Build a deduplicated list of unique subjects from allRoomSchedules
        function getUniqueSubjects() {
            const map = {}; // key: cleaned name → { name, majorMinor, type, faculty (most recent) }
            Object.values(allRoomSchedules).forEach(slots => {
                (slots || []).forEach(s => {
                    if (!s.course_name) return;
                    // Extract parts
                    const mmMatch   = s.course_name.match(/\[(Major|Minor)\]/);
                    const typeMatch = s.course_name.match(/\((Lecture|Laboratory|None)\)/);
                    const cleanName = s.course_name
                        .replace(/\s*\[(Major|Minor)\]/, '')
                        .replace(/\s*\((Lecture|Laboratory|None)\)/, '')
                        .trim();
                    if (!cleanName) return;
                    const key = cleanName.toLowerCase();
                    if (!map[key]) {
                        map[key] = {
                            name:       cleanName,
                            majorMinor: mmMatch   ? mmMatch[1]   : '',
                            type:       typeMatch ? typeMatch[1] : '',
                            faculty:    s.faculty || ''
                        };
                    } else {
                        // Keep most recent faculty if slot has one
                        if (s.faculty) map[key].faculty = s.faculty;
                    }
                });
            });
            return Object.values(map).sort((a,b) => a.name.localeCompare(b.name));
        }

        function highlight(text, query) {
            if (!query) return escHtml(text);
            const idx = text.toLowerCase().indexOf(query.toLowerCase());
            if (idx < 0) return escHtml(text);
            return escHtml(text.slice(0, idx))
                 + '<mark>' + escHtml(text.slice(idx, idx + query.length)) + '</mark>'
                 + escHtml(text.slice(idx + query.length));
        }

        function renderDropdown(query) {
            const subjects = getUniqueSubjects();
            const q = (query || '').trim().toLowerCase();
            const filtered = q
                ? subjects.filter(s => s.name.toLowerCase().includes(q))
                : subjects;

            if (filtered.length === 0) {
                closeDropdown();
                return;
            }

            acItems = filtered;
            focusedIdx = -1;

            listEl.innerHTML = filtered.map((s, i) => {
                const mmBadge = s.majorMinor
                    ? `<span class="subject-ac-badge ${s.majorMinor === 'Minor' ? 'minor' : ''}">${s.majorMinor}</span>`
                    : '';
                const typeBadge = s.type && s.type !== 'None'
                    ? `<span class="subject-ac-badge">${s.type}</span>`
                    : '';
                const facultyText = s.faculty
                    ? `<span style="opacity:0.85;">${escHtml(s.faculty)}</span>`
                    : '';
                return `<div class="subject-ac-item" data-idx="${i}">
                    <div class="subject-ac-name">${highlight(s.name, q)}</div>
                    <div class="subject-ac-meta">${mmBadge}${typeBadge}${facultyText}</div>
                </div>`;
            }).join('');

            // Attach click handlers
            listEl.querySelectorAll('.subject-ac-item').forEach(el => {
                el.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    const idx = parseInt(el.dataset.idx);
                    applyAutofill(acItems[idx]);
                });
            });

            dropdown.classList.add('open');
        }

        function closeDropdown() {
            dropdown.classList.remove('open');
            focusedIdx = -1;
        }

        function flashField(el) {
            el.classList.remove('autofill-flash');
            void el.offsetWidth; // reflow
            el.classList.add('autofill-flash');
            el.addEventListener('animationend', () => el.classList.remove('autofill-flash'), { once: true });
        }

        function applyAutofill(subject) {
            courseNameInput.value = subject.name;
            closeDropdown();

            // Auto-fill Major/Minor
            if (subject.majorMinor) {
                const mmSel = document.getElementById('courseMajorMinor');
                mmSel.value = subject.majorMinor;
                flashField(mmSel);
                // Trigger the change event so courseType enable/disable logic fires
                mmSel.dispatchEvent(new Event('change'));
            }

            // Auto-fill Lec/Lab type
            if (subject.type) {
                const typeSel = document.getElementById('courseType');
                typeSel.disabled = false;
                typeSel.style.opacity = '1';
                typeSel.style.cursor = '';
                typeSel.value = subject.type;
                flashField(typeSel);
            }

            // Auto-fill professor
            if (subject.faculty) {
                const facInput = document.getElementById('faculty');
                facInput.value = subject.faculty;
                flashField(facInput);
            }

            // Focus next empty field
            const mmSel   = document.getElementById('courseMajorMinor');
            const typeSel = document.getElementById('courseType');
            const facInput = document.getElementById('faculty');
            if (!mmSel.value) { mmSel.focus(); }
            else if (!typeSel.value) { typeSel.focus(); }
            else if (!facInput.value) { facInput.focus(); }
            else {
                // All pre-filled, move focus to section
                document.getElementById('sectionCourse').focus();
            }
        }

        function moveFocus(dir) {
            const items = listEl.querySelectorAll('.subject-ac-item');
            if (!items.length) return;
            items[focusedIdx]?.classList.remove('focused');
            focusedIdx = Math.max(0, Math.min(items.length - 1, focusedIdx + dir));
            items[focusedIdx]?.classList.add('focused');
            items[focusedIdx]?.scrollIntoView({ block: 'nearest' });
        }

        // ── Event Listeners ──
        courseNameInput.addEventListener('input', () => {
            renderDropdown(courseNameInput.value);
        });

        courseNameInput.addEventListener('focus', () => {
            if (courseNameInput.value.length >= 0) renderDropdown(courseNameInput.value);
        });

        courseNameInput.addEventListener('keydown', (e) => {
            if (!dropdown.classList.contains('open')) return;
            if (e.key === 'ArrowDown')  { e.preventDefault(); moveFocus(1); }
            else if (e.key === 'ArrowUp')   { e.preventDefault(); moveFocus(-1); }
            else if (e.key === 'Enter') {
                if (focusedIdx >= 0 && acItems[focusedIdx]) {
                    e.preventDefault();
                    applyAutofill(acItems[focusedIdx]);
                }
            }
            else if (e.key === 'Escape') { closeDropdown(); }
        });

        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && e.target !== courseNameInput) {
                closeDropdown();
            }
        });
    })();
    // ─────────────────────────────────────────────────────────────────────────

    // ── EDIT MODAL: SUBJECT AUTOCOMPLETE ─────────────────────────────────────
    (function() {
        const editNameInput = document.getElementById('editCourseName');
        const dropdown      = document.getElementById('editSubjectAcDropdown');
        const listEl        = document.getElementById('editSubjectAcList');
        let focusedIdx = -1;
        let acItems    = [];

        function getUniqueSubjects() {
            const map = {};
            Object.values(allRoomSchedules).forEach(slots => {
                (slots || []).forEach(s => {
                    if (!s.course_name) return;
                    const mmMatch   = s.course_name.match(/\[(Major|Minor)\]/);
                    const typeMatch = s.course_name.match(/\((Lecture|Laboratory|None)\)/);
                    const cleanName = s.course_name
                        .replace(/\s*\[(Major|Minor)\]/, '')
                        .replace(/\s*\((Lecture|Laboratory|None)\)/, '')
                        .trim();
                    if (!cleanName) return;
                    const key = cleanName.toLowerCase();
                    if (!map[key]) {
                        map[key] = {
                            name:       cleanName,
                            majorMinor: mmMatch   ? mmMatch[1]   : '',
                            type:       typeMatch ? typeMatch[1] : '',
                            faculty:    s.faculty || ''
                        };
                    } else {
                        if (s.faculty) map[key].faculty = s.faculty;
                    }
                });
            });
            return Object.values(map).sort((a,b) => a.name.localeCompare(b.name));
        }

        function highlight(text, query) {
            if (!query) return escHtml(text);
            const idx = text.toLowerCase().indexOf(query.toLowerCase());
            if (idx < 0) return escHtml(text);
            return escHtml(text.slice(0, idx))
                 + '<mark>' + escHtml(text.slice(idx, idx + query.length)) + '</mark>'
                 + escHtml(text.slice(idx + query.length));
        }

        function renderDropdown(query) {
            const subjects = getUniqueSubjects();
            const q = (query || '').trim().toLowerCase();
            const filtered = q
                ? subjects.filter(s => s.name.toLowerCase().includes(q))
                : subjects;

            if (filtered.length === 0) { closeDropdown(); return; }

            acItems = filtered;
            focusedIdx = -1;

            listEl.innerHTML = filtered.map((s, i) => {
                const mmBadge = s.majorMinor
                    ? `<span class="subject-ac-badge ${s.majorMinor === 'Minor' ? 'minor' : ''}">${s.majorMinor}</span>`
                    : '';
                const typeBadge = s.type && s.type !== 'None'
                    ? `<span class="subject-ac-badge">${s.type}</span>`
                    : '';
                const facultyText = s.faculty
                    ? `<span style="opacity:0.85;">${escHtml(s.faculty)}</span>`
                    : '';
                return `<div class="subject-ac-item" data-idx="${i}">
                    <div class="subject-ac-name">${highlight(s.name, q)}</div>
                    <div class="subject-ac-meta">${mmBadge}${typeBadge}${facultyText}</div>
                </div>`;
            }).join('');

            listEl.querySelectorAll('.subject-ac-item').forEach(el => {
                el.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    applyAutofill(acItems[parseInt(el.dataset.idx)]);
                });
            });

            dropdown.classList.add('open');
        }

        function closeDropdown() {
            dropdown.classList.remove('open');
            focusedIdx = -1;
        }

        function flashField(el) {
            el.classList.remove('autofill-flash');
            void el.offsetWidth;
            el.classList.add('autofill-flash');
            el.addEventListener('animationend', () => el.classList.remove('autofill-flash'), { once: true });
        }

        function applyAutofill(subject) {
            editNameInput.value = subject.name;
            closeDropdown();

            if (subject.majorMinor) {
                const mmSel = document.getElementById('editCourseMajorMinor');
                mmSel.value = subject.majorMinor;
                flashField(mmSel);
                mmSel.dispatchEvent(new Event('change'));
            }

            if (subject.type) {
                const typeSel = document.getElementById('editCourseType');
                typeSel.disabled = false;
                typeSel.style.opacity = '1';
                typeSel.style.cursor = '';
                typeSel.value = subject.type;
                flashField(typeSel);
            }

            if (subject.faculty) {
                const facInput = document.getElementById('editFaculty');
                facInput.value = subject.faculty;
                flashField(facInput);
            }
        }

        function moveFocus(dir) {
            const items = listEl.querySelectorAll('.subject-ac-item');
            if (!items.length) return;
            items[focusedIdx]?.classList.remove('focused');
            focusedIdx = Math.max(0, Math.min(items.length - 1, focusedIdx + dir));
            items[focusedIdx]?.classList.add('focused');
            items[focusedIdx]?.scrollIntoView({ block: 'nearest' });
        }

        editNameInput.addEventListener('input', () => renderDropdown(editNameInput.value));
        editNameInput.addEventListener('focus', () => renderDropdown(editNameInput.value));
        editNameInput.addEventListener('keydown', (e) => {
            if (!dropdown.classList.contains('open')) return;
            if (e.key === 'ArrowDown')  { e.preventDefault(); moveFocus(1); }
            else if (e.key === 'ArrowUp')   { e.preventDefault(); moveFocus(-1); }
            else if (e.key === 'Enter') {
                if (focusedIdx >= 0 && acItems[focusedIdx]) {
                    e.preventDefault();
                    applyAutofill(acItems[focusedIdx]);
                }
            }
            else if (e.key === 'Escape') { closeDropdown(); }
        });
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && e.target !== editNameInput) closeDropdown();
        });
    })();
    // ─────────────────────────────────────────────────────────────────────────

