(function () {
  /* ============================================================
     Medicine Return — JS  (IIFE / Frappe page safe)

     Flow:
       1. User enters Pharmacy Billing name → fetchBill()
       2. Medicines listed with checkboxes + editable return qty
       3. "Process Return & Update Stock" →
            a. For each selected medicine:
               - Increase batch qty via Stock Ledger Entry (frappe.call)
               - Or simply use frappe.call to update Batch qty directly
            b. Shows success banner
       4. "Print Return Bill" → prints a bill in the same format,
          showing only the RETURNED medicines, stamped "RETURN BILL"

     Doctype references (confirmed from JSON):
       Pharmacy Billing  → medicines (child: Pharmaceuticals)
         fields: hsn, item_code, item_name, batch, expiry_date,
                 qty, mrp, discount_, gst_, amount
       Batch             → batch_qty (standard Frappe field)
  ============================================================ */

  /* ── Find the shadow root or document that has our root element ── */
  function findRoot(retries, onFound) {
    if (document.querySelector(".mr-wrapper")) { onFound(document); return; }
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      try {
        var sr = all[i].shadowRoot;
        if (sr && sr.querySelector(".mr-wrapper")) { onFound(sr); return; }
      } catch (e) {}
    }
    if (retries > 0) {
      setTimeout(function () { findRoot(retries - 1, onFound); }, 300);
    } else {
      console.error("MR: .mr-wrapper not found after all retries");
    }
  }

  findRoot(20, function (ROOT) {

    /* ── $ helpers ── */
    function $id(id) { return ROOT.getElementById(id); }
    function $q(sel) { return ROOT.querySelector(sel); }

    /* ── State ── */
    var _billDoc   = null;   /* full Pharmacy Billing doc */
    var _medicines = [];     /* array of medicine rows from the bill */

    /* ── UI refs ── */
    var billIdInput  = $id("mr-bill-id");
    var searchBtn    = $id("mr-search-btn");
    var billInfoDiv  = $id("mr-bill-info");
    var step2Div     = $id("mr-step2");
    var tbody        = $id("mr-medicine-tbody");
    var selectAllCb  = $id("mr-select-all");
    var summaryDiv   = $id("mr-summary");
    var actionBar    = $id("mr-action-bar");
    var processBtn   = $id("mr-process-btn");
    var printBtn     = $id("mr-print-btn");
    var spinner      = $id("mr-spinner");
    var resultBanner = $id("mr-result-banner");

    /* ── Helpers ── */
    function flt(v) { return parseFloat(v) || 0; }

    function fmt(n) {
      return "₹ " + Number(n || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }

    function showBanner(msg, type) {
      resultBanner.textContent = msg;
      resultBanner.className = "mr-result-banner " + (type === "error" ? "mr-error" : "mr-success");
      resultBanner.style.display = "block";
      resultBanner.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function hideBanner() {
      resultBanner.style.display = "none";
    }

    function showSpinner(show) {
      spinner.style.display = show ? "flex" : "none";
    }

    function fmtDate(d) {
      if (!d) return "—";
      try {
        var parts = d.split("-");
        if (parts.length === 3) return parts[2] + "-" + parts[1] + "-" + parts[0];
      } catch(e){}
      return d;
    }

    /* ── STEP 1 : Fetch the bill ── */
    function fetchBill() {
      var billId = (billIdInput.value || "").trim();
      if (!billId) {
        frappe.msgprint ? frappe.msgprint("Please enter a Bill ID.") : alert("Please enter a Bill ID.");
        return;
      }

      hideBanner();
      showSpinner(true);
      billInfoDiv.style.display = "none";
      step2Div.style.display = "none";
      summaryDiv.style.display = "none";
      actionBar.style.display = "none";
      if (printBtn) printBtn.style.display = "none";
      tbody.innerHTML = "";

      frappe.call({
        method: "frappe.client.get",
        args: {
          doctype: "Pharmacy Billing",
          name: billId
        },
        callback: function (r) {
          showSpinner(false);
          if (!r || !r.message) {
            showBanner("❌ Bill '" + billId + "' not found. Please check the Bill ID.", "error");
            return;
          }
          var doc = r.message;

          /* Check docstatus — only allow returns on submitted bills */
          if (doc.docstatus !== 1) {
            showBanner(
              "⚠️ This bill is not submitted (status: " + (doc.docstatus === 0 ? "Draft" : "Cancelled") + "). Only submitted bills can be returned.",
              "error"
            );
            return;
          }

          _billDoc = doc;
          _medicines = doc.medicines || [];

          if (_medicines.length === 0) {
            showBanner("⚠️ This bill has no medicines.", "error");
            return;
          }

          renderBillInfo(doc);
          renderMedicineTable(_medicines);
          billInfoDiv.style.display = "block";
          step2Div.style.display = "block";
          actionBar.style.display = "flex";
          recalcSummary();
        },
        error: function (e) {
          showSpinner(false);
          console.error("MR | fetchBill error:", e);
          showBanner("❌ Error fetching bill. Check console for details.", "error");
        }
      });
    }

    /* ── Render bill info strip ── */
    function renderBillInfo(doc) {
      $id("mr-info-name").textContent    = doc.name || "—";
      $id("mr-info-patient").textContent = doc.patient_name || "—";
      $id("mr-info-date").textContent    = fmtDate((doc.date_and_time || "").split(" ")[0]);
      $id("mr-info-doctor").textContent  = doc.healthcare_practitioner || "—";
      $id("mr-info-total").textContent   = fmt(doc.rounded_total_amount || doc.total_amount);
      var statusEl = $id("mr-info-status");
      statusEl.textContent  = "Submitted";
      statusEl.className    = "mr-badge mr-badge-submitted";
    }

    /* ── Render medicine rows ── */
    function renderMedicineTable(medicines) {
      tbody.innerHTML = "";
      medicines.forEach(function (med, idx) {
        var tr = document.createElement("tr");
        tr.dataset.idx = idx;

        var expiryStr = fmtDate(med.expiry_date) || "—";
        var billedQty = flt(med.qty);

        tr.innerHTML =
          '<td style="text-align:center;">' +
            '<input type="checkbox" class="mr-row-checkbox" data-idx="' + idx + '" />' +
          '</td>' +
          '<td>' + (med.hsn || "—") + '</td>' +
          '<td style="font-weight:600;">' + (med.item_name || med.item_code || "—") + '</td>' +
          '<td>' + (med.batch || "—") + '</td>' +
          '<td>' + expiryStr + '</td>' +
          '<td style="text-align:center; font-weight:600;">' + billedQty + '</td>' +
          '<td style="text-align:center;">' +
            '<input type="number" class="mr-ret-qty-input" ' +
              'id="mr-retqty-' + idx + '" ' +
              'min="0" max="' + billedQty + '" ' +
              'value="' + billedQty + '" ' +
              'disabled ' +
              'data-idx="' + idx + '" ' +
              'data-max="' + billedQty + '" />' +
          '</td>' +
          '<td style="text-align:right;">' + fmt(med.mrp) + '</td>' +
          '<td style="text-align:right;">' + (flt(med.discount_) || 0).toFixed(2) + '%</td>' +
          '<td style="text-align:right;">' + (med.gst_ || "0") + '%</td>' +
          '<td style="text-align:right; font-weight:600;">' + fmt(med.amount) + '</td>';

        tbody.appendChild(tr);

        /* Row checkbox handler */
        var cb = tr.querySelector(".mr-row-checkbox");
        cb.addEventListener("change", function () {
          var qtyInput = $id("mr-retqty-" + idx);
          if (this.checked) {
            tr.classList.add("mr-row-selected");
            qtyInput.disabled = false;
          } else {
            tr.classList.remove("mr-row-selected");
            qtyInput.disabled = true;
          }
          recalcSummary();
          syncSelectAll();
        });

        /* Qty input handler */
        var qi = $id("mr-retqty-" + idx);
        qi.addEventListener("input", function () {
          var maxQ = flt(this.dataset.max);
          var val  = flt(this.value);
          if (val < 0) { this.value = 0; }
          if (val > maxQ) { this.value = maxQ; }
          recalcSummary();
        });
      });
    }

    /* ── Sync "Select All" checkbox state ── */
    function syncSelectAll() {
      var cbs = ROOT.querySelectorAll(".mr-row-checkbox");
      var checked = Array.from(cbs).filter(function(c){ return c.checked; }).length;
      if (selectAllCb) {
        selectAllCb.indeterminate = checked > 0 && checked < cbs.length;
        selectAllCb.checked = checked === cbs.length;
      }
    }

    /* ── Select All handler ── */
    if (selectAllCb) {
      selectAllCb.addEventListener("change", function () {
        var state = this.checked;
        var cbs   = ROOT.querySelectorAll(".mr-row-checkbox");
        cbs.forEach(function (cb, idx) {
          cb.checked = state;
          var tr = cb.closest("tr");
          var qi = $id("mr-retqty-" + cb.dataset.idx);
          if (state) {
            tr.classList.add("mr-row-selected");
            if (qi) qi.disabled = false;
          } else {
            tr.classList.remove("mr-row-selected");
            if (qi) qi.disabled = true;
          }
        });
        recalcSummary();
      });
    }

    /* ── Recalculate summary (refund total, incl. 12% deduction) ── */
    function recalcSummary() {
      var selected     = getSelectedItems();
      var totalItems   = selected.length;
      var totalQty     = selected.reduce(function(s, m){ return s + m.retQty; }, 0);
      var totalGross   = selected.reduce(function(s, m){ return s + m.grossAmount; }, 0);
      var totalDeduct  = selected.reduce(function(s, m){ return s + m.deductionAmt; }, 0);
      var totalNet     = selected.reduce(function(s, m){ return s + m.retAmount; }, 0);

      if ($id("mr-ret-items")) $id("mr-ret-items").textContent = totalItems;
      if ($id("mr-ret-qty"))   $id("mr-ret-qty").textContent   = totalQty;

      /* Refund total display: show gross → deduction → net */
      var retTotalEl = $id("mr-ret-total");
      if (retTotalEl) {
        retTotalEl.innerHTML =
          '<span style="font-size:13px; color:#8d99a6; text-decoration:line-through;">' + fmt(totalGross) + '</span>' +
          '<span style="font-size:11px; color:#e53e3e; margin-left:6px;">−' + RETURN_DEDUCTION_PCT + '% policy</span><br>' +
          '<span style="font-size:24px; font-weight:800; color:#e53e3e;">' + fmt(totalNet) + '</span>';
      }

      if (summaryDiv) summaryDiv.style.display = totalItems > 0 ? "flex" : "none";
      if (processBtn) processBtn.disabled = totalItems === 0;
    }

    /* ── Get selected items with return qty (12% deduction applied) ── */
    var RETURN_DEDUCTION_PCT = 12; /* 12% deducted from every returned medicine */

    function getSelectedItems() {
      var cbs = ROOT.querySelectorAll(".mr-row-checkbox");
      var result = [];
      cbs.forEach(function (cb) {
        if (!cb.checked) return;
        var idx = parseInt(cb.dataset.idx, 10);
        var med = _medicines[idx];
        if (!med) return;
        var retQtyInput = $id("mr-retqty-" + idx);
        var retQty = retQtyInput ? flt(retQtyInput.value) : flt(med.qty);
        if (retQty <= 0) return;

        /* Proportional gross amount for returned qty */
        var billedQty   = flt(med.qty) || 1;
        var billedAmt   = flt(med.amount);
        var grossAmount = (billedAmt / billedQty) * retQty;

        /* Apply 12% deduction — return policy */
        var deductionAmt = grossAmount * (RETURN_DEDUCTION_PCT / 100);
        var retAmount    = grossAmount - deductionAmt;   /* net refund */

        result.push({
          idx:          idx,
          item_code:    med.item_code,
          item_name:    med.item_name,
          batch:        med.batch,
          hsn:          med.hsn,
          expiry_date:  med.expiry_date,
          mrp:          flt(med.mrp),
          discount_:    flt(med.discount_),
          gst_:         med.gst_,
          billedQty:    billedQty,
          retQty:       retQty,
          grossAmount:  grossAmount,   /* proportional billed amount */
          deductionAmt: deductionAmt,  /* 12% cut */
          retAmount:    retAmount,     /* net refund to patient */
          amount:       billedAmt
        });
      });
      return result;
    }

    /* =========================================================
       STEP 3 : Process Return
         Calls the Python API which:
           1. Creates a Stock Ledger Entry (inward) for each item
              — this is what ERPNext validates stock against.
           2. Syncs Batch.batch_qty from SLE totals.
       This fixes the negative stock error that occurred when
       only batch_qty was updated without an SLE.
    ========================================================= */
    function processReturn() {
      var selected = getSelectedItems();
      if (selected.length === 0) {
        showBanner("⚠️ No medicines selected for return.", "error");
        return;
      }

      /* Confirm */
      var confirmMsg =
        "Return " + selected.length + " medicine(s)" +
        " — Refund: " + fmt(selected.reduce(function(s,m){return s + m.retAmount;}, 0)) +
        "?\n\nThis will create Stock Ledger Entries to add quantities back to stock.";

      if (!confirm(confirmMsg)) return;

      hideBanner();
      showSpinner(true);
      if (processBtn) processBtn.disabled = true;

      /* Build the items payload for the Python API */
      var returnPayload = selected.map(function(m) {
        return {
          item_code: m.item_code,
          batch:     m.batch,
          qty:       m.retQty
        };
      });

      frappe.call({
        method: "health_sil.services.medicine_return_api.process_medicine_return",
        args: {
          pharmacy_billing_name: _billDoc.name,
          return_items:          JSON.stringify(returnPayload)
        },
        callback: function(r) {
          showSpinner(false);
          if (processBtn) processBtn.disabled = false;

          if (!r || !r.message) {
            showBanner("❌ No response from server. Please check error logs.", "error");
            return;
          }

          var result = r.message;

          if (result.ok) {
            showBanner(
              "✅ Return processed successfully! " +
              result.processed.length + " medicine(s) returned. " +
              "Stock Ledger Entries created.",
              "success"
            );
            if (printBtn) printBtn.style.display = "inline-flex";
          } else if (result.errors && result.errors.length > 0) {
            var partial = result.processed && result.processed.length > 0;
            showBanner(
              (partial ? "⚠️ Partial return: " + result.processed.length + " item(s) succeeded. " : "❌ Return failed. ") +
              "Errors: " + result.errors.join("; "),
              "error"
            );
            if (partial && printBtn) printBtn.style.display = "inline-flex";
          } else {
            showBanner("❌ Return failed. Please check error logs.", "error");
          }
        },
        error: function(e) {
          showSpinner(false);
          if (processBtn) processBtn.disabled = false;
          console.error("MR | processReturn error:", e);
          showBanner("❌ Server error during return. Check console/error logs.", "error");
        }
      });
    }

    /* =========================================================
       STEP 4 : Print Return Bill
    ========================================================= */
    function printReturnBill() {
      var selected = getSelectedItems();
      if (selected.length === 0) {
        showBanner("⚠️ No medicines selected. Please select items first.", "error");
        return;
      }

      var doc = _billDoc;
      var totalGross   = selected.reduce(function(s,m){ return s + m.grossAmount; }, 0);
      var totalDeduct  = selected.reduce(function(s,m){ return s + m.deductionAmt; }, 0);
      var totalNet     = selected.reduce(function(s,m){ return s + m.retAmount; }, 0);
      var totalRetQty  = selected.reduce(function(s,m){ return s + m.retQty; }, 0);

      /* A5 landscape = same size as GST Invoice for <=9 items; 2 fit per A4 portrait */
      var isA5     = selected.length <= 9;
      var pageSize = isA5 ? "A5 landscape" : "A4 portrait";
      var maxRows  = isA5 ? 9 : 34;

      var billedDate = (doc.date_and_time || "").split(" ")[0];
      var printDate  = new Date().toLocaleDateString("en-IN", {
        day: "2-digit", month: "2-digit", year: "numeric"
      }).replace(/\//g, "-");

      var medRowsHtml = "";
      selected.slice(0, maxRows).forEach(function (item, i) {
        medRowsHtml +=
          "<tr class='product-row'>" +
            "<td style='text-align:center;'>" + (i + 1) + "</td>" +
            "<td>" + (item.hsn || "") + "</td>" +
            "<td>" + (item.item_name || item.item_code || "") + "</td>" +
            "<td>" + (item.batch || "") + "</td>" +
            "<td style='text-align:center;'>" + (fmtDate(item.expiry_date) || "—") + "</td>" +
            "<td style='text-align:center;'>" + item.retQty + "</td>" +
            "<td style='text-align:right;'>₹ " + item.mrp.toFixed(2) + "</td>" +
            "<td style='text-align:right;'>" + item.discount_.toFixed(2) + "%</td>" +
            "<td style='text-align:right;'>" + (item.gst_ || "0") + "%</td>" +
            "<td style='text-align:right; color:#c53030;'>₹ " + item.retAmount.toFixed(2) + "</td>" +
          "</tr>";
      });

      for (var e = Math.min(selected.length, maxRows); e < maxRows; e++) {
        medRowsHtml += "<tr class='product-row'>" +
          "<td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>" +
          "<td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>" +
          "<td>&nbsp;</td><td>&nbsp;</td></tr>";
      }

      var amtInWords = numberToWordsINR(totalNet);

      var css = [
        '@page { size: ' + pageSize + '; margin: 3mm; }',
        'html, body { height: 100%; margin: 0; padding: 0; }',
        '.page-container { font-family:Arial,sans-serif; width:100%; height:100%; border:1px solid #000; padding:0.5mm; overflow:hidden; box-sizing:border-box; display:flex; flex-direction:column; }',
        '.invoice-table { width:100%; border-collapse:collapse; margin:-1px 0 2px 0; flex-shrink:0; }',
        '.invoice-table td { border:1px solid black; padding:1px; font-size:11px; }',
        '.logo-td { text-align:right; width:27.5%; overflow:hidden; }',
        '.logo-td img { max-height:60px; max-width:100%; object-fit:contain; display:block; margin-left:auto; }',
        '.content-wrapper { display:flex; flex-direction:column; flex:1; overflow:hidden; }',
        '.table-wrapper { flex:1; overflow:hidden; display:flex; flex-direction:column; }',
        '.order-details { width:100%; height:100%; border-collapse:collapse; font-size:11px; border-spacing:0; border-bottom:1px solid black; }',
        '.order-details th, .order-details td { padding:0px; font-size:11px; line-height:0.7; }',
        '.order-details tr.header-row th { border:1px solid black; padding:0px; text-align:center; font-size:11px; }',
        '.order-details tr.product-row td { border-left:1px solid black; border-right:1px solid black; border-top:none; border-bottom:none; padding:0px; font-size:11px; line-height:0.8; margin:0; }',
        '.order-details tr.total-row th { border:1px solid black; padding:0px; font-size:11px; }',
        '.footer-container { font-size:11px; margin-top:1px; flex-shrink:0; width:100%; }',
        '.footer-container p { margin:0; line-height:1; }',
        '.footer-flex { display:flex; justify-content:space-between; width:100%; }',
        '.refund-policy { margin:0; line-height:1; }',
        '.delivery-contact { text-align:center; margin-top:2px; }'
      ].join(" ");

      var html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
        '<style>' + css + '</style></head><body>' +

        '<div class="page-container">' +

          /* ── HEADER TABLE (exact pharmacy_inv structure) ── */
          '<table class="invoice-table"><tr>' +
            '<td class="logo-td">' +
              '<img src="/assets/health_sil/images/final_logo_3.png" alt="Clinic Logo">' +
            '</td>' +
            '<td style="text-align:center; font-size:11px; width:28.5%;">' +
              '<span style="font-weight:bold;">' +
                'Kowdiar, Thiruvananthapuram, Kerala 695003<br>' +
                '\u{1F4DE} 0471-4612849, 0471-2575888<br>' +
                'e - drrasheeds@gmail.com' +
              '</span>' +
            '</td>' +
            '<td style="text-align:left; font-size:12px; width:44%; font-weight:bold;">' +
              '<span>Name&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:&nbsp;&nbsp;' + (doc.patient_name || '') + '</span><br>' +
              '<span>Orig. Bill&nbsp;&nbsp;&nbsp;&nbsp;:&nbsp;&nbsp;' + doc.name + '</span><br>' +
              '<span>Return Date&nbsp;:&nbsp;&nbsp;' + printDate + '</span><br>' +
              '<span>Doctor&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:&nbsp;&nbsp;<span style="font-size:14px;">' + (doc.healthcare_practitioner || '') + '</span></span>' +
            '</td>' +
          '</tr></table>' +

          '<div class="content-wrapper">' +
            '<div class="table-wrapper">' +
            '<table class="order-details">' +

              /* Title row — "RETURN BILL" replaces "GST INVOICE" */
              '<tr class="header-row">' +
                '<th colspan="3" style="width:40%; font-size:11px; text-align:start;">' +
                  '<span style="font-weight:bold;"><br>GSTIN: 32CHZPS7837K1Z9<br><br>DL.NO: RLF20KL2025001437, RLF21KL2025001428</span>' +
                '</th>' +
                '<th colspan="3" style="width:30%; font-size:22px; font-weight:bold; text-align:center; line-height:50px; height:50px; color:#c53030;">RETURN BILL</th>' +
                '<th colspan="5" style="width:30%; font-size:11px; text-align:start;">' +
                  '<span style="font-weight:bold;">' +
                    'Invoice No: ' + doc.name + '<br><br>' +
                    'Return Date: ' + printDate + '<br><br>' +
                    'Orig. Date: ' + fmtDate(billedDate) +
                  '</span>' +
                '</th>' +
              '</tr>' +

              /* Column headers — exact match to pharmacy_inv */
              '<tr class="header-row" style="border-bottom:1px solid black;">' +
                '<th style="width:2%;"><span style="font-weight:bold;">SN</span></th>' +
                '<th style="width:5%;"><span style="font-weight:bold;">HSN</span></th>' +
                '<th style="width:38%;"><span style="font-weight:bold;">PRODUCT NAME</span></th>' +
                '<th style="width:8%;"><span style="font-weight:bold;">BATCH</span></th>' +
                '<th style="width:14%;"><span style="font-weight:bold;">EXPIRY DATE</span></th>' +
                '<th style="width:6%;"><span style="font-weight:bold;">QTY</span></th>' +
                '<th style="width:9%;"><span style="font-weight:bold;">MRP</span></th>' +
                '<th style="width:5%;"><span style="font-weight:bold;">DISC</span></th>' +
                '<th style="width:2%;"><span style="font-weight:bold;">GST</span></th>' +
                '<th style="width:14%;"><span style="font-weight:bold;">AMOUNT</span></th>' +
              '</tr>' +

              medRowsHtml +

              /* Total row — return amounts, same structure as pharmacy_inv */
              '<tr class="total-row">' +
                '<th colspan="5" style="width:85%; font-size:12px; border-bottom:1px solid black;">' +
                  '<span style="font-weight:bold; font-size:11px;">' + amtInWords + '</span><br><br>' +
                  '<p style="font-weight:bold; margin-top:20px;">' +
                    'TOTAL ITEMS RETURNED : ' + selected.length + '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;TOTAL QTY : ' + totalRetQty +
                  '</p>' +
                '</th>' +
                '<th colspan="5" style="width:15%; font-size:11px; border-bottom:1px solid black; text-align:start; padding:4px;">' +
                  '<div style="display:flex; justify-content:space-between; width:100%;">' +
                    '<strong>GROSS RETURN</strong>' +
                    '<strong>&#8377; ' + totalGross.toFixed(2) + '</strong>' +
                  '</div>' +
                  '<div style="display:flex; justify-content:space-between; width:100%; margin-top:5px; color:#c53030;">' +
                    '<strong>DEDUCTION (12%)</strong>' +
                    '<strong>&#8722;&#8377; ' + totalDeduct.toFixed(2) + '</strong>' +
                  '</div>' +
                  '<br>' +
                  '<div style="display:flex; justify-content:space-between; width:100%; margin-top:5px; font-size:17px;">' +
                    '<strong>NET REFUND</strong>' +
                    '<strong style="color:#c53030;">&#8377; ' + totalNet.toFixed(2) + '</strong>' +
                  '</div>' +
                '</th>' +
              '</tr>' +

            '</table>' +
            '</div>' +  /* /table-wrapper */

            /* FOOTER — exact match to pharmacy_inv A5 landscape version */
            '<div class="footer-container">' +
              '<div class="refund-policy" style="font-size:9px;">' +
                '<p>All medicines purchased from our pharmacy can be refunded if not used, on producing original pharmacy bill. Items return for refunding should be in good condition. Refrigerated and bottled medicines will not be considered for refunding.</p>' +
              '</div>' +
              '<br>' +
              '<div class="footer-flex">' +
                '<span class="delivery-contact" style="text-align:center;">For free home delivery please contact : 9895116444</span>' +
                '<span style="font-weight:bold; text-align:start;">Pharmacist</span>' +
              '</div>' +
            '</div>' +

          '</div>' +  /* /content-wrapper */
        '</div></body></html>';

      var win = window.open("", "_blank", "width=950,height=680");
      if (!win) {
        showBanner("⚠️ Popup blocked! Please allow popups for this site and try again.", "error");
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(function () { win.print(); }, 700);
    }

    /* ── Number to INR words (basic, up to crores) ── */
    function numberToWordsINR(amount) {
      var n = Math.round(amount);
      if (n === 0) return "Zero Rupees Only";

      var a = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine",
               "Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen",
               "Seventeen","Eighteen","Nineteen"];
      var b = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];

      function inWords(num) {
        if (num < 20) return a[num];
        if (num < 100) return b[Math.floor(num/10)] + (num % 10 ? " " + a[num%10] : "");
        if (num < 1000) return a[Math.floor(num/100)] + " Hundred" + (num%100 ? " and " + inWords(num%100) : "");
        if (num < 100000) return inWords(Math.floor(num/1000)) + " Thousand" + (num%1000 ? " " + inWords(num%1000) : "");
        if (num < 10000000) return inWords(Math.floor(num/100000)) + " Lakh" + (num%100000 ? " " + inWords(num%100000) : "");
        return inWords(Math.floor(num/10000000)) + " Crore" + (num%10000000 ? " " + inWords(num%10000000) : "");
      }

      var paise = Math.round((amount - n) * 100);
      var words = inWords(n) + " Rupees";
      if (paise > 0) words += " and " + inWords(paise) + " Paise";
      return words + " Only";
    }

    /* ── Bind events ── */
    if (searchBtn)  searchBtn.addEventListener("click", fetchBill);
    if (processBtn) processBtn.addEventListener("click", processReturn);
    if (printBtn)   printBtn.addEventListener("click", printReturnBill);

    /* Allow Enter key on bill ID input */
    if (billIdInput) {
      billIdInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") fetchBill();
      });
    }

    console.log("MR | Medicine Return page initialized.");

  }); /* end findRoot */

})();
