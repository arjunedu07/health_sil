
import frappe
# from frappe.utils.background_jobs import enqueue
from frappe import _

def clear_token_history():
    # This function will delete all records of Token History
    frappe.db.delete("Doctor Token History")
    frappe.logger().info(_("Cleared Token History"))

# Enqueue the job to run it in the background
# enqueue('health_sil.tasks.clear_token_history', timeout=6000)


# import frappe

# def clear_token_history():
#     token_history_records = frappe.get_all("Doctor Token History", fields=["name"])
#     for record in token_history_records:
#         frappe.delete_doc("Token History", record.name)
