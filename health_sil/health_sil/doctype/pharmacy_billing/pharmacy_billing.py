# Copyright (c) 2025, softland and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt
from frappe.model.document import Document


class PharmacyBilling(Document):

    def on_submit(self):
        """
        Stock deduction is handled automatically by ERPNext when the Sales Invoice
        is submitted with update_stock=1 (via generate_invoice_api.create_sales_invoice).
        Manual deduction here caused a double-deduction bug and was removed.
        """
        pass
