import frappe

def create_address_from_patient(doc, method):
    """
    After a Patient is inserted, create a new Address document using the custom address fields.
    The dynamic link is added as a child record in the dynamic_links table.

    This optimized version includes error validation and logging for a production-ready setup.
    """
    # List of required custom fields and corresponding display labels
    required_fields = [
        ('custom_address_line', "Address Line"),
        ('custom_city', "City"),
        ('custom_state', "State"),
        ('custom_country', "Country"),
        ('custom_pincode', "Pincode")
    ]

    # Check for missing required fields in the patient document
    missing_fields = [label for field, label in required_fields if not doc.get(field)]
    if missing_fields:
        error_message = f"Missing required fields for Patient {doc.name}: {', '.join(missing_fields)}"
        frappe.log_error(title="Missing Fields in Patient", message=error_message)
        # Optionally, you could notify the user or raise an exception here.
        return

    try:
        # Create a new Address document and set its fields
        address = frappe.new_doc("Address")
        
        # Use patient name for address title; if not provided, fallback to document name
        address.address_title = doc.patient_name or doc.name
        address.address_line1 = doc.custom_address_line
        address.city = doc.custom_city
        address.state = doc.custom_state
        address.country = doc.custom_country
        address.pincode = doc.custom_pincode
        address.address_type = "Personal"
        
        # Append the dynamic link to the address document linking to the Patient
        address.append("links", {
            "link_doctype": "Patient",
            "link_name": doc.name  # using doc.name to reference the actual document
        })
        
        # Insert the address document into the system
        address.insert(ignore_permissions=True)
        frappe.db.commit()
        
    except Exception as e:
        # Log any errors that occur during the process with a clear error title and message
        frappe.log_error(
            title="Error Creating Address from Patient",
            message=f"Patient {doc.name}: {str(e)}"
        )
        # Depending on your needs, you can either re-raise the exception or simply pass.
        # For production, you might want to re-raise to let upstream systems handle it.
        raise
