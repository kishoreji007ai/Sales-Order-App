========================================================
 TallyPrime master export  (read-only proof step)
========================================================

WHAT THIS IS
------------
A small, READ-ONLY script that pulls your Parties, Stock Items and
Price Levels OUT of TallyPrime so we can confirm the connection and
see how your data is named. It does NOT write to or change Tally.


STEP 1 — Turn on Tally's gateway (one time, ~30 seconds)
--------------------------------------------------------
On the Tally-on-Cloud desktop, open TallyPrime with your company, then:

  Press  F1  (Help)  ->  Settings  ->  Connectivity
  ->  Client/Server configuration
  ->  set "TallyPrime acts as"  =  Server
  ->  Port  =  9000
  Accept / save.

(Leave TallyPrime open with your company loaded.)


STEP 2 — Get this script onto the Tally-on-Cloud desktop
--------------------------------------------------------
Any one of these:
  a) Copy the file "Export-TallyMasters.ps1" from your PC and paste it
     onto the cloud desktop (RDP clipboard/copy-paste works), OR
  b) On the cloud desktop, open this link in a browser and download it:
     https://github.com/kishoreji007ai/Sales-Order-App
     -> folder "tally-connector" -> Export-TallyMasters.ps1
     -> "Raw" -> Save As.

Put it on the Desktop (or any folder).


STEP 3 — Run it
---------------
Right-click "Export-TallyMasters.ps1"  ->  "Run with PowerShell".

  * If Windows blocks scripts, open PowerShell and run this once:
        Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
    then run:
        .\Export-TallyMasters.ps1

It will connect to Tally, print how many parties / items / price
levels it found, and save the details in a new folder next to the
script called  TallyExport_<date_time>.


STEP 4 — Send the result back
-----------------------------
Send the developer the file  SUMMARY.txt  from that folder
(and the .xml files too, if you can copy them across).
That's all that's needed to plan the next step.


SAFE BY DESIGN
--------------
- Read-only: it only asks Tally to EXPORT data. No import, no changes.
- Stays on your machine: it talks to Tally at http://localhost:9000
  on the same server. Nothing is sent anywhere by the script itself.
