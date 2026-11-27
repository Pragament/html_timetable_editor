// Multi-school connection config.
// The app first asks for a SCHOOL CODE, then asks for that school's login credentials.
// To add a school: add one entry below (code in UPPER CASE). Only the publishable (anon) key belongs here.
// NEVER put a service-role key in this file.
window.SCHOOLS = {
    // code : { name, url, key }
    'DPSS': {
        name: 'DPSS',   // <-- change to the full school name if you want
        url: 'https://lntvobybgpnsixyxigku.supabase.co',
        key: 'sb_publishable_2Z_SZDYa5ohZ_KKIskcXSQ_ZfppUo4r'
    }
    // 'ABC': { name: 'ABC Public School', url: 'https://xxxx.supabase.co', key: 'sb_publishable_...' },
};

(function () {
    var CODE_KEY = 'school-code';
    window.schoolCodeLookup = function (code) {
        code = String(code || '').trim().toUpperCase();
        return Object.prototype.hasOwnProperty.call(window.SCHOOLS, code) ? { code: code, cfg: window.SCHOOLS[code] } : null;
    };
    function fromUrl() { try { return new URLSearchParams(location.search).get('school') || ''; } catch (e) { return ''; } }
    window.getSavedSchoolCode = function () {
        var c = ''; try { c = localStorage.getItem(CODE_KEY) || ''; } catch (e) { }
        return c || fromUrl();          // fallback: https://site/index.html?school=DPSS (works even if storage is blocked)
    };
    // Returns true if the code was stored; false when the browser blocks storage (caller then uses ?school=CODE).
    window.saveSchoolCode = function (c) {
        try { localStorage.setItem(CODE_KEY, c); return localStorage.getItem(CODE_KEY) === c; } catch (e) { return false; }
    };
    // Forget the school (and its login session) so the School Connect screen shows again.
    window.changeSchool = function () {
        try { localStorage.removeItem(CODE_KEY); localStorage.removeItem('school-auth'); localStorage.removeItem('cachedProfile'); localStorage.removeItem('userRole'); } catch (e) { }
        location.replace(location.pathname);
    };
    var hit = window.schoolCodeLookup(window.getSavedSchoolCode());
    if (hit) {
        window.SCHOOL_CODE = hit.code;
        window.SCHOOL_NAME = hit.cfg.name;
        window.SCHOOL_SUPABASE = { url: hit.cfg.url, key: hit.cfg.key };   // same shape the other shared scripts read
    }
})();
