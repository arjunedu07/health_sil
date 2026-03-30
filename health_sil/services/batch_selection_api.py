import frappe
from frappe import _
from frappe.utils import flt


@frappe.whitelist()
def get_batches_for_item(item_code):
    """Return all active batches for an item, sorted by expiry (FEFO).
    qty_available is returned in NOS so it matches the billing qty field."""
    if not item_code:
        return []

    batches = frappe.db.sql("""
        SELECT
            b.name        AS batch_no,
            b.expiry_date,
            CASE
                WHEN i.stock_uom = 'Strip'
                THEN b.batch_qty * COALESCE(NULLIF(i.weight_per_unit, 0), 1)
                ELSE b.batch_qty
            END           AS qty_available,
            COALESCE(NULLIF(b.custom_mrp_per_unit, 0), i.valuation_rate, 0) AS mrp_per_tablet,
            COALESCE(NULLIF(b.custom_mrp, 0), COALESCE(NULLIF(b.custom_mrp_per_unit, 0), i.valuation_rate, 0) * COALESCE(NULLIF(b.custom_strips, 0), i.weight_per_unit, 1), 0) AS mrp_per_strip,
            COALESCE(NULLIF(b.custom_strips, 0), i.weight_per_unit, 1) AS strips
        FROM `tabBatch` b
        LEFT JOIN `tabItem` i ON b.item = i.name
        WHERE b.item      = %s
          AND b.disabled  = 0
        ORDER BY b.expiry_date ASC
    """, item_code, as_dict=True)

    return batches



@frappe.whitelist()
def validate_batch_qty(batch_no, qty):
    """Compare requested NOS qty against available NOS.
    Converts Strip-based batch_qty to NOS before comparing."""
    if not batch_no:
        return {"ok": False, "available": 0, "message": "No batch selected"}

    batch_info = frappe.db.get_value(
        "Batch", batch_no, ["batch_qty", "item"], as_dict=True
    )
    if not batch_info:
        return {"ok": False, "available": 0, "message": "Batch not found"}

    item_info = frappe.db.get_value(
        "Item", batch_info.item, ["stock_uom", "weight_per_unit"], as_dict=True
    ) or {}

    stock_uom        = item_info.get("stock_uom", "Nos")
    tablets_per_strip = flt(item_info.get("weight_per_unit") or 1)
    raw_batch_qty    = flt(batch_info.batch_qty or 0)

    # Convert to NOS so comparison matches the billing qty field
    if stock_uom == "Strip":
        available_nos = raw_batch_qty * tablets_per_strip
    else:
        available_nos = raw_batch_qty

    requested = flt(qty)

    if requested <= 0:
        return {"ok": False, "available": available_nos, "message": "Qty must be greater than zero"}

    if requested > available_nos:
        return {
            "ok": False,
            "available": available_nos,
            "message": "Insufficient stock. Only {0} Nos available for this batch.".format(int(available_nos))
        }

    return {"ok": True, "available": available_nos}



@frappe.whitelist()
def deduct_batch_stock(batch_no, qty):
    """Decrement Batch.batch_qty by the billed qty. Called on Pharmacy Billing submit."""
    if not batch_no:
        return

    qty = flt(qty)
    if qty <= 0:
        return

    current_qty = flt(frappe.db.get_value("Batch", batch_no, "batch_qty") or 0)

    new_qty = current_qty - qty
    frappe.db.set_value("Batch", batch_no, "batch_qty", new_qty)
    frappe.db.commit()
