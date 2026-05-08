    // ── AVAILABILITY FEATURE ──
    // Sync the Find Free Room Day dropdowns to whatever day is currently selected
    (function initFindFreeSelects() {
        const startSel = document.getElementById('findFreeStart');
        const endSel   = document.getElementById('findFreeEnd');
        if (!startSel || !endSel) return;
        // HOURS is defined in the main script; wait until DOM is ready
        function populate() {
            if (typeof HOURS === 'undefined') { setTimeout(populate, 100); return; }
            HOURS.forEach(h => {
                const o1 = document.createElement('option');
                o1.value = h; o1.textContent = to12hr(h);
                startSel.appendChild(o1);
                const o2 = document.createElement('option');
                o2.value = h; o2.textContent = to12hr(h);
                endSel.appendChild(o2);
            });
            // Default: 7:00 → 9:00
            startSel.value = '07:00';
            endSel.value   = '09:00';
        }
        populate();
    })();

    // Sync the Find Free Room Day dropdowns to whatever day is currently selected
    function syncFindFreeDay() {
        const sel1 = document.getElementById('findFreeDay');
        const sel2 = document.getElementById('findFreeDayDur');
        if (sel1 && typeof currentDay !== 'undefined') sel1.value = currentDay;
        if (sel2 && typeof currentDay !== 'undefined') sel2.value = currentDay;
    }

    // ── Mode toggle: exact vs duration ──
    let findFreeMode = 'exact';
    function setFindMode(mode) {
        findFreeMode = mode;
        const exactRow  = document.getElementById('modeExactRow');
        const durRow    = document.getElementById('modeDurRow');
        const exactBtn  = document.getElementById('modeExactBtn');
        const durBtn    = document.getElementById('modeDurBtn');
        const resultsEl = document.getElementById('findFreeResults');
        if (mode === 'exact') {
            exactRow.style.display = 'flex';
            durRow.style.display   = 'none';
            exactBtn.style.background    = '#16a34a';
            exactBtn.style.color         = 'white';
            exactBtn.style.borderColor   = '#16a34a';
            durBtn.style.background      = 'transparent';
            durBtn.style.color           = '#15803d';
            durBtn.style.borderColor     = '#86efac';
        } else {
            exactRow.style.display = 'none';
            durRow.style.display   = 'flex';
            durBtn.style.background      = '#16a34a';
            durBtn.style.color           = 'white';
            durBtn.style.borderColor     = '#16a34a';
            exactBtn.style.background    = 'transparent';
            exactBtn.style.color         = '#15803d';
            exactBtn.style.borderColor   = '#86efac';
        }
        resultsEl.style.display = 'none';
        resultsEl.innerHTML = '';
    }

    // ── OPTION 2: Find Free Room panel ──
    function toggleFindFreePanel() {
        const panel = document.getElementById('findFreePanel');
        const btn   = document.getElementById('findFreeBtn');
        const isOpen = panel.classList.contains('show');
        if (isOpen) {
            panel.classList.remove('show');
            btn.classList.remove('active');
            btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Find Free Room';
        } else {
            syncFindFreeDay();
            panel.classList.add('show');
            btn.classList.add('active');
            btn.innerHTML = '<i class="fa-solid fa-xmark"></i> Close Search';
            // Auto-run with current day on open
            if (findFreeMode === 'duration') runFindByDuration(); else runFindFreeRoom();
        }
    }

    function runFindFreeRoom() {
        const day       = document.getElementById('findFreeDay').value;
        const startVal  = document.getElementById('findFreeStart').value;
        const endVal    = document.getElementById('findFreeEnd').value;
        const resultsEl = document.getElementById('findFreeResults');

        if (!startVal || !endVal) return;
        if (startVal >= endVal) {
            showToast('"From" time must be before "To" time', 'error'); return;
        }

        const searchStart = timeToMins(startVal);
        const searchEnd   = timeToMins(endVal);

        // Get ALL rooms
        const allRoomNums = ALL_ROOMS.map(r => String(r));

        const freeRooms = [];
        const busyRooms = [];

        allRoomNums.forEach(room => {
            const roomSlots = allRoomSchedules[room] || [];
            const conflict  = roomSlots.find(s => {
                if (s.day !== day) return false;
                const sM = timeToMins(s.start_time);
                const eM = timeToMins(s.end_time);
                return searchStart < eM && searchEnd > sM;
            });
            if (conflict) {
                busyRooms.push({ room, conflict });
            } else {
                freeRooms.push(room);
            }
        });

        // Build result chips
        let html = '';

        if (freeRooms.length === 0) {
            html = `<div style="font-size:0.82rem;color:#b91c1c;font-weight:600;padding:4px 0;">
                        <i class="fa-solid fa-circle-xmark"></i> No free rooms found for ${day} ${to12hr(startVal)} – ${to12hr(endVal)}
                    </div>`;
        } else {
            html += `<div style="width:100%;font-size:0.75rem;font-weight:700;color:#15803d;margin-bottom:2px;">
                        <i class="fa-solid fa-circle-check"></i> ${freeRooms.length} free room(s) — click to jump:
                     </div>`;
            freeRooms.forEach(room => {
                html += `<div class="free-room-chip" onclick="jumpToRoom('${room}','${day}','${startVal}')">
                            <i class="fa-solid fa-door-open"></i> Room ${room}
                         </div>`;
            });
        }

        if (busyRooms.length > 0) {
            html += `<div style="width:100%;font-size:0.75rem;font-weight:700;color:#b91c1c;margin-top:8px;margin-bottom:2px;">
                        <i class="fa-solid fa-circle-xmark"></i> ${busyRooms.length} occupied:
                     </div>`;
            busyRooms.forEach(({ room, conflict }) => {
                const subj = (conflict.course_name || '').replace(/\s*\[.*?\]/g,'').replace(/\s*\(.*?\)/g,'').trim();
                html += `<div class="busy-room-chip" title="Occupied by: ${subj} (${conflict.section})">
                            <i class="fa-solid fa-lock"></i> Room ${room}
                         </div>`;
            });
        }

        resultsEl.innerHTML = html;
        resultsEl.style.display = 'flex';
    }

    // ── DURATION MODE: find any room+time slot that fits the class length ──
    function runFindByDuration() {
        const day        = document.getElementById('findFreeDayDur').value;
        const durMins    = parseInt(document.getElementById('findFreeDuration').value);
        const resultsEl  = document.getElementById('findFreeResults');

        // All rooms
        const allRoomNums = ALL_ROOMS.map(r => String(r));

        // For each room, find all contiguous free windows >= durMins on this day
        const roomSlots = []; // { room, startMins, endMins }

        allRoomNums.forEach(room => {
            const occupied = (allRoomSchedules[room] || [])
                .filter(s => s.day === day)
                .map(s => ({ sM: timeToMins(s.start_time), eM: timeToMins(s.end_time) }))
                .sort((a, b) => a.sM - b.sM);

            // Build list of free windows between HOURS[0] and HOURS[last]
            const dayStart = timeToMins(HOURS[0]);
            const dayEnd   = timeToMins(HOURS[HOURS.length - 1]);

            // Merge occupied slots to handle overlaps, then find gaps
            const merged = [];
            occupied.forEach(o => {
                if (!merged.length || o.sM >= merged[merged.length-1].eM) {
                    merged.push({ ...o });
                } else {
                    merged[merged.length-1].eM = Math.max(merged[merged.length-1].eM, o.eM);
                }
            });

            // Gaps: before first, between blocks, after last
            const boundaries = [
                { eM: dayStart },
                ...merged,
                { sM: dayEnd }
            ];
            for (let i = 0; i < boundaries.length - 1; i++) {
                const gapStart = boundaries[i].eM;
                const gapEnd   = boundaries[i + 1].sM !== undefined ? boundaries[i + 1].sM : dayEnd;
                if (gapEnd - gapStart >= durMins) {
                    // This gap can fit the class — find all possible start times (every 30 min step)
                    for (let t = gapStart; t + durMins <= gapEnd; t += 30) {
                        // Only include slots that align with an HOURS slot
                        const hourStr = HOURS.find(h => timeToMins(h) === t);
                        if (hourStr) {
                            roomSlots.push({ room, startMins: t, endMins: t + durMins });
                        }
                    }
                }
            }
        });

        // Group results by room, then by start time
        const byRoom = {};
        roomSlots.forEach(s => {
            if (!byRoom[s.room]) byRoom[s.room] = [];
            byRoom[s.room].push(s);
        });

        const durLabel = durMins >= 60
            ? (durMins % 60 === 0 ? (durMins/60)+'h' : Math.floor(durMins/60)+'h '+(durMins%60)+'min')
            : durMins+'min';

        let html = '';

        if (Object.keys(byRoom).length === 0) {
            html = `<div style="font-size:0.82rem;color:#b91c1c;font-weight:600;padding:4px 0;">
                        <i class="fa-solid fa-circle-xmark"></i> No room has a free ${durLabel} slot on ${day}.
                    </div>`;
        } else {
            html += `<div style="width:100%;font-size:0.75rem;font-weight:700;color:#15803d;margin-bottom:4px;">
                        <i class="fa-solid fa-circle-check"></i> Rooms with a free ${durLabel} slot on ${day} — click a time to jump:
                     </div>`;

            Object.keys(byRoom).sort((a,b) => parseInt(a)-parseInt(b)).forEach(room => {
                const slots = byRoom[room];
                html += `<div style="width:100%;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px;background:var(--light-bg);border:1.5px solid #86efac;border-radius:9px;margin-bottom:2px;">
                            <span style="font-size:0.78rem;font-weight:700;color:#15803d;white-space:nowrap;min-width:64px;">
                                <i class="fa-solid fa-door-open"></i> Room ${room}
                            </span>`;
                slots.forEach(s => {
                    const startH = HOURS.find(h => timeToMins(h) === s.startMins) || '';
                    const endH   = HOURS.find(h => timeToMins(h) === s.endMins)   || '';
                    const endLabel = endH ? to12hr(endH) : minsToTime(s.endMins);
                    html += `<div class="free-room-chip" style="font-size:0.73rem;padding:4px 10px;"
                                  onclick="jumpToRoom('${room}','${day}','${startH}')">
                                 ${to12hr(startH)} – ${endLabel}
                             </div>`;
                });
                html += `</div>`;
            });
        }

        resultsEl.innerHTML = html;
        resultsEl.style.display = 'flex';
        resultsEl.style.flexDirection = 'column';
    }

    // helper: convert minutes back to HH:MM string for display
    function minsToTime(m) {
        const h = Math.floor(m/60), mm = m%60;
        return (h<10?'0':'')+h+':'+(mm<10?'0':'')+mm;
    }

    // ── BANNER CONFLICT CLICK → navigate to slot then auto-open suggest ──
    function navigateToBannerConflict(rowEl) {
        const slotAId   = rowEl.dataset.slotAId;
        const slotARoom = rowEl.dataset.slotARoom;
        const slotBId   = rowEl.dataset.slotBId;
        const slotBRoom = rowEl.dataset.slotBRoom;
        const day       = rowEl.dataset.day;

        // Pick slot A as the primary one to navigate to
        const slotId   = slotAId;
        const room     = slotARoom;

        // Find the actual schedule entry
        let targetSlot = null;
        for (const [r, slots] of Object.entries(allRoomSchedules)) {
            const found = slots.find(s => String(s.id) === String(slotId));
            if (found) { targetSlot = { ...found, room: r }; break; }
        }
        if (!targetSlot) return;

        const startTime = targetSlot.start_time.slice(0, 5);

        // Collapse the banner so the timetable is visible
        document.getElementById('blockConflictBanner').classList.add('collapsed');

        // Switch day if needed
        if (day !== currentDay) {
            currentDay = day;
            document.querySelectorAll('#dayGrid .floor-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.day === day);
            });
        }

        // Load schedules then scroll & highlight, then auto-open suggest modal
        loadSchedules().then(() => {
            setTimeout(() => {
                // Find the rendered cell for this slot
                let target = null;
                document.querySelectorAll('#timetableBody .scheduled-slot').forEach(td => {
                    const idEl = td.querySelector('.slot-id');
                    if (idEl && String(idEl.dataset.id) === String(slotId)) target = td;
                });

                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Flash highlight — use the existing bscsFlash-style animation inline
                    target.style.transition = 'outline 0.1s, box-shadow 0.1s';
                    target.style.outline    = '3px solid #ef4444';
                    target.style.boxShadow  = '0 0 0 6px rgba(239,68,68,0.25)';
                    setTimeout(() => {
                        target.style.outline   = '';
                        target.style.boxShadow = '';
                    }, 1800);

                    // After a short pause, open the suggest-move modal for this slot
                    setTimeout(() => {
                        openSuggestMoveForSlot(slotId, room);
                    }, 400);
                }
            }, 120);
        });
    }

    // Open the conflict modal in "suggest" mode directly for a given slot
    function openSuggestMoveForSlot(slotId, room) {
        // Find the slot entry
        let entry = null;
        for (const [r, slots] of Object.entries(allRoomSchedules)) {
            const found = slots.find(s => String(s.id) === String(slotId));
            if (found) { entry = { ...found, room: r }; break; }
        }
        if (!entry) return;

        const conflictRoom = entry.room;
        const durMins = timeToMins(entry.end_time) - timeToMins(entry.start_time);
        const day     = entry.day;

        const freeSlots = findFreeSlotsForEntry(entry, conflictRoom);

        // Populate the conflict modal — no pendingNewEntry needed (banner-initiated)
        const timeStr = to12hr(entry.start_time.slice(0,5)) + ' – ' + to12hr(entry.end_time.slice(0,5));
        document.getElementById('conflictSlotCard').innerHTML =
            '<strong>'+escHtml(entry.course_name)+'</strong> '+
            escHtml(entry.section)+'<br>'+escHtml(entry.faculty)+'<br>'+
            '<span class="slot-time">'+timeStr+'</span>'+
            '<br><span style="font-size:0.75rem;color:#f59e0b;">Block conflict on: '+escHtml(day)+'</span>';

        // Show suggest panel immediately
        document.getElementById('conflictSuggestName').textContent =
            entry.course_name.replace(/\s*\[.*?\]/,'').replace(/\s*\(.*?\)/,'').trim();

        const listEl = document.getElementById('conflictSuggestList');
        const noneEl = document.getElementById('conflictSuggestNone');

        _suggestEntry = { ...entry, room: conflictRoom };
        renderSuggestSlots(listEl, noneEl, freeSlots, entry, (slot) => {
            pendingNewEntry = null;
            applyConflictMove(entry, slot.room, slot.start, slot.end);
        });

        // Show modal with suggest panel open, hide main action buttons
        document.getElementById('conflictSuggestPanel').style.display = 'block';
        document.getElementById('conflictMainBtns').style.display     = 'none';
        document.getElementById('conflictReplaceRow').style.display   = 'none';
        document.getElementById('conflictModal').classList.add('show');
    }

    // Jump to a specific room on a specific day, then highlight the slot
    function jumpToRoom(room, day, startTime) {
        // Switch day if needed
        if (day !== currentDay) {
            currentDay = day;
            document.querySelectorAll('#dayGrid .floor-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.day === day);
            });
        }

        // Load schedules then scroll & highlight the cell
        loadSchedules().then(() => {
            setTimeout(() => {
                const startMins = timeToMins(startTime);
                // Find the empty cell at that room + time
                const cells = document.querySelectorAll('#timetableBody td');
                let target = null;
                cells.forEach(td => {
                    if (String(td.dataset.room) === String(room) && td.dataset.time) {
                        const cellMins = timeToMins(td.dataset.time);
                        if (cellMins === startMins) target = td;
                    }
                });
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    target.style.transition = 'background 0.2s';
                    target.style.background = '#bbf7d0';
                    setTimeout(() => { target.style.background = ''; }, 1800);
                }
                // Close the panel
                toggleFindFreePanel();
                // Pre-fill the schedule modal room
                currentRoom = String(room);
                schedules   = allRoomSchedules[String(room)] || [];
                if (target) {
                    openScheduleModal(String(room), startTime);
                }
            }, 120);
        });
    }

    // ── Register Service Worker (PWA) ──
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js')
                    .then(reg => console.log('SW registered:', reg.scope))
                    .catch(err => console.warn('SW registration failed:', err));
            });
        }
