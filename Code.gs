/**
 * Flagship Solar — Sheets bridge
 * ==================================================================
 * SETUP
 *   1. Set ADMIN_USERNAME below to the username you will register with.
 *   2. Run  setup()  once. Approve the prompts.
 *   3. Deploy > New deployment > Web app
 *        Execute as:      Me
 *        Who has access:  Anyone
 *      Copy the /exec URL into the app's Settings screen.
 *
 * "Anyone" is required because phones are not signed into Google.
 * Access is controlled by the Users sheet and checked on every request
 * here in the script — not in the app. The app only hides buttons;
 * this file is what actually decides.
 *
 * AFTER CHANGING ANYTHING HERE
 *   Deploy > Manage deployments > pencil > Version: New version > Deploy
 *   The URL stays the same. Without this, the old code keeps running.
 * ==================================================================
 */

// The first person to register with this username becomes Admin.
// Everyone else lands as Pending until you approve them.
var ADMIN_USERNAME = 'michael';

// Normal working day. Anything outside counts as overtime.
var DAY_END       = 17 * 60;   // 17:00
var OT_BEFORE     = 6 * 60;    // only earlier than 06:00 earns overtime
var LUNCH_DEFAULT = 30;

var ROLES = ['Admin', 'Technician', 'Worker'];

var SHEETS = {
  Users: ['Username', 'Display Name', 'Role', 'Status', 'Password Hash', 'Created', 'Last Seen'],
  Timesheets: [
    'Date', 'Day', 'Day Type', 'Worker', 'Job / Site',
    'Time In', 'Time Out', 'Lunch (min)',
    'Normal Hours', 'Overtime Hours', 'Total Hours',
    'Note', 'Submitted By', 'Timestamp'
  ],
  Workers: ['Name', 'Active', 'Added'],
  Prices: ['ID', 'Category', 'Supplier', 'Code', 'Description', 'Unit',
           'Cost', 'Type', 'Markup %', 'Install Cost', 'Spec', 'Active', 'Updated'],
  Log: ['Timestamp', 'User', 'Action', 'Detail', 'Was', 'Now']
};

/* Categories the quoting engine understands. The engine keys off these,
   so adding one here is what makes it available on the quote screen. */
var CATEGORIES = ['Inverter', 'Battery', 'Panel', 'Heat pump', 'Changeover',
                  'Roof structure', 'DC string', 'Labour', 'Consumable', 'Other'];

// Applied when an item leaves Markup % blank.
var DEFAULT_MARKUP = 20;

/* 'Cost'  = a supplier price; markup gets added.
   'Sell'  = already your selling price; markup is NOT added.
   Getting this wrong is how a R5900 board quotes at R7080. */
var PRICE_TYPES = ['Cost', 'Sell'];

var WORKER_COLS = [
  'Date', 'Day', 'Day Type', 'Job / Site',
  'Time In', 'Time Out', 'Lunch (min)',
  'Normal Hours', 'Overtime Hours', 'Total Hours',
  'Note', 'Submitted By', 'Timestamp'
];

var SEED_WORKERS = ['Frank', 'Michael', 'Jacobus', 'Ian', 'Sangwani'];
var MONTHS_ = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var DAYS_ = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

/* ================= setup ================= */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var want = SHEETS[name];
    var lastCol = sh.getLastColumn();
    var have = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    want.forEach(function (h, i) { if (have[i] !== h) sh.getRange(1, i + 1).setValue(h); });
    sh.getRange(1, 1, 1, want.length).setFontWeight('bold')
      .setBackground('#1F4E79').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  });

  var u = ss.getSheetByName('Users');
  u.setColumnWidth(1, 130); u.setColumnWidth(2, 150);
  try { u.hideColumns(5); } catch (e) {}   // password hashes

  fixFormats_();

  var w = ss.getSheetByName('Workers');
  if (w.getLastRow() < 2) {
    var now = new Date();
    w.getRange(2, 1, SEED_WORKERS.length, 3)
     .setValues(SEED_WORKERS.map(function (n) { return [n, 'Yes', now]; }));
  }

  var pr = ss.getSheetByName('Prices');
  pr.setColumnWidth(5, 260); pr.setColumnWidth(11, 160);
  if (pr.getLastRow() < 2) { seedPrices_(); seedSuppliers_(); }

  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && ss.getSheets().length > 1 && s1.getLastRow() === 0) ss.deleteSheet(s1);

  log_('system', 'setup', 'sheets checked', '', '');
  return 'Setup done.';
}

/** Times are written as text; tell Sheets to leave them alone. */
function fixFormats_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var ts = ss.getSheetByName('Timesheets');
  if (ts && ts.getMaxRows() > 1) {
    ts.getRange(2, 6, ts.getMaxRows() - 1, 2).setNumberFormat('@');   // Time In / Out
    ts.getRange(2, 1, ts.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd');
  }

  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (['Timesheets','Users','Workers','Log','Summary','Sheet1'].indexOf(name) !== -1) return;
    if (sh.getMaxRows() < 2) return;
    if (String(sh.getRange(1, 1).getValue()) !== 'Date') return;      // only worker tabs
    sh.getRange(2, 5, sh.getMaxRows() - 1, 2).setNumberFormat('@');   // Time In / Out
    sh.getRange(2, 1, sh.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd');
  });
}

/** Repairs times already written as 1899 datetimes. */
function fixExistingTimes() {
  var sh = sheet_('Timesheets');
  var n = sh.getLastRow() - 1;
  if (n < 1) return 'No data.';

  fixFormats_();
  var rng = sh.getRange(2, 6, n, 2);
  var vals = rng.getValues();
  var changed = 0;

  var out = vals.map(function (r) {
    return r.map(function (v) {
      if (v instanceof Date) {
        changed++;
        return pad2_(v.getHours()) + ':' + pad2_(v.getMinutes());
      }
      return String(v);
    });
  });

  if (changed) rng.setValues(out);
  rebuildWorkerTabs();
  return 'Repaired ' + changed + ' time cells.';
}

/* Your own fixed prices, from QU-0475. These are Sell prices — what you
   charge — so no markup is added. Supplier lists (Africo, ITS) go in as
   Cost and get marked up. */
function seedPrices_() {
  var now = new Date();
  var seed = [
    ['Changeover', 'Flagship', '', 'AC Switch gear — 40A single phase',
     'each', 5900, 'Sell', '', 0,
     '18way steel DB board, 4x 40A D/P breakers, 1x 40A changeover switch, 2x pilot lights, cables to and from inverter'],
    ['Changeover', 'Flagship', '', 'AC Switch gear — 3 phase 30/50kW',
     'each', 13500, 'Sell', '', 0, 'Three phase changeover assembly'],
    ['DC string', 'Flagship', '', 'DC Switch gear — one string',
     'each', 5900, 'Sell', '', 0,
     '18way DB board, 30m 6mm DC cable red & black, MC4 connectors, 1x DC surge, 1x 16A DC breaker, DC disconnect'],
    ['Roof structure', 'Flagship', '', 'Roof structure — tiles',
     'per panel', 450, 'Sell', '', 0, 'Roof hooks, rails, end clamps, mid clamps'],
    ['Roof structure', 'Flagship', '', 'Roof structure — kliplock',
     'per panel', 450, 'Sell', '', 0, 'Kliplock brackets, rails, clamps'],
    ['Roof structure', 'Flagship', '', 'Roof structure — hanger bolts',
     'per panel', 600, 'Sell', '', 0, 'Hanger bolts, rails, clamps'],
    ['Consumable', 'Flagship', '', 'Installation hardware',
     'per job', 3000, 'Sell', '', 0,
     'Consumables, screws, bootlaces, trunking, sealant, stainless bolts & nuts'],
    ['Labour', 'Flagship', '', 'Labour — 5kW system', 'per job', 8500, 'Sell', '', 0, 'Suggested'],
    ['Labour', 'Flagship', '', 'Labour — 8kW system', 'per job', 12500, 'Sell', '', 0, 'Suggested'],
    ['Labour', 'Flagship', '', 'Labour — 12kW system', 'per job', 16400, 'Sell', '', 0, 'Suggested'],
    ['Panel', '', '', 'Solar panel', 'per watt', 2.15, 'Cost', 20, 0,
     'Cost per watt. Multiply by panel wattage.']
  ];
  var rows = seed.map(function (s) {
    return [priceId_(), s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9], 'Yes', now];
  });
  sheet_('Prices').getRange(2, 1, rows.length, 13).setValues(rows);
  log_('system', 'seedPrices', rows.length + ' items', '', '');
}

/* Supplier lists as uploaded. These are Cost prices — markup is added.
   Africo: TRADE PRICE column (18% account discount already applied),
   from the June 2026 list. ITS heat pumps: Dealer's Price, November 2025.
   Both change often. Update them in the Prices tab or on the app's
   Prices screen; nothing here needs editing. */
function seedSuppliers_() {
  var listDate = new Date();
  var seed = [
    ['Inverter', 'Africo', 'SUN-5K-SG01LP-EU', 12320, 'each', 'Cost', '', 0, '', 'Deye - 5Kw Single Phase Hybrid Inverter'],
    ['Inverter', 'Africo', 'SUN-6K-SG04LP1-EU', 13440, 'each', 'Cost', '', 0, '', 'Deye - 6Kw Single Phase Hybrid Inverter'],
    ['Inverter', 'Africo', 'SUN-8K-SG01LP1-EU', 17920, 'each', 'Cost', '', 0, '', 'Deye - 8Kw Single Phase Hybrid Inverter'],
    ['Inverter', 'Africo', 'SUN-10K-SG02LP1-EU-AM3', 23520, 'each', 'Cost', '', 0, '', 'Deye - 10Kw Single Phase Hybrid Inverter'],
    ['Inverter', 'Africo', 'SUN-12K-1PHASE', 26320, 'each', 'Cost', '', 0, '', 'Deye - 12Kw Single Phase Hybrid Inverter'],
    ['Inverter', 'Africo', 'SUN-12K-SG04LP3', 26320, 'each', 'Cost', '', 0, '', 'Deye - 12Kw Three Phase Hybrid Inverter'],
    ['Inverter', 'Africo', 'SUN-15K-SG01LP1-EU', 30800, 'each', 'Cost', '', 0, '', 'Deye - 15kW Three Phase Hybrid Inverter'],
    ['Inverter', 'Africo', 'SUN-16K-SG01LP1-EU', 33040, 'each', 'Cost', '', 0, '', 'Deye - 16kW Single Phase Hybrid Inverter'],
    ['Inverter', 'Africo', 'SUN-18-1P', 37520, 'each', 'Cost', '', 0, '', 'Deye - 18kW Single Phase Hybrid Inverter'],
    ['Inverter', 'Africo', 'SUN-20K-SG05LP3-EU-SM2', 43120, 'each', 'Cost', '', 0, '', 'Deye - 20kW Three Phase Hybrid Inverter LV'],
    ['Inverter', 'Africo', 'SUN-20K-SG01HP3-EU', 31360, 'each', 'Cost', '', 0, '', 'Deye - 20kW Three Phase Hybrid Inverter HV'],
    ['Inverter', 'Africo', 'SUN-30K-SG01HP3-EU', 45920, 'each', 'Cost', '', 0, '', 'Deye - 30kW Three Phase Hybrid Inverter HV'],
    ['Inverter', 'Africo', 'SUN-50K-SG01HP3-EU', 66080, 'each', 'Cost', '', 0, '', 'Deye - 50kW Three Phase Hybrid Inverter HV'],
    ['Inverter', 'Africo', 'SUN-80K-SG01HP3-EU', 98560, 'each', 'Cost', '', 0, '', 'Deye - 80kW Three Phase Hybrid Inverter HV'],
    ['Inverter', 'Africo', 'SUN-125K-SG01HP3-EU', 140000, 'each', 'Cost', '', 0, '', 'Deye - 125kW Three Phase Hybrid Inverter HV'],
    ['Inverter', 'Africo', 'DEYE-6KW-OG', 6720, 'each', 'Cost', '', 0, '', 'Deye - 6Kw Off Grid inverter IP65'],
    ['Inverter', 'Africo', 'S6-EH1P6K-L-PLUS', 12305.22, 'each', 'Cost', '', 0, '', 'Solis S6 6kw single phase hybrid inverter'],
    ['Inverter', 'Africo', 'S6-EH1P8K-L-PLUS', 17767.68, 'each', 'Cost', '', 0, '', 'Solis S6 8kw single phase hybrid inverter'],
    ['Inverter', 'Africo', 'S6-EH1P10K-L-PLUS(21A)', 21156.80, 'each', 'Cost', '', 0, '', 'Solis S6 10kw single phase hybrid inverter'],
    ['Inverter', 'Africo', 'S6-EH1P12K03-NV-YD-L', 23050.72, 'each', 'Cost', '', 0, '', 'Solis S6 12kw single phase hybrid inverter'],
    ['Inverter', 'Africo', 'S6-EH1P16K03-NV-YD-L', 32556.38, 'each', 'Cost', '', 0, '', 'Solis S6 16kw single phase hybrid inverter'],
    ['Inverter', 'Africo', 'S6-EH3P18K02-NV-YD-L', 31380.16, 'each', 'Cost', '', 0, '', 'Solis S6 18kw three phase hybrid inverter'],
    ['Inverter', 'Africo', 'S6-EH3P30K-H', 38541.44, 'each', 'Cost', '', 0, '', 'Solis S6 30kw 3Ph Hybrid Inverter'],
    ['Inverter', 'Africo', 'S6-EH3P50K-H', 58876.61, 'each', 'Cost', '', 0, '', 'Solis S6 50kw 3Ph Hybrid Inverter'],
    ['Inverter', 'Africo', 'LUX-SNA5000WPV', 5824, 'each', 'Cost', '', 0, '', 'LuxPower - Inverter 5Kw Eco Hybrid / Off Grid'],
    ['Inverter', 'Africo', 'LUX-SNA6000WPV', 6048, 'each', 'Cost', '', 0, '', 'LuxPower - Inverter 6Kw Eco Hybrid / Off Grid'],
    ['Inverter', 'Africo', 'LUX-SNA12000WPV-WB', 14560, 'each', 'Cost', '', 0, '', 'LuxPower - Inverter 12Kw Eco Hybrid with breaker'],
    ['Inverter', 'Africo', 'LUX-LXP6K-LV', 10640, 'each', 'Cost', '', 0, '', 'LuxPower - Inverter 6Kw Hybrid Single Phase'],
    ['Inverter', 'Africo', 'LUX-LXP-LB10K', 17360, 'each', 'Cost', '', 0, '', 'LuxPower - Inverter 10Kw Hybrid Single Phase'],
    ['Inverter', 'Africo', 'LUX-GEN2-LB12K', 18480, 'each', 'Cost', '', 0, '', 'LuxPower - Inverter 12Kw Hybrid Single Phase Gen2'],
    ['Inverter', 'Africo', 'LUX-12-3P-HV', 28000, 'each', 'Cost', '', 0, '', 'LuxPower - Inverter 20Kw Hybrid 3Phase HV'],
    ['Inverter', 'Africo', 'VOLTA-LV-12', 28560, 'each', 'Cost', '', 0, '', 'Volta - 12kW Single Phase Hybrid Inverter'],
    ['Inverter', 'Africo', 'VOLTA-LV-15', 34160, 'each', 'Cost', '', 0, '', 'Volta - 15kW Three Phase Hybrid Inverter'],
    ['Battery', 'Africo', 'DEYE-LV-5.32-SE-G', 12320, 'each', 'Cost', '', 0, '', 'Deye - Battery Lithium Ion SE-G 5.32kWh 51.2V 100Ah'],
    ['Battery', 'Africo', 'DEYE-SE-F5.1', 11760, 'each', 'Cost', '', 0, '', 'Deye - Battery SE-F 5.12kWh'],
    ['Battery', 'Africo', 'DEYE-SE-F5.1-PLUS', 12320, 'each', 'Cost', '', 0, '', 'Deye - Battery SE-F PLUS 5.12kWh'],
    ['Battery', 'Africo', 'DEYE-RW-G/F-10.6', 23520, 'each', 'Cost', '', 0, '', 'Deye - Battery RW-F/G 10,6kWh'],
    ['Battery', 'Africo', 'DEYE-LV-11,8', 24080, 'each', 'Cost', '', 0, '', 'Deye - Battery Lithium Ion 11,8kWh 51V 208Ah'],
    ['Battery', 'Africo', 'DEYE-LV-16', 28000, 'each', 'Cost', '', 0, '', 'Deye - Battery Lithium Ion SE-F16 16kWh'],
    ['Battery', 'Africo', 'DEYE-HV-5.12-BOS-G', 13440, 'each', 'Cost', '', 0, '', 'Deye - Battery High Voltage 5.12kWh BOS-G Pro'],
    ['Battery', 'Africo', 'DEYE-HV-7.68-BOS-A', 19040, 'each', 'Cost', '', 0, '', 'Deye - Battery High Voltage 7.68kWh BOS-A'],
    ['Battery', 'Africo', 'DEYE-HV-14,3-BOS-B', 27440, 'each', 'Cost', '', 0, '', 'Deye - Battery High Voltage 14,3kWh BOS-B Single'],
    ['Battery', 'Africo', 'DYN-DL-2,5', 5992, 'each', 'Cost', '', 0, '', 'Dyness - Battery Lithium Ion DL 2,56kWh'],
    ['Battery', 'Africo', 'DYN-DL5.0-1C', 11760, 'each', 'Cost', '', 0, '', 'Dyness - Battery Lithium Ion DL5 5.12kWh 10yr'],
    ['Battery', 'Africo', 'DYN-DL-PRO', 11200, 'each', 'Cost', '', 0, '', 'Dyness - Battery Lithium Ion DL PRO 5.12kWh'],
    ['Battery', 'Africo', 'DYN-PB-10,2', 22960, 'each', 'Cost', '', 0, '', 'Dyness - Battery Lithium Ion 10,24kWh PowerBox Pro'],
    ['Battery', 'Africo', 'DYN-PB-14,3', 26880, 'each', 'Cost', '', 0, '', 'Dyness - Battery Lithium Ion 14,3kWh PowerBrick'],
    ['Battery', 'Africo', 'DYN-PB-16,07', 28000, 'each', 'Cost', '', 0, '', 'Dyness - Battery Lithium Ion 16,076kWh PowerBrick MAX'],
    ['Battery', 'Africo', 'HINAESS-POWERGEM', 10640, 'each', 'Cost', '', 0, '', 'Hina ESS - Battery Lithium Ion 5.1kWh PowerGem'],
    ['Battery', 'Africo', 'HINAESS-POWERGEMPLUS', 24080, 'each', 'Cost', '', 0, '', 'Hina ESS - Battery Lithium Ion 14.3kWh PowerGemPlus'],
    ['Battery', 'Africo', 'VOLTA-S1-2NDGEN', 10976, 'each', 'Cost', '', 0, '', 'Volta - Battery Lithium Ion 5.1kW 48V 100Ah Stage 1 2nd Gen'],
    ['Battery', 'Africo', 'VOLTA-S3-2NDGEN', 20160, 'each', 'Cost', '', 0, '', 'Volta - Battery Lithium Ion 10.2kW 48V 200Ah Stage 3 2nd Gen'],
    ['Battery', 'Africo', 'VOLTA-S4-2NDGEN', 24640, 'each', 'Cost', '', 0, '', 'Volta - Battery Lithium Ion 14.3kW 51.2V 200Ah Stage 4 2nd Gen'],
    ['Battery', 'Africo', 'SDA10-48100', 10080, 'each', 'Cost', '', 0, '', 'Shoto - Battery Lithium Ion 5.1kW 48V 100Ah'],
    ['Battery', 'Africo', 'SHOTO-16', 22400, 'each', 'Cost', '', 0, '', 'Shoto - Battery Lithium Ion 16,07kW'],
    ['Battery', 'Africo', 'SMDSS4143', 44788.80, 'each', 'Cost', '', 0, '', 'Solar MD - Battery Lithium Ion 14.3kWh 51.2V'],
    ['Heat pump', 'ITS', 'ITS-3.6HD', 10810, 'each', 'Cost', '', 15000, 'Includes pipes, fittings and installation', 'ITS-3.6HD 3.6kW domestic heat pump'],
    ['Heat pump', 'ITS', 'ITS-4.5HDsuper', 12595, 'each', 'Cost', '', 15000, 'Includes pipes, fittings and installation', 'ITS-4.5HDsuper 4.5kW high temp domestic heat pump'],
    ['Heat pump', 'ITS', 'ITS-5.4HD', 12070, 'each', 'Cost', '', 15000, 'Includes pipes, fittings and installation', 'ITS-5.4HD 5.4kW domestic heat pump'],
    ['Heat pump', 'ITS', 'ITS-6.3HDsuper', 14233, 'each', 'Cost', '', 15000, 'Includes pipes, fittings and installation', 'ITS-6.3HDsuper 6.3kW high temp domestic heat pump'],
    ['Heat pump', 'ITS', 'ITS-7.6HD', 13750, 'each', 'Cost', '', 15000, 'Includes pipes, fittings and installation', 'ITS-7.6HD 7.6kW domestic heat pump'],
    ['Heat pump', 'ITS', 'ITS-11HD', 18895, 'each', 'Cost', '', 0, '', 'ITS-11HD 11kW heat pump 1 Phase'],
    ['Heat pump', 'ITS', 'ITS-22HD3', 28345, 'each', 'Cost', '', 0, '', 'ITS-22HD3 22kW heat pump 3 Phase'],
    ['Heat pump', 'ITS', 'ITS-50VD3pro', 88195, 'each', 'Cost', '', 0, '', 'ITS-50VD3pro 50kW heat pump 3 Phase'],
  ];
  var rows = seed.map(function (s) {
    // [category, supplier, code, cost, unit, type, markup, install, spec, description]
    return [priceId_(), s[0], s[1], s[2], s[9], s[4], s[3], s[5], s[6], s[7], s[8], 'Yes', listDate];
  });
  sheet_('Prices').getRange(sheet_('Prices').getLastRow() + 1, 1, rows.length, 13).setValues(rows);
  log_('system', 'seedSuppliers', rows.length + ' items', '', '');
  return rows.length;
}

/** Wipes Africo and ITS rows and re-seeds them from the built-in lists.
 *  Your own prices, markups and any items you added are left alone. */
function reloadSuppliers() {
  var sh = sheet_('Prices');
  var all = priceRows_();
  var kill = all.filter(function (p) {
    return p.supplier === 'Africo' || p.supplier === 'ITS';
  }).map(function (p) { return p.row; }).sort(function (a, b) { return b - a; });
  kill.forEach(function (r) { sh.deleteRow(r); });
  var n = seedSuppliers_();
  return 'Removed ' + kill.length + ', loaded ' + n + '.';
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Flagship')
    .addItem('Rebuild summary', 'rebuildSummary')
    .addItem('Rebuild worker tabs', 'rebuildWorkerTabs')
    .addItem('Repair time columns', 'fixExistingTimes')
    .addItem('Reload supplier price lists', 'reloadSuppliers')
    .addSeparator()
    .addItem('Check sheets / setup', 'setup')
    .addToUi();
}

/* ================= helpers ================= */

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) { setup(); sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }
  return sh;
}

function log_(user, action, detail, was, now) {
  try { sheet_('Log').appendRow([new Date(), user || '', action, detail || '', was || '', now || '']); }
  catch (e) {}
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Salted SHA-256, so the sheet never holds a readable password. */
function hash_(username, password) {
  var raw = 'flagship:' + String(username).toLowerCase() + ':' + String(password);
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

function dateStr_(d) {
  if (d instanceof Date) return d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate());
  return String(d);
}

function mins_(hhmm) {
  if (!hhmm) return null;
  var p = String(hhmm).split(':');
  var h = parseInt(p[0], 10), m = parseInt(p[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Splits a shift into normal and overtime.
 * Weekday: normal 07:00-17:00 less lunch. Overtime before 06:00 and
 *   after 17:00. Arriving between 06:00 and 07:00 is recorded but
 *   counts as normal — people come in early, that isn't overtime.
 * Sat/Sun: every hour is overtime. The 1.5x / 2x rate is deliberately
 *   NOT applied here. Use a formula against Day Type in the sheet,
 *   where you can see and check it.
 */
function calc_(dateStr, inStr, outStr, lunchMin) {
  if (inStr instanceof Date) inStr = pad2_(inStr.getHours()) + ':' + pad2_(inStr.getMinutes());
  if (outStr instanceof Date) outStr = pad2_(outStr.getHours()) + ':' + pad2_(outStr.getMinutes());
  var d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return null;
  var dayType = d.getDay() === 0 ? 'Sunday' : (d.getDay() === 6 ? 'Saturday' : 'Weekday');
  var a = mins_(inStr), b = mins_(outStr);
  if (a === null || b === null) return null;
  if (b < a) b += 1440;

  var lunch = (lunchMin === '' || lunchMin == null) ? LUNCH_DEFAULT : Number(lunchMin);
  if (isNaN(lunch) || lunch < 0) lunch = LUNCH_DEFAULT;

  var normal = 0, ot = 0;
  if (dayType === 'Weekday') {
    ot = ((a < OT_BEFORE) ? (OT_BEFORE - a) : 0) + ((b > DAY_END) ? (b - DAY_END) : 0);
    normal = Math.max(0, Math.min(b, DAY_END) - Math.max(a, OT_BEFORE)) - lunch;
    if (normal < 0) normal = 0;
  } else {
    ot = (b - a) - lunch;
    if (ot < 0) ot = 0;
  }
  var r2 = function (m) { return Math.round((m / 60) * 100) / 100; };
  return { day: DAYS_[d.getDay()], dayType: dayType, lunch: lunch,
           normal: r2(normal), overtime: r2(ot), total: r2(normal + ot) };
}

/** Pay cycle runs the 25th to the 24th. Named by the month it ends in. */
function cycleOf_(d) {
  var y = d.getFullYear(), m = d.getMonth();
  if (d.getDate() >= 25) { m++; if (m > 11) { m = 0; y++; } }
  return { y: y, m: m };
}
function cycleKey_(c) { return c.y + '-' + pad2_(c.m + 1); }
function cycleLabel_(y, m) {
  var sm = m - 1; if (sm < 0) sm = 11;
  return '25 ' + MONTHS_[sm] + ' - 24 ' + MONTHS_[m] + ' ' + y;
}
function isCurrentCycle_(ds) {
  var d = new Date(ds + 'T00:00:00');
  if (isNaN(d)) return false;
  return cycleKey_(cycleOf_(d)) === cycleKey_(cycleOf_(new Date()));
}

/* ================= users ================= */

function findUser_(username) {
  var sh = sheet_('Users');
  var n = sh.getLastRow() - 1;
  if (n < 1) return null;
  var rows = sh.getRange(2, 1, n, 7).getValues();
  var key = String(username).trim().toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === key) {
      return { row: i + 2, username: String(rows[i][0]), name: String(rows[i][1]),
               role: String(rows[i][2]), status: String(rows[i][3]), hash: String(rows[i][4]) };
    }
  }
  return null;
}

/** Every request goes through here. Returns the user or throws. */
function auth_(body, needRole) {
  var u = findUser_(body.user || '');
  if (!u) throw new Error('unknown user or password');
  if (u.hash !== hash_(u.username, body.pass || '')) throw new Error('unknown user or password');
  if (u.status.toLowerCase() !== 'active') throw new Error('account not approved yet');

  if (needRole) {
    var need = [].concat(needRole);
    if (need.indexOf(u.role) === -1) throw new Error('not allowed');
  }
  try { sheet_('Users').getRange(u.row, 7).setValue(new Date()); } catch (e) {}
  return u;
}

function register_(body) {
  var username = String(body.user || '').trim();
  var pass = String(body.pass || '');
  var name = String(body.name || '').trim() || username;

  if (username.length < 3) throw new Error('username must be at least 3 characters');
  if (pass.length < 4) throw new Error('password must be at least 4 characters');
  if (findUser_(username)) throw new Error('that username is taken');

  var isFirst = username.toLowerCase() === String(ADMIN_USERNAME).toLowerCase();
  var role = isFirst ? 'Admin' : '';
  var status = isFirst ? 'Active' : 'Pending';

  sheet_('Users').appendRow([username, name, role, status, hash_(username, pass), new Date(), '']);
  log_(username, 'register', name, '', status);

  return { ok: true, status: status, role: role,
           message: isFirst ? 'Admin account created. You can sign in now.'
                            : 'Account created. An admin must approve it before you can sign in.' };
}

/* ================= worker tabs and summary ================= */

/** Whatever a time cell holds, give back "HH:MM". */
function timeTxt_(v) {
  if (v instanceof Date) return pad2_(v.getHours()) + ':' + pad2_(v.getMinutes());
  return String(v || '');
}

function tabName_(worker) {
  var clean = String(worker).replace(/[\[\]\*\/\\\?:]/g, '').trim().slice(0, 90);
  return clean || 'Unnamed';
}

function workerSheet_(worker) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = tabName_(worker);
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, WORKER_COLS.length).setValues([WORKER_COLS])
      .setFontWeight('bold').setBackground('#1F4E79').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 95);
    sh.setColumnWidth(4, 170);
    log_('system', 'newTab', name, '', '');
  }
  return sh;
}

function sortWorkerTab_(sh) {
  var n = sh.getLastRow() - 1;
  if (n > 1) sh.getRange(2, 1, n, WORKER_COLS.length).sort({ column: 1, ascending: true });
}

function rebuildSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = sheet_('Timesheets');
  var sh = ss.getSheetByName('Summary') || ss.insertSheet('Summary');
  sh.clear();

  var head = ['Pay Cycle', 'Worker', 'Days', 'Normal Hours', 'Overtime Hours', 'Total Hours'];
  sh.getRange(1, 1, 1, head.length).setValues([head])
    .setFontWeight('bold').setBackground('#1F4E79').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 130);

  var n = src.getLastRow() - 1;
  if (n < 1) return 'No data yet.';

  var data = src.getRange(2, 1, n, 11).getValues();
  var bucket = {};
  data.forEach(function (r) {
    var d = (r[0] instanceof Date) ? r[0] : new Date(String(r[0]) + 'T00:00:00');
    if (isNaN(d)) return;
    var worker = String(r[3] || '').trim();
    if (!worker) return;
    var c = cycleOf_(d);
    var label = cycleLabel_(c.y, c.m);
    var k = label + '||' + worker;
    if (!bucket[k]) bucket[k] = { label: label, worker: worker, sort: c.y * 100 + c.m, days: 0, n: 0, o: 0 };
    bucket[k].days++;
    bucket[k].n += Number(r[8]) || 0;
    bucket[k].o += Number(r[9]) || 0;
  });

  var rows = Object.keys(bucket).map(function (k) { return bucket[k]; });
  rows.sort(function (a, b) {
    if (a.sort !== b.sort) return b.sort - a.sort;
    return a.worker.localeCompare(b.worker);
  });

  var out = rows.map(function (r) {
    return [r.label, r.worker, r.days, Math.round(r.n * 100) / 100,
            Math.round(r.o * 100) / 100, Math.round((r.n + r.o) * 100) / 100];
  });
  if (out.length) sh.getRange(2, 1, out.length, 6).setValues(out);
  return 'Summary rebuilt: ' + out.length + ' lines.';
}

function rebuildWorkerTabs() {
  var src = sheet_('Timesheets');
  var n = src.getLastRow() - 1;
  if (n < 1) return 'No data yet.';

  var data = src.getRange(2, 1, n, 14).getValues();
  var byWorker = {};
  data.forEach(function (r) {
    var w = String(r[3] || '').trim();
    if (!w) return;
    if (!byWorker[w]) byWorker[w] = [];
    byWorker[w].push([r[0], r[1], r[2], r[4], timeTxt_(r[5]), timeTxt_(r[6]),
                      r[7], r[8], r[9], r[10], r[11], r[12], r[13]]);
  });

  var count = 0;
  Object.keys(byWorker).forEach(function (w) {
    var sh = workerSheet_(w);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, WORKER_COLS.length).clearContent();
    sh.getRange(2, 5, byWorker[w].length, 2).setNumberFormat('@');
    sh.getRange(2, 1, byWorker[w].length, WORKER_COLS.length).setValues(byWorker[w]);
    sortWorkerTab_(sh);
    count++;
  });
  rebuildSummary();
  return 'Rebuilt ' + count + ' worker tabs.';
}

/* ================= timesheet writes ================= */

/** Finds an existing row for this worker + date on the master sheet. */
function findEntry_(worker, ds) {
  var sh = sheet_('Timesheets');
  var n = sh.getLastRow() - 1;
  if (n < 1) return null;
  var rows = sh.getRange(2, 1, n, 4).getValues();
  var w = String(worker).trim().toLowerCase();
  for (var i = rows.length - 1; i >= 0; i--) {
    if (dateStr_(rows[i][0]) === ds && String(rows[i][3]).trim().toLowerCase() === w) return i + 2;
  }
  return null;
}

/**
 * Writes one day. Replaces an existing row for the same worker + date
 * rather than adding a second one, and logs what changed so an edit
 * can always be traced back.
 */
function writeEntry_(user, r) {
  var c = calc_(r.date, r.timeIn, r.timeOut, r.lunch);
  if (!c) return { skipped: true };

  var worker = String(r.worker || '').trim();
  if (!worker) return { skipped: true };

  var sh = sheet_('Timesheets');
  // times go in as text — as real values Sheets renders them against
  // its 1899 epoch, which looks like "12/30/1899 7:00:00"
  var row = [r.date, c.day, c.dayType, worker, r.job || '',
             "'" + r.timeIn, "'" + r.timeOut, c.lunch, c.normal, c.overtime, c.total,
             r.note || '', user.username, new Date()];

  var at = findEntry_(worker, r.date);
  if (at) {
    var old = sh.getRange(at, 1, 1, 14).getValues()[0];
    var wasTxt = old[5] + '-' + old[6] + '  ' + old[8] + 'n / ' + old[9] + 'ot' +
                 (old[4] ? '  ' + old[4] : '') + (old[11] ? '  (' + old[11] + ')' : '');
    var nowTxt = r.timeIn + '-' + r.timeOut + '  ' + c.normal + 'n / ' + c.overtime + 'ot' +
                 (r.job ? '  ' + r.job : '') + (r.note ? '  (' + r.note + ')' : '');
    if (wasTxt !== nowTxt) {
      sh.getRange(at, 1, 1, 14).setValues([row]);
      log_(user.username, 'edit', worker + ' ' + r.date, wasTxt, nowTxt);
      return { updated: true };
    }
    return { unchanged: true };
  }

  sh.appendRow(row);
  log_(user.username, 'add', worker + ' ' + r.date, '',
       r.timeIn + '-' + r.timeOut + '  ' + c.normal + 'n / ' + c.overtime + 'ot');
  return { added: true };
}

/* ================= prices ================= */

function priceRows_() {
  var sh = sheet_('Prices');
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var vals = sh.getRange(2, 1, n, 13).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (!r[0] && !r[4]) continue;                 // blank row
    out.push({
      row: i + 2,
      id: String(r[0]),
      category: String(r[1] || ''),
      supplier: String(r[2] || ''),
      code: String(r[3] || ''),
      description: String(r[4] || ''),
      unit: String(r[5] || ''),
      cost: Number(r[6]) || 0,
      type: String(r[7] || 'Cost'),
      markup: (r[8] === '' || r[8] == null) ? '' : Number(r[8]),
      install: Number(r[9]) || 0,
      spec: String(r[10] || ''),
      active: String(r[11]).toLowerCase() !== 'no',
      updated: r[12] ? dateStr_(r[12]) : ''
    });
  }
  return out;
}

function findPrice_(id) {
  var all = priceRows_();
  for (var i = 0; i < all.length; i++) if (all[i].id === String(id)) return all[i];
  return null;
}

/** Sell price for one item at a given markup override. */
function sellPrice_(item, overrideMarkup) {
  if (item.type === 'Sell') return item.cost;      // already your price
  var m = (overrideMarkup === '' || overrideMarkup == null)
    ? (item.markup === '' ? DEFAULT_MARKUP : item.markup)
    : Number(overrideMarkup);
  if (isNaN(m)) m = DEFAULT_MARKUP;
  return item.cost * (1 + m / 100);
}

function priceId_() {
  return 'P' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100);
}

/* ================= web app ================= */

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'ping') return out_({ ok: true, pong: true });

    var body = { user: p.user, pass: p.pass };

    if (p.action === 'me') {
      var u = auth_(body);
      return out_({ ok: true, user: { username: u.username, name: u.name, role: u.role } });
    }

    if (p.action === 'workers') {
      auth_(body);
      var sh = sheet_('Workers');
      var n = sh.getLastRow() - 1;
      var list = [];
      if (n > 0) sh.getRange(2, 1, n, 2).getValues().forEach(function (r) {
        if (r[0] && String(r[1]).toLowerCase() !== 'no') list.push(String(r[0]));
      });
      return out_({ ok: true, workers: list });
    }

    if (p.action === 'entries') {
      var me = auth_(body);
      var who = p.worker || me.name;
      if (me.role === 'Worker' && String(who).toLowerCase() !== String(me.name).toLowerCase()) {
        return out_({ ok: false, error: 'not allowed' });
      }
      var sh2 = sheet_('Timesheets');
      var n2 = sh2.getLastRow() - 1;
      var rows = [];
      if (n2 > 0) {
        sh2.getRange(2, 1, n2, 12).getValues().forEach(function (r) {
          if (String(r[3]).trim().toLowerCase() !== String(who).trim().toLowerCase()) return;
          var ds = dateStr_(r[0]);
          if (p.cycle && cycleKey_(cycleOf_(new Date(ds + 'T00:00:00'))) !== p.cycle) return;
          rows.push({ date: ds, job: String(r[4] || ''), ti: String(r[5]), to: String(r[6]),
                      lu: r[7], normal: r[8], ot: r[9], note: String(r[11] || '') });
        });
      }
      return out_({ ok: true, entries: rows });
    }

    if (p.action === 'prices') {
      auth_(body, ['Admin', 'Technician']);
      var all = priceRows_();
      if (p.category) all = all.filter(function (x) { return x.category === p.category; });
      // Technicians see sell prices only — cost and markup stay with the Admin
      var me3 = findUser_(body.user);
      var hideCost = me3 && me3.role !== 'Admin';
      var list3 = all.map(function (x) {
        var o = { id: x.id, category: x.category, supplier: x.supplier, code: x.code,
                  description: x.description, unit: x.unit, install: x.install,
                  spec: x.spec, active: x.active, updated: x.updated,
                  sell: Math.round(sellPrice_(x, '') * 100) / 100 };
        if (!hideCost) { o.cost = x.cost; o.type = x.type; o.markup = x.markup; }
        return o;
      });
      return out_({ ok: true, prices: list3, categories: CATEGORIES,
                    types: PRICE_TYPES, defaultMarkup: DEFAULT_MARKUP });
    }

    if (p.action === 'users') {
      auth_(body, 'Admin');
      var us = sheet_('Users');
      var un = us.getLastRow() - 1;
      var list2 = [];
      if (un > 0) us.getRange(2, 1, un, 7).getValues().forEach(function (r) {
        if (!r[0]) return;
        list2.push({ username: String(r[0]), name: String(r[1]), role: String(r[2]),
                     status: String(r[3]), lastSeen: r[6] ? dateStr_(r[6]) : '' });
      });
      return out_({ ok: true, users: list2, roles: ROLES });
    }

    return out_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return out_({ ok: false, error: 'bad json' }); }

  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (err) { return out_({ ok: false, error: 'busy, try again' }); }

  try {
    if (body.action === 'register') return out_(register_(body));

    if (body.action === 'login') {
      var u = auth_(body);
      log_(u.username, 'login', '', '', '');
      return out_({ ok: true, user: { username: u.username, name: u.name, role: u.role } });
    }

    if (body.action === 'addWorker') {
      var me = auth_(body, ['Admin', 'Technician']);
      var name = String(body.name || '').trim();
      if (!name) return out_({ ok: false, error: 'no name' });
      var w = sheet_('Workers');
      var n = w.getLastRow() - 1;
      var have = n > 0 ? w.getRange(2, 1, n, 1).getValues().map(function (r) {
        return String(r[0]).trim().toLowerCase();
      }) : [];
      if (have.indexOf(name.toLowerCase()) === -1) {
        w.appendRow([name, 'Yes', new Date()]);
        log_(me.username, 'addWorker', name, '', '');
      }
      return out_({ ok: true, name: name });
    }

    if (body.action === 'timesheets') {
      var user = auth_(body);
      var rows = body.rows || [];
      if (!rows.length) return out_({ ok: false, error: 'no rows' });

      var added = 0, updated = 0, skipped = 0, blocked = 0, closed = 0;

      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];

        // Workers may only file their own hours
        if (user.role === 'Worker' &&
            String(r.worker).trim().toLowerCase() !== String(user.name).trim().toLowerCase()) {
          blocked++; continue;
        }
        // Only the open cycle can be written. Past cycles are closed to
        // everyone except an Admin, who can still fix a mistake.
        if (!isCurrentCycle_(r.date) && user.role !== 'Admin') { closed++; continue; }

        var res = writeEntry_(user, r);
        if (res.added) added++;
        else if (res.updated) updated++;
        else if (res.skipped) skipped++;
      }

      if (added || updated) rebuildWorkerTabs();

      return out_({ ok: true, written: added, updated: updated,
                    skipped: skipped, blocked: blocked, closed: closed });
    }

    if (body.action === 'savePrice') {
      var pu = auth_(body, 'Admin');
      var it = body.item || {};
      var desc = String(it.description || '').trim();
      if (!desc) return out_({ ok: false, error: 'a description is required' });
      if (it.category && CATEGORIES.indexOf(it.category) === -1) {
        return out_({ ok: false, error: 'unknown category' });
      }
      var type = (it.type === 'Sell') ? 'Sell' : 'Cost';
      var cost = Number(it.cost); if (isNaN(cost) || cost < 0) cost = 0;
      var markup = (it.markup === '' || it.markup == null) ? '' : Number(it.markup);
      if (markup !== '' && (isNaN(markup) || markup < 0)) markup = '';
      var install = Number(it.install); if (isNaN(install) || install < 0) install = 0;

      var sh = sheet_('Prices');
      var row = [it.id || priceId_(), it.category || 'Other', it.supplier || '',
                 it.code || '', desc, it.unit || '', cost, type, markup, install,
                 it.spec || '', it.active === false ? 'No' : 'Yes', new Date()];

      var ex = it.id ? findPrice_(it.id) : null;
      if (ex) {
        var was = ex.description + ' @ ' + ex.cost + ' ' + ex.type +
                  (ex.markup === '' ? '' : ' +' + ex.markup + '%');
        var now = desc + ' @ ' + cost + ' ' + type +
                  (markup === '' ? '' : ' +' + markup + '%');
        sh.getRange(ex.row, 1, 1, 13).setValues([row]);
        if (was !== now) log_(pu.username, 'price', desc, was, now);
        return out_({ ok: true, id: ex.id, updated: true });
      }
      sh.appendRow(row);
      log_(pu.username, 'price', desc, '', desc + ' @ ' + cost + ' ' + type);
      return out_({ ok: true, id: row[0], added: true });
    }

    if (body.action === 'deletePrice') {
      var du = auth_(body, 'Admin');
      var t4 = findPrice_(body.id || '');
      if (!t4) return out_({ ok: false, error: 'no such item' });
      sheet_('Prices').deleteRow(t4.row);
      log_(du.username, 'deletePrice', t4.description, t4.cost + ' ' + t4.type, 'deleted');
      return out_({ ok: true });
    }

    /* ---- admin only ---- */

    if (body.action === 'setUser') {
      var admin = auth_(body, 'Admin');
      var t = findUser_(body.target || '');
      if (!t) return out_({ ok: false, error: 'no such user' });
      if (t.username.toLowerCase() === admin.username.toLowerCase() &&
          body.role && body.role !== 'Admin') {
        return out_({ ok: false, error: 'you cannot remove your own admin role' });
      }
      var sh = sheet_('Users');
      var was = t.role + ' / ' + t.status;
      if (body.role !== undefined && body.role !== null) {
        if (body.role && ROLES.indexOf(body.role) === -1) return out_({ ok: false, error: 'bad role' });
        sh.getRange(t.row, 3).setValue(body.role);
      }
      if (body.status) sh.getRange(t.row, 4).setValue(body.status);
      var now = (body.role !== undefined && body.role !== null ? body.role : t.role) +
                ' / ' + (body.status || t.status);
      log_(admin.username, 'setUser', t.username, was, now);
      return out_({ ok: true });
    }

    if (body.action === 'deleteUser') {
      var admin2 = auth_(body, 'Admin');
      var t2 = findUser_(body.target || '');
      if (!t2) return out_({ ok: false, error: 'no such user' });
      if (t2.username.toLowerCase() === admin2.username.toLowerCase()) {
        return out_({ ok: false, error: 'you cannot delete yourself' });
      }
      sheet_('Users').deleteRow(t2.row);
      log_(admin2.username, 'deleteUser', t2.username, t2.role + ' / ' + t2.status, 'deleted');
      return out_({ ok: true });
    }

    if (body.action === 'resetPassword') {
      var admin3 = auth_(body, 'Admin');
      var t3 = findUser_(body.target || '');
      if (!t3) return out_({ ok: false, error: 'no such user' });
      var np = String(body.newPass || '');
      if (np.length < 4) return out_({ ok: false, error: 'password must be at least 4 characters' });
      sheet_('Users').getRange(t3.row, 5).setValue(hash_(t3.username, np));
      log_(admin3.username, 'resetPassword', t3.username, '', '');
      return out_({ ok: true });
    }

    if (body.action === 'changePassword') {
      var me2 = auth_(body);
      var np2 = String(body.newPass || '');
      if (np2.length < 4) return out_({ ok: false, error: 'password must be at least 4 characters' });
      sheet_('Users').getRange(me2.row, 5).setValue(hash_(me2.username, np2));
      log_(me2.username, 'changePassword', '', '', '');
      return out_({ ok: true });
    }

    return out_({ ok: false, error: 'unknown action' });
  } catch (err) {
    log_(body && body.user, 'error', String(body && body.action), '', String(err.message || err));
    return out_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}
