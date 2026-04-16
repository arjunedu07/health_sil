(function () {
  /* ============================================================
     Billing Dashboard — JS  (IIFE / shadow-DOM safe)
     Works on any Frappe Page — mirrors the pattern of the old
     bdbLoad script that was confirmed working.

     Doctypes & date fields (confirmed from JSON files):
       Registration Fee       → creation (Datetime), NOT submittable (no docstatus)
       Sales Invoice          → posting_date (Date),  docstatus = 1
       Laboratory Bill        → date_and_time (Datetime), docstatus = 1
       Pharmacy Billing       → date_and_time (Datetime), docstatus = 1
       Clinical Procedure Bill→ date_and_time (Datetime), docstatus = 1
  ============================================================ */

  /* Always start with TODAY — never restore a stale date from a previous session */
  var _today = new Date().toISOString().split("T")[0];

  /* ── Find the shadow root (or document) containing #bd-date-picker ── */
  function findRoot(retries, onFound) {
    if (document.getElementById("bd-date-picker")) { onFound(document); return; }
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      try {
        var sr = all[i].shadowRoot;
        if (sr && sr.getElementById("bd-date-picker")) { onFound(sr); return; }
      } catch (e) {}
    }
    if (retries > 0) {
      setTimeout(function () { findRoot(retries - 1, onFound); }, 300);
    } else {
      console.error("BD: #bd-date-picker not found after all retries");
    }
  }

  findRoot(20, function (ROOT) {

    function $id(id) { return ROOT.getElementById(id); }

    /* ── Formatter ── */
    function fmt(n) {
      return "\u20B9 " + Number(n || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2, maximumFractionDigits: 2
      });
    }

    /* ── Card helper: reset to loading state ── */
    var TX_KEYS = ["registration", "consultation", "lab", "pharmacy", "clinical"];

    function resetCards() {
      TX_KEYS.forEach(function (k) {
        var cnt  = $id("tx-" + k + "-count");
        var amt  = $id("tx-" + k + "-amount");
        var bdg  = $id("tx-" + k + "-badge");
        var mop  = $id("tx-" + k + "-mop");
        if (cnt) cnt.textContent  = "\u2014";
        if (amt) amt.textContent  = "\u20B9\u2014";
        if (bdg) { bdg.textContent = "Loading\u2026"; bdg.className = "bd-tx-badge"; }
        if (mop) mop.textContent  = "\u2014";
      });
      var tc = $id("tx-total-count"),  ta = $id("tx-total-amount");
      if (tc) tc.textContent = "\u2014";
      if (ta) ta.textContent = "\u20B9\u2014";
      var sp = $id("bd-spinner"), rc = $id("bd-report-content");
      if (sp) sp.style.display = "flex";
      if (rc) rc.innerHTML = "";
    }

    /* ── Update a single transaction card ──
       rows     : raw array of records for this type
       mopField : field name holding MOP value (null = default 'Cash')
    ─────────────────────────────────────────── */
    function updateCard(key, count, amount, rows, mopField) {
      var cnt = $id("tx-" + key + "-count");
      var amt = $id("tx-" + key + "-amount");
      var bdg = $id("tx-" + key + "-badge");
      var mp  = $id("tx-" + key + "-mop");

      if (cnt) cnt.textContent = count;
      if (amt) amt.textContent = fmt(amount);

      /* Badge */
      if (bdg) {
        bdg.className = "bd-tx-badge";
        if (count === 0) {
          bdg.textContent = "No transactions";
          bdg.className  += " badge-idle";
        } else if (count < 5) {
          bdg.textContent = count + " txns";
          bdg.className  += " badge-warning";
        } else {
          bdg.textContent = count + " txns";
          bdg.className  += " badge-success";
        }
      }

      /* MOP breakdown in footer */
      if (mp) {
        if (!rows || !rows.length) {
          mp.textContent = "\u2014";
        } else {
          /* Build per-MOP totals */
          var mopTotals = {};
          rows.forEach(function (r) {
            var m = (mopField && r[mopField]) ? r[mopField] : "Cash";
            if (!mopTotals[m]) mopTotals[m] = { count: 0, amount: 0 };
            mopTotals[m].count  += 1;
            mopTotals[m].amount += flt(
              r.rounded_total_amount || r.total_amount ||
              r.registration_fee     || r.grand_total
            );
          });

          var mopKeys = Object.keys(mopTotals);

          if (mopKeys.length === 1) {
            /* Single MOP — compact single-line display */
            var m0 = mopKeys[0];
            mp.innerHTML =
              '<span class="bd-mop-single">' + m0 + '</span>';
          } else {
            /* Multiple MOPs — show each with amount */
            var html = '<div class="bd-mop-breakdown">';
            mopKeys.sort().forEach(function (m) {
              var d = mopTotals[m];
              html +=
                '<div class="bd-mop-row">' +
                  '<span class="bd-mop-name">' + m + ' <span class="bd-mop-cnt">(' + d.count + ')</span></span>' +
                  '<span class="bd-mop-amt">' + fmt(d.amount) + '</span>' +
                '</div>';
            });
            html += '</div>';
            mp.innerHTML = html;
          }
        }
      }
    }

    /* ── Dominant MOP helper ── */
    function getDominantMOP(list, field) {
      if (!list || !list.length) return "\u2014";
      var freq = {};
      list.forEach(function (r) {
        var v = (r[field] || "Cash");
        freq[v] = (freq[v] || 0) + 1;
      });
      var sorted = Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a]; });
      if (sorted.length === 1) return sorted[0];
      return (freq[sorted[0]] !== freq[sorted[1]]) ? sorted[0] : "Mixed";
    }

    /* ── flt ── */
    function flt(v) { return parseFloat(v) || 0; }

    /* ── formatCurrency ── */
    function formatCurrency(n) {
      return Number(n || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2, maximumFractionDigits: 2
      });
    }

    /* ── Render the detail breakdown table ── */
    function renderDetailTable(allData, date) {
      var rc = $id("bd-report-content");
      if (!rc) return;

      /* Flatten all rows into one list */
      var TYPE_META = {
        registration: { label: "Patient Registration", dotClass: "type-dot-reg",      mopField: null                   },
        consultation: { label: "Consultation",         dotClass: "type-dot-consult",  mopField: "mode_of_payment"      },
        lab:          { label: "Laboratory",           dotClass: "type-dot-lab",      mopField: "custom_mode_of_payment"},
        pharmacy:     { label: "Pharmacy",             dotClass: "type-dot-pharmacy", mopField: "custom_mode_of_payment"},
        clinical:     { label: "Clinical Procedure",   dotClass: "type-dot-clinical", mopField: "custom_mode_of_payment"}
      };

      var allRows = [];
      TX_KEYS.forEach(function (key) {
        var meta = TYPE_META[key];
        var rows = allData[key] || [];
        rows.forEach(function (row) {
          var mop = meta.mopField
            ? (row[meta.mopField] || "Cash")
            : "Cash";
          var amount = flt(row.rounded_total_amount || row.total_amount || row.registration_fee || row.grand_total);
          allRows.push({ type: meta.label, dotClass: meta.dotClass, mop: mop, amount: amount });
        });
      });

      if (!allRows.length) {
        rc.innerHTML =
          '<div style="text-align:center;padding:40px;color:#718096;">' +
          '<div style="font-size:40px;margin-bottom:12px;">\uD83D\uDCCB</div>' +
          '<div style="font-weight:600;">No transactions on ' + date + '</div></div>';
        return;
      }

      /* Group by Type → MOP */
      var grouped = {};
      allRows.forEach(function (row) {
        if (!grouped[row.type]) grouped[row.type] = { _dot: row.dotClass };
        var bucket = grouped[row.type];
        if (!bucket[row.mop]) bucket[row.mop] = { count: 0, amount: 0 };
        bucket[row.mop].count  += 1;
        bucket[row.mop].amount += row.amount;
      });

      var html =
        '<table class="bd-dept-table"><thead><tr>' +
        '<th>Transaction Type</th><th>Mode of Payment</th>' +
        '<th class="td-count" style="text-align:center">Count</th>' +
        '<th style="text-align:right">Amount (\u20B9)</th>' +
        '</tr></thead><tbody>';

      var grandTotal = 0, grandCount = 0;

      Object.keys(grouped).forEach(function (type) {
        var bucket    = grouped[type];
        var dotClass  = bucket._dot;
        var typeTotal = 0, typeCount = 0, first = true;

        Object.keys(bucket).forEach(function (mop) {
          if (mop === "_dot") return;
          var data = bucket[mop];
          typeTotal  += data.amount; typeCount  += data.count;
          grandTotal += data.amount; grandCount += data.count;
          html +=
            '<tr><td class="td-type">' +
            (first
              ? '<span class="type-dot ' + dotClass + '"></span>' + type
              : '') +
            '</td>' +
            '<td class="td-mop">' + mop + '</td>' +
            '<td class="td-count">' + data.count + '</td>' +
            '<td class="td-amount">\u20B9 ' + formatCurrency(data.amount) + '</td></tr>';
          first = false;
        });

        html +=
          '<tr style="background:#f0f4f8;">' +
          '<td colspan="2" style="font-weight:700;color:#4a5568;font-size:12px;padding-left:28px;">' +
          'Subtotal \u2014 ' + type + '</td>' +
          '<td class="td-count" style="font-weight:700">' + typeCount + '</td>' +
          '<td class="td-amount" style="font-weight:700">\u20B9 ' + formatCurrency(typeTotal) + '</td></tr>';
      });

      var GT_CELL = 'background-color:#1f272e !important;color:#ffffff !important;padding:12px 13px;font-weight:800;border:none;';
      html +=
        '<tr>' +
        '<td colspan="2" style="' + GT_CELL + 'font-size:13px;">Grand Total</td>' +
        '<td style="' + GT_CELL + 'text-align:center;">' + grandCount + '</td>' +
        '<td style="' + GT_CELL + 'text-align:right;font-size:14px;">' +
        '\u20B9 ' + formatCurrency(grandTotal) + '</td></tr>' +
        '</tbody></table>';

      rc.innerHTML = html;
    }

    /* ==========================================================
       FETCHERS — one per transaction type
       All use frappe.call callback style (confirmed working pattern)
    ========================================================== */

    /* 1. Registration Fee ─────────────────────────────────────
       - NOT submittable → NO docstatus filter
       - No posting_date → filter by `creation` (full-day range)
       - Fields: territory, registration_fee
    ─────────────────────────────────────────────────────────── */
    function fetchRegistration(date, done) {
      var ds = date + " 00:00:00", de = date + " 23:59:59";
      frappe.call({
        method: "frappe.client.get_list",
        args: {
          doctype:           "Registration Fee",
          filters:           [
            ["creation", ">=", ds],
            ["creation", "<=", de]
          ],
          fields:            ["name", "territory", "registration_fee", "creation"],
          limit_page_length: 500,
          order_by:          "creation asc"
        },
        callback: function (r) { done((r && r.message) ? r.message : []); },
        error:    function (e) { console.warn("BD | Registration Fee fetch failed:", e); done([]); }
      });
    }

    /* 2. Consultation (Sales Invoice) ─────────────────────────
       - Has posting_date + docstatus
       - Filter on child table (Sales Invoice Item) to only include
         invoices whose item_code = "Consultation Fee".
         Sales Invoice is shared across Registration, Lab, Medications
         and Consultation — the item filter isolates consultation only.
       - MOP: default Cash (not available as a direct header field)
    ─────────────────────────────────────────────────────────── */
    function fetchConsultation(date, done) {
      frappe.call({
        method: "frappe.client.get_list",
        args: {
          doctype:           "Sales Invoice",
          filters:           [
            ["posting_date",              "=",  date],
            ["docstatus",                 "=",  1],
            ["Sales Invoice Item", "item_code", "=", "Consultation Fee"]
          ],
          fields:            ["name", "customer_name", "grand_total"],
          limit_page_length: 500,
          order_by:          "posting_date asc"
        },
        callback: function (r) { done((r && r.message) ? r.message : []); },
        error:    function (e) { console.warn("BD | Sales Invoice fetch failed:", e); done([]); }
      });
    }

    /* 3. Laboratory Bill ──────────────────────────────────────
       - Submittable → docstatus = 1
       - Date: date_and_time (Datetime) — confirmed from doctype JSON
       - MOP: custom_mode_of_payment
    ─────────────────────────────────────────────────────────── */
    function fetchLaboratory(date, done) {
      var ds = date + " 00:00:00", de = date + " 23:59:59";
      frappe.call({
        method: "frappe.client.get_list",
        args: {
          doctype:           "Laboratory Bill",
          filters:           [
            ["date_and_time", ">=", ds],
            ["date_and_time", "<=", de],
            ["docstatus",     "=",  1]
          ],
          fields:            ["name", "patient_name", "total_amount",
                              "rounded_total_amount", "custom_mode_of_payment",
                              "department", "date_and_time"],
          limit_page_length: 500,
          order_by:          "date_and_time asc"
        },
        callback: function (r) { done((r && r.message) ? r.message : []); },
        error:    function (e) { console.warn("BD | Laboratory Bill fetch failed:", e); done([]); }
      });
    }

    /* 4. Pharmacy Billing ─────────────────────────────────────
       - Submittable → docstatus = 1
       - Date: date_and_time (Datetime)
       - MOP: custom_mode_of_payment
    ─────────────────────────────────────────────────────────── */
    function fetchPharmacy(date, done) {
      var ds = date + " 00:00:00", de = date + " 23:59:59";
      frappe.call({
        method: "frappe.client.get_list",
        args: {
          doctype:           "Pharmacy Billing",
          filters:           [
            ["date_and_time", ">=", ds],
            ["date_and_time", "<=", de],
            ["docstatus",     "=",  1]
          ],
          fields:            ["name", "patient_name", "total_amount",
                              "rounded_total_amount", "custom_mode_of_payment",
                              "department", "date_and_time"],
          limit_page_length: 500,
          order_by:          "date_and_time asc"
        },
        callback: function (r) { done((r && r.message) ? r.message : []); },
        error:    function (e) { console.warn("BD | Pharmacy Billing fetch failed:", e); done([]); }
      });
    }

    /* 5. Clinical Procedure Bill ──────────────────────────────
       - Submittable → docstatus = 1
       - Date: date_and_time (Datetime)
       - MOP: custom_mode_of_payment
    ─────────────────────────────────────────────────────────── */
    function fetchClinical(date, done) {
      var ds = date + " 00:00:00", de = date + " 23:59:59";
      frappe.call({
        method: "frappe.client.get_list",
        args: {
          doctype:           "Clinical Procedure Bill",
          filters:           [
            ["date_and_time", ">=", ds],
            ["date_and_time", "<=", de],
            ["docstatus",     "=",  1]
          ],
          fields:            ["name", "patient_name", "total_amount",
                              "rounded_total_amount", "custom_mode_of_payment",
                              "department", "date_and_time"],
          limit_page_length: 500,
          order_by:          "date_and_time asc"
        },
        callback: function (r) { done((r && r.message) ? r.message : []); },
        error:    function (e) { console.warn("BD | Clinical Procedure Bill fetch failed:", e); done([]); }
      });
    }

    /* ==========================================================
       MAIN LOAD — waits for all 5 callbacks then renders
    ========================================================== */
    function loadDashboard() {
      var dEl  = $id("bd-date-picker");
      var date = dEl ? dEl.value : "";
      if (!date) { frappe && frappe.msgprint ? frappe.msgprint("Please select a date.") : alert("Please select a date."); return; }

      resetCards();

      console.log("BD | Loading for date:", date);

      /* Track completion of all 5 fetchers */
      var pending = 5;
      var allData = { registration: [], consultation: [], lab: [], pharmacy: [], clinical: [] };

      function oneDone(key, rows) {
        allData[key] = rows || [];
        console.log("BD |", key, "→", allData[key].length, "records");
        pending--;
        if (pending > 0) return;   /* wait for others */

        /* ── All data received — compute totals ── */
        var grandCount  = 0;
        var grandAmount = 0;

        /* Registration Fee — no MOP field (default Cash) */
        var regRows   = allData.registration;
        var regCount  = regRows.length;
        var regAmount = regRows.reduce(function (s, r) { return s + flt(r.registration_fee); }, 0);
        updateCard("registration", regCount, regAmount, regRows, null);
        grandCount  += regCount;
        grandAmount += regAmount;

        /* Consultation — mode_of_payment not fetched (child table), default Cash */
        var conRows   = allData.consultation;
        var conCount  = conRows.length;
        var conAmount = conRows.reduce(function (s, r) { return s + flt(r.grand_total); }, 0);
        updateCard("consultation", conCount, conAmount, conRows, null);
        grandCount  += conCount;
        grandAmount += conAmount;

        /* Laboratory — MOP in custom_mode_of_payment */
        var labRows   = allData.lab;
        var labCount  = labRows.length;
        var labAmount = labRows.reduce(function (s, r) { return s + flt(r.rounded_total_amount || r.total_amount); }, 0);
        updateCard("lab", labCount, labAmount, labRows, "custom_mode_of_payment");
        grandCount  += labCount;
        grandAmount += labAmount;

        /* Pharmacy — MOP in custom_mode_of_payment */
        var phRows   = allData.pharmacy;
        var phCount  = phRows.length;
        var phAmount = phRows.reduce(function (s, r) { return s + flt(r.rounded_total_amount || r.total_amount); }, 0);
        updateCard("pharmacy", phCount, phAmount, phRows, "custom_mode_of_payment");
        grandCount  += phCount;
        grandAmount += phAmount;

        /* Clinical — MOP in custom_mode_of_payment */
        var cpRows   = allData.clinical;
        var cpCount  = cpRows.length;
        var cpAmount = cpRows.reduce(function (s, r) { return s + flt(r.rounded_total_amount || r.total_amount); }, 0);
        updateCard("clinical", cpCount, cpAmount, cpRows, "custom_mode_of_payment");
        grandCount  += cpCount;
        grandAmount += cpAmount;

        /* Grand Total box */
        var tc = $id("tx-total-count"),  ta = $id("tx-total-amount");
        if (tc) tc.textContent = grandCount;
        if (ta) ta.textContent = fmt(grandAmount);

        /* ── Grand Total MOP breakdown ──
           Aggregate across all 5 types using the same MOP field as each card.
           Registration = Cash, Consultation = Cash (no MOP field available),
           Lab/Pharmacy/Clinical = custom_mode_of_payment
        ─────────────────────────────────────────────────────────── */
        var grandMOP = {};
        function _addToGrandMOP(rows, mopField) {
          rows.forEach(function (r) {
            var m = (mopField && r[mopField]) ? r[mopField] : "Cash";
            var a = flt(r.rounded_total_amount || r.total_amount || r.registration_fee || r.grand_total);
            if (!grandMOP[m]) grandMOP[m] = { count: 0, amount: 0 };
            grandMOP[m].count  += 1;
            grandMOP[m].amount += a;
          });
        }
        _addToGrandMOP(regRows, null);
        _addToGrandMOP(conRows, null);
        _addToGrandMOP(labRows, "custom_mode_of_payment");
        _addToGrandMOP(phRows,  "custom_mode_of_payment");
        _addToGrandMOP(cpRows,  "custom_mode_of_payment");

        var tm = $id("tx-total-mop");
        if (tm) {
          var mopKeys = Object.keys(grandMOP).sort();
          if (!mopKeys.length) {
            tm.innerHTML = '<span class="bd-tx-total-note">All submitted transactions</span>';
          } else {
            /* Palette for bars — cycles if more than 6 MOPs */
            var BAR_COLORS = ["#2490ef","#28a745","#fd7e14","#e83e8c","#6f42c1","#20c997"];
            var h = '<div class="bd-grand-mop-breakdown">' +
                    '<div class="bd-grand-mop-label">By Mode of Payment</div>';

            mopKeys.forEach(function (m, idx) {
              var d   = grandMOP[m];
              var pct = grandAmount > 0 ? Math.round((d.amount / grandAmount) * 100) : 0;
              var color = BAR_COLORS[idx % BAR_COLORS.length];
              h += '<div class="bd-grand-mop-item">' +
                     '<div class="bd-grand-mop-row">' +
                       '<span class="bd-grand-mop-name">' + m +
                         ' <span class="bd-grand-mop-cnt">(' + d.count + ')</span>' +
                       '</span>' +
                       '<span class="bd-grand-mop-amt">' + fmt(d.amount) + '</span>' +
                     '</div>' +
                     '<div class="bd-grand-mop-bar-track">' +
                       '<div class="bd-grand-mop-bar-fill" style="width:' + pct + '%;background:' + color + '" data-pct="' + pct + '"></div>' +
                     '</div>' +
                     '<div class="bd-grand-mop-pct">' + pct + '% of total</div>' +
                   '</div>';
            });

            /* Avg per transaction */
            var avg = grandCount > 0 ? (grandAmount / grandCount) : 0;
            h += '</div>' +
                 '<div class="bd-grand-stat-row">' +
                   '<span class="bd-grand-stat-label">Avg. per transaction</span>' +
                   '<span class="bd-grand-stat-value">' + fmt(avg) + '</span>' +
                 '</div>';

            tm.innerHTML = h;

            /* Animate bars: set width from 0 → target after paint */
            requestAnimationFrame(function () {
              var fills = tm.querySelectorAll(".bd-grand-mop-bar-fill");
              fills.forEach(function (el) {
                var pct = el.getAttribute("data-pct") || "0";
                el.style.width = pct + "%";
              });
            });
          }
        }

        /* Detail table */
        renderDetailTable(allData, date);

        /* Hide spinner */
        var sp = $id("bd-spinner");
        if (sp) sp.style.display = "none";
      }

      /* Fire all 5 fetchers in parallel */
      fetchRegistration(date, function (rows) { oneDone("registration", rows); });
      fetchConsultation(date, function (rows) { oneDone("consultation",  rows); });
      fetchLaboratory(date,   function (rows) { oneDone("lab",           rows); });
      fetchPharmacy(date,     function (rows) { oneDone("pharmacy",      rows); });
      fetchClinical(date,     function (rows) { oneDone("clinical",      rows); });
    }

    /* ── Expose globally so onclick= attributes in HTML work ── */
    window.bd_loadDashboard = loadDashboard;

    /*
     * bd_navigate(doctype)
     * Opens the doctype in Frappe REPORT view (tabular) with:
     *   - The correct date filter for that doctype
     *   - docstatus filter where applicable
     *
     * Date-field mapping (confirmed from doctype JSONs):
     *   Registration Fee       → creation  (no docstatus — not submittable)
     *   Sales Invoice          → posting_date + docstatus=1
     *   Laboratory Bill        → date_and_time + docstatus=1
     *   Pharmacy Billing       → date_and_time + docstatus=1
     *   Clinical Procedure Bill→ date_and_time + docstatus=1
     */
    window.bd_navigate = function (doctype) {
      var dEl  = $id("bd-date-picker");
      var date = dEl ? dEl.value : "";
      if (!date) {
        frappe.msgprint ? frappe.msgprint("Please select a date first.") : alert("Please select a date first.");
        return;
      }

      var ds = date + " 00:00:00";
      var de = date + " 23:59:59";

      if (doctype === "Registration Fee") {
        /* NOT submittable — no docstatus. Date stored in `creation` */
        frappe.route_options = {
          "creation": ["Between", [ds, de]]
        };

      } else if (doctype === "Sales Invoice") {
        /* posting_date is a Date field (not Datetime), docstatus=1
           item_code filter ensures only Consultation Fee invoices are shown */
        frappe.route_options = {
          "posting_date": date,
          "docstatus":    1,
          "item_code":    "Consultation Fee"
        };

      } else {
        /* Laboratory Bill, Pharmacy Billing, Clinical Procedure Bill
           Date stored in `date_and_time` (Datetime), docstatus=1 */
        frappe.route_options = {
          "date_and_time": ["Between", [ds, de]],
          "docstatus":      1
        };
      }

      /* Open in Report view (tabular) instead of default List view */
      frappe.set_route("List", doctype, "Report");
    };

    /* ── Bind UI controls ── */
    var dEl = $id("bd-date-picker");
    var btn = $id("bd-refresh-btn");

    if (dEl) dEl.value = _today;
    if (btn) btn.onclick = function () { loadDashboard(); };

    console.log("BD init | root:", ROOT.nodeType, "| date el:", !!dEl, "| btn:", !!btn);

    /* ── Auto-load on page open ── */
    loadDashboard();

  }); /* end findRoot */

})();
