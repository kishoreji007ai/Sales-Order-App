# Tally → Hub master sync

`sync-masters.js` reads your **Stock Items** and **Sundry-Debtor parties** from
TallyPrime and loads them into your Sales Order Hub (Supabase).

- **First run = full load** (all items + parties).
- **Re-run anytime = re-sync** (updates changed names, adds new ones).
- Matched by each master's **Tally GUID**, so it never creates duplicates.
- It does **not** touch prices you set in the app (leaves `base_rate` alone).

Verified on your data: **1,006 items** and **1,590 parties**.

## Prerequisites (on the PC where Tally runs)
- **Node.js** (already installed on this PC).
- **TallyPrime open** with the company loaded, acting as a server on port 9000:
  `F1 (Help) → Settings → Connectivity → Client/Server configuration →
   TallyPrime acts as = Server, Port = 9000`.

## One-time setup
1. In this `tally-connector` folder, copy **`config.sample.json`** to **`config.json`**.
2. Get your **secret** key from Supabase: **Project Settings → API Keys →
   `service_role` (secret)** → copy it.
3. Paste it into `config.json` as `serviceRoleKey`. Check `company` matches your
   Tally company name. **Keep `config.json` private** — it holds the secret key
   and is git-ignored so it never leaves your PC.

## Run it
Open a terminal in this folder and run:

```bash
node sync-masters.js --dry-run   # test: reads Tally, writes nothing
node sync-masters.js             # real sync: loads everything into the Hub
```

After it finishes, open the Hub → **Items** and **Parties** tabs → everything
from Tally is there. Re-run whenever your Tally masters change.

## Notes / roadmap
- **Prices:** this v1 syncs item names, units and parties. Selling prices come
  from your app **price lists** (or a later step that maps Tally price levels).
- **GSTIN:** captured when Tally exposes `PARTYGSTIN`; otherwise left blank.
- **Security:** the `service_role` key bypasses row-level security and is only
  used here, on your machine. Never put it in the app or share it.
