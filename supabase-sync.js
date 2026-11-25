// Timetable Editor <-> Supabase persistence + login gate.
// Replaces localStorage keys timetableAppData_v2 / masterTimetableData_v2 as the source of truth.
// DB side (existing public.timetable table): one 'config' row (editor settings, teachers, subjects, substitutions,
// date overrides) + one 'period' row per filled cell for status 'working' and 'master'.
// Saves go through the existing save_timetable() RPC: atomic replace with optimistic-concurrency version check.
(function () {
    'use strict';
    const CFG = window.SCHOOL_SUPABASE;
    const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const EDIT_ROLES = ['admin', 'super_admin', 'principal', 'vice_principal'];
    const LEGACY_KEYS = ['timetableAppData_v2', 'masterTimetableData_v2'];

    const sb = window.supabase.createClient(CFG.url, CFG.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'school-auth' }
    });
    window.sbClient = sb;

    let remoteVersion = 0;      // config-row version we last loaded/saved (optimistic concurrency)
    let saving = false, queued = false, dirty = false, conflictOpen = false;
    let profile = null;

    const $ = (id) => document.getElementById(id);
    function status(text, kind) {
        const el = $('lastSaved'); if (!el) return;
        el.textContent = text;
        el.style.color = kind === 'err' ? '#dc2626' : kind === 'busy' ? '#b45309' : '';
        el.style.cursor = kind === 'err' ? 'pointer' : '';
        el.title = kind === 'err' ? 'Click to retry saving' : '';
    }
    function toast(msg, isErr) {
        let t = $('sbToast');
        if (!t) {
            t = document.createElement('div'); t.id = 'sbToast';
            t.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:100000;padding:10px 14px;border-radius:8px;color:#fff;font:13px system-ui;max-width:340px;box-shadow:0 4px 14px rgba(0,0,0,.25)';
            document.body.appendChild(t);
        }
        t.style.background = isErr ? '#dc2626' : '#15803d'; t.textContent = msg; t.style.display = 'block';
        clearTimeout(t._h); t._h = setTimeout(() => { t.style.display = 'none'; }, isErr ? 6000 : 2500);
    }

    // ───────── login gate ─────────
    function overlay(html) {
        let o = $('sbAuthOverlay');
        if (!o) {
            o = document.createElement('div'); o.id = 'sbAuthOverlay';
            o.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0f172a;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif';
            document.body.appendChild(o);
        }
        o.innerHTML = '<div style="background:#fff;border-radius:12px;padding:28px;width:min(360px,92vw);box-shadow:0 10px 40px rgba(0,0,0,.4)">' + html + '</div>';
        o.style.display = 'flex';
        return o;
    }
    function showLogin(msg) {
        const o = overlay(
            '<h2 style="margin:0 0 4px;font-size:20px">Timetable Editor</h2>' +
            '<p style="margin:0 0 16px;color:#64748b;font-size:13px">Sign in with your school account. Everyone can view the timetable; only the principal and admin can edit it.</p>' +
            '<form id="sbLoginForm"><input id="sbEmail" type="email" required autocomplete="username" placeholder="Email" style="width:100%;padding:10px;margin-bottom:8px;border:1px solid #cbd5e1;border-radius:8px;box-sizing:border-box">' +
            '<input id="sbPass" type="password" required autocomplete="current-password" placeholder="Password" style="width:100%;padding:10px;margin-bottom:10px;border:1px solid #cbd5e1;border-radius:8px;box-sizing:border-box">' +
            '<div id="sbLoginMsg" style="color:#dc2626;font-size:13px;min-height:18px;margin-bottom:8px"></div>' +
            '<button id="sbLoginBtn" style="width:100%;padding:10px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer">Sign in</button></form>');
        if (msg) $('sbLoginMsg').textContent = msg;
        $('sbLoginForm').onsubmit = async (e) => {
            e.preventDefault();
            const btn = $('sbLoginBtn'); btn.disabled = true; btn.textContent = 'Signing in…';
            const { error } = await sb.auth.signInWithPassword({ email: $('sbEmail').value.trim(), password: $('sbPass').value });
            if (error) { $('sbLoginMsg').textContent = error.message === 'Invalid login credentials' ? 'Invalid email or password.' : error.message; btn.disabled = false; btn.textContent = 'Sign in'; return; }
            location.reload();
        };
        void o;
    }
    async function loadProfile(user) {
        const { data, error } = await sb.from('users').select('id,name,email,role,is_active').eq('id', user.id).maybeSingle();
        if (error) throw error;
        return data;
    }
    window.sbLogout = async function () { await sb.auth.signOut(); location.replace(location.pathname); };

    // ───────── data mapping ─────────
    function cellRows(table, settings, subjects) {
        const rows = [];
        const times = (settings && settings.periodTimes) || {};
        Object.keys(table || {}).forEach(cls => {
            Object.keys(table[cls] || {}).forEach(day => {
                const di = DAY_NAMES.indexOf(day); if (di < 0) return;
                Object.keys(table[cls][day] || {}).forEach(pk => {
                    const v = table[cls][day][pk];
                    const pn = parseInt(String(pk).replace(/\D/g, ''), 10);
                    if (!v || !pn || (!v.subject && !v.teacher)) return;
                    const t = times[pk] || {};
                    rows.push({
                        class_section: cls, day_of_week: di + 1, period_number: pn,
                        subject: (subjects && subjects[v.subject] && subjects[v.subject].name) || v.subject || '',
                        subject_code: v.subject || null, teacher_code: v.teacher || null,
                        combined_group: v.combined || null,
                        start_time: t.start || null, end_time: t.end || null
                    });
                });
            });
        });
        return rows;
    }
    function configPayload() {
        const c = JSON.parse(JSON.stringify(appData)); delete c.timetable; return c;
    }
    function rowsToTable(rows) {
        const t = {};
        rows.forEach(r => {
            const day = DAY_NAMES[r.day_of_week - 1]; if (!day) return;
            ((t[r.class_section] = t[r.class_section] || {})[day] = t[r.class_section][day] || {})['P' + r.period_number] =
                Object.assign({ subject: r.subject_code || r.subject || null, teacher: r.teacher_code || null }, r.combined_group ? { combined: r.combined_group } : {});
        });
        return t;
    }

    // ───────── load ─────────
    async function fetchAll() {
        const { data, error } = await sb.from('timetable').select('row_kind,status,class_section,day_of_week,period_number,subject,subject_code,teacher_code,combined_group,payload,version').limit(20000);
        if (error) throw error;
        return data || [];
    }
    function applyRemote(rows) {
        const cfgRow = rows.find(r => r.row_kind === 'config' && r.status === 'working');
        if (!cfgRow) return false;
        const p = cfgRow.payload || {};
        appData.classes = p.classes || []; appData.classTeachers = p.classTeachers || {}; appData.subjects = p.subjects || {};
        appData.teachers = p.teachers || {}; appData.substitutedCells = p.substitutedCells || {}; appData.eventLogs = p.eventLogs || [];
        appData.dateOverrides = p.dateOverrides || {}; appData.departments = p.departments || [];
        appData.settings = p.settings || { periodsPerDay: 7, periodTimes: {}, breaks: [], includeSaturday: true };
        appData.timetable = rowsToTable(rows.filter(r => r.row_kind === 'period' && r.status === 'working'));
        masterTimetable = rowsToTable(rows.filter(r => r.row_kind === 'period' && r.status === 'master'));
        if (!appData.settings.periodTimes || !Object.keys(appData.settings.periodTimes).length) appData.settings.periodTimes = initDefaultTimes();
        if (!appData.settings.periodsPerDay) appData.settings.periodsPerDay = 7;
        if (!Array.isArray(appData.settings.breaks)) appData.settings.breaks = [];
        if (typeof appData.settings.includeSaturday !== 'boolean') appData.settings.includeSaturday = true;
        recomputeDays();
        getClassKeys().forEach(c => {
            if (!appData.timetable[c]) {
                appData.timetable[c] = {};
                DAYS.forEach(d => { appData.timetable[c][d] = {}; for (let p = 1; p <= appData.settings.periodsPerDay; p++) appData.timetable[c][d]['P' + p] = { subject: null, teacher: null }; });
            }
        });
        remoteVersion = Number(cfgRow.version) || 0;
        return true;
    }
    // One-time import of data a browser still holds in the old localStorage keys (only when Supabase is empty).
    function legacyLocal() {
        try {
            const raw = localStorage.getItem(LEGACY_KEYS[0]); if (!raw) return null;
            const p = JSON.parse(raw); if (!p || !(p.classes || []).length) return null;
            return { app: p, master: JSON.parse(localStorage.getItem(LEGACY_KEYS[1]) || 'null') };
        } catch (e) { return null; }
    }

    window.loadDataRemote = async function () {
        status('loading…', 'busy');
        const rows = await fetchAll();
        if (applyRemote(rows)) { lastSnap = snap(); status('loaded from Supabase', ''); return true; }
        const legacy = legacyLocal();
        if (legacy && confirm('The database has no timetable yet, but this browser holds an older local timetable.\n\nImport it into Supabase now?')) {
            const p = legacy.app;
            appData.classes = p.classes || []; appData.classTeachers = p.classTeachers || {}; appData.subjects = p.subjects || {};
            appData.teachers = p.teachers || {}; appData.timetable = p.timetable || {}; appData.substitutedCells = p.substitutedCells || {};
            appData.eventLogs = p.eventLogs || []; appData.dateOverrides = p.dateOverrides || {}; appData.departments = p.departments || [];
            appData.settings = p.settings || appData.settings;
            masterTimetable = legacy.master && Object.keys(legacy.master).length ? legacy.master : JSON.parse(JSON.stringify(appData.timetable));
            recomputeDays(); dirty = true;
            return true;
        }
        status('no saved timetable yet', '');
        return false;
    };

    // ───────── save ─────────
    const snap = () => JSON.stringify([appData, masterTimetable]);
    let lastSnap = null;        // state as last loaded from / written to Supabase
    async function doSave(force) {
        if (saving) { queued = true; return; }
        const mySnap = snap();
        if (!force && mySnap === lastSnap) { dirty = false; return; }   // nothing changed: no write, no version bump
        saving = true; status('saving…', 'busy');
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        let lastErr = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const { data, error } = await sb.rpc('save_timetable', {
                    p_working: cellRows(appData.timetable, appData.settings, appData.subjects),
                    p_master: cellRows(masterTimetable, appData.settings, appData.subjects),
                    p_config: configPayload(),
                    p_expected_version: force ? null : remoteVersion
                });
                if (error) throw error;
                remoteVersion = Number(data && data.version) || remoteVersion;
                lastSnap = mySnap; dirty = snap() !== mySnap; saving = false;
                status('saved to Supabase ' + new Date().toLocaleTimeString(), '');
                if (queued) { queued = false; doSave(); }
                return;
            } catch (e) {
                lastErr = e;
                if (String(e.message || '').includes('TIMETABLE_CONFLICT')) { saving = false; queued = false; return onConflict(); }
                if (e.code === '42501' || /not allowed|row-level|JWT|not authenticated/i.test(e.message || '')) break; // not retryable
                await sleep(800 * attempt);
            }
        }
        saving = false; queued = false;
        status('SAVE FAILED – click to retry', 'err');
        toast('Could not save to Supabase: ' + ((lastErr && lastErr.message) || 'network error'), true);
    }
    function onConflict() {
        if (conflictOpen) return; conflictOpen = true;
        status('conflict – newer version exists', 'err');
        const reload = confirm('Someone else saved a newer timetable.\n\nOK = discard your unsaved changes and load the latest.\nCancel = keep your version and overwrite theirs.');
        conflictOpen = false;
        if (reload) { location.reload(); } else { doSave(true); }
    }

    let timer = null;
    // Called from index.html's saveDataNow()/saveData() (the editor's original ~44 save call sites).
    window.sbSaveNow = function () { clearTimeout(timer); timer = null; if (!window._sbReady) return; return doSave(); };
    window.sbSave = function () { if (!window._sbReady) return; dirty = snap() !== lastSnap; clearTimeout(timer); timer = setTimeout(() => doSave(), 600); };
    window.addEventListener('beforeunload', (e) => { if (dirty || saving) { e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('click', (e) => { if (e.target && e.target.id === 'lastSaved' && e.target.style.cursor === 'pointer') doSave(); });

    // ───────── boot ─────────
    async function boot() {
        try {
            const { data: { session } } = await sb.auth.getSession();
            if (!session) return showLogin();
            profile = await loadProfile(session.user);
            if (!profile || !profile.is_active) { await sb.auth.signOut(); return showLogin('This account is inactive or has no profile.'); }
            const viewOnly = !EDIT_ROLES.includes(profile.role);   // everyone may view; only principal/admin may edit
            overlay('<p style="margin:0;font:14px system-ui">Loading timetable from Supabase…</p>');
            if (viewOnly) {
                // Read-only copy of the published (master) timetable, served by the get_timetable_view() database function.
                const { data, error } = await sb.rpc('get_timetable_view');
                if (error) throw error;
                if (!applyRemote(data || [])) { overlay('<p style="margin:0 0 10px;font:14px system-ui">No timetable has been published yet.</p><button onclick="sbLogout()" style="padding:8px 14px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer">Log out</button>'); return; }
                lastSnap = snap(); window._sbViewOnly = true;      // _sbReady stays false: nothing can be saved from here
                const st = document.createElement('style'); st.textContent = '#btnModeToggle,#undoRedoGroup,#btnLockMaster,#btnResetToMaster,#btnOperations,#operationsMenu,#manageDataWrap,#btnImport,#backupBanner{display:none!important}'; window.openImportGuide = function(){}; ['importModal','importGuideModal'].forEach(function(i){var m=document.getElementById(i); if(m) m.remove();}); document.head.appendChild(st);
            } else {
                await window.loadDataRemote();
                window._sbReady = true;
            }
            $('sbAuthOverlay').style.display = 'none';
            window.startEditorAfterAuth(); // runs the original init()
            if (viewOnly) {
                if (typeof toggleViewMode === 'function' && viewMode !== 'master') toggleViewMode();
                const vb = document.createElement('div'); vb.textContent = '\uD83D\uDC41 View only - only the principal or admin can edit the timetable';
                vb.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:100001;padding:5px 10px;border-radius:999px;background:#fef3c7;color:#92400e;font:12px system-ui,sans-serif;border:1px solid #fcd34d';
                document.body.appendChild(vb);
            }
            const bar = $('lastSaved') && $('lastSaved').parentElement;
            if (bar) {
                const b = document.createElement('button'); b.textContent = 'Logout (' + (profile.name || profile.email) + ')';
                b.style.cssText = 'margin-left:8px;padding:2px 8px;font-size:11px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer';
                b.onclick = window.sbLogout; bar.appendChild(b);
            }
            if (!viewOnly && dirty) doSave(true); // freshly imported legacy data
            sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') location.reload(); });
        } catch (e) {
            console.error(e);
            overlay('<p style="margin:0 0 10px;font:14px system-ui;color:#dc2626">Could not reach Supabase: ' + (e.message || e) + '</p><button onclick="location.reload()" style="padding:8px 14px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer">Retry</button>');
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

// Back-button guard: pressing Back inside the editor keeps you on the editor (or its login screen) instead of
// jumping out of the whole app. After logout the login screen is shown; a cached page is re-checked on return.
(function () {
    try {
        history.replaceState({ tt: 'base' }, '');
        history.pushState({ tt: 'app' }, '');
        window.addEventListener('popstate', function () {
            history.pushState({ tt: 'app' }, '');
            var signedIn = false; try { signedIn = !!localStorage.getItem('school-auth'); } catch (e) { }
            if (!signedIn) location.reload();
        });
        window.addEventListener('pageshow', function (e) { if (e.persisted) location.reload(); });
    } catch (e) { }
})();
