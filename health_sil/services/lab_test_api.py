import frappe

# @frappe.whitelist()
# def get_created_lab_tests_for_bill(laboratory_bill):
#     try:
#         tests = frappe.get_all(
#             "Lab Test",
#             filters={"laboratory_bill_ref": laboratory_bill, "docstatus": 1},  # Only submitted
#             fields=["source_item_code"]
#         )
#         return [t.source_item_code for t in tests if t.source_item_code]
#     except Exception as e:
#         frappe.log_error(e, "Lab Test API")

@frappe.whitelist()
def get_lab_tests_by_bill(lab_bill):
    return frappe.get_all("Lab Test", filters={"laboratory_bill_ref": lab_bill},
        fields=["name", "template", "docstatus"])

# @frappe.whitelist()
# def get_lab_test_result_fields(lab_test_id):
#     lab_test = frappe.get_doc("Lab Test", lab_test_id)
#     return {
#         "template": lab_test.template,
#         "fields": [
#             {
#                 "fieldname": row.parameter.lower().replace(" ", "_"),
#                 "label": row.parameter,
#                 "fieldtype": "Data",
#                 "reqd": 1
#             } for row in lab_test.normal_test_items
#         ]
#     }
@frappe.whitelist()
def get_lab_test_result_fields(lab_test_id):
    lab_test = frappe.get_doc("Lab Test", lab_test_id)

    rows = []
    for row in lab_test.normal_test_items:
        rows.append({
            "name": row.name,
            "lab_test_name": row.lab_test_name or "",
            "event_name": row.lab_test_event or "",
            "uom": row.lab_test_uom,
            "normal_range": row.normal_range,
            "result_value": row.result_value or ""
        })

    return {
        "template": lab_test.template,
        "rows": rows,
        "lab_test_id": lab_test.name
    }

# @frappe.whitelist()
# def submit_lab_test_with_results(lab_test_id, results):
#     doc = frappe.get_doc("Lab Test", lab_test_id)
#     for row in doc.lab_test_items:
#         key = row.parameter.lower().replace(" ", "_")
#         row.result_value = results.get(key)
#     doc.save()
#     doc.submit()
import frappe
import json

@frappe.whitelist()
def submit_lab_test_with_results(lab_test_id, results):
    results = json.loads(results) 

    doc = frappe.get_doc("Lab Test", lab_test_id)
    for row in doc.normal_test_items:
        if row.name in results:
            row.result_value = results[row.name]

    doc.save()
    doc.submit()

