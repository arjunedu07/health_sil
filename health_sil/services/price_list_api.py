import frappe

@frappe.whitelist()
def get_country_specific_price(item_code, patient_id):
    if not item_code or not patient_id:
        return None

    patient = frappe.get_doc("Patient", patient_id)
    if not patient.territory:
        return None

    territory_doc = frappe.get_doc("Territory", patient.territory)
    price_list = territory_doc.get("custom_price_list")

    if not price_list:
        return None

    item_doc = frappe.get_doc("Item", item_code)

    # Skip medications / pharmacy items
    if item_doc.item_group == "Medications":
        return None

    price = frappe.db.get_value("Item Price", {
        "item_code": item_code,
        "price_list": price_list
    }, "price_list_rate")

    return price

def add_price_list_from_item(doc, method):
    try:
        # medications / pharmacy items
        if doc.item_group == "Medications":
            med = frappe.new_doc("Item Price")
            med.item_code = doc.item_code
            med.item_name = doc.item_name
            med.item_description = doc.item_name
            med.price_list = "Standard Selling"
            med.price_list_rate = doc.valuation_rate
            med.uom = "nos"
            med.insert(ignore_permissions=True)
            frappe.db.commit()

            return

        # Create a new Batch document
        native = frappe.new_doc("Item Price")
        foreign = frappe.new_doc("Item Price")

        native.item_code = doc.item_code
        native.item_name = doc.item_name
        native.item_description = doc.item_name
        native.price_list = "Native Price List"
        native.price_list_rate = doc.custom_rate_for_native
        native.uom = "nos"

        foreign.item_code = doc.item_code
        foreign.item_name = doc.item_name
        foreign.item_description = doc.item_name
        foreign.price_list = "Foreign Price List"
        foreign.price_list_rate = doc.custom_rate_for_foreign
        foreign.uom = "nos"

        # Insert the batch document into the database
        native.insert(ignore_permissions=True)
        foreign.insert(ignore_permissions=True)

        frappe.db.commit()

    except Exception as e:
        # Log any unexpected errors during batch creation with detailed information
        frappe.log_error(
            title="Error Creating Batch from Item",
            message=f"Item {doc.name}: {str(e)}"
        )
        raise  # Optionally re-raise the exception to alert upstream processes

def update_price_list_from_item(doc, method):
    try:
        # medications / pharmacy items
        if doc.item_group == "Medications":
            med = frappe.get_doc("Item Price", {"item_code": doc.item_code, "price_list": "Standard Selling"})
            
            med.price_list_rate = doc.valuation_rate
            
            med.save(ignore_permissions=True)

            frappe.db.commit()

            return

        # Fetch existing Item Price documents
        native = frappe.get_doc("Item Price", {"item_code": doc.item_code, "price_list": "Native Price List"})
        foreign = frappe.get_doc("Item Price", {"item_code": doc.item_code, "price_list": "Foreign Price List"})
        
        # Update Item Price details
        native.price_list_rate = doc.custom_rate_for_native
        foreign.price_list_rate = doc.custom_rate_for_foreign
        
        # Save the updated documents
        native.save(ignore_permissions=True)
        foreign.save(ignore_permissions=True)

        frappe.db.commit()

    except Exception as e:
        # Log any unexpected errors during update with detailed information
        frappe.log_error(
            title="Error Updating Price List from Item",
            message=f"Item {doc.name}: {str(e)}"
        )
        raise  # Optionally re-raise the exception to alert upstream processes



