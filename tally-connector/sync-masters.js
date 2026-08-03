/* =====================================================================
 *  sync-masters.js  —  Tally  ->  Sales Order Hub (Supabase)
 *  Reads Stock Items and Sundry-Debtor parties from TallyPrime's XML
 *  gateway and upserts them into your Hub. Matched by Tally GUID, so it
 *  is safe to run repeatedly:
 *     - first run  = full load
 *     - later runs = re-sync (updates changed, adds new)
 *  It never overwrites prices you set in the app (base_rate is left alone).
 *
 *  Run:   node sync-masters.js            (real sync)
 *         node sync-masters.js --dry-run  (read Tally only, no writes)
 *
 *  Needs a config.json next to this file (copy config.sample.json).
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const DRY = process.argv.includes('--dry-run');
const PURGE = process.argv.includes('--purge');
const LIMIT = (function () { const i = process.argv.indexOf('--limit'); return i >= 0 ? parseInt(process.argv[i + 1], 10) || 0 : 0; })();
const cfgPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(cfgPath)) {
  console.error('Missing config.json — copy config.sample.json to config.json and fill it in.');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const TALLY = cfg.tallyUrl || 'http://localhost:9000';
const COMPANY = cfg.company || '';

/* ---------- helpers ---------- */
function decode(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
    .replace(/\s+/g, ' ').trim();
}
function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '[^>]*>([^<]*)</' + name + '>', 'i'));
  return m ? decode(m[1]) : '';
}

/* ---------- Tally XML request ---------- */
function tallyCollection(id, type, fetchFields, extra) {
  const body =
    '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>' +
    '<TYPE>Collection</TYPE><ID>' + id + '</ID></HEADER><BODY><DESC><STATICVARIABLES>' +
    '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>' +
    (COMPANY ? '<SVCURRENTCOMPANY>' + COMPANY + '</SVCURRENTCOMPANY>' : '') +
    '</STATICVARIABLES><TDL><TDLMESSAGE>' +
    '<COLLECTION NAME="' + id + '" ISMODIFY="No">' +
    '<TYPE>' + type + '</TYPE>' + (extra || '') +
    '<FETCH>' + fetchFields + '</FETCH></COLLECTION>' +
    '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>';

  return new Promise(function (resolve, reject) {
    const u = new URL(TALLY);
    const req = http.request({ hostname: u.hostname, port: u.port || 9000, method: 'POST',
      headers: { 'Content-Type': 'text/xml' } }, function (res) {
      let data = ''; res.setEncoding('utf8');
      res.on('data', function (c) { data += c; });
      res.on('end', function () { resolve(data); });
    });
    req.on('error', reject);
    req.setTimeout(60000, function () { req.destroy(new Error('Tally timed out — is it open with the company loaded and gateway on?')); });
    req.end(body);
  });
}

/* ---------- parse ---------- */
function parseItems(xml) {
  const out = [];
  const blocks = xml.split('<STOCKITEM ').slice(1);
  blocks.forEach(function (b) {
    const nm = b.match(/^NAME="([^"]*)"/);
    const name = nm ? decode(nm[1]) : '';
    const guid = tag(b, 'GUID');
    const unit = tag(b, 'BASEUNITS') || 'NOS';
    if (name && guid) out.push({ tally_guid: guid, name: name, unit: unit, source: 'tally' });
  });
  return out;
}
function parseParties(xml) {
  const out = [];
  const blocks = xml.split('<LEDGER ').slice(1);
  blocks.forEach(function (b) {
    const nm = b.match(/^NAME="([^"]*)"/);
    const name = nm ? decode(nm[1]) : '';
    const guid = tag(b, 'GUID');
    const place = tag(b, 'PARENT');
    const phone = tag(b, 'LEDGERMOBILE');
    const state = tag(b, 'LEDSTATENAME');
    let gstin = tag(b, 'PARTYGSTIN');
    if (name && guid) out.push({ tally_guid: guid, name: name, place: place, phone: phone,
      gstin: gstin || null, source: 'tally' });
  });
  return out;
}

/* ---------- Supabase upsert (REST, service_role) ---------- */
function upsert(table, rows) {
  return new Promise(function (resolve, reject) {
    if (!rows.length) return resolve(0);
    const u = new URL(cfg.supabaseUrl + '/rest/v1/' + table + '?on_conflict=tally_guid');
    const payload = JSON.stringify(rows);
    const req = require('https').request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': cfg.serviceRoleKey,
        'Authorization': 'Bearer ' + cfg.serviceRoleKey,
        'Prefer': 'resolution=merge-duplicates,return=minimal',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, function (res) {
      let d = ''; res.on('data', function (c) { d += c; });
      res.on('end', function () {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(rows.length);
        else reject(new Error(table + ' upsert HTTP ' + res.statusCode + ': ' + d.slice(0, 300)));
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}
async function upsertBatched(table, rows, size) {
  let done = 0;
  for (let i = 0; i < rows.length; i += size) {
    done += await upsert(table, rows.slice(i, i + size));
    process.stdout.write('\r  ' + table + ': ' + done + '/' + rows.length + ' ');
  }
  process.stdout.write('\n');
  return done;
}

/* ---------- delete all Tally-sourced masters (cleanup) ---------- */
function purgeTable(table) {
  return new Promise(function (resolve, reject) {
    const u = new URL(cfg.supabaseUrl + '/rest/v1/' + table + '?source=eq.tally');
    const req = require('https').request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'DELETE',
      headers: { 'apikey': cfg.serviceRoleKey, 'Authorization': 'Bearer ' + cfg.serviceRoleKey, 'Prefer': 'return=minimal' }
    }, function (res) {
      let d = ''; res.on('data', function (c) { d += c; });
      res.on('end', function () {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(table + ' purge HTTP ' + res.statusCode + ': ' + d.slice(0, 200)));
      });
    });
    req.on('error', reject); req.end();
  });
}

/* ---------- main ---------- */
(async function () {
  try {
    if (PURGE) {
      console.log('Purging all Tally-sourced masters from the Hub ...');
      await purgeTable('items'); await purgeTable('customers');
      console.log('Done ✓  Removed all items/parties with source = tally.');
      return;
    }
    console.log('Reading masters from Tally (' + (COMPANY || 'active company') + ') ...');
    const itemsXml = await tallyCollection('SO_Items', 'StockItem', 'NAME,BASEUNITS,GUID');
    const items = parseItems(itemsXml);
    console.log('  stock items : ' + items.length);

    const partyXml = await tallyCollection('SO_Parties', 'Ledger', 'NAME,GUID,PARENT,PARTYGSTIN,LEDGERMOBILE,LEDSTATENAME',
      '<CHILDOF>Sundry Debtors</CHILDOF><BELONGSTO>Yes</BELONGSTO>');
    const parties = parseParties(partyXml);
    console.log('  parties     : ' + parties.length);

    if (DRY) {
      console.log('\n[dry-run] sample item  :', JSON.stringify(items[0]));
      console.log('[dry-run] sample party :', JSON.stringify(parties[0]));
      console.log('\nDry run only — nothing written. Remove --dry-run to sync to the Hub.');
      return;
    }
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
      console.error('config.json needs supabaseUrl and serviceRoleKey to write. (Use --dry-run to test reading.)');
      process.exit(1);
    }
    let itemsToLoad = items, partiesToLoad = parties;
    if (LIMIT > 0) {
      itemsToLoad = items.slice(0, LIMIT); partiesToLoad = parties.slice(0, LIMIT);
      console.log('--limit ' + LIMIT + ': loading only ' + itemsToLoad.length + ' items and ' + partiesToLoad.length + ' parties.');
    }
    console.log('Writing to the Hub ...');
    await upsertBatched('items', itemsToLoad, 500);
    await upsertBatched('customers', partiesToLoad, 500);
    console.log('\nDone ✓  Synced ' + itemsToLoad.length + ' items and ' + partiesToLoad.length + ' parties into the Hub.');
  } catch (e) {
    console.error('\nERROR: ' + e.message);
    process.exit(1);
  }
})();
