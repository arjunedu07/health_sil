import frappe

def create_batch_from_item(doc, method):
    """
    If an Item document has batch numbers enabled, create a corresponding Batch document.
    This production-ready version includes field validation and error logging.
    """
    # Only proceed if the item has batch numbers enabled
    if not doc.has_batch_no:
        return

    # Define the required fields and their human-readable names for Batch creation
    required_fields = [
        ('custom_batch_id', "Batch ID"),
        ('item_code', "Item Code"),
        ('stock_uom', "Stock UOM"),
        ('custom_expiry_date', "Expiry Date")
    ]

    # Check if any required fields are missing
    missing_fields = [label for field, label in required_fields if not doc.get(field)]
    if missing_fields:
        error_message = f"Missing required field(s) for Batch creation: {', '.join(missing_fields)}"
        frappe.log_error(title="Missing Fields in Batch Creation", message=error_message)
        # Optionally, you could also notify the user; for now, we simply exit.
        return

    try:
        # Create a new Batch document
        batch = frappe.new_doc("Batch")

        batch.batch_id = doc.custom_batch_id
        batch.item = doc.item_code
        batch.stock_uom = doc.stock_uom
        batch.expiry_date = doc.custom_expiry_date
        batch.description = doc.custom_batch_description or ""

        # Insert the batch document into the database
        batch.insert(ignore_permissions=True)
        frappe.db.commit()

    except Exception as e:
        # Log any unexpected errors during batch creation with detailed information
        frappe.log_error(
            title="Error Creating Batch from Item",
            message=f"Item {doc.name}: {str(e)}"
        )
        raise  # Optionally re-raise the exception to alert upstream processes

@frappe.whitelist()
def notify_batches_due_today():
    from frappe.utils import nowdate
    today = nowdate()
    batches = frappe.get_all("Batch", filters={
        "next_reminder_date": today
    }, fields=["name", "item", "expiry_date"])

    for batch in batches:
        frappe.publish_realtime(
            event='msgprint',
            message=f"Reminder: Batch <b>{batch.name}</b> for Item <b>{batch.item}</b> expires on {batch.expiry_date}!",
        )

