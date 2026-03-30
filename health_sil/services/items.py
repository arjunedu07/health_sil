import frappe

def update_item_valuation_rate_on_submit(doc, method):
    # Loop through the items in the purchase invoice
    for item in doc.items:
        # Check if the custom valuation rate is set
        if item.custom_valuation_rate is not None:
            try:
                # Fetch the item record
                item_doc = frappe.get_doc("Item", item.item_code)
                # Update the valuation_rate field with the value from the custom field
                item_doc.valuation_rate = item.custom_valuation_rate
                item_doc.save(ignore_permissions=True)  # Save the changes
                frappe.db.commit()  # Commit the transaction
            except Exception as e:
                # Log any errors that occur
                frappe.log_error(frappe.get_traceback(), "Valuation Rate Update Error")

        # Check if the custom mrp is set
        if item.custom_mrp is not None:
            try:
                # Fetch the item record
                item_doc = frappe.get_doc("Item", item.item_code)
                # Update the custom_mrp in item_doc
                item_doc.custom_mrp_per_purchase_uom = item.custom_mrp
                # Update the custom mrp as for nos of items by dividing with conversion factor
                new_mrp = item.custom_mrp / ( item.conversion_factor if item.conversion_factor else 1 ) # ( item.custom_mrp / item.conversion_factor 1 )
                # Update the custom mrp field with the value from the custom field
                item_doc.custom_mrp = new_mrp
                item_doc.save(ignore_permissions=True)  # Save the changes
                frappe.db.commit()  # Commit the transaction
            except Exception as e:
                # Log any errors that occur
                frappe.log_error(frappe.get_traceback(), " Custom mrp Update Error")

