    // ══════════════════════════════════════════════════════════════
    // EXCEL IMPORT FEATURE
    // ══════════════════════════════════════════════════════════════

    // ── Column guide data ──
    const IMPORT_COLUMNS = [
        { col: 'Subject',        example: 'Data Structures',         note: 'Course/subject name only (no type or bracket)' },
        { col: 'Type',           example: 'Lecture',                 note: 'Lecture, Laboratory, or None' },
        { col: 'Major_Minor',    example: 'Major',                   note: 'Major or Minor' },
        { col: 'Section',        example: 'BSCS 2-A',               note: 'Primary section — Format: COURSE YEAR-BLOCK (e.g. BSIT 1-A)' },
        { col: 'Merged_Section', example: 'B',                       note: '(Optional) Second block for merged classes (e.g. B → makes BSCS 2-A/B). Leave blank if not merged.' },
        { col: 'Teacher',        example: 'Juan Dela Cruz',          note: 'Full name of the faculty member' },
        { col: 'Room',           example: '301',                     note: 'Room number (must exist in the system)' },
        { col: 'Day',            example: 'Monday',                  note: 'Monday, Tuesday, Wednesday, Thursday, Friday, Saturday' },
        { col: 'Start_Time',     example: '08:00',                   note: '24-hour format HH:MM (e.g. 13:30 for 1:30 PM)' },
        { col: 'End_Time',       example: '09:30',                   note: '24-hour format HH:MM — must be after Start_Time' },
    ];

    const VALID_DAYS  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const VALID_TYPES = ['lecture','laboratory','none'];
    const VALID_MM    = ['major','minor'];

    // ── Render column guide table ──
    (function renderGuide() {
        const tbody = document.getElementById('importGuideRows');
        if (!tbody) return;
        IMPORT_COLUMNS.forEach((c, i) => {
            const tr = document.createElement('tr');
            tr.style.background = i % 2 === 0 ? '' : 'var(--light-bg)';
            tr.innerHTML = `
                <td style="padding:6px 12px;border-bottom:1px solid var(--border);font-weight:700;color:var(--navy);white-space:nowrap;">${c.col}</td>
                <td style="padding:6px 12px;border-bottom:1px solid var(--border);color:#16a34a;font-family:monospace;white-space:nowrap;">${c.example}</td>
                <td style="padding:6px 12px;border-bottom:1px solid var(--border);color:var(--muted);">${c.note}</td>
            `;
            tbody.appendChild(tr);
        });
    })();

    // ── Download Template ──
    document.getElementById('downloadTemplateBtn').addEventListener('click', () => {
        if (typeof XLSX === 'undefined') { alert('SheetJS not loaded yet, please wait a moment and try again.'); return; }

        const headers = IMPORT_COLUMNS.map(c => c.col);
        const examples = [
            ['Data Structures','Lecture','Major','BSCS 2-A','',   'Juan Dela Cruz','301','Monday','08:00','09:30'],
            ['Web Development','Laboratory','Major','BSIT 1-B','', 'Maria Santos',  '201','Tuesday','13:00','15:00'],
            ['Physical Education','None','Minor','BSEMC-DAT 3-A','','Pedro Reyes', '101','Wednesday','07:00','08:00'],
            ['Discrete Mathematics','Lecture','Major','BSCS 1-A','B','Ana Reyes',  '302','Thursday','10:00','11:30'],
        ];

        const wsData = [headers, ...examples];
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // Column widths
        ws['!cols'] = [
            {wch:22},{wch:12},{wch:13},{wch:14},{wch:16},{wch:22},{wch:8},{wch:12},{wch:12},{wch:12}
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Schedule Template');

        // Instructions sheet
        const instrData = [
            ['CCSRMS Schedule Import Template — Instructions'],
            [''],
            ['Fill in the "Schedule Template" sheet with your schedule data.'],
            ['Do NOT change the column headers (Row 1).'],
            ['You may delete the sample rows (Rows 2–4) before filling in your data.'],
            [''],
            ['Column Reference:'],
            ...IMPORT_COLUMNS.map(c => [`  ${c.col}`, c.note, `Example: ${c.example}`]),
            [''],
            ['Valid values for Day: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday'],
            ['Valid values for Type: Lecture, Laboratory, None'],
            ['Valid values for Major_Minor: Major, Minor'],
            ['Time format: HH:MM in 24-hour (07:00 to 21:00 in 30-min increments)'],
            [''],
            ['Merged Classes:'],
            ['  Leave Merged_Section blank for regular single-block classes.'],
            ['  For merged classes (e.g. Block A and Block B together), put the SECOND block letter in Merged_Section.'],
            ['  Example: Section = "BSCS 1-A", Merged_Section = "B"  →  saves as "BSCS 1-A/B"'],
        ];
        const wsInstr = XLSX.utils.aoa_to_sheet(instrData);
        wsInstr['!cols'] = [{wch:20},{wch:55},{wch:30}];
        XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions');

        XLSX.writeFile(wb, 'CCSRMS_Schedule_Import_Template.xlsx');
        showToast('Template downloaded!', 'success');
    });

    // ── Modal open / close ──
    document.getElementById('importScheduleBtn').addEventListener('click', () => {
        resetImportModal();
        document.getElementById('importModalOverlay').style.display = 'flex';
        document.getElementById('importModalOverlay').style.alignItems = 'center';
        document.getElementById('importModalOverlay').style.justifyContent = 'center';
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebarOverlay').classList.remove('show');
        document.body.style.overflow = 'hidden';
    });

    function closeImportModal() {
        document.getElementById('importModalOverlay').style.display = 'none';
        document.body.style.overflow = '';
        resetImportModal();
    }

    document.getElementById('importModalCloseBtn').addEventListener('click', closeImportModal);
    document.getElementById('importCancelBtn').addEventListener('click', closeImportModal);
    document.getElementById('importModalOverlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('importModalOverlay')) closeImportModal();
    });

    function resetImportModal() {
        document.getElementById('importFileInput').value = '';
        document.getElementById('importFileName').style.display  = 'none';
        document.getElementById('importParseError').style.display = 'none';
        document.getElementById('importStep3').style.display      = 'none';
        document.getElementById('importPreviewBody').innerHTML    = '';
        document.getElementById('importWarningBadge').style.display = 'none';
        document.getElementById('importConflictNote').style.display = 'none';
        document.getElementById('importConfirmBtn').disabled = true;
        document.getElementById('importConfirmBtn').style.opacity = '0.5';
        document.getElementById('importConfirmBtn').style.cursor  = 'not-allowed';
        document.getElementById('importConfirmLabel').textContent = 'Import Schedules';
        importReadyRows = [];
    }

    // ── Drag-over styling ──
    const dropZone = document.getElementById('importDropZone');
    dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.style.borderColor = '#3b82f6'; dropZone.style.background = '#eff6ff'; });
    dropZone.addEventListener('dragleave', ()  => { dropZone.style.borderColor = ''; dropZone.style.background = ''; });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = ''; dropZone.style.background = '';
        const file = e.dataTransfer.files[0];
        if (file) handleImportFile(file);
    });

    document.getElementById('importFileInput').addEventListener('change', (e) => {
        if (e.target.files[0]) handleImportFile(e.target.files[0]);
    });

    document.getElementById('importFileClearBtn').addEventListener('click', (e) => {
        e.preventDefault();
        resetImportModal();
    });

    // ── Time helpers ──
    function normalizeTime(raw) {
        if (!raw && raw !== 0) return null;
        // Handle Excel serial time (fraction of a day)
        if (typeof raw === 'number') {
            const totalMins = Math.round(raw * 24 * 60);
            const h = Math.floor(totalMins / 60);
            const m = totalMins % 60;
            return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
        }
        const s = String(raw).trim();
        // HH:MM or HH:MM:SS
        const m1 = s.match(/^(\d{1,2}):(\d{2})/);
        if (m1) return String(parseInt(m1[1])).padStart(2,'0') + ':' + m1[2];
        // HHMM
        const m2 = s.match(/^(\d{2})(\d{2})$/);
        if (m2) return m2[1] + ':' + m2[2];
        return null;
    }

    function isValidTime30(t) {
        if (!t) return false;
        const [h, m] = t.split(':').map(Number);
        return h >= 7 && h <= 21 && (m === 0 || m === 30) && !(h === 21 && m === 30);
    }

    // ── Parse file ──
    let importReadyRows = [];

    function handleImportFile(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['xlsx','csv'].includes(ext)) {
            showParseError('Only .xlsx or .csv files are accepted.');
            return;
        }

        document.getElementById('importFileName').style.display = 'flex';
        document.getElementById('importFileNameText').textContent = file.name + ' (' + (file.size/1024).toFixed(1) + ' KB)';
        document.getElementById('importParseError').style.display = 'none';
        document.getElementById('importStep3').style.display = 'none';

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data  = new Uint8Array(e.target.result);
                const wb    = XLSX.read(data, { type: 'array', cellDates: false });
                const ws    = wb.Sheets[wb.SheetNames[0]];
                const rows  = XLSX.utils.sheet_to_json(ws, { defval: '' });

                if (rows.length === 0) { showParseError('The file appears to be empty or has no data rows.'); return; }

                // Validate headers
                const required = IMPORT_COLUMNS.map(c => c.col);
                const fileKeys = Object.keys(rows[0]);
                const missing  = required.filter(r => !fileKeys.includes(r));
                if (missing.length > 0) {
                    showParseError('Missing required columns: ' + missing.join(', ') + '. Please use the downloaded template.');
                    return;
                }

                processRows(rows);
            } catch (err) {
                showParseError('Could not read the file. Make sure it is a valid .xlsx or .csv. (' + err.message + ')');
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function showParseError(msg) {
        const el = document.getElementById('importParseError');
        el.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="margin-right:6px;"></i>' + msg;
        el.style.display = 'block';
        document.getElementById('importStep3').style.display = 'none';
        document.getElementById('importConfirmBtn').disabled = true;
        document.getElementById('importConfirmBtn').style.opacity = '0.5';
        importReadyRows = [];
    }

    function processRows(rows) {
        const tbody = document.getElementById('importPreviewBody');
        tbody.innerHTML = '';
        importReadyRows = [];

        let warnCount = 0;
        const processedRows = [];

        rows.forEach((row, idx) => {
            const subject   = String(row['Subject']        || '').trim();
            const type      = String(row['Type']           || '').trim();
            const mm        = String(row['Major_Minor']    || '').trim();
            // Auto-normalize section to uppercase: "bsit 1-b" -> "BSIT 1-B"
            const section   = String(row['Section']        || '').trim().toUpperCase();
            // Optional merged block letter (e.g. "B" → merges with primary block to form "BSCS 2-A/B")
            const mergedRaw = String(row['Merged_Section'] || '').trim().toUpperCase();
            const teacher   = String(row['Teacher']        || '').trim();
            const roomRaw   = String(row['Room']        || '').trim();
            // Normalize day to Title Case: "monday" -> "Monday"
            const dayRaw    = String(row['Day']         || '').trim();
            const day       = dayRaw.charAt(0).toUpperCase() + dayRaw.slice(1).toLowerCase();
            const startRaw  = row['Start_Time'];
            const endRaw    = row['End_Time'];

            const startTime = normalizeTime(startRaw);
            const endTime   = normalizeTime(endRaw);

            // ── Validation ──
            const errors = [];

            if (!subject)   errors.push('Subject is empty');
            if (!VALID_TYPES.includes(type.toLowerCase()))  errors.push('Type must be Lecture, Laboratory, or None (got: "' + type + '")');
            if (!VALID_MM.includes(mm.toLowerCase()))       errors.push('Major_Minor must be Major or Minor (got: "' + mm + '")');

            // Section format: COURSE YEAR-BLOCK — already uppercased
            const secMatch = section.trim().match(/^(\S+)\s+(\d+)-([A-Z])$/i);
            if (!secMatch) errors.push('Section must be like "BSCS 2-A" (got: "' + section + '")');

            // Merged_Section validation — must be a single letter A–F if provided, and different from primary block
            let mergedBlock = '';
            if (mergedRaw) {
                if (!/^[A-F]$/.test(mergedRaw)) {
                    errors.push('Merged_Section must be a single block letter A–F (got: "' + mergedRaw + '"). Leave blank if not a merged class.');
                } else if (secMatch && mergedRaw === secMatch[3].toUpperCase()) {
                    errors.push('Merged_Section block ("' + mergedRaw + '") must be different from the primary Section block ("' + secMatch[3] + '").');
                } else {
                    mergedBlock = mergedRaw;
                }
            }
            if (!teacher)  errors.push('Teacher name is empty');

            const roomNum = parseInt(roomRaw);
            if (isNaN(roomNum)) errors.push('Room must be a number (got: "' + roomRaw + '")');

            if (!VALID_DAYS.includes(day)) errors.push('Day must be Monday–Saturday (got: "' + day + '")');

            if (!startTime)             errors.push('Start_Time could not be read (got: "' + startRaw + '") — use HH:MM format');
            else if (!isValidTime30(startTime)) errors.push('Start_Time ' + startTime + ' must be 07:00–21:00, on the hour or :30');

            if (!endTime)               errors.push('End_Time could not be read (got: "' + endRaw + '") — use HH:MM format');
            else if (!isValidTime30(endTime))   errors.push('End_Time ' + endTime + ' must be 07:00–21:00, on the hour or :30');

            if (startTime && endTime && startTime >= endTime) errors.push('End_Time (' + endTime + ') must be after Start_Time (' + startTime + ')');

            // ── Build final section string (e.g. "BSCS 2-A" or "BSCS 2-A/B" for merged) ──
            const finalSection = (secMatch && mergedBlock)
                ? secMatch[1] + ' ' + secMatch[2] + '-' + secMatch[3] + '/' + mergedBlock
                : section;

            // ── Role check: coordinator can only import their own course ──
            if (errors.length === 0 && coordinatorCourse && secMatch) {
                const secCourse = secMatch[1].toUpperCase();
                if (!canOwnSection(finalSection)) {
                    errors.push('You can only import schedules for ' + coordinatorCourse);
                }
            }

            const isValid = errors.length === 0;

            // ── Conflict check (only for valid rows, against already-loaded schedules) ──
            let hasConflict = false;
            let conflictNote = '';

            if (isValid) {
                const roomStr = String(roomNum);
                const sM = timeToMins(startTime);
                const eM = timeToMins(endTime);

                // Room conflict
                const roomSlots = allRoomSchedules[roomStr] || [];
                const roomConflict = roomSlots.find(s => s.day === day && sM < timeToMins(s.end_time) && eM > timeToMins(s.start_time));
                if (roomConflict) {
                    hasConflict   = true;
                    conflictNote  = 'Room ' + roomNum + ' occupied by "' + roomConflict.course_name + '" on ' + day;
                }

                // Section conflict across all rooms
                if (!hasConflict) {
                    const secConflict = findSectionConflict(finalSection, day, sM, eM, roomStr, null);
                    if (secConflict) {
                        hasConflict  = true;
                        conflictNote = 'Section ' + finalSection + ' already in Room ' + secConflict.room + ' on ' + day;
                    }
                }
            }

            // ── Build course_name exactly like the manual form does ──
            let fullCourseName = '';
            if (isValid) {
                const capType = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
                const capMM   = mm.charAt(0).toUpperCase() + mm.slice(1).toLowerCase();
                fullCourseName = subject
                    + ' [' + capMM + ']'
                    + (capType !== 'None' ? ' (' + capType + ')' : '');
            }

            const rowData = {
                rowNum: idx + 2, // 1-indexed + header
                subject, type, mm, section: finalSection, mergedBlock, teacher,
                room: String(roomNum),
                day, startTime, endTime,
                fullCourseName,
                valid: isValid,
                conflict: hasConflict,
                conflictNote,
                errors,
            };
            processedRows.push(rowData);

            if (!isValid || hasConflict) warnCount++;
            if (isValid && !hasConflict)  importReadyRows.push(rowData);
        });

        // ── Render preview table ──
        processedRows.forEach((r) => {
            const tr  = document.createElement('tr');
            const trR = document.createElement('tr'); // reason row

            let statusCell, rowBg, reasonHtml = '';

            if (!r.valid) {
                rowBg = '#fef2f2';
                statusCell = `<div style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;font-size:0.7rem;font-weight:700;background:#fef2f2;color:#dc2626;border:1px solid #fca5a5;">✕ Invalid</div>`;
                reasonHtml = r.errors.map(e =>
                    `<div style="display:flex;align-items:flex-start;gap:5px;margin-top:3px;">
                        <i class="fa-solid fa-circle-exclamation" style="color:#dc2626;font-size:0.65rem;margin-top:2px;flex-shrink:0;"></i>
                        <span style="font-size:0.72rem;color:#b91c1c;">${escHtml(e)}</span>
                    </div>`
                ).join('');
            } else if (r.conflict) {
                rowBg = '#fff7ed';
                statusCell = `<div style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;font-size:0.7rem;font-weight:700;background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;">⚠ Conflict</div>`;
                reasonHtml = `<div style="display:flex;align-items:flex-start;gap:5px;margin-top:3px;">
                    <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;font-size:0.65rem;margin-top:2px;flex-shrink:0;"></i>
                    <span style="font-size:0.72rem;color:#92400e;">${escHtml(r.conflictNote)}</span>
                </div>`;
            } else {
                rowBg = '';
                statusCell = `<div style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;font-size:0.7rem;font-weight:700;background:#f0fdf4;color:#16a34a;border:1px solid #86efac;">✓ Ready</div>`;
            }

            const colCount = 11;
            const mergeBadge = r.mergedBlock
                ? ` <span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:0.68rem;font-weight:700;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;margin-left:3px;" title="Merged class">⇌ Merged</span>`
                : '';
            tr.style.background = rowBg;
            tr.innerHTML = `
                <td style="padding:6px 10px;border-bottom:${reasonHtml ? 'none' : '1px solid var(--border)'};color:var(--muted);font-size:0.7rem;">${r.rowNum}</td>
                <td style="padding:6px 10px;border-bottom:${reasonHtml ? 'none' : '1px solid var(--border)'};font-weight:600;color:var(--text);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(r.subject)}">${escHtml(r.subject)}</td>
                <td style="padding:6px 10px;border-bottom:${reasonHtml ? 'none' : '1px solid var(--border)'};color:var(--muted);">${escHtml(r.type)}</td>
                <td style="padding:6px 10px;border-bottom:${reasonHtml ? 'none' : '1px solid var(--border)'};color:var(--muted);">${escHtml(r.mm)}</td>
                <td style="padding:6px 10px;border-bottom:${reasonHtml ? 'none' : '1px solid var(--border)'};white-space:nowrap;">${escHtml(r.section)}${mergeBadge}</td>
                <td style="padding:6px 10px;border-bottom:${reasonHtml ? 'none' : '1px solid var(--border)'};max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(r.teacher)}">${escHtml(r.teacher)}</td>
                <td style="padding:6px 10px;border-bottom:${reasonHtml ? 'none' : '1px solid var(--border)'};text-align:center;">${escHtml(r.room)}</td>
                <td style="padding:6px 10px;border-bottom:${reasonHtml ? 'none' : '1px solid var(--border)'};white-space:nowrap;">${escHtml(r.day)}</td>
                <td style="padding:6px 10px;border-bottom:${reasonHtml ? 'none' : '1px solid var(--border)'};white-space:nowrap;">${r.startTime ? to12hr(r.startTime) : '—'}</td>
                <td style="padding:6px 10px;border-bottom:${reasonHtml ? 'none' : '1px solid var(--border)'};white-space:nowrap;">${r.endTime ? to12hr(r.endTime) : '—'}</td>
                <td style="padding:6px 10px;border-bottom:${reasonHtml ? 'none' : '1px solid var(--border)'};">${statusCell}</td>
            `;
            tbody.appendChild(tr);

            // Inline reason row — shown directly under the data row, no hover needed
            if (reasonHtml) {
                trR.style.background = rowBg;
                trR.innerHTML = `<td colspan="${colCount}" style="padding:4px 10px 8px 28px;border-bottom:1px solid var(--border);">${reasonHtml}</td>`;
                tbody.appendChild(trR);
            }
        });

        // Update UI
        document.getElementById('importRowCount').textContent = importReadyRows.length;
        document.getElementById('importStep3').style.display = '';

        if (warnCount > 0) {
            document.getElementById('importWarningBadge').style.display = '';
            document.getElementById('importWarningCount').textContent = warnCount;
            document.getElementById('importConflictNote').style.display = '';
        } else {
            document.getElementById('importWarningBadge').style.display  = 'none';
            document.getElementById('importConflictNote').style.display  = 'none';
        }

        const hasReady = importReadyRows.length > 0;
        document.getElementById('importConfirmBtn').disabled = !hasReady;
        document.getElementById('importConfirmBtn').style.opacity = hasReady ? '1' : '0.5';
        document.getElementById('importConfirmBtn').style.cursor  = hasReady ? 'pointer' : 'not-allowed';
        document.getElementById('importConfirmLabel').textContent =
            hasReady ? 'Import ' + importReadyRows.length + ' Schedule' + (importReadyRows.length !== 1 ? 's' : '') : 'No Valid Rows';
    }

    // ── Confirm Import ──
    document.getElementById('importConfirmBtn').addEventListener('click', async () => {
        if (importReadyRows.length === 0) return;

        const btn = document.getElementById('importConfirmBtn');
        btn.disabled = true;
        btn.style.opacity = '0.7';
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Importing...';

        const entries = importReadyRows.map(r => ({
            room:        r.room,
            course_name: r.fullCourseName,
            section:     r.section,
            faculty:     r.teacher,
            day:         r.day,
            start_time:  r.startTime + ':00',
            end_time:    r.endTime   + ':00',
        }));

        try {
            if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
                // Demo mode: push to localStorage
                entries.forEach(e => {
                    const key = 'schedules_' + e.room;
                    const existing = JSON.parse(localStorage.getItem(key) || '[]');
                    existing.push({ ...e, id: Date.now() + Math.random() });
                    localStorage.setItem(key, JSON.stringify(existing));
                    if (!allRoomSchedules[e.room]) allRoomSchedules[e.room] = [];
                    allRoomSchedules[e.room].push({ ...e, id: Date.now() + Math.random() });
                });
                closeImportModal();
                renderTimetable();
                showToast('Imported ' + entries.length + ' schedule' + (entries.length !== 1 ? 's' : '') + ' successfully!', 'success');
                return;
            }

            const { error } = await _supabase.from('schedules').insert(entries);
            if (error) {
                showToast('Import failed: ' + error.message, 'error');
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.innerHTML = '<i class="fa-solid fa-upload"></i> Retry Import';
                return;
            }

            closeImportModal();
            await loadSchedules();
            showToast('✓ Imported ' + entries.length + ' schedule' + (entries.length !== 1 ? 's' : '') + ' successfully!', 'success');

        } catch (err) {
            showToast('Unexpected error: ' + err.message, 'error');
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.innerHTML = '<i class="fa-solid fa-upload"></i> Retry Import';
        }
    });

