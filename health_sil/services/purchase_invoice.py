import frappe

@frappe.whitelist()
def create_stock_entry_from_purchase_invoice(purchase_invoice):
    try:
        # Fetch the Purchase Invoice document
        pi = frappe.get_doc("Purchase Invoice", purchase_invoice)
        
        # Loop through all items in the purchase invoice
        for item in pi.items:
            # Check if custom_is_free_qty is True and custom_free_qty is greater than 0
            if item.custom_is_free_qty and item.custom_free_qty > 0:
                # Create a new Stock Entry
                stock_entry = frappe.new_doc("Stock Entry")
                stock_entry.custom_purchase_invoice_no = purchase_invoice
                stock_entry.purpose = "Material Receipt"
                stock_entry.stock_entry_type = "Purchase Receipt"
                stock_entry.company = pi.company
                
                # Add the item to Stock Entry
                stock_entry.append("items", {
                    "item_code": item.item_code,
                    "qty": item.custom_free_qty,
                    "rate": 0,
                    "t_warehouse": item.warehouse,
                    "item_name": item.item_name,
                    "uom": item.uom,
                    "batch_no": item.batch_no,
                    "stock_uom": item.uom,
                    "basic_rate": 0,
                })
                
                # Submit the Stock Entry
                stock_entry.insert()
                stock_entry.submit()
                
                # Optionally, you can log that the stock entry was created
                # frappe.msgprint(f"Stock Entry for {item.item_code} created with qty {item.custom_free_qty}")
    except Exception as e:
        frappe.log_error(message=str(e), title="Error in Creating Stock Entry")
        frappe.throw(_("An error occurred while creating stock entry from purchase invoice."))

