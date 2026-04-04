import sqlite3
import json
import os

db_path = 'fred_triangulated_unemployment_data.db'
if not os.path.exists(db_path):
    print("Database not found. Please pull the data using employmentrate_single_download.py first.")
    exit(1)

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

cursor.execute("SELECT * FROM unemployment_data")
rows = cursor.fetchall()
data = [dict(row) for row in rows]

conn.close()

# Ensure public dir exists for Vite static assets
os.makedirs('public', exist_ok=True)
json_path = os.path.join('public', 'unemployment_data.json')

with open(json_path, 'w') as f:
    json.dump(data, f)

print(f"Successfully converted SQLite database to {json_path}")
