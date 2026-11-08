/* AMAR SECONDARY SCHOOL - app logic.
   Real access control is done by the database (Row Level Security).
   Hiding a button here is only a convenience, never the protection. */
(function () {
  'use strict';

  var SCHOOL = 'AMAR SECONDARY SCHOOL';
  var DOMAIN = 'amar.school';
  var STR = window.AMAR_STRINGS;
  var cfg = window.AMAR_CONFIG || {};
  var configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !/YOUR_/.test(cfg.SUPABASE_URL) && window.supabase);
  var db = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  var root = document.getElementById('app');
  var state = { lang: 'en', profile: null, stack: [], timeoutMin: 15, timer: null, child: null, children: [] };
  var signed = {};
  var installEvt = null;

  try { state.lang = localStorage.getItem('amar_lang') || 'en'; } catch (e) {}

  /* ---------- helpers ---------- */
  function t(k) { return (STR[state.lang] && STR[state.lang][k]) || STR.en[k] || k; }
  function sub(k) { return (STR[state.lang] && STR[state.lang]['s_' + k]) || STR.en['s_' + k] || ''; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function toast(msg, bad) {
    var el = document.getElementById('toast');
    el.textContent = msg; el.className = 'toast' + (bad ? ' bad' : ''); el.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { el.hidden = true; }, 3500);
  }
  function must(res) { if (res.error) throw res.error; return res.data; }
  function errText(e) { return (e && e.message) ? e.message : t('err_generic'); }
  function roleLabel(r) { return t(r + '_login'); }
  function roleTitle(r) { return t(r === 'admin' ? 'card_school' : r === 'teacher' ? 'card_teacher' : 'card_student'); }

  function logo(size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 100 100" aria-hidden="true">' +
      '<circle cx="50" cy="50" r="48" fill="#1f78b4"/>' +
      '<path d="M50 22 L84 38 L50 54 L16 38 Z" fill="#fff"/>' +
      '<path d="M30 48 V62 C30 70 70 70 70 62 V48 L50 58 Z" fill="#dff1ff"/>' +
      '<rect x="80" y="40" width="3" height="20" fill="#fff"/><circle cx="81.5" cy="62" r="3.5" fill="#fff"/></svg>';
  }

  function langToggle() {
    return '<div class="seg" data-lang-toggle>' +
      '<button data-l="en" class="' + (state.lang === 'en' ? 'on' : '') + '">English</button>' +
      '<button data-l="ne" class="' + (state.lang === 'ne' ? 'on' : '') + '">नेपाली</button></div>';
  }
  function bindLangToggle(el, after) {
    var box = $('[data-lang-toggle]', el);
    if (!box) return;
    box.addEventListener('click', function (e) {
      var l = e.target.getAttribute && e.target.getAttribute('data-l');
      if (l) setLanguage(l, after);
    });
  }
  function setLanguage(l, after) {
    state.lang = l;
    try { localStorage.setItem('amar_lang', l); } catch (e) {}
    if (state.profile) {
      try { localStorage.setItem('amar_lang_' + state.profile.id, l); } catch (e) {}
      db.from('users').update({ language: l }).eq('id', state.profile.id).then(function () {});
    }
    document.documentElement.lang = l === 'ne' ? 'ne' : 'en';
    after();
  }

  /* ---------- photos (private storage, short-lived links) ---------- */
  async function photoSrc(path) {
    var c = signed[path];
    if (c && c.exp > Date.now()) return c.url;
    try {
      var r = await db.storage.from('photos').createSignedUrl(path, 3600);
      if (r.error || !r.data) return '';
      signed[path] = { url: r.data.signedUrl, exp: Date.now() + 3300000 };
      return r.data.signedUrl;
    } catch (e) { return ''; }
  }
  function hydratePhotos(el) {
    el.querySelectorAll('[data-photo]').forEach(function (n) {
      var path = n.getAttribute('data-photo');
      if (!path) return;
      photoSrc(path).then(function (u) {
        if (!u) return;
        n.style.backgroundImage = 'url("' + u + '")';
        var s = n.querySelector('span'); if (s) s.remove();
      });
    });
  }
  function resizeImage(file, max) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) { URL.revokeObjectURL(url); b ? resolve(b) : reject(new Error('Image error')); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { reject(new Error('This file is not an image')); };
      img.src = url;
    });
  }
  async function uploadPhoto(path, file) {
    var blob = await resizeImage(file, 500);
    must(await db.storage.from('photos').upload(path, blob, { upsert: true, contentType: 'image/jpeg' }));
    delete signed[path];
  }

  /* ---------- inactivity logout ---------- */
  function touch() {
    clearTimeout(state.timer);
    if (!state.profile) return;
    state.timer = setTimeout(function () { signOut(); }, state.timeoutMin * 60 * 1000);
  }
  ['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, touch, { passive: true }); });

  /* ---------- auth ---------- */
  async function loadProfile(uid, expected) {
    var row = must(await db.from('users').select('id, role, login_id, full_name, full_name_ne, language, is_active').eq('id', uid).maybeSingle());
    if (!row) throw { key: 'err_invalid_login' };
    if (row.is_active !== true) throw { key: 'err_inactive' };
    if (expected && row.role !== expected) throw { key: 'err_wrong_role' };
    state.profile = row;
    var saved = null;
    try { saved = localStorage.getItem('amar_lang_' + uid); } catch (e) {}
    state.lang = saved || row.language || state.lang;
    try {
      var s = await db.from('schools').select('inactivity_timeout_minutes').maybeSingle();
      if (s.data && s.data.inactivity_timeout_minutes) state.timeoutMin = s.data.inactivity_timeout_minutes;
    } catch (e) {}
    if (row.role === 'parent') await loadChildren();
    touch();
  }

  async function signIn(role, loginId, password) {
    if (!configured) throw { key: 'err_not_configured' };
    var email = loginId.trim().toLowerCase() + '@' + DOMAIN;
    var res;
    try { res = await db.auth.signInWithPassword({ email: email, password: password }); }
    catch (e) { throw { key: 'err_network' }; }
    if (res.error) {
      var m = (res.error.message || '').toLowerCase();
      if (m.indexOf('banned') >= 0) throw { key: 'err_inactive' };
      if (m.indexOf('fetch') >= 0 || m.indexOf('network') >= 0) throw { key: 'err_network' };
      throw { key: 'err_invalid_login' };
    }
    try { await loadProfile(res.data.user.id, role); }
    catch (e) { await db.auth.signOut(); throw e.key ? e : { key: 'err_invalid_login' }; }
    db.from('login_history').insert({ user_id: res.data.user.id, success: true, device_info: navigator.userAgent.slice(0, 200) }).then(function () {});
  }

  async function signOut() {
    clearTimeout(state.timer);
    closeMenu();
    try { if (db) await db.auth.signOut(); } catch (e) {}
    state.profile = null; state.stack = []; state.child = null; state.children = [];
    showSelect();
  }

  /* ---------- download page (browser) ---------- */
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; });
  window.addEventListener('appinstalled', function () {
    installEvt = null;
    var m = document.getElementById('dlmsg'); if (m) m.textContent = STR.en.dl_done + '\n' + STR.ne.dl_done;
  });
  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }
  function showDownload() {
    root.innerHTML = '<div class="dl"><div>' + logo(130) + '</div><h1>' + SCHOOL + '</h1>' +
      '<button class="btn primary big" id="dlbtn">⬇ Download App · एप डाउनलोड</button><p class="muted" id="dlmsg"></p></div>';
    $('#dlbtn').addEventListener('click', function () {
      var msg = $('#dlmsg');
      if (installEvt) {
        installEvt.prompt();
        installEvt.userChoice.then(function (c) {
          installEvt = null;
          if (c && c.outcome === 'accepted') msg.textContent = STR.en.dl_done + '\n' + STR.ne.dl_done;
        });
        return;
      }
      var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      var k = ios ? 'dl_ios' : 'dl_android';
      msg.textContent = STR.en[k] + '\n\n' + STR.ne[k];
    });
  }

  /* ---------- pre-login screens ---------- */
  function showSplash() {
    root.innerHTML = '<div class="center">' + logo(120) + '<div class="school">' + SCHOOL + '</div></div>';
  }

  function showSelect() {
    var cards = [['teacher', '🧑‍🏫', 'card_teacher'], ['parent', '🧒', 'card_student'], ['admin', '🏫', 'card_school']];
    var h = '<div class="page"><div class="sel-top"><h2>Amar Secondary School</h2>' + langToggle() + '</div>' +
      '<div class="logocard">' + logo(150) + '<div class="school">' + SCHOOL + '</div></div><div class="rolegrid">';
    cards.forEach(function (c) {
      h += '<button class="rolecard" data-role="' + c[0] + '"><span class="e">' + c[1] + '</span>' + esc(t(c[2])) + '</button>';
    });
    h += '</div>';
    if (!configured) h += '<div class="note">' + esc(t('err_not_configured')) + '</div>';
    h += '</div>';
    root.innerHTML = h;
    bindLangToggle(root, showSelect);
    root.querySelectorAll('[data-role]').forEach(function (b) {
      b.addEventListener('click', function () { showLogin(b.getAttribute('data-role')); });
    });
  }

  function showLogin(role) {
    var idKey = role === 'admin' ? 'school_id' : role === 'teacher' ? 'teacher_id' : 'parent_id';
    root.innerHTML = '<div class="appbar"><button class="icon" id="back">←</button><h2>' + esc(roleTitle(role)) + '</h2></div>' +
      '<div class="page"><div class="row" style="justify-content:flex-end">' + langToggle() + '</div>' +
      '<p class="muted">' + esc(t('login_help')) + '</p>' +
      '<form class="form" id="lf" novalidate>' +
      '<label>' + esc(t(idKey)) + '</label><input id="lid" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false">' +
      '<label>' + esc(t('password')) + '</label><input id="lpw" type="password" autocomplete="current-password">' +
      '<p class="err" id="lerr"></p><button class="btn primary" type="submit" id="lbtn">' + esc(t('login')) + '</button></form></div>';
    $('#back').onclick = showSelect;
    bindLangToggle(root, function () { showLogin(role); });
    $('#lf').addEventListener('submit', async function (e) {
      e.preventDefault();
      var id = $('#lid').value, pw = $('#lpw').value, err = $('#lerr'), btn = $('#lbtn');
      err.textContent = '';
      if (!id.trim() || !pw) { err.textContent = t('err_required'); return; }
      btn.disabled = true; btn.textContent = t('loading');
      try { await signIn(role, id, pw); showShell(); }
      catch (ex) { err.textContent = t(ex.key || 'err_generic'); btn.disabled = false; btn.textContent = t('login'); }
    });
  }

  /* ---------- shell: app bar, content, bottom bar ---------- */
  function showShell() {
    state.stack = [];
    root.innerHTML = '<div class="shell"><div id="appbar"></div><div id="content"></div><nav class="bottom" id="nav"></nav></div>';
    renderChrome(); renderContent();
  }

  var NAV = [['homework', '📓', 'placeholder'], ['attendance', '✅', 'placeholder'], ['home'], ['notices', '📢', 'placeholder'], ['inbox', '💬', 'inbox']];

  function renderChrome() {
    var v = state.stack[state.stack.length - 1];
    var left = v ? '<button class="icon" id="back">←</button>' : '<span class="mini">' + logo(36) + '</span>';
    var title = v ? v.title() : roleTitle(state.profile.role);
    $('#appbar').innerHTML = '<div class="appbar">' + left + '<h2>' + esc(title) + '</h2><button class="icon" id="more" aria-label="menu">⋮</button></div>';
    var back = $('#back'); if (back) back.onclick = pop;
    $('#more').onclick = function (e) { e.stopPropagation(); if ($('#menu')) closeMenu(); else openMenu(); };

    var nav = $('#nav');
    nav.innerHTML = NAV.map(function (n) {
      if (n[0] === 'home') return '<button class="mid" data-n="home" aria-label="' + esc(t('home')) + '"><span>' + logo(56) + '</span></button>';
      return '<button data-n="' + n[0] + '"><span class="i">' + n[1] + '</span>' + esc(t(n[0])) + '</button>';
    }).join('');
    nav.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-n');
        closeMenu();
        if (key === 'home') { state.stack = []; }
        else {
          var item = NAV.filter(function (n) { return n[0] === key; })[0];
          state.stack = [{ title: function () { return t(key); }, render: item[2] === 'inbox' ? viewInbox : placeholder }];
        }
        renderChrome(); renderContent();
      });
    });
  }

  function openMenu() {
    var m = document.createElement('div'); m.className = 'menu'; m.id = 'menu';
    m.innerHTML = '<div class="mi"><div class="muted sm" style="margin-bottom:6px">' + esc(t('language')) + '</div>' + langToggle() + '</div>' +
      '<div class="mi muted sm">' + esc(state.profile.full_name) + ' · ' + esc(state.profile.login_id) + '</div>' +
      '<button class="mi out" id="mlo">⎋ ' + esc(t('logout')) + '</button>';
    document.body.appendChild(m);
    bindLangToggle(m, function () { closeMenu(); renderChrome(); renderContent(); });
    $('#mlo', m).onclick = function () { closeMenu(); if (confirm(t('confirm_logout'))) signOut(); };
    setTimeout(function () { document.addEventListener('click', outsideMenu); }, 0);
  }
  function outsideMenu(e) { var m = $('#menu'); if (m && !m.contains(e.target)) closeMenu(); }
  function closeMenu() {
    var m = $('#menu'); if (m) m.remove();
    document.removeEventListener('click', outsideMenu);
  }

  function push(view) { state.stack.push(view); renderChrome(); renderContent(); }
  function pop() { state.stack.pop(); renderChrome(); renderContent(); }

  function renderContent() {
    var c = $('#content');
    if (state.stack.length) {
      var v = state.stack[state.stack.length - 1];
      c.innerHTML = '<div class="pad" id="sub"></div>';
      Promise.resolve(v.render($('#sub'))).catch(function (e) { $('#sub').innerHTML = '<p class="err">' + esc(errText(e)) + '</p>'; });
      return;
    }
    c.innerHTML = '<div class="page" id="tab"></div>';
    Promise.resolve(tabHome($('#tab'))).catch(function (e) { $('#tab').innerHTML = '<p class="err">' + esc(errText(e)) + '</p>'; });
  }

  /* ---------- generic UI pieces ---------- */
  function tiles(list) {
    return '<div class="grid">' + list.map(function (f, i) {
      return '<button class="tile" data-i="' + i + '">' + (f.view ? '' : '<span class="badge">' + esc(t('soon')) + '</span>') +
        '<span class="i">' + f.i + '</span><b>' + esc(t(f.k)) + '</b><small>' + esc(sub(f.k)) + '</small></button>';
    }).join('') + '</div>';
  }
  function bindTiles(el, list) {
    el.querySelectorAll('.tile').forEach(function (b) {
      b.addEventListener('click', function () {
        var f = list[+b.getAttribute('data-i')];
        push({ title: function () { return t(f.k); }, render: f.view || placeholder });
      });
    });
  }
  function placeholder(el) {
    el.innerHTML = '<div class="empty"><div style="font-size:56px">🛠️</div><h3>' + esc(t('not_implemented')) + '</h3><p>' + esc(t('coming_in_phase')) + '</p></div>';
  }
  function viewInbox(el) {
    el.innerHTML = '<div class="empty"><div style="font-size:56px">🔔</div>' + esc(t('no_notifications')) + '</div>';
  }
  function emptyMsg(key) { return '<div class="empty">' + esc(t(key || 'nothing_here')) + '</div>'; }
  function irow(labelKey, val) {
    return val ? '<div class="irow"><b>' + esc(t(labelKey)) + '</b><span>' + esc(val) + '</span></div>' : '';
  }

  /* Form builder.  field = {name,label,type,required,options,dependsOn} */
  function mountForm(el, o) {
    var vals = o.values || {};
    function optsOf(f) { return typeof f.options === 'function' ? f.options(readValues()) : (f.options || []); }
    function optHtml(f, sel) {
      return '<option value=""></option>' + optsOf(f).map(function (op) {
        return '<option value="' + esc(op.value) + '"' + (String(op.value) === String(sel) ? ' selected' : '') + '>' + esc(op.label) + '</option>';
      }).join('');
    }
    function fieldHtml(f) {
      var v = vals[f.name] == null ? '' : vals[f.name];
      var lab = '<label>' + esc(t(f.label)) + (f.required ? ' *' : '') + '</label>';
      if (f.type === 'select') return lab + '<select name="' + f.name + '">' + optHtml(f, v) + '</select>';
      if (f.type === 'textarea') return lab + '<textarea name="' + f.name + '" rows="2">' + esc(v) + '</textarea>';
      if (f.type === 'file') return lab + '<input name="' + f.name + '" type="file" accept="image/*">';
      return lab + '<input name="' + f.name + '" type="' + (f.type || 'text') + '" value="' + esc(v) + '" autocomplete="off">';
    }
    function readValues() {
      var out = {};
      o.fields.forEach(function (f) {
        var inp = el.querySelector('[name="' + f.name + '"]');
        if (f.type === 'file') out[f.name] = inp && inp.files ? (inp.files[0] || null) : null;
        else out[f.name] = inp ? inp.value : (vals[f.name] || '');
      });
      return out;
    }
    el.innerHTML = '<form class="form" novalidate>' + (o.intro || '') + o.fields.map(fieldHtml).join('') +
      '<p class="err" data-err></p><button class="btn primary" type="submit">' + esc(t(o.submitKey || 'save')) + '</button></form>';
    var form = $('form', el);
    form.addEventListener('change', function (e) {
      var name = e.target.getAttribute('name');
      o.fields.forEach(function (f) {
        if (f.dependsOn === name) {
          var sel = el.querySelector('[name="' + f.name + '"]');
          sel.innerHTML = optHtml(f, '');
        }
      });
    });
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = $('[data-err]', el), btn = $('button[type=submit]', el), raw = readValues(), out = {};
      err.textContent = '';
      for (var i = 0; i < o.fields.length; i++) {
        var f = o.fields[i];
        if (f.type === 'file') { out[f.name] = raw[f.name]; continue; }
        var v = (raw[f.name] || '').trim();
        if (f.required && !v) { err.textContent = t(f.label) + ': ' + t('err_required'); return; }
        out[f.name] = v === '' ? null : (f.type === 'number' ? Number(v) : v);
      }
      btn.disabled = true;
      try { await o.onSubmit(out); }
      catch (ex) { err.textContent = errText(ex); btn.disabled = false; }
    });
  }

  function downloadCsv(name, rows) {
    var csv = rows.map(function (r) {
      return r.map(function (c) { c = c == null ? '' : String(c); return '"' + c.replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); toast(t('export_done'));
  }

  /* ---------- role home screens ---------- */
  var ADMIN = [
    { k: 'student_records', i: '🎒', view: viewStudents },
    { k: 'attendance', i: '✅' },
    { k: 'parent_info', i: '👨‍👩‍👧', view: viewParents },
    { k: 'marks_entry', i: '📝' },
    { k: 'grade_sheet', i: '🏅' },
    { k: 'teacher_records', i: '🧑‍🏫', view: viewTeachers },
    { k: 'auto_reports', i: '📄' },
    { k: 'class_mgmt', i: '🏫', view: viewClasses },
    { k: 'subject_mgmt', i: '📚', view: viewSubjects },
    { k: 'fees', i: '💰' },
    { k: 'homework', i: '📓' },
    { k: 'exam_routine', i: '🗓️' },
    { k: 'class_routine', i: '⏰' },
    { k: 'notices', i: '📢' },
    { k: 'calendar', i: '📅' },
    { k: 'library', i: '📖' },
    { k: 'transport', i: '🚌' },
    { k: 'staff_leave', i: '🏖️' },
    { k: 'user_accounts', i: '🔑', view: viewAccounts }
  ];
  var TEACHER = [
    { k: 'my_classes', i: '🏫', view: viewMyClasses },
    { k: 'student_records', i: '🎒', view: function (el) { return viewStudents(el, true); } },
    { k: 'attendance', i: '✅' },
    { k: 'marks_entry', i: '📝' },
    { k: 'homework', i: '📓' },
    { k: 'class_routine', i: '⏰' },
    { k: 'notices', i: '📢' },
    { k: 'calendar', i: '📅' },
    { k: 'staff_leave', i: '🏖️' }
  ];
  var PARENT = [
    { k: 'teachers', i: '👩‍🏫', view: viewChildTeachers },
    { k: 'homework', i: '📓' },
    { k: 'attendance', i: '✅' },
    { k: 'examination', i: '📄' },
    { k: 'exam_routine', i: '🗓️' },
    { k: 'account', i: '💰' },
    { k: 'library', i: '📖' },
    { k: 'calendar', i: '📅' },
    { k: 'timetable', i: '⏰' },
    { k: 'inbox', i: '🔔', view: viewInbox }
  ];

  async function count(table, filter) {
    var q = db.from(table).select('*', { count: 'exact', head: true });
    if (filter) q = filter(q);
    var r = await q; if (r.error) throw r.error; return r.count || 0;
  }

  async function tabHome(el) {
    var p = state.profile;
    var list = p.role === 'admin' ? ADMIN : p.role === 'teacher' ? TEACHER : PARENT;
    el.innerHTML = '<div id="hdr"></div><div id="info"></div><h3 class="qa">' + esc(t('quick_access')) + '</h3>' + tiles(list);
    bindTiles(el, list);
    var hdr = $('#hdr', el), info = $('#info', el);

    if (p.role === 'admin') {
      hdr.innerHTML = '<div class="hdr"><div class="ph" style="background:#fff">' + logo(80) + '</div>' +
        '<div class="hn">' + esc(p.full_name) + '</div><div class="hl">' + esc(roleLabel('admin')) + ' | ' + esc(t('id_label')) + ': ' + esc(p.login_id) + '</div>' +
        '<div class="hstats" id="st"></div></div>';
      var s = await Promise.all([
        count('students', function (q) { return q.eq('status', 'active'); }), count('teachers'), count('classes')]);
      $('#st', el).innerHTML = '<div><b>' + s[0] + '</b><span>' + esc(t('total_students')) + '</span></div>' +
        '<div><b>' + s[1] + '</b><span>' + esc(t('total_teachers')) + '</span></div>' +
        '<div><b>' + s[2] + '</b><span>' + esc(t('total_classes')) + '</span></div>';
    } else if (p.role === 'teacher') {
      var tr = must(await db.from('teachers').select('id, teacher_code, full_name, photo_url').eq('user_id', p.id).maybeSingle());
      var rows = tr ? must(await db.from('teacher_assignments').select('id, classes(name), sections(name), subjects(name)').eq('teacher_id', tr.id)) : [];
      hdr.innerHTML = '<div class="hdr"><div class="ph" data-photo="' + esc(tr && tr.photo_url) + '"><span>🧑‍🏫</span></div>' +
        '<div class="hn">' + esc(p.full_name) + '</div><div class="hl">🪪 ' + esc(t('teacher_id')) + ': ' + esc(p.login_id) + '</div></div>';
      info.innerHTML = '<div class="info"><h3>' + esc(t('assignments')) + '</h3>' +
        (rows.length ? rows.map(function (r) {
          return '<span class="chip">' + esc(r.classes ? r.classes.name : '') + (r.sections ? ' ' + esc(r.sections.name) : '') +
            ' · ' + esc(r.subjects ? r.subjects.name : t('none')) + '</span>';
        }).join('') : emptyMsg()) + '</div>';
      hydratePhotos(el);
    } else {
      var c = currentChild();
      if (!c) { hdr.innerHTML = '<div class="note">' + esc(t('no_child')) + '</div>'; return; }
      var sw = '';
      if (state.children.length > 1) {
        sw = '<select data-child-switch>' + state.children.map(function (x) {
          return '<option value="' + x.id + '"' + (x.id === state.child ? ' selected' : '') + '>' + esc(x.full_name) + '</option>';
        }).join('') + '</select>';
      }
      hdr.innerHTML = '<div class="hdr"><div class="ph" data-photo="' + esc(c.photo_url) + '"><span>🧒</span></div>' +
        '<div class="hn">' + esc(c.full_name) + '</div>' +
        '<div class="hl">🎓 ' + esc(t('class')) + ': ' + esc(c.classes ? c.classes.name : '–') + (c.sections ? ' ' + esc(c.sections.name) : '') +
        (c.roll_no ? ' | ' + esc(t('roll')) + ' ' + esc(c.roll_no) : '') + '</div>' +
        '<div class="hl">🪪 ' + esc(t('regd_no')) + ' ' + esc(c.student_code) + '</div>' + sw + '</div>';
      info.innerHTML = '<div class="info"><h3>' + esc(t('additional_info')) + '</h3>' +
        irow('guardian', c.guardian_name) + irow('contact_no', c.guardian_phone) + irow('address', c.address) +
        irow('house', c.house) + irow('blood_group', c.blood_group) + irow('emis_no', c.emis_no) + irow('dob', c.dob) + '</div>';
      hydratePhotos(el);
      var swEl = $('[data-child-switch]', el);
      if (swEl) swEl.addEventListener('change', function () { state.child = swEl.value; tabHome(el); });
    }
  }

  /* ---------- teacher views ---------- */
  function assignmentsHtml(rows, withDelete) {
    if (!rows.length) return emptyMsg();
    return rows.map(function (r) {
      return '<div class="card row between"><div><h4>' + esc(r.classes ? r.classes.name : '') + (r.sections ? ' – ' + esc(r.sections.name) : '') + '</h4>' +
        '<span class="chip">' + esc(r.subjects ? r.subjects.name : t('none')) + '</span></div>' +
        (withDelete ? '<button class="btn small danger" data-del="' + r.id + '">✕</button>' : '') + '</div>';
    }).join('');
  }
  async function viewMyClasses(el) {
    var tr = must(await db.from('teachers').select('id').eq('user_id', state.profile.id).maybeSingle());
    var rows = tr ? must(await db.from('teacher_assignments').select('id, classes(name), sections(name), subjects(name)').eq('teacher_id', tr.id)) : [];
    el.innerHTML = assignmentsHtml(rows);
  }

  /* ---------- parent views ---------- */
  async function loadChildren() {
    var pr = must(await db.from('parents').select('id').eq('user_id', state.profile.id).maybeSingle());
    state.children = [];
    if (pr) {
      var links = must(await db.from('parent_student_links').select('students(*, classes(name), sections(name))').eq('parent_id', pr.id));
      state.children = links.map(function (l) { return l.students; }).filter(Boolean);
    }
    var keep = state.child && state.children.filter(function (c) { return c.id === state.child; })[0];
    state.child = keep ? keep.id : (state.children[0] ? state.children[0].id : null);
  }
  function currentChild() { return state.children.filter(function (c) { return c.id === state.child; })[0]; }

  async function viewChildTeachers(el) {
    if (!state.child) { el.innerHTML = '<div class="note">' + esc(t('no_child')) + '</div>'; return; }
    var rows = must(await db.rpc('parent_child_teachers', { p_student: state.child }));
    var ne = state.lang === 'ne';
    el.innerHTML = rows.length ? rows.map(function (r) {
      var subj = ne ? (r.subject_name_ne || r.subject_name) : r.subject_name;
      return '<div class="card row"><div class="ph sm" data-photo="' + esc(r.photo_path) + '"><span>👩‍🏫</span></div><div><h4>' +
        esc(r.teacher_name) + '</h4>' + (subj ? '<span class="chip">' + esc(subj) + '</span>' : '') + '</div></div>';
    }).join('') : emptyMsg();
    hydratePhotos(el);
  }

  /* ---------- admin: classes & sections ---------- */
  async function viewClasses(el) {
    var cls = must(await db.from('classes').select('id, name, name_ne, level').order('level'));
    var secs = must(await db.from('sections').select('id, class_id, name').order('name'));
    var h = '<button class="btn primary" id="addc" style="margin-bottom:12px">＋ ' + esc(t('add_class')) + '</button>';
    if (!cls.length) h += emptyMsg();
    cls.forEach(function (c) {
      var mine = secs.filter(function (s) { return s.class_id === c.id; });
      h += '<div class="card"><div class="row between"><h4>' + esc(c.name) + (c.name_ne ? ' · ' + esc(c.name_ne) : '') + '</h4>' +
        '<button class="btn small" data-sec="' + c.id + '">＋ ' + esc(t('section')) + '</button></div><div>' +
        (mine.length ? mine.map(function (s) { return '<span class="chip">' + esc(s.name) + '</span>'; }).join('') : '<span class="muted">' + esc(t('no_sections')) + '</span>') + '</div></div>';
    });
    el.innerHTML = h;
    $('#addc', el).onclick = function () {
      push({ title: function () { return t('add_class'); }, render: function (e) {
        mountForm(e, { fields: [
          { name: 'name', label: 'class_name', required: true }, { name: 'name_ne', label: 'class_name_ne' },
          { name: 'level', label: 'level', type: 'number', required: true }],
          onSubmit: async function (v) {
            var sch = must(await db.from('schools').select('id').limit(1).maybeSingle());
            must(await db.from('classes').insert({ school_id: sch.id, name: v.name, name_ne: v.name_ne, level: v.level }));
            toast(t('saved')); pop();
          } });
      } });
    };
    el.querySelectorAll('[data-sec]').forEach(function (b) {
      b.onclick = function () {
        var cid = b.getAttribute('data-sec');
        push({ title: function () { return t('add_section'); }, render: function (e) {
          mountForm(e, { fields: [{ name: 'name', label: 'section_name', required: true }],
            onSubmit: async function (v) { must(await db.from('sections').insert({ class_id: cid, name: v.name })); toast(t('saved')); pop(); } });
        } });
      };
    });
  }

  /* ---------- admin: subjects ---------- */
  async function viewSubjects(el) {
    var rows = must(await db.from('subjects').select('id, name, name_ne').order('name'));
    el.innerHTML = '<button class="btn primary" id="adds" style="margin-bottom:12px">＋ ' + esc(t('add_subject')) + '</button>' +
      (rows.length ? rows.map(function (r) { return '<div class="card"><h4>' + esc(r.name) + '</h4><div class="muted">' + esc(r.name_ne || '') + '</div></div>'; }).join('') : emptyMsg());
    $('#adds', el).onclick = function () {
      push({ title: function () { return t('add_subject'); }, render: function (e) {
        mountForm(e, { fields: [{ name: 'name', label: 'subject_name', required: true }, { name: 'name_ne', label: 'subject_name_ne' }],
          onSubmit: async function (v) {
            var sch = must(await db.from('schools').select('id').limit(1).maybeSingle());
            must(await db.from('subjects').insert({ school_id: sch.id, name: v.name, name_ne: v.name_ne }));
            toast(t('saved')); pop();
          } });
      } });
    };
  }

  /* ---------- students (admin: manage / teacher: read only) ---------- */
  async function viewStudents(el, ro) {
    var rows = must(await db.from('students').select('*, classes(name), sections(name)').order('full_name'));
    var cls = must(await db.from('classes').select('id, name').order('level'));
    el.innerHTML = (ro ? '' : '<div class="row" style="margin-bottom:10px"><button class="btn primary" id="adds" style="flex:1">＋ ' + esc(t('add_student')) + '</button>' +
      '<button class="btn small" id="prom">⬆</button></div>') +
      '<input class="search" id="q" placeholder="' + esc(t('search')) + '">' +
      '<select class="search" id="cf"><option value="">' + esc(t('all')) + ' – ' + esc(t('class')) + '</option>' +
      cls.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('') + '</select>' +
      '<select class="search" id="sf"><option value="active">' + esc(t('active')) + '</option><option value="transferred">' + esc(t('transferred')) +
      '</option><option value="archived">' + esc(t('archived')) + '</option><option value="">' + esc(t('status_all')) + '</option></select>' +
      '<div id="list"></div><button class="btn small" id="exp" style="margin-top:8px">⬇ ' + esc(t('export_csv')) + '</button>';
    var filtered = rows;
    function draw() {
      var q = $('#q', el).value.trim().toLowerCase(), cf = $('#cf', el).value, sf = $('#sf', el).value;
      filtered = rows.filter(function (r) {
        return (!cf || r.class_id === cf) && (!sf || r.status === sf) &&
          (!q || (r.full_name || '').toLowerCase().indexOf(q) >= 0 || (r.full_name_ne || '').indexOf(q) >= 0 || (r.student_code || '').toLowerCase().indexOf(q) >= 0);
      });
      $('#list', el).innerHTML = filtered.length ? filtered.map(function (r) {
        return '<div class="card' + (ro ? '' : ' tap') + '" data-id="' + r.id + '"><h4>' + esc(r.full_name) + (r.full_name_ne ? ' · ' + esc(r.full_name_ne) : '') + '</h4>' +
          '<div class="muted">' + esc(r.student_code) + ' · ' + esc(r.classes ? r.classes.name : '–') + (r.sections ? ' ' + esc(r.sections.name) : '') +
          (r.roll_no ? ' · ' + esc(t('roll')) + ' ' + esc(r.roll_no) : '') + '</div>' +
          '<span class="chip ' + (r.status === 'active' ? 'ok' : 'bad') + '">' + esc(t(r.status)) + '</span></div>';
      }).join('') : emptyMsg('no_results');
      if (!ro) el.querySelectorAll('.card.tap').forEach(function (c) {
        c.onclick = function () { studentForm(rows.filter(function (r) { return r.id === c.getAttribute('data-id'); })[0]); };
      });
    }
    draw();
    $('#q', el).addEventListener('input', draw); $('#cf', el).addEventListener('change', draw); $('#sf', el).addEventListener('change', draw);
    if (!ro) {
      $('#adds', el).onclick = function () { studentForm(null); };
      $('#prom', el).onclick = promoteView;
    }
    $('#exp', el).onclick = function () {
      downloadCsv('students.csv', [['Student ID', 'Admission No', 'Name', 'Name (Nepali)', 'Class', 'Section', 'Roll', 'House', 'EMIS', 'Guardian', 'Guardian phone', 'Status']]
        .concat(filtered.map(function (r) { return [r.student_code, r.admission_no, r.full_name, r.full_name_ne, r.classes && r.classes.name, r.sections && r.sections.name, r.roll_no, r.house, r.emis_no, r.guardian_name, r.guardian_phone, r.status]; })));
    };
  }

  function promoteView() {
    push({ title: function () { return t('promote'); }, render: async function (e) {
      var cls = must(await db.from('classes').select('id, name').order('level'));
      var opts = cls.map(function (c) { return { value: c.id, label: c.name }; });
      mountForm(e, {
        intro: '<div class="note">' + esc(t('promote_confirm')) + '</div>',
        fields: [{ name: 'from_class', label: 'from_class', type: 'select', required: true, options: opts },
                 { name: 'to_class', label: 'to_class', type: 'select', required: true, options: opts }],
        submitKey: 'promote',
        onSubmit: async function (v) {
          var n = must(await db.rpc('admin_promote_students', { p_from: v.from_class, p_to: v.to_class }));
          toast(t('promoted_n') + ': ' + n); pop();
        }
      });
    } });
  }

  function studentForm(existing) {
    push({ title: function () { return t(existing ? 'edit_student' : 'add_student'); }, render: async function (e) {
      var cls = must(await db.from('classes').select('id, name').order('level'));
      var secs = must(await db.from('sections').select('id, class_id, name').order('name'));
      var fields = [
        { name: 'photo', label: 'photo', type: 'file' },
        { name: 'student_code', label: 'student_code', required: true }, { name: 'admission_no', label: 'admission_no' },
        { name: 'full_name', label: 'full_name', required: true }, { name: 'full_name_ne', label: 'full_name_ne' },
        { name: 'dob', label: 'dob', type: 'date' },
        { name: 'gender', label: 'gender', type: 'select', options: [{ value: 'male', label: t('male') }, { value: 'female', label: t('female') }, { value: 'other', label: t('other') }] },
        { name: 'blood_group', label: 'blood_group' }, { name: 'address', label: 'address' },
        { name: 'class_id', label: 'class', type: 'select', options: cls.map(function (c) { return { value: c.id, label: c.name }; }) },
        { name: 'section_id', label: 'section', type: 'select', dependsOn: 'class_id', options: function (v) {
          return secs.filter(function (s) { return s.class_id === v.class_id; }).map(function (s) { return { value: s.id, label: s.name }; }); } },
        { name: 'roll_no', label: 'roll_no', type: 'number' }, { name: 'admission_date', label: 'admission_date', type: 'date' },
        { name: 'house', label: 'house' }, { name: 'emis_no', label: 'emis_no' },
        { name: 'previous_school', label: 'previous_school' }, { name: 'guardian_name', label: 'guardian_name' },
        { name: 'guardian_phone', label: 'guardian_phone' }, { name: 'emergency_phone', label: 'emergency_phone' },
        { name: 'status', label: 'status', type: 'select', options: [{ value: 'active', label: t('active') }, { value: 'transferred', label: t('transferred') }, { value: 'archived', label: t('archived') }] }
      ];
      mountForm(e, { fields: fields, values: existing || { status: 'active' }, onSubmit: async function (v) {
        var file = v.photo; delete v.photo;
        if (!v.status) v.status = 'active';
        var id;
        if (existing) { must(await db.from('students').update(v).eq('id', existing.id)); id = existing.id; }
        else { id = must(await db.from('students').insert(v).select('id').single()).id; }
        if (file) {
          try {
            var path = 'students/' + id + '.jpg';
            await uploadPhoto(path, file);
            must(await db.from('students').update({ photo_url: path }).eq('id', id));
          } catch (ex) { toast(t('photo_failed') + ': ' + errText(ex), true); pop(); return; }
        }
        toast(t('saved')); pop();
      } });
    } });
  }

  /* ---------- admin: teachers ---------- */
  async function viewTeachers(el) {
    var rows = must(await db.from('teachers').select('id, user_id, teacher_code, full_name, full_name_ne, phone, photo_url').order('full_name'));
    el.innerHTML = '<button class="btn primary" id="addt" style="margin-bottom:12px">＋ ' + esc(t('add_teacher')) + '</button>' +
      (rows.length ? rows.map(function (r) {
        return '<div class="card tap row" data-id="' + r.id + '"><div class="ph sm" data-photo="' + esc(r.photo_url) + '"><span>🧑‍🏫</span></div><div><h4>' +
          esc(r.full_name) + (r.full_name_ne ? ' · ' + esc(r.full_name_ne) : '') + '</h4><div class="muted">' + esc(r.teacher_code) + (r.phone ? ' · ' + esc(r.phone) : '') + '</div></div></div>';
      }).join('') : emptyMsg());
    hydratePhotos(el);
    $('#addt', el).onclick = function () { createAccountView('teacher', 'add_teacher'); };
    el.querySelectorAll('.card.tap').forEach(function (c) {
      c.onclick = function () { teacherDetail(rows.filter(function (r) { return r.id === c.getAttribute('data-id'); })[0]); };
    });
  }

  function createAccountView(role, titleKey) {
    push({ title: function () { return t(titleKey); }, render: function (e) {
      var fields = [
        { name: 'login_id', label: 'login_id', required: true }, { name: 'password', label: 'new_password', required: true },
        { name: 'full_name', label: 'full_name', required: true }, { name: 'full_name_ne', label: 'full_name_ne' }, { name: 'phone', label: 'phone' }];
      if (role === 'teacher') fields.push({ name: 'address', label: 'address' });
      mountForm(e, { fields: fields, onSubmit: async function (v) {
        must(await db.rpc('admin_create_account', { p_role: role, p_login_id: v.login_id, p_password: v.password, p_full_name: v.full_name,
          p_full_name_ne: v.full_name_ne, p_phone: v.phone, p_address: v.address || null }));
        toast(t('account_created')); pop();
      } });
    } });
  }

  function teacherDetail(tr) {
    push({ title: function () { return tr.full_name; }, render: async function (el) {
      async function draw() {
        var rows = must(await db.from('teacher_assignments').select('id, classes(name), sections(name), subjects(name)').eq('teacher_id', tr.id));
        el.innerHTML = '<div class="card row"><div class="ph sm" data-photo="' + esc(tr.photo_url) + '"><span>🧑‍🏫</span></div><div style="flex:1"><h4>' + esc(tr.full_name) +
          '</h4><div class="muted">' + esc(tr.teacher_code) + '</div></div></div>' +
          '<label class="btn small" style="display:inline-block;margin-bottom:12px">📷 ' + esc(t('change_photo')) + '<input id="tph" type="file" accept="image/*" hidden></label>' +
          '<h3>' + esc(t('assignments')) + '</h3>' + assignmentsHtml(rows, true) +
          '<button class="btn primary" id="adda" style="margin-top:8px">＋ ' + esc(t('add_assignment')) + '</button>';
        hydratePhotos(el);
        $('#tph', el).addEventListener('change', async function (ev) {
          var f = ev.target.files[0]; if (!f) return;
          try {
            var path = 'teachers/' + tr.id + '.jpg';
            await uploadPhoto(path, f);
            must(await db.from('teachers').update({ photo_url: path }).eq('id', tr.id));
            tr.photo_url = path; toast(t('saved')); draw();
          } catch (ex) { toast(errText(ex), true); }
        });
        el.querySelectorAll('[data-del]').forEach(function (b) {
          b.onclick = async function () { try { must(await db.from('teacher_assignments').delete().eq('id', b.getAttribute('data-del'))); draw(); } catch (e) { toast(errText(e), true); } };
        });
        $('#adda', el).onclick = function () {
          push({ title: function () { return t('add_assignment'); }, render: async function (e) {
            var cls = must(await db.from('classes').select('id, name').order('level'));
            var secs = must(await db.from('sections').select('id, class_id, name').order('name'));
            var subs = must(await db.from('subjects').select('id, name').order('name'));
            mountForm(e, { fields: [
              { name: 'class_id', label: 'class', type: 'select', required: true, options: cls.map(function (c) { return { value: c.id, label: c.name }; }) },
              { name: 'section_id', label: 'section', type: 'select', dependsOn: 'class_id', options: function (v) {
                return secs.filter(function (s) { return s.class_id === v.class_id; }).map(function (s) { return { value: s.id, label: s.name }; }); } },
              { name: 'subject_id', label: 'subject', type: 'select', options: subs.map(function (s) { return { value: s.id, label: s.name }; }) }],
              onSubmit: async function (v) {
                must(await db.from('teacher_assignments').insert({ teacher_id: tr.id, class_id: v.class_id, section_id: v.section_id, subject_id: v.subject_id }));
                toast(t('saved')); pop(); draw();
              } });
          } });
        };
      }
      await draw();
    } });
  }

  /* ---------- admin: parents ---------- */
  async function viewParents(el) {
    var rows = must(await db.from('parents').select('id, parent_code, full_name, phone').order('full_name'));
    el.innerHTML = '<button class="btn primary" id="addp" style="margin-bottom:12px">＋ ' + esc(t('add_parent')) + '</button>' +
      (rows.length ? rows.map(function (r) {
        return '<div class="card tap" data-id="' + r.id + '"><h4>' + esc(r.full_name) + '</h4><div class="muted">' + esc(r.parent_code) + (r.phone ? ' · ' + esc(r.phone) : '') + '</div></div>';
      }).join('') : emptyMsg());
    $('#addp', el).onclick = function () { createAccountView('parent', 'add_parent'); };
    el.querySelectorAll('.card.tap').forEach(function (c) {
      c.onclick = function () { parentDetail(rows.filter(function (r) { return r.id === c.getAttribute('data-id'); })[0]); };
    });
  }

  function parentDetail(pr) {
    push({ title: function () { return pr.full_name; }, render: async function (el) {
      async function draw() {
        var links = must(await db.from('parent_student_links').select('student_id, students(full_name, student_code)').eq('parent_id', pr.id));
        el.innerHTML = '<div class="card"><h4>' + esc(pr.full_name) + '</h4><div class="muted">' + esc(pr.parent_code) + '</div></div>' +
          '<h3>' + esc(t('linked_students')) + '</h3>' +
          (links.length ? links.map(function (l) {
            return '<div class="card row between"><div><h4>' + esc(l.students ? l.students.full_name : '') + '</h4><div class="muted">' + esc(l.students ? l.students.student_code : '') + '</div></div>' +
              '<button class="btn small danger" data-un="' + l.student_id + '">' + esc(t('unlink')) + '</button></div>';
          }).join('') : emptyMsg()) +
          '<button class="btn primary" id="lnk" style="margin-top:8px">＋ ' + esc(t('link_student')) + '</button>';
        el.querySelectorAll('[data-un]').forEach(function (b) {
          b.onclick = async function () { try { must(await db.from('parent_student_links').delete().eq('parent_id', pr.id).eq('student_id', b.getAttribute('data-un'))); draw(); } catch (e) { toast(errText(e), true); } };
        });
        $('#lnk', el).onclick = function () {
          push({ title: function () { return t('link_student'); }, render: async function (e) {
            var sts = must(await db.from('students').select('id, full_name, student_code').eq('status', 'active').order('full_name'));
            mountForm(e, { fields: [{ name: 'student_id', label: 'student', type: 'select', required: true,
              options: sts.map(function (s) { return { value: s.id, label: s.full_name + ' (' + s.student_code + ')' }; }) }],
              onSubmit: async function (v) {
                must(await db.from('parent_student_links').insert({ parent_id: pr.id, student_id: v.student_id }));
                toast(t('saved')); pop(); draw();
              } });
          } });
        };
      }
      await draw();
    } });
  }

  /* ---------- admin: user accounts ---------- */
  async function viewAccounts(el) {
    var rows = must(await db.from('users').select('id, role, login_id, full_name, is_active').order('role').order('full_name'));
    el.innerHTML = '<button class="btn primary" id="adma" style="margin-bottom:12px">＋ ' + esc(t('add')) + ' – ' + esc(t('admin_login')) + '</button>' +
      rows.map(function (r) {
        var me = r.id === state.profile.id;
        return '<div class="card"><div class="row between"><div><h4>' + esc(r.full_name) + '</h4><div class="muted">' + esc(roleLabel(r.role)) + ' · ' + esc(r.login_id) + '</div></div>' +
          '<span class="chip ' + (r.is_active ? 'ok' : 'bad') + '">' + esc(t(r.is_active ? 'active' : 'inactive')) + '</span></div>' +
          '<div class="row" style="margin-top:10px"><button class="btn small" data-rp="' + r.id + '">' + esc(t('reset_password')) + '</button>' +
          (me ? '' : '<button class="btn small ' + (r.is_active ? 'danger' : '') + '" data-act="' + r.id + '" data-to="' + (r.is_active ? 0 : 1) + '">' + esc(t(r.is_active ? 'deactivate' : 'activate')) + '</button>') + '</div></div>';
      }).join('');
    $('#adma', el).onclick = function () { createAccountView('admin', 'admin_login'); };
    el.querySelectorAll('[data-act]').forEach(function (b) {
      b.onclick = async function () {
        try { must(await db.rpc('admin_set_active', { p_user: b.getAttribute('data-act'), p_active: b.getAttribute('data-to') === '1' })); toast(t('saved')); viewAccounts(el); }
        catch (e) { toast(errText(e), true); }
      };
    });
    el.querySelectorAll('[data-rp]').forEach(function (b) {
      b.onclick = function () {
        var uid = b.getAttribute('data-rp');
        push({ title: function () { return t('reset_password'); }, render: function (e) {
          mountForm(e, { fields: [{ name: 'password', label: 'new_password', required: true }], onSubmit: async function (v) {
            must(await db.rpc('admin_reset_password', { p_user: uid, p_password: v.password }));
            toast(t('password_reset_done')); pop();
          } });
        } });
      };
    });
  }

  /* ---------- start ---------- */
  async function start() {
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
    // In a normal browser tab, show ONLY the download page.
    // Add ?app=1 to the address to open the app inside the browser (for testing).
    var testMode = /[?&]app=1/.test(location.search);
    if (!isStandalone() && !testMode) { showDownload(); return; }

    showSplash();
    await new Promise(function (r) { setTimeout(r, 900); });
    document.documentElement.lang = state.lang === 'ne' ? 'ne' : 'en';
    if (configured) {
      try {
        var s = await db.auth.getSession();
        if (s.data && s.data.session) { await loadProfile(s.data.session.user.id); showShell(); return; }
      } catch (e) { try { await db.auth.signOut(); } catch (x) {} }
    }
    showSelect();
  }
  start();
})();
