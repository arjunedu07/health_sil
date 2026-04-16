import frappe
from frappe.utils import flt


@frappe.whitelist()
def get_batches_for_item(item_code):
    if not item_code:
        return []

    batches = frappe.db.sql("""
        SELECT
            b.name          AS batch_no,
            b.expiry_date,
            b.batch_qty,
            COALESCE(NULLIF(b.custom_mrp_per_unit, 0), i.valuation_rate, 0) AS mrp_per_tablet,
            COALESCE(
                NULLIF(b.custom_mrp, 0),
                COALESCE(NULLIF(b.custom_mrp_per_unit, 0), i.valuation_rate, 0)
                    * COALESCE(NULLIF(b.custom_strips, 0), i.weight_per_unit, 1)
            , 0) AS mrp_per_strip,
            COALESCE(NULLIF(b.custom_strips, 0), i.weight_per_unit, 1) AS strips
        FROM `tabBatch` b
        LEFT JOIN `tabItem` i ON b.item = i.name
        WHERE b.item     = %s
          AND b.disabled = 0
        ORDER BY b.expiry_date ASC
    """, item_code, as_dict=True)

    result = []

    for b in batches:
        # Get qty_after_transaction from the latest SLE for this batch
        # This is the true current stock Frappe tracks internally
        latest_sle = frappe.db.sql("""
            SELECT qty_after_transaction
            FROM `tabStock Ledger Entry`
            WHERE item_code = %s
              AND batch_no  = %s
              AND docstatus = 1
            ORDER BY posting_date DESC, posting_time DESC, creation DESC
            LIMIT 1
        """, (item_code, b.batch_no), as_dict=True)

        if latest_sle:
            b.qty_available = flt(latest_sle[0].qty_after_transaction)
        else:
            # No SLE found — fall back to batch_qty
            b.qty_available = flt(b.batch_qty or 0)

        if b.qty_available > 0:
            result.append(b)

    return result


@frappe.whitelist()
def validate_batch_qty(batch_no, qty):
    if not batch_no:
        return {"ok": False, "available": 0, "message": "No batch selected"}

    batch_info = frappe.db.get_value(
        "Batch", batch_no, ["batch_qty", "item"], as_dict=True
    )
    if not batch_info:
        return {"ok": False, "available": 0, "message": "Batch not found"}

    # Use latest SLE qty_after_transaction for validation too
    latest_sle = frappe.db.sql("""
        SELECT qty_after_transaction
        FROM `tabStock Ledger Entry`
        WHERE item_code = %s
          AND batch_no  = %s
          AND docstatus = 1
        ORDER BY posting_date DESC, posting_time DESC, creation DESC
        LIMIT 1
    """, (batch_info.item, batch_no), as_dict=True)

    if latest_sle:
        available = flt(latest_sle[0].qty_after_transaction)
    else:
        available = flt(batch_info.batch_qty or 0)

    requested = flt(qty)

    if requested <= 0:
        return {"ok": False, "available": available, "message": "Qty must be greater than zero"}

    if requested > available:
        return {
            "ok": False,
            "available": available,
            "message": "Insufficient stock. Only {0} Nos available for this batch.".format(int(available))
        }

    return {"ok": True, "available": available}


@frappe.whitelist()
def deduct_batch_stock(batch_no, qty):
    if not batch_no:
        return {"ok": False, "message": "No batch selected"}

    qty = flt(qty)
    if qty <= 0:
        return {"ok": False, "message": "Qty must be greater than zero"}

    current_qty = flt(frappe.db.get_value("Batch", batch_no, "batch_qty") or 0)

    if qty > current_qty:
        return {
            "ok": False,
            "message": "Cannot deduct {0} from batch {1}. Only {2} available.".format(
                int(qty), batch_no, int(current_qty)
            )
        }

    new_qty = current_qty - qty
    frappe.db.set_value("Batch", batch_no, "batch_qty", new_qty)
    frappe.db.commit()

    return {"ok": True, "remaining": new_qty}