/* cloud.js — Supabase-backed data layer + login.
   Exposes window.Store with the SAME API the app already uses (synchronous,
   optimistic): reads come from an in-memory cache loaded at login; writes
   update the cache instantly and push to Supabase in the background. */
(function () {
  'use strict';

  var client = window.supabase.createClient(window.SUPA.url, window.SUPA.key);
  var db = { customers: [], items: [], priceLists: [], orders: [] };
  var me = null; // { id, email, name, role }
  var TKEY = 'sopro.tally.v1';

  /* ---------- mapping DB <-> app model ---------- */
  function toDateStr(ms) {
    var d = new Date(ms); function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function mapItem(row, prices) {
    var rates = {};
    prices.forEach(function (p) { if (p.item_id === row.id) rates[p.price_list_id] = Number(p.rate); });
    return { id: row.id, name: row.name, unit: row.unit || 'Pcs', rate: Number(row.base_rate) || 0,
      gst: Number(row.gst) || 0, hsn: row.hsn || '', rates: rates, tally_guid: row.tally_guid, source: row.source };
  }
  function mapCustomer(row) {
    return { id: row.id, name: row.name, phone: row.phone || '', place: row.place || '',
      gstin: row.gstin || '', address: row.address || '' };
  }
  function mapOrder(row, lines) {
    return { id: row.id, orderNo: row.order_no,
      date: row.order_date ? new Date(row.order_date + 'T00:00:00').getTime() : Date.now(),
      customerId: row.customer_id, customerName: row.customer_name,
      priceListId: row.price_list_id, priceListName: row.price_list_name, salesmanName: row.salesman_name,
      status: row.status, notes: row.notes || '', subtotal: Number(row.subtotal) || 0,
      taxTotal: Number(row.tax_total) || 0, total: Number(row.total) || 0,
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      lines: (lines || []).map(function (l) {
        return { itemId: l.item_id, name: l.name, unit: l.unit, rate: Number(l.rate) || 0,
          gst: Number(l.gst) || 0, qty: Number(l.qty) || 0 };
      }) };
  }

  /* ---------- load everything into cache ---------- */
  async function loadAll() {
    var res = await Promise.all([
      client.from('price_lists').select('*').order('name'),
      client.from('items').select('*').order('name'),
      client.from('item_prices').select('*'),
      client.from('customers').select('*').order('name'),
      client.from('orders').select('*').order('created_at', { ascending: false }),
      client.from('order_lines').select('*')
    ]);
    res.forEach(function (r) { if (r.error) console.error('load error', r.error); });
    var pl = res[0].data || [], it = res[1].data || [], ip = res[2].data || [],
        cu = res[3].data || [], od = res[4].data || [], ol = res[5].data || [];
    db.priceLists = pl.map(function (r) { return { id: r.id, name: r.name }; });
    db.items = it.map(function (r) { return mapItem(r, ip); });
    db.customers = cu.map(mapCustomer);
    var byOrder = {};
    ol.forEach(function (l) { (byOrder[l.order_id] = byOrder[l.order_id] || []).push(l); });
    db.orders = od.map(function (r) { return mapOrder(r, byOrder[r.id] || []); });
  }

  /* ---------- background push helpers ---------- */
  function fail(e, msg) { console.error(msg, e); if (window.__toast) window.__toast(msg + (e && e.message ? ': ' + e.message : '')); }
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('x' + Math.random().toString(36).slice(2) + Date.now().toString(36)); }

  async function pushCustomer(c) {
    var r = await client.from('customers').upsert({ id: c.id, name: c.name, phone: c.phone, place: c.place, gstin: c.gstin, address: c.address });
    if (r.error) fail(r.error, 'Save party failed');
  }
  async function pushItem(it) {
    var r = await client.from('items').upsert({ id: it.id, name: it.name, unit: it.unit, gst: it.gst, hsn: it.hsn, base_rate: it.rate });
    if (r.error) { fail(r.error, 'Save item failed'); return; }
    await client.from('item_prices').delete().eq('item_id', it.id);
    var rows = Object.keys(it.rates || {}).map(function (plId) { return { item_id: it.id, price_list_id: plId, rate: it.rates[plId] }; });
    if (rows.length) { var r2 = await client.from('item_prices').insert(rows); if (r2.error) fail(r2.error, 'Save item rates failed'); }
  }
  async function pushPriceList(p) {
    var r = await client.from('price_lists').upsert({ id: p.id, name: p.name });
    if (r.error) fail(r.error, 'Save price list failed');
  }
  async function pushOrder(o) {
    var row = { id: o.id, order_no: o.orderNo, order_date: toDateStr(o.date), customer_id: o.customerId,
      customer_name: o.customerName, price_list_id: o.priceListId || null, price_list_name: o.priceListName || null,
      salesman_id: me.id, salesman_name: me.name, status: o.status, notes: o.notes,
      subtotal: o.subtotal, tax_total: o.taxTotal, total: o.total };
    var r = await client.from('orders').upsert(row);
    if (r.error) { fail(r.error, 'Save order failed'); return; }
    await client.from('order_lines').delete().eq('order_id', o.id);
    var lines = (o.lines || []).map(function (l) {
      return { order_id: o.id, item_id: l.itemId, name: l.name, unit: l.unit, rate: l.rate, gst: l.gst,
        qty: l.qty, amount: (Number(l.qty) || 0) * (Number(l.rate) || 0) };
    });
    if (lines.length) { var r2 = await client.from('order_lines').insert(lines); if (r2.error) fail(r2.error, 'Save order items failed'); }
  }

  /* ---------- Store API (matches the old localStorage Store) ---------- */
  var Store = {
    isAdmin: function () { return !!(me && me.role === 'admin'); },
    currentUser: function () { return me; },

    customers: function () { return db.customers.slice(); },
    customer: function (id) { return db.customers.find(function (c) { return c.id === id; }); },
    saveCustomer: function (c) {
      if (!c.id) { c.id = uid(); db.customers.push(c); }
      else { var i = db.customers.findIndex(function (x) { return x.id === c.id; }); if (i >= 0) db.customers[i] = c; }
      pushCustomer(c); return c;
    },
    deleteCustomer: function (id) {
      db.customers = db.customers.filter(function (c) { return c.id !== id; });
      client.from('customers').delete().eq('id', id).then(function (r) { if (r.error) fail(r.error, 'Delete party failed'); });
    },

    items: function () { return db.items.slice(); },
    item: function (id) { return db.items.find(function (i) { return i.id === id; }); },
    saveItem: function (it) {
      if (!it.id) { it.id = uid(); db.items.push(it); }
      else { var i = db.items.findIndex(function (x) { return x.id === it.id; }); if (i >= 0) db.items[i] = it; }
      pushItem(it); return it;
    },
    deleteItem: function (id) {
      db.items = db.items.filter(function (i) { return i.id !== id; });
      client.from('items').delete().eq('id', id).then(function (r) { if (r.error) fail(r.error, 'Delete item failed'); });
    },

    priceLists: function () { return db.priceLists.slice(); },
    priceList: function (id) { return db.priceLists.find(function (p) { return p.id === id; }); },
    savePriceList: function (p) {
      if (!p.id) { p.id = uid(); db.priceLists.push(p); }
      else { var i = db.priceLists.findIndex(function (x) { return x.id === p.id; }); if (i >= 0) db.priceLists[i] = p; }
      pushPriceList(p); return p;
    },
    deletePriceList: function (id) {
      db.priceLists = db.priceLists.filter(function (p) { return p.id !== id; });
      db.items.forEach(function (it) { if (it.rates) delete it.rates[id]; });
      client.from('price_lists').delete().eq('id', id).then(function (r) { if (r.error) fail(r.error, 'Delete price list failed'); });
    },

    orders: function () { return db.orders.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }); },
    order: function (id) { return db.orders.find(function (o) { return o.id === id; }); },
    nextOrderNo: function () { return 'SO-' + String(db.orders.length + 1).padStart(4, '0'); },
    saveOrder: function (o) {
      if (!o.id) { o.id = uid(); o.createdAt = Date.now(); o.salesmanName = me.name; db.orders.push(o); }
      else { var i = db.orders.findIndex(function (x) { return x.id === o.id; }); if (i >= 0) db.orders[i] = o; }
      pushOrder(o); return o;
    },
    setOrderStatus: function (id, status) {
      var o = this.order(id);
      if (o) { o.status = status; client.from('orders').update({ status: status }).eq('id', id).then(function (r) { if (r.error) fail(r.error, 'Update status failed'); }); }
      return o;
    },
    deleteOrder: function (id) {
      db.orders = db.orders.filter(function (o) { return o.id !== id; });
      client.from('orders').delete().eq('id', id).then(function (r) { if (r.error) fail(r.error, 'Delete order failed'); });
    },

    tallySettings: function () {
      try { var s = JSON.parse(localStorage.getItem(TKEY)); if (s) return s; } catch (e) {}
      return { company: '', salesLedger: 'Sales', voucherType: 'Sales Order', godown: '' };
    },
    saveTallySettings: function (s) { try { localStorage.setItem(TKEY, JSON.stringify(s)); } catch (e) {} return s; },

    reload: async function () { await loadAll(); },
    resetDemo: function () {}
  };
  window.Store = Store;

  /* ---------- auth + boot ---------- */
  async function fetchProfile(id, email) {
    var r = await client.from('profiles').select('full_name, role').eq('id', id).single();
    if (r.error || !r.data) return { id: id, email: email, name: email, role: 'salesman' };
    return { id: id, email: email, name: r.data.full_name || email, role: r.data.role || 'salesman' };
  }

  async function startSession(session) {
    setLoginBusy(true);
    me = await fetchProfile(session.user.id, session.user.email);
    await loadAll();
    hideLogin();
    if (window.__APP_BOOT__) window.__APP_BOOT__();
  }

  /* ---------- login overlay ---------- */
  function buildLogin() {
    var el = document.createElement('div');
    el.id = 'loginScreen';
    el.innerHTML =
      '<div class="login-card">' +
        '<div class="login-logo">📋</div>' +
        '<h1 class="login-title">Sales Order</h1>' +
        '<p class="login-sub">Sign in to continue</p>' +
        '<div class="field"><label>Email</label><input id="loginEmail" type="email" autocomplete="username" placeholder="you@example.com"></div>' +
        '<div class="field"><label>Password</label><input id="loginPw" type="password" autocomplete="current-password" placeholder="••••••••"></div>' +
        '<div class="login-error" id="loginError"></div>' +
        '<button class="btn" id="loginBtn">Sign in</button>' +
      '</div>';
    document.body.appendChild(el);
    var doIt = function () {
      var email = document.getElementById('loginEmail').value.trim();
      var pw = document.getElementById('loginPw').value;
      if (!email || !pw) { showLoginError('Enter email and password'); return; }
      setLoginBusy(true); showLoginError('');
      client.auth.signInWithPassword({ email: email, password: pw }).then(function (r) {
        if (r.error) { setLoginBusy(false); showLoginError(r.error.message); return; }
        startSession(r.data.session);
      });
    };
    document.getElementById('loginBtn').onclick = doIt;
    document.getElementById('loginPw').addEventListener('keydown', function (e) { if (e.key === 'Enter') doIt(); });
  }
  function showLogin() { if (!document.getElementById('loginScreen')) buildLogin(); }
  function hideLogin() { var el = document.getElementById('loginScreen'); if (el) el.remove(); }
  function showLoginError(msg) { var e = document.getElementById('loginError'); if (e) e.textContent = msg || ''; }
  function setLoginBusy(b) {
    var btn = document.getElementById('loginBtn');
    if (btn) { btn.disabled = b; btn.textContent = b ? 'Signing in…' : 'Sign in'; }
  }

  window.__logout = function () { client.auth.signOut().then(function () { location.reload(); }); };

  /* ---------- init ---------- */
  (async function () {
    try {
      var s = await client.auth.getSession();
      if (s.data && s.data.session) { await startSession(s.data.session); }
      else { showLogin(); }
    } catch (e) { console.error(e); showLogin(); }
  })();
})();
