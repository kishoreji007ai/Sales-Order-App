/* store.js — standalone on-device data layer (localStorage).
   No server, no network. Everything persists on the device. */
(function (global) {
  'use strict';

  var KEY = 'sopro.db.v1';

  var SEED = {
    customers: [
      { id: 'c1', name: 'Sunrise Traders', gstin: '32ABCDE1234F1Z5', phone: '9847012345', place: 'Kochi, Kerala', address: 'MG Road, Kochi, Kerala 682011' },
      { id: 'c2', name: 'Metro Distributors', gstin: '29PQRSX6789K2Z1', phone: '9880011223', place: 'Bengaluru, Karnataka', address: '5th Block, Jayanagar, Bengaluru 560041' },
      { id: 'c3', name: 'Coastal Supermarket', gstin: '32LMNOP4567Q1Z9', phone: '9995566778', place: 'Kozhikode, Kerala', address: 'Beach Road, Kozhikode 673032' },
      { id: 'c4', name: 'Green Valley Stores', gstin: '', phone: '9812345678', place: 'Thrissur, Kerala', address: 'Round South, Thrissur 680001' }
    ],
    items: [
      { id: 'i1', name: 'Basmati Rice 25kg', unit: 'Bag', rate: 1850, gst: 5, hsn: '1006' },
      { id: 'i2', name: 'Sunflower Oil 1L', unit: 'Pcs', rate: 145, gst: 5, hsn: '1512' },
      { id: 'i3', name: 'Wheat Flour 10kg', unit: 'Bag', rate: 420, gst: 5, hsn: '1101' },
      { id: 'i4', name: 'Toor Dal 1kg', unit: 'Pkt', rate: 135, gst: 5, hsn: '0713' },
      { id: 'i5', name: 'Detergent Powder 1kg', unit: 'Pkt', rate: 110, gst: 18, hsn: '3402' },
      { id: 'i6', name: 'Tea Powder 500g', unit: 'Pkt', rate: 240, gst: 5, hsn: '0902' },
      { id: 'i7', name: 'Sugar 1kg', unit: 'Pkt', rate: 45, gst: 5, hsn: '1701' },
      { id: 'i8', name: 'Biscuits (Pack of 12)', unit: 'Box', rate: 180, gst: 18, hsn: '1905' }
    ],
    orders: [],
    seq: 1
  };

  var db = load();

  function load() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* fall through to seed */ }
    var fresh = JSON.parse(JSON.stringify(SEED));
    persist(fresh);
    return fresh;
  }

  function persist(d) {
    try { global.localStorage.setItem(KEY, JSON.stringify(d || db)); }
    catch (e) { /* storage full / unavailable */ }
  }

  function uid(prefix) {
    return (prefix || 'x') + Math.abs(Math.floor((performance.now() * 1000) % 1e9)).toString(36) +
           (db.seq++).toString(36);
  }

  var Store = {
    /* ----- customers ----- */
    customers: function () { return db.customers.slice(); },
    customer: function (id) { return db.customers.find(function (c) { return c.id === id; }); },
    saveCustomer: function (c) {
      if (c.id) {
        var i = db.customers.findIndex(function (x) { return x.id === c.id; });
        if (i >= 0) db.customers[i] = c;
      } else {
        c.id = uid('c'); db.customers.push(c);
      }
      persist(); return c;
    },
    deleteCustomer: function (id) {
      db.customers = db.customers.filter(function (c) { return c.id !== id; });
      persist();
    },

    /* ----- items ----- */
    items: function () { return db.items.slice(); },
    item: function (id) { return db.items.find(function (i) { return i.id === id; }); },
    saveItem: function (it) {
      if (it.id) {
        var i = db.items.findIndex(function (x) { return x.id === it.id; });
        if (i >= 0) db.items[i] = it;
      } else {
        it.id = uid('i'); db.items.push(it);
      }
      persist(); return it;
    },
    deleteItem: function (id) {
      db.items = db.items.filter(function (i) { return i.id !== id; });
      persist();
    },

    /* ----- orders ----- */
    orders: function () {
      return db.orders.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    },
    order: function (id) { return db.orders.find(function (o) { return o.id === id; }); },
    nextOrderNo: function () {
      var n = db.orders.length + 1;
      return 'SO-' + String(n).padStart(4, '0');
    },
    saveOrder: function (o) {
      if (o.id) {
        var i = db.orders.findIndex(function (x) { return x.id === o.id; });
        if (i >= 0) db.orders[i] = o;
      } else {
        o.id = uid('o');
        o.createdAt = Date.now();
        db.orders.push(o);
      }
      persist(); return o;
    },
    setOrderStatus: function (id, status) {
      var o = this.order(id); if (o) { o.status = status; persist(); }
      return o;
    },
    deleteOrder: function (id) {
      db.orders = db.orders.filter(function (o) { return o.id !== id; });
      persist();
    },

    resetDemo: function () {
      db = JSON.parse(JSON.stringify(SEED)); persist();
    }
  };

  global.Store = Store;
})(window);
