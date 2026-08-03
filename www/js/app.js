/* app.js — UI + navigation for the Sales Order app */
(function () {
  'use strict';

  var view = document.getElementById('view');
  var appTitle = document.getElementById('appTitle');
  var btnBack = document.getElementById('btnBack');
  var btnHeaderAction = document.getElementById('btnHeaderAction');
  var tabbar = document.getElementById('tabbar');
  var toastEl = document.getElementById('toast');

  var STATUSES = ['Pending', 'Confirmed', 'Delivered', 'Cancelled'];

  /* draft holds the order currently being edited/created */
  var draft = null;

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    return '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }
  function badgeClass(status) {
    return 'badge badge--' + String(status || 'Pending').toLowerCase();
  }

  /* Rate for an item under a given price list; falls back to the item's base rate */
  function resolveRate(item, plId) {
    if (item && item.rates && plId && item.rates[plId] != null && item.rates[plId] !== '') {
      return Number(item.rates[plId]) || 0;
    }
    return Number(item ? item.rate : 0) || 0;
  }

  /* Rate for an item on the CURRENT order: party's own rate wins, else price list, else base */
  function orderLineRate(item) {
    if (draft && draft.customerId && Store.partyPrice) {
      var pp = Store.partyPrice(draft.customerId, item.id);
      if (pp != null) return Number(pp) || 0;
    }
    return resolveRate(item, draft ? draft.priceListId : '');
  }

  function lineAmount(l) { return (Number(l.qty) || 0) * (Number(l.rate) || 0); }
  function computeTotals(order) {
    var sub = 0, tax = 0;
    (order.lines || []).forEach(function (l) {
      var amt = lineAmount(l);
      sub += amt;
      tax += amt * (Number(l.gst) || 0) / 100;
    });
    order.subtotal = sub;
    order.taxTotal = tax;
    order.total = sub + tax;
    return order;
  }

  /* ------------------------------------------------------------------ */
  /* Router                                                              */
  /* ------------------------------------------------------------------ */
  var routes = {
    orders: renderOrders,
    items: renderItems,
    customers: renderCustomers,
    'order': renderOrderDetail,     // #order/<id>
    'item-edit': renderItemEdit,    // #item-edit/<id?>
    'cust-edit': renderCustEdit,    // #cust-edit/<id?>
    'party-prices': renderPartyPrices, // #party-prices/<custId>
    'pricelists': renderPriceLists, // #pricelists
    'pl-edit': renderPriceListEdit, // #pl-edit/<id?>
    'tally-settings': renderTallySettings, // #tally-settings
    'entry': renderEntry            // order entry (uses draft)
  };

  function go(hash) { window.location.hash = hash; }

  function route() {
    var raw = (window.location.hash || '#orders').replace(/^#/, '');
    var parts = raw.split('/');
    var name = parts[0];
    var arg = parts[1];
    var fn = routes[name] || renderOrders;
    view.scrollTop = 0;
    fn(arg);
    updateTabbar(name);
  }

  function updateTabbar(name) {
    var map = {
      orders: 'orders', order: 'orders', 'tally-settings': 'orders',
      items: 'items', 'item-edit': 'items', pricelists: 'items', 'pl-edit': 'items',
      customers: 'customers', 'cust-edit': 'customers', 'party-prices': 'customers',
      entry: 'new'
    };
    var active = map[name];
    Array.prototype.forEach.call(tabbar.querySelectorAll('.tabbar__btn'), function (b) {
      b.classList.toggle('is-active', b.dataset.nav === active);
    });
    // Hide tabbar + show full view during order entry
    var full = (name === 'entry');
    tabbar.style.display = full ? 'none' : 'flex';
    view.classList.toggle('view--full', full);
  }

  function header(title, opts) {
    opts = opts || {};
    appTitle.textContent = title;
    if (opts.back) { btnBack.hidden = false; } else { btnBack.hidden = true; }
    if (opts.action) {
      btnHeaderAction.hidden = false;
      btnHeaderAction.textContent = opts.action;
      btnHeaderAction.onclick = opts.onAction || null;
    } else {
      btnHeaderAction.hidden = true;
      btnHeaderAction.onclick = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Screen: Orders list                                                */
  /* ------------------------------------------------------------------ */
  var orderFilter = 'All';

  function renderOrders() {
    header('Sales Orders', { action: '⚙ Tally', onAction: function () { go('tally-settings'); } });
    var all = Store.orders();
    var filtered = orderFilter === 'All' ? all : all.filter(function (o) { return o.status === orderFilter; });

    var chips = ['All'].concat(STATUSES).map(function (s) {
      return '<button class="chip ' + (orderFilter === s ? 'is-active' : '') + '" data-filter="' + s + '">' + s + '</button>';
    }).join('');

    var html = '<div class="chips">' + chips + '</div>';

    if (!filtered.length) {
      html += emptyState('&#128220;', 'No orders yet', 'Tap the + button to create your first sales order.');
    } else {
      html += '<div class="list">' + filtered.map(orderRow).join('') + '</div>';
    }
    view.innerHTML = html;

    Array.prototype.forEach.call(view.querySelectorAll('.chip'), function (c) {
      c.onclick = function () { orderFilter = c.dataset.filter; renderOrders(); };
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-order]'), function (r) {
      r.onclick = function () { go('order/' + r.dataset.order); };
    });
  }

  function orderRow(o) {
    var cust = Store.customer(o.customerId);
    var name = cust ? cust.name : (o.customerName || 'Unknown party');
    var count = (o.lines || []).length;
    var showSalesman = (Store.isAdmin && Store.isAdmin()) && o.salesmanName;
    return '<div class="row" data-order="' + o.id + '">' +
      '<div class="row__main">' +
        '<div class="row__title">' + esc(name) + '</div>' +
        '<div class="row__sub">' + esc(o.orderNo) + ' &middot; ' + fmtDate(o.date) + ' &middot; ' + count + ' item' + (count === 1 ? '' : 's') + '</div>' +
        (showSalesman ? '<div class="row__sub">👤 ' + esc(o.salesmanName) + '</div>' : '') +
        '<span class="' + badgeClass(o.status) + '">' + esc(o.status) + '</span>' +
      '</div>' +
      '<div class="row__end"><div class="row__amt">' + money(o.total) + '</div></div>' +
    '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Screen: Order entry (create / edit)                                */
  /* ------------------------------------------------------------------ */
  function startNewOrder() {
    var pls = Store.priceLists();
    draft = {
      id: null,
      orderNo: Store.nextOrderNo(),
      date: Date.now(),
      customerId: '',
      priceListId: pls.length ? pls[0].id : '',
      lines: [],
      notes: '',
      status: 'Pending'
    };
    go('entry');
  }

  function editOrder(id) {
    var o = Store.order(id);
    if (!o) { go('orders'); return; }
    draft = JSON.parse(JSON.stringify(o));
    go('entry');
  }

  function renderEntry() {
    if (!draft) { startNewOrder(); return; }
    header(draft.id ? 'Edit Order' : 'New Sales Order', { back: true });
    btnBack.onclick = function () { go(draft.id ? 'order/' + draft.id : 'orders'); };

    computeTotals(draft);
    var cust = Store.customer(draft.customerId);
    var dateStr = new Date(draft.date).toISOString().slice(0, 10);

    var linesHtml = draft.lines.length
      ? draft.lines.map(lineCard).join('')
      : '<div class="card muted" style="text-align:center">No items added yet</div>';

    view.innerHTML =
      '<div class="card">' +
        '<div class="field"><label>Party / Customer</label>' +
          '<button class="btn btn--ghost" id="pickCust" style="text-align:left">' +
            (cust ? esc(cust.name) : 'Select a customer &#9662;') + '</button>' +
          (cust ? '<div class="row__sub" style="margin-top:6px">' + esc(cust.place || '') + (cust.gstin ? ' &middot; GSTIN ' + esc(cust.gstin) : '') + '</div>' : '') +
        '</div>' +
        '<div class="field--row">' +
          '<div class="field"><label>Order No.</label><input id="fOrderNo" value="' + esc(draft.orderNo) + '"></div>' +
          '<div class="field"><label>Date</label><input id="fDate" type="date" value="' + dateStr + '"></div>' +
        '</div>' +
        (Store.priceLists().length ?
          '<div class="field"><label>Price List</label><select id="fPriceList">' +
            Store.priceLists().map(function (p) {
              return '<option value="' + p.id + '" ' + (p.id === draft.priceListId ? 'selected' : '') + '>' + esc(p.name) + '</option>';
            }).join('') +
          '</select></div>' : '') +
      '</div>' +

      '<div class="sec-head"><h2>Items</h2>' +
        '<button class="btn btn--accent btn--sm" id="addItem">+ Add Item</button></div>' +
      '<div id="lines">' + linesHtml + '</div>' +

      '<div class="card totals">' +
        '<div class="trow"><span>Subtotal</span><span>' + money(draft.subtotal) + '</span></div>' +
        '<div class="trow"><span>GST</span><span>' + money(draft.taxTotal) + '</span></div>' +
        '<div class="trow trow--grand"><span>Total</span><span>' + money(draft.total) + '</span></div>' +
      '</div>' +

      '<div class="field"><label>Notes (optional)</label>' +
        '<textarea id="fNotes" rows="2" placeholder="Delivery instructions, remarks...">' + esc(draft.notes || '') + '</textarea></div>' +

      '<div class="sticky-actions"><div class="btn-row">' +
        '<button class="btn btn--ghost" id="cancelOrder">Cancel</button>' +
        '<button class="btn" id="saveOrder">Save Order</button>' +
      '</div></div>';

    document.getElementById('pickCust').onclick = pickCustomer;
    document.getElementById('addItem').onclick = pickItem;
    var plSel = document.getElementById('fPriceList');
    if (plSel) plSel.onchange = function (e) {
      draft.priceListId = e.target.value;
      // re-price every line (party's own rate still wins over the list)
      draft.lines.forEach(function (l) {
        var it = Store.item(l.itemId);
        if (it) l.rate = orderLineRate(it);
      });
      computeTotals(draft);
      var pl = Store.priceList(draft.priceListId);
      toast('Prices set to ' + (pl ? pl.name : 'list'));
      renderEntry();
    };
    document.getElementById('fOrderNo').oninput = function (e) { draft.orderNo = e.target.value; };
    document.getElementById('fDate').onchange = function (e) { draft.date = new Date(e.target.value).getTime() || draft.date; };
    document.getElementById('fNotes').oninput = function (e) { draft.notes = e.target.value; };
    document.getElementById('cancelOrder').onclick = function () { go(draft.id ? 'order/' + draft.id : 'orders'); };
    document.getElementById('saveOrder').onclick = saveDraft;

    bindLineEvents();
  }

  function lineCard(l, idx) {
    return '<div class="line" data-idx="' + idx + '">' +
      '<div class="line__top">' +
        '<div class="line__name">' + esc(l.name) + '<div class="row__sub">' + esc(l.unit || '') + (l.gst ? ' &middot; GST ' + l.gst + '%' : '') + '</div></div>' +
        '<button class="line__del" data-del="' + idx + '">&times;</button>' +
      '</div>' +
      '<div class="line__grid">' +
        '<div class="field"><label>Qty</label><input type="number" inputmode="decimal" min="0" step="1" data-f="qty" value="' + (l.qty) + '"></div>' +
        '<div class="field"><label>Rate</label><input type="number" inputmode="decimal" min="0" step="0.01" data-f="rate" value="' + (l.rate) + '"></div>' +
      '</div>' +
      '<div class="line__amt">Amount: ' + money(lineAmount(l)) + '</div>' +
    '</div>';
  }

  function bindLineEvents() {
    Array.prototype.forEach.call(view.querySelectorAll('.line'), function (el) {
      var idx = Number(el.dataset.idx);
      Array.prototype.forEach.call(el.querySelectorAll('input[data-f]'), function (inp) {
        inp.oninput = function () {
          draft.lines[idx][inp.dataset.f] = inp.value === '' ? 0 : Number(inp.value);
          computeTotals(draft);
          // update just the amount + totals without full re-render (keeps keyboard open)
          el.querySelector('.line__amt').textContent = 'Amount: ' + money(lineAmount(draft.lines[idx]));
          refreshTotals();
        };
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
      b.onclick = function () {
        draft.lines.splice(Number(b.dataset.del), 1);
        renderEntry();
      };
    });
  }

  function refreshTotals() {
    var t = view.querySelector('.totals');
    if (!t) return;
    t.children[0].children[1].textContent = money(draft.subtotal);
    t.children[1].children[1].textContent = money(draft.taxTotal);
    t.children[2].children[1].textContent = money(draft.total);
  }

  function saveDraft() {
    if (!draft.customerId) { toast('Please select a customer'); return; }
    if (!draft.lines.length) { toast('Add at least one item'); return; }
    var cust = Store.customer(draft.customerId);
    draft.customerName = cust ? cust.name : '';
    var pl = Store.priceList(draft.priceListId);
    draft.priceListName = pl ? pl.name : '';
    computeTotals(draft);
    var saved = Store.saveOrder(draft);
    toast('Order ' + saved.orderNo + ' saved');
    draft = null;
    go('order/' + saved.id);
  }

  /* ------------------------------------------------------------------ */
  /* Bottom-sheet pickers                                               */
  /* ------------------------------------------------------------------ */
  function openSheet(title, items, onPick, opts) {
    opts = opts || {};
    var backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    backdrop.innerHTML =
      '<div class="sheet">' +
        '<div class="sheet__grip"></div>' +
        '<div class="sheet__title">' + esc(title) + '</div>' +
        (opts.search ? '<div class="search"><input placeholder="Search..." id="sheetSearch"></div>' : '') +
        '<div class="sheet__list" id="sheetList"></div>' +
      '</div>';
    document.body.appendChild(backdrop);

    var listEl = backdrop.querySelector('#sheetList');
    function paint(q) {
      q = (q || '').toLowerCase();
      var shown = items.filter(function (it) { return it.label.toLowerCase().indexOf(q) >= 0; });
      if (!shown.length) { listEl.innerHTML = '<div class="empty"><div class="empty__title">No matches</div></div>'; return; }
      listEl.innerHTML = shown.map(function (it) {
        return '<div class="row" data-id="' + it.id + '"><div class="row__main">' +
          '<div class="row__title">' + esc(it.label) + '</div>' +
          (it.sub ? '<div class="row__sub">' + esc(it.sub) + '</div>' : '') +
          '</div>' + (it.end ? '<div class="row__end"><div class="row__amt">' + it.end + '</div></div>' : '') + '</div>';
      }).join('');
      Array.prototype.forEach.call(listEl.querySelectorAll('[data-id]'), function (r) {
        r.onclick = function () { close(); onPick(r.dataset.id); };
      });
    }
    function close() { backdrop.classList.remove('show'); setTimeout(function () { backdrop.remove(); }, 250); }

    backdrop.onclick = function (e) { if (e.target === backdrop) close(); };
    if (opts.search) backdrop.querySelector('#sheetSearch').oninput = function (e) { paint(e.target.value); };
    paint('');
    requestAnimationFrame(function () { backdrop.classList.add('show'); });
  }

  function pickCustomer() {
    var custs = Store.customers();
    if (!custs.length) { toast('Add a customer first (Parties tab)'); return; }
    openSheet('Select Party', custs.map(function (c) {
      return { id: c.id, label: c.name, sub: (c.place || c.phone || '') + (c.priceListName ? ' · ' + c.priceListName : '') };
    }), function (id) {
      draft.customerId = id;
      var cust = Store.customer(id);
      if (cust && cust.priceListId) draft.priceListId = cust.priceListId;  // optional tier fallback
      // re-price existing lines for this party (party's own rates win)
      draft.lines.forEach(function (l) { var it = Store.item(l.itemId); if (it) l.rate = orderLineRate(it); });
      computeTotals(draft);
      if (cust) {
        var hasOwn = Store.partyPricesFor && Object.keys(Store.partyPricesFor(id)).length;
        if (hasOwn) toast('Using ' + cust.name + '’s own prices');
        else if (cust.priceListId) { var pl = Store.priceList(cust.priceListId); if (pl) toast('Using ' + pl.name + ' prices for ' + cust.name); }
      }
      renderEntry();
    }, { search: true });
  }

  function pickItem() {
    var items = Store.items();
    if (!items.length) { toast('Add an item first (Items tab)'); return; }
    openSheet('Add Item', items.map(function (i) {
      return { id: i.id, label: i.name, sub: i.unit + ' · GST ' + i.gst + '%', end: money(i.rate) };
    }), function (id) {
      var it = Store.item(id);
      var existing = draft.lines.find(function (l) { return l.itemId === id; });
      if (existing) { existing.qty = (Number(existing.qty) || 0) + 1; }
      else {
        draft.lines.push({ itemId: it.id, name: it.name, unit: it.unit, rate: orderLineRate(it), gst: it.gst, qty: 1 });
      }
      computeTotals(draft); renderEntry();
    }, { search: true });
  }

  /* ------------------------------------------------------------------ */
  /* Screen: Order detail                                               */
  /* ------------------------------------------------------------------ */
  function renderOrderDetail(id) {
    var o = Store.order(id);
    if (!o) { go('orders'); return; }
    header('Order Detail', { back: true });
    btnBack.onclick = function () { go('orders'); };
    var cust = Store.customer(o.customerId) || { name: o.customerName || 'Unknown', place: '', gstin: '', phone: '' };

    var linesHtml = (o.lines || []).map(function (l) {
      return '<div class="doc-line"><div><div>' + esc(l.name) + '</div>' +
        '<div class="qty">' + l.qty + ' ' + esc(l.unit || '') + ' × ' + money(l.rate) + (l.gst ? '  (GST ' + l.gst + '%)' : '') + '</div></div>' +
        '<div class="strong">' + money(lineAmount(l)) + '</div></div>';
    }).join('');

    view.innerHTML =
      '<div class="card">' +
        '<div class="detail-head"><div class="num">' + esc(o.orderNo) + '</div>' +
          '<span class="' + badgeClass(o.status) + '">' + esc(o.status) + '</span></div>' +
        '<div class="kv"><span class="k">Party</span><span class="strong">' + esc(cust.name) + '</span></div>' +
        (cust.place ? '<div class="kv"><span class="k">Place</span><span>' + esc(cust.place) + '</span></div>' : '') +
        (cust.gstin ? '<div class="kv"><span class="k">GSTIN</span><span>' + esc(cust.gstin) + '</span></div>' : '') +
        '<div class="kv"><span class="k">Date</span><span>' + fmtDate(o.date) + '</span></div>' +
        (o.priceListName ? '<div class="kv"><span class="k">Price List</span><span>' + esc(o.priceListName) + '</span></div>' : '') +
      '</div>' +

      '<div class="card">' + linesHtml +
        '<div class="trow" style="display:flex;justify-content:space-between;padding-top:10px"><span class="muted">Subtotal</span><span>' + money(o.subtotal) + '</span></div>' +
        '<div class="trow" style="display:flex;justify-content:space-between"><span class="muted">GST</span><span>' + money(o.taxTotal) + '</span></div>' +
        '<div class="trow trow--grand" style="display:flex;justify-content:space-between"><span>Total</span><span>' + money(o.total) + '</span></div>' +
      '</div>' +

      (o.notes ? '<div class="card"><div class="row__sub">Notes</div><div>' + esc(o.notes) + '</div></div>' : '') +

      '<div class="field"><label>Status</label>' +
        '<select id="statusSel">' + STATUSES.map(function (s) {
          return '<option ' + (s === o.status ? 'selected' : '') + '>' + s + '</option>';
        }).join('') + '</select></div>' +

      '<button class="btn btn--accent" id="tallyXml" style="margin-bottom:10px">&#11015; Download Tally XML (Sales Order)</button>' +
      '<div class="btn-row" style="margin-bottom:10px">' +
        '<button class="btn btn--ghost" id="shareOrder">Share</button>' +
        '<button class="btn btn--ghost" id="printOrder">Print / PDF</button>' +
      '</div>' +
      '<div class="btn-row">' +
        '<button class="btn btn--ghost" id="editOrder">Edit</button>' +
        '<button class="btn btn--danger" id="delOrder">Delete</button>' +
      '</div>';

    document.getElementById('statusSel').onchange = function (e) {
      Store.setOrderStatus(o.id, e.target.value); toast('Status updated'); renderOrderDetail(o.id);
    };
    document.getElementById('tallyXml').onclick = function () { downloadTallyXml(o, cust); };
    document.getElementById('shareOrder').onclick = function () { shareOrder(o, cust); };
    document.getElementById('printOrder').onclick = function () { printOrder(o, cust); };
    document.getElementById('editOrder').onclick = function () { editOrder(o.id); };
    document.getElementById('delOrder').onclick = function () {
      if (confirm('Delete order ' + o.orderNo + '?')) { Store.deleteOrder(o.id); toast('Order deleted'); go('orders'); }
    };
  }

  function orderText(o, cust) {
    var lines = (o.lines || []).map(function (l, i) {
      return (i + 1) + '. ' + l.name + '  ' + l.qty + ' ' + (l.unit || '') + ' x ' + money(l.rate) + ' = ' + money(lineAmount(l));
    }).join('\n');
    return 'SALES ORDER ' + o.orderNo + '\n' +
      'Date: ' + fmtDate(o.date) + '\n' +
      'Party: ' + cust.name + (cust.gstin ? ' (GSTIN ' + cust.gstin + ')' : '') + '\n' +
      (o.priceListName ? 'Price List: ' + o.priceListName + '\n' : '') + '\n' +
      lines + '\n\n' +
      'Subtotal: ' + money(o.subtotal) + '\n' +
      'GST: ' + money(o.taxTotal) + '\n' +
      'TOTAL: ' + money(o.total) +
      (o.notes ? '\n\nNotes: ' + o.notes : '');
  }

  function shareOrder(o, cust) {
    var text = orderText(o, cust);
    if (navigator.share) {
      navigator.share({ title: 'Sales Order ' + o.orderNo, text: text }).catch(function () {});
    } else {
      // Fallback: WhatsApp web intent
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    }
  }

  function printOrder(o, cust) {
    var rows = (o.lines || []).map(function (l, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(l.name) + '</td><td class="r">' + l.qty + ' ' + esc(l.unit || '') +
        '</td><td class="r">' + money(l.rate) + '</td><td class="r">' + l.gst + '%</td><td class="r">' + money(lineAmount(l)) + '</td></tr>';
    }).join('');
    var win = window.open('', '_blank');
    if (!win) { toast('Allow pop-ups to print'); return; }
    win.document.write(
      '<html><head><title>' + esc(o.orderNo) + '</title><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>body{font-family:Arial,sans-serif;color:#1f2430;padding:24px;max-width:720px;margin:auto}' +
      'h1{color:#1b3a6b;margin:0 0 4px}.sub{color:#666;font-size:13px}' +
      '.box{border:1px solid #ddd;border-radius:8px;padding:12px;margin:14px 0}' +
      'table{width:100%;border-collapse:collapse;margin-top:10px}th,td{padding:8px;border-bottom:1px solid #eee;font-size:13px;text-align:left}' +
      'th{background:#f3f5fa;color:#1b3a6b}.r{text-align:right}tfoot td{font-weight:bold;border-top:2px solid #1b3a6b}' +
      '.tot{text-align:right;margin-top:12px;font-size:15px}.grand{font-size:20px;color:#1b3a6b;font-weight:bold}</style></head><body>' +
      '<h1>SALES ORDER</h1><div class="sub">' + esc(o.orderNo) + ' &middot; ' + fmtDate(o.date) + ' &middot; Status: ' + esc(o.status) + (o.priceListName ? ' &middot; ' + esc(o.priceListName) : '') + '</div>' +
      '<div class="box"><strong>' + esc(cust.name) + '</strong><br>' + esc(cust.address || cust.place || '') +
        (cust.gstin ? '<br>GSTIN: ' + esc(cust.gstin) : '') + (cust.phone ? '<br>Ph: ' + esc(cust.phone) : '') + '</div>' +
      '<table><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">GST</th><th class="r">Amount</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div class="tot">Subtotal: ' + money(o.subtotal) + '</div>' +
      '<div class="tot">GST: ' + money(o.taxTotal) + '</div>' +
      '<div class="tot grand">TOTAL: ' + money(o.total) + '</div>' +
      (o.notes ? '<div class="box"><strong>Notes:</strong> ' + esc(o.notes) + '</div>' : '') +
      '<script>setTimeout(function(){window.print()},350)<\/script></body></html>');
    win.document.close();
  }

  /* ------------------------------------------------------------------ */
  /* Tally XML export (import file for TallyPrime)                       */
  /* ------------------------------------------------------------------ */
  function tallyDate(ts) {
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }

  function buildTallyXml(o, cust) {
    var s = Store.tallySettings();
    var party = (cust && cust.name) || o.customerName || '';
    var dt = tallyDate(o.date);

    var inv = (o.lines || []).map(function (l) {
      var qty = Number(l.qty) || 0;
      var amt = (qty * (Number(l.rate) || 0)).toFixed(2);
      var unit = l.unit || '';
      var godown = s.godown ?
        '<BATCHALLOCATIONS.LIST>' +
          '<GODOWNNAME>' + esc(s.godown) + '</GODOWNNAME>' +
          '<ACTUALQTY>' + qty + ' ' + esc(unit) + '</ACTUALQTY>' +
          '<BILLEDQTY>' + qty + ' ' + esc(unit) + '</BILLEDQTY>' +
          '<AMOUNT>' + amt + '</AMOUNT>' +
        '</BATCHALLOCATIONS.LIST>' : '';
      return '<ALLINVENTORYENTRIES.LIST>' +
        '<STOCKITEMNAME>' + esc(l.name) + '</STOCKITEMNAME>' +
        '<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>' +
        '<RATE>' + (Number(l.rate) || 0).toFixed(2) + '/' + esc(unit) + '</RATE>' +
        '<ACTUALQTY>' + qty + ' ' + esc(unit) + '</ACTUALQTY>' +
        '<BILLEDQTY>' + qty + ' ' + esc(unit) + '</BILLEDQTY>' +
        '<AMOUNT>' + amt + '</AMOUNT>' +
        godown +
        '<ACCOUNTINGALLOCATIONS.LIST>' +
          '<LEDGERNAME>' + esc(s.salesLedger) + '</LEDGERNAME>' +
          '<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>' +
          '<AMOUNT>' + amt + '</AMOUNT>' +
        '</ACCOUNTINGALLOCATIONS.LIST>' +
      '</ALLINVENTORYENTRIES.LIST>';
    }).join('');

    var company = s.company ? '<SVCURRENTCOMPANY>' + esc(s.company) + '</SVCURRENTCOMPANY>' : '';

    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<ENVELOPE>\n' +
      ' <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n' +
      ' <BODY>\n' +
      '  <IMPORTDATA>\n' +
      '   <REQUESTDESC>\n' +
      '    <REPORTNAME>Vouchers</REPORTNAME>\n' +
      '    <STATICVARIABLES>' + company + '</STATICVARIABLES>\n' +
      '   </REQUESTDESC>\n' +
      '   <REQUESTDATA>\n' +
      '    <TALLYMESSAGE xmlns:UDF="TallyUDF">\n' +
      '     <VOUCHER VCHTYPE="' + esc(s.voucherType) + '" ACTION="Create" OBJVIEW="Order Voucher View">\n' +
      '      <DATE>' + dt + '</DATE>\n' +
      '      <EFFECTIVEDATE>' + dt + '</EFFECTIVEDATE>\n' +
      '      <VOUCHERTYPENAME>' + esc(s.voucherType) + '</VOUCHERTYPENAME>\n' +
      '      <VOUCHERNUMBER>' + esc(o.orderNo) + '</VOUCHERNUMBER>\n' +
      '      <REFERENCE>' + esc(o.orderNo) + '</REFERENCE>\n' +
      '      <REFERENCEDATE>' + dt + '</REFERENCEDATE>\n' +
      '      <PARTYLEDGERNAME>' + esc(party) + '</PARTYLEDGERNAME>\n' +
      '      <BASICBASEPARTYNAME>' + esc(party) + '</BASICBASEPARTYNAME>\n' +
      '      <PERSISTEDVIEW>Order Voucher View</PERSISTEDVIEW>\n' +
      '      <ISDELETED>No</ISDELETED>\n' +
      (o.notes ? '      <NARRATION>' + esc(o.notes) + '</NARRATION>\n' : '') +
      '      ' + inv + '\n' +
      '     </VOUCHER>\n' +
      '    </TALLYMESSAGE>\n' +
      '   </REQUESTDATA>\n' +
      '  </IMPORTDATA>\n' +
      ' </BODY>\n' +
      '</ENVELOPE>\n';
  }

  function downloadTallyXml(o, cust) {
    var xml = buildTallyXml(o, cust);
    var blob = new Blob([xml], { type: 'application/xml' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (o.orderNo || 'sales-order') + '.xml';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 600);
    toast('Tally XML downloaded');
  }

  function renderTallySettings() {
    var s = Store.tallySettings();
    var user = Store.currentUser ? Store.currentUser() : null;
    header('Settings', { back: true });
    btnBack.onclick = function () { go('orders'); };
    view.innerHTML =
      (user ? '<div class="card">' +
        '<div class="kv"><span class="k">Signed in as</span><span class="strong">' + esc(user.email || '') + '</span></div>' +
        '<div class="kv"><span class="k">Role</span><span>' + esc(user.role === 'admin' ? 'Admin' : 'Salesman') + '</span></div>' +
        '<button class="btn btn--ghost" style="margin-top:12px" id="logoutBtn">Sign out</button>' +
      '</div>' : '') +
      '<div class="sec-head"><h2>Tally Export</h2></div>' +
      '<div class="card"><div class="row__sub">These must match your TallyPrime company so the imported order posts correctly. Leave <strong>Company</strong> blank to import into whichever company is open in Tally.</div></div>' +
      '<div class="card">' +
        '<div class="field"><label>Company name in Tally (optional)</label><input id="tc" value="' + esc(s.company) + '" placeholder="Blank = use the open company"></div>' +
        '<div class="field"><label>Sales ledger name</label><input id="tl" value="' + esc(s.salesLedger) + '" placeholder="e.g. Sales"></div>' +
        '<div class="field"><label>Sales Order voucher type</label><input id="tv" value="' + esc(s.voucherType) + '" placeholder="Sales Order"></div>' +
        '<div class="field"><label>Godown / Location (optional)</label><input id="tg" value="' + esc(s.godown) + '" placeholder="e.g. Main Location"></div>' +
      '</div>' +
      '<button class="btn" id="saveTs">Save Settings</button>';
    document.getElementById('saveTs').onclick = function () {
      Store.saveTallySettings({
        company: document.getElementById('tc').value.trim(),
        salesLedger: document.getElementById('tl').value.trim() || 'Sales',
        voucherType: document.getElementById('tv').value.trim() || 'Sales Order',
        godown: document.getElementById('tg').value.trim()
      });
      toast('Settings saved'); go('orders');
    };
    var lo = document.getElementById('logoutBtn');
    if (lo) lo.onclick = function () { if (window.__logout) window.__logout(); };
  }

  /* ------------------------------------------------------------------ */
  /* Screen: Items                                                      */
  /* ------------------------------------------------------------------ */
  var itemQuery = '';
  function renderItems() {
    var admin = Store.isAdmin ? Store.isAdmin() : true;
    header('Stock Items', admin ? { action: '+ New', onAction: function () { go('item-edit'); } } : {});
    var items = Store.items().filter(function (i) { return i.name.toLowerCase().indexOf(itemQuery.toLowerCase()) >= 0; });
    var html = '<div class="search"><input id="q" placeholder="Search items" value="' + esc(itemQuery) + '"></div>';
    html += '<div style="text-align:right;margin:-4px 0 12px"><button class="btn btn--ghost btn--sm" id="mgPl">&#9881; Price Lists</button></div>';
    if (!items.length) html += emptyState('&#128230;', 'No items', 'Add stock items to use them in orders.');
    else html += '<div class="list">' + items.map(function (i) {
      return '<div class="row" data-item="' + i.id + '"><div class="row__main">' +
        '<div class="row__title">' + esc(i.name) + '</div>' +
        '<div class="row__sub">' + esc(i.unit) + ' &middot; GST ' + i.gst + '%' + (i.hsn ? ' &middot; HSN ' + esc(i.hsn) : '') + '</div>' +
        '</div><div class="row__end"><div class="row__amt">' + money(i.rate) + '</div></div></div>';
    }).join('') + '</div>';
    view.innerHTML = html;
    var q = document.getElementById('q');
    q.oninput = function () { itemQuery = q.value; var p = q.selectionStart; renderItems(); var nq = document.getElementById('q'); nq.focus(); nq.setSelectionRange(p, p); };
    document.getElementById('mgPl').onclick = function () { go('pricelists'); };
    if (admin) Array.prototype.forEach.call(view.querySelectorAll('[data-item]'), function (r) {
      r.onclick = function () { go('item-edit/' + r.dataset.item); };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Screen: Price Lists                                                */
  /* ------------------------------------------------------------------ */
  function renderPriceLists() {
    var admin = Store.isAdmin ? Store.isAdmin() : true;
    header('Price Lists', admin ? { back: true, action: '+ New', onAction: function () { go('pl-edit'); } } : { back: true });
    btnBack.onclick = function () { go('items'); };
    var pls = Store.priceLists();
    var html = '<div class="card"><div class="row__sub">Price lists let you keep different rate levels (e.g. Wholesale, Retail). Salesmen pick one when placing an order and item rates fill in automatically.</div></div>';
    if (!pls.length) html += emptyState('&#127991;', 'No price lists', 'Add a price list, then set item rates for it.');
    else html += '<div class="list">' + pls.map(function (p) {
      return '<div class="row" data-pl="' + p.id + '"><div class="row__main">' +
        '<div class="row__title">' + esc(p.name) + '</div></div>' +
        '<div class="row__end muted">&rsaquo;</div></div>';
    }).join('') + '</div>';
    view.innerHTML = html;
    if (admin) Array.prototype.forEach.call(view.querySelectorAll('[data-pl]'), function (r) {
      r.onclick = function () { go('pl-edit/' + r.dataset.pl); };
    });
  }

  function renderPriceListEdit(id) {
    var pl = id ? Store.priceList(id) : { name: '' };
    if (!pl) { go('pricelists'); return; }
    header(id ? 'Edit Price List' : 'New Price List', { back: true });
    btnBack.onclick = function () { go('pricelists'); };
    view.innerHTML =
      '<div class="card">' +
        '<div class="field"><label>Price list name</label><input id="name" value="' + esc(pl.name) + '" placeholder="e.g. Wholesale"></div>' +
      '</div>' +
      (id ? '<div class="card"><div class="row__sub">Set each item’s rate for this price list from the <strong>Items</strong> tab → open an item → <strong>Price List Rates</strong>.</div></div>' : '') +
      '<button class="btn" id="save">Save Price List</button>' +
      (id ? '<button class="btn btn--danger" id="del" style="margin-top:10px">Delete Price List</button>' : '');
    document.getElementById('save').onclick = function () {
      var name = document.getElementById('name').value.trim();
      if (!name) { toast('Enter a name'); return; }
      Store.savePriceList({ id: pl.id, name: name });
      toast('Price list saved'); go('pricelists');
    };
    if (id) document.getElementById('del').onclick = function () {
      if (confirm('Delete price list "' + pl.name + '"? Item rates for it will be removed.')) {
        Store.deletePriceList(id); toast('Price list deleted'); go('pricelists');
      }
    };
  }

  function renderItemEdit(id) {
    var it = id ? Store.item(id) : { name: '', unit: 'Pcs', rate: '', gst: 5, hsn: '' };
    if (!it) { go('items'); return; }
    header(id ? 'Edit Item' : 'New Item', { back: true });
    btnBack.onclick = function () { go('items'); };
    view.innerHTML =
      '<div class="card">' +
        '<div class="field"><label>Item name</label><input id="name" value="' + esc(it.name) + '" placeholder="e.g. Basmati Rice 25kg"></div>' +
        '<div class="field--row">' +
          '<div class="field"><label>Unit</label><input id="unit" value="' + esc(it.unit) + '" placeholder="Pcs / Bag / Kg"></div>' +
          '<div class="field"><label>Rate (₹)</label><input id="rate" type="number" inputmode="decimal" value="' + esc(it.rate) + '"></div>' +
        '</div>' +
        '<div class="field--row">' +
          '<div class="field"><label>GST %</label><select id="gst">' + [0, 5, 12, 18, 28].map(function (g) {
            return '<option ' + (g === it.gst ? 'selected' : '') + '>' + g + '</option>';
          }).join('') + '</select></div>' +
          '<div class="field"><label>HSN (optional)</label><input id="hsn" value="' + esc(it.hsn || '') + '"></div>' +
        '</div>' +
      '</div>' +
      (Store.priceLists().length ?
        '<div class="card">' +
          '<div class="sec-head" style="margin-top:0"><h2>Price List Rates</h2></div>' +
          '<div class="row__sub" style="margin:-6px 2px 10px">Leave blank to use the base rate above.</div>' +
          Store.priceLists().map(function (p) {
            var v = (it.rates && it.rates[p.id] != null) ? it.rates[p.id] : '';
            return '<div class="field--row" style="align-items:center;margin-bottom:10px">' +
              '<div style="flex:1;font-weight:600;font-size:14px">' + esc(p.name) + '</div>' +
              '<div class="field" style="margin:0;flex:1"><input type="number" inputmode="decimal" data-pl="' + p.id + '" value="' + esc(v) + '" placeholder="₹ rate"></div>' +
            '</div>';
          }).join('') +
        '</div>' : '') +
      '<button class="btn" id="save">Save Item</button>' +
      (id ? '<button class="btn btn--danger" id="del" style="margin-top:10px">Delete Item</button>' : '');

    document.getElementById('save').onclick = function () {
      var name = document.getElementById('name').value.trim();
      if (!name) { toast('Enter item name'); return; }
      var rates = {};
      Array.prototype.forEach.call(document.querySelectorAll('[data-pl]'), function (inp) {
        if (inp.value !== '') rates[inp.dataset.pl] = Number(inp.value) || 0;
      });
      Store.saveItem({
        id: it.id, name: name,
        unit: document.getElementById('unit').value.trim() || 'Pcs',
        rate: Number(document.getElementById('rate').value) || 0,
        gst: Number(document.getElementById('gst').value) || 0,
        hsn: document.getElementById('hsn').value.trim(),
        rates: rates
      });
      toast('Item saved'); go('items');
    };
    if (id) document.getElementById('del').onclick = function () {
      if (confirm('Delete ' + it.name + '?')) { Store.deleteItem(id); toast('Item deleted'); go('items'); }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Screen: Customers                                                  */
  /* ------------------------------------------------------------------ */
  var custQuery = '';
  function renderCustomers() {
    var admin = Store.isAdmin ? Store.isAdmin() : true;
    header('Parties', admin ? { action: '+ New', onAction: function () { go('cust-edit'); } } : {});
    var custs = Store.customers().filter(function (c) { return c.name.toLowerCase().indexOf(custQuery.toLowerCase()) >= 0; });
    var html = '<div class="search"><input id="q" placeholder="Search parties" value="' + esc(custQuery) + '"></div>';
    if (!custs.length) html += emptyState('&#128100;', 'No parties', 'Add customers to place orders for them.');
    else html += '<div class="list">' + custs.map(function (c) {
      return '<div class="row" data-cust="' + c.id + '"><div class="row__main">' +
        '<div class="row__title">' + esc(c.name) + '</div>' +
        '<div class="row__sub">' + esc(c.place || '') + (c.phone ? ' &middot; ' + esc(c.phone) : '') + '</div>' +
        (c.gstin ? '<div class="row__sub">GSTIN ' + esc(c.gstin) + '</div>' : '') +
        '</div></div>';
    }).join('') + '</div>';
    view.innerHTML = html;
    var q = document.getElementById('q');
    q.oninput = function () { custQuery = q.value; var p = q.selectionStart; renderCustomers(); var nq = document.getElementById('q'); nq.focus(); nq.setSelectionRange(p, p); };
    if (admin) Array.prototype.forEach.call(view.querySelectorAll('[data-cust]'), function (r) {
      r.onclick = function () { go('cust-edit/' + r.dataset.cust); };
    });
  }

  function renderCustEdit(id) {
    var c = id ? Store.customer(id) : { name: '', gstin: '', phone: '', place: '', address: '', group: '', state: '', country: '', priceListId: '', priceListName: '' };
    if (!c) { go('customers'); return; }
    header(id ? 'Edit Party' : 'New Party', { back: true });
    btnBack.onclick = function () { go('customers'); };
    view.innerHTML =
      '<div class="card">' +
        '<div class="field"><label>Party name</label><input id="name" value="' + esc(c.name) + '" placeholder="Business / customer name"></div>' +
        '<div class="field--row">' +
          '<div class="field"><label>Phone</label><input id="phone" type="tel" value="' + esc(c.phone || '') + '"></div>' +
          '<div class="field"><label>Place</label><input id="place" value="' + esc(c.place || '') + '" placeholder="City, State"></div>' +
        '</div>' +
        '<div class="field--row">' +
          '<div class="field"><label>State</label><input id="state" value="' + esc(c.state || '') + '"></div>' +
          '<div class="field"><label>Country</label><input id="country" value="' + esc(c.country || '') + '"></div>' +
        '</div>' +
        '<div class="field"><label>GSTIN (optional)</label><input id="gstin" value="' + esc(c.gstin || '') + '"></div>' +
        (Store.priceLists().length ?
          '<div class="field"><label>Price List (this party’s rates)</label><select id="plsel">' +
            '<option value="">— default —</option>' +
            Store.priceLists().map(function (p) {
              return '<option value="' + p.id + '" ' + (p.id === c.priceListId ? 'selected' : '') + '>' + esc(p.name) + '</option>';
            }).join('') +
          '</select></div>' : '') +
        (c.group ? '<div class="field"><label>Tally Group</label><input value="' + esc(c.group) + '" disabled></div>' : '') +
        '<div class="field"><label>Address (optional)</label><textarea id="address" rows="2">' + esc(c.address || '') + '</textarea></div>' +
      '</div>' +
      '<button class="btn" id="save">Save Party</button>' +
      (id ? '<button class="btn btn--accent" id="setPrices" style="margin-top:10px">💲 Set this party’s item prices</button>' : '') +
      (id ? '<button class="btn btn--danger" id="del" style="margin-top:10px">Delete Party</button>' : '');

    document.getElementById('save').onclick = function () {
      var name = document.getElementById('name').value.trim();
      if (!name) { toast('Enter party name'); return; }
      var plSelEl = document.getElementById('plsel');
      var plId = plSelEl ? plSelEl.value : '';
      var plObj = plId ? Store.priceList(plId) : null;
      Store.saveCustomer({
        id: c.id, name: name,
        phone: document.getElementById('phone').value.trim(),
        place: document.getElementById('place').value.trim(),
        state: document.getElementById('state').value.trim(),
        country: document.getElementById('country').value.trim(),
        gstin: document.getElementById('gstin').value.trim(),
        address: document.getElementById('address').value.trim(),
        group: c.group || '',
        priceListId: plId,
        priceListName: plObj ? plObj.name : ''
      });
      toast('Party saved'); go('customers');
    };
    if (id) document.getElementById('setPrices').onclick = function () { go('party-prices/' + id); };
    if (id) document.getElementById('del').onclick = function () {
      if (confirm('Delete ' + c.name + '?')) { Store.deleteCustomer(id); toast('Party deleted'); go('customers'); }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Screen: Party item prices (each party's own rates)                 */
  /* ------------------------------------------------------------------ */
  var ppState = null; // { custId, edits: {itemId: value}, query }
  function renderPartyPrices(custId) {
    var cust = Store.customer(custId);
    if (!cust) { go('customers'); return; }
    if (!ppState || ppState.custId !== custId) {
      ppState = { custId: custId, edits: {}, query: '' };
      var existing = Store.partyPricesFor(custId);
      Object.keys(existing).forEach(function (k) { ppState.edits[k] = existing[k]; });
    }
    header('Prices · ' + cust.name, { back: true });
    btnBack.onclick = function () { ppState = null; go('cust-edit/' + custId); };

    var items = Store.items().filter(function (i) { return i.name.toLowerCase().indexOf(ppState.query.toLowerCase()) >= 0; });
    var setCount = Object.keys(ppState.edits).filter(function (k) { return ppState.edits[k] !== '' && ppState.edits[k] != null; }).length;
    var rows = items.map(function (it) {
      var v = ppState.edits[it.id]; if (v == null) v = '';
      return '<div style="display:flex;align-items:center;gap:10px;background:var(--card);border-radius:12px;box-shadow:var(--shadow);padding:10px 12px;margin-bottom:8px">' +
        '<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:14px">' + esc(it.name) + '</div>' +
        '<div class="row__sub">' + esc(it.unit || '') + (it.gst ? ' · GST ' + it.gst + '%' : '') + '</div></div>' +
        '<input class="pp-rate" data-item="' + it.id + '" type="number" inputmode="decimal" value="' + esc(v) + '" placeholder="₹' + (it.base_rate || 0) + '" ' +
        'style="width:96px;text-align:right;border:1px solid var(--line);border-radius:9px;padding:9px;font-size:15px;background:#fff">' +
      '</div>';
    }).join('');

    view.innerHTML =
      '<div class="card"><div class="row__sub">Set <strong>' + esc(cust.name) + '</strong>’s own rate for each item. Blank = use the item’s base rate. These apply automatically when you place an order for this party. <strong>' + setCount + '</strong> set.</div></div>' +
      '<div class="search"><input id="q" placeholder="Search items" value="' + esc(ppState.query) + '"></div>' +
      '<div id="pplist">' + (rows || '<div class="card muted" style="text-align:center">No items</div>') + '</div>' +
      '<div class="sticky-actions"><button class="btn" id="savePP">Save Prices</button></div>';

    var q = document.getElementById('q');
    q.oninput = function () { ppState.query = q.value; var p = q.selectionStart; renderPartyPrices(custId); var nq = document.getElementById('q'); nq.focus(); nq.setSelectionRange(p, p); };
    Array.prototype.forEach.call(view.querySelectorAll('.pp-rate'), function (inp) {
      inp.oninput = function () { ppState.edits[inp.dataset.item] = inp.value; };
    });
    document.getElementById('savePP').onclick = function () {
      Store.setPartyPrices(custId, ppState.edits);
      toast('Prices saved for ' + cust.name);
      ppState = null; go('cust-edit/' + custId);
    };
  }

  /* ------------------------------------------------------------------ */
  function emptyState(icon, title, sub) {
    return '<div class="empty"><div class="empty__icon">' + icon + '</div>' +
      '<div class="empty__title">' + esc(title) + '</div>' +
      '<div class="row__sub">' + esc(sub) + '</div></div>';
  }

  /* ------------------------------------------------------------------ */
  /* Tab bar navigation                                                 */
  /* ------------------------------------------------------------------ */
  function boot() {
    Array.prototype.forEach.call(tabbar.querySelectorAll('.tabbar__btn'), function (b) {
      b.onclick = function () {
        var nav = b.dataset.nav;
        if (nav === 'new') { startNewOrder(); }
        else { go(nav); }
      };
    });
    btnBack.onclick = function () { window.history.length > 1 ? window.history.back() : go('orders'); };
    window.addEventListener('hashchange', route);
    route();
  }

  // Expose hooks for the cloud layer (cloud.js boots the app after login).
  window.__APP_BOOT__ = boot;
  window.__toast = toast;

  // If no cloud layer is present (standalone build), boot immediately.
  if (!window.SUPA) boot();
})();
