import frappe
from frappe.utils import nowdate, add_days, get_datetime_str

@frappe.whitelist()
def update_consultation_validity(patient, doctor):
    """
    Update consultation validity for a specific doctor using direct database operations
    to avoid concurrency issues with child tables
    """
    try:
        # Get patient details
        patient_doc = frappe.get_doc("Patient", patient)
        patient_doc.reload()
        free_consultation_period = patient_doc.custom_free_consultation_period_ or 30
        
        # Today's date
        today = nowdate()
        valid_upto = add_days(today, int(free_consultation_period))
        
        # First check if this doctor already exists in the child table
        existing_record = frappe.db.sql("""
            SELECT name 
            FROM `tabPatient Consultation Validity` 
            WHERE parent=%s AND doctor_name=%s
        """, (patient, doctor), as_dict=1)
        
        if existing_record:
            # Update existing record
            record_name = existing_record[0].name
            frappe.db.sql("""
                UPDATE `tabPatient Consultation Validity`
                SET consultation_renewal_date=%s, consultation_valid_upto_date=%s
                WHERE name=%s
            """, (today, valid_upto, record_name))
        else:
            # Insert new record
            new_record = frappe.new_doc("Patient Consultation Validity")
            new_record.parent = patient
            new_record.parenttype = "Patient"
            new_record.parentfield = "custom_consultation_validity"
            new_record.doctor_name = doctor
            new_record.consultation_renewal_date = today
            new_record.consultation_valid_upto_date = valid_upto
            new_record.insert(ignore_permissions=True)
        
        # Manually update the modified timestamp on the parent doc to avoid conflicts
        frappe.db.sql("""
            UPDATE `tabPatient` 
            SET modified=%s 
            WHERE name=%s
        """, (get_datetime_str(frappe.utils.now()), patient))
        
        frappe.db.commit()
        
        return {
            'success': True,
            'message': f'Consultation validity updated for {doctor}'
        }
        
    except Exception as e:
        frappe.log_error(f"Consultation validity update error: {str(e)}", "Consultation Update Error")
        frappe.db.rollback()
        return {
            'success': False,
            'error': str(e)
        }



 
    