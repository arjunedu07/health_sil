import frappe
from frappe.utils import money_in_words

@frappe.whitelist()
def money_in_words_api(amount):
    return money_in_words(amount)




