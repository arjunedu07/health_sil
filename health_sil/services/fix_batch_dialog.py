import frappe

def run():
    cs = frappe.get_doc("Client Script", "Pharmacy Billing Conditions")
    lines = cs.script.split('\n')
    
    # Show context from line 429 (item_code handler) to about 30 lines further
    for i, line in enumerate(lines):
        if i >= 428 and i <= 470:
            print(f"  {i+1}: {lines[i]}")
    
    print("\n")
    
    # Show context from line 600 area (where fetch_item_details body is)
    for i, line in enumerate(lines):
        if i >= 600 and i <= 650:
            print(f"  {i+1}: {lines[i]}")
    
    print("\n=== checking for a separate batch handler ===")
    # Check if there is a "batch:" handler in the Pharmaceuticals section
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('batch:') or stripped.startswith('"batch":') or stripped.startswith("batch :"):
            start = max(0, i-2)
            end = min(len(lines), i+15)
            print(f"\nFound batch handler at line {i+1}")
            for j in range(start, end):
                print(f"  {j+1}: {lines[j]}")
