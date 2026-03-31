import csv

batches = {}
with open("/home/silpc-064/frappe-bench/apps/health_sil/Batch_filled (2).csv", "r") as f:
    for row in csv.DictReader(f):
        bid = (row.get("Batch ID") or "").strip()
        item = (row.get("Item") or "").strip()
        qty = (row.get("Batch Quantity") or "0").strip()
        if bid and item:
            key = (bid, item)
            batches.setdefault(key, []).append(float(qty))

stock = {}
with open("/home/silpc-064/frappe-bench/apps/health_sil/Stock_Entry_Upload_Populated.csv", "r") as f:
    for row in csv.DictReader(f):
        item = (row.get("Item Code (Items)") or "").strip()
        batch = (row.get("Batch No (Items)") or "").strip()
        qty = (row.get("Qty (Items)") or "0").strip()
        if batch and item:
            key = (batch, item)
            stock.setdefault(key, []).append(float(qty))

print("=== DUPLICATE BATCHES (same Batch ID + Item more than once) ===")
dc = 0
for k, v in batches.items():
    if len(v) > 1:
        print("  Batch: %s | Item: %s | qtys: %s" % (k[0], k[1], v))
        dc += 1
print("Duplicate count: %d" % dc)

print("")
print("=== DUPLICATE STOCK ENTRIES (same Batch + Item more than once) ===")
dc2 = 0
for k, v in stock.items():
    if len(v) > 1:
        print("  Batch: %s | Item: %s | qtys: %s" % (k[0], k[1], v))
        dc2 += 1
print("Duplicate count: %d" % dc2)

print("")
print("=== ALASPAN DETAILS ===")
for k, v in batches.items():
    if k[1] == "ALASPAN":
        sv = stock.get(k, ["MISSING"])
        print("  Batch=%s  BatchCSV_qty=%s  StockCSV_qty=%s" % (k[0], v, sv))

print("")
print("=== QUANTITY MISMATCHES (Batch qty != Stock Entry qty) ===")
mc = 0
for k in batches:
    if k in stock:
        bq = sum(batches[k])
        sq = sum(stock[k])
        if abs(bq - sq) > 0.01:
            print("  Batch: %s | Item: %s | batch_csv=%s stock_csv=%s" % (k[0], k[1], bq, sq))
            mc += 1
print("Mismatch count: %d" % mc)

print("")
print("Total unique batches in Batch CSV: %d" % len(batches))
print("Total unique entries in Stock CSV: %d" % len(stock))
