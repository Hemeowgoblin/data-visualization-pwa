import pandas as pd
import sqlite3
import os
from fredapi import Fred

# Configuration
# It's recommended to set FRED_API_KEY in your environment variables.
# For example: $env:FRED_API_KEY = "your_key_here" in PowerShell
API_KEY = os.environ.get('FRED_API_KEY', "d9db361476e27b27396d59e190de8c7a")
if not API_KEY:
    print("Warning: FRED_API_KEY environment variable not set.")

fred = Fred(api_key=API_KEY)

# THE TRIANGULATION MAP
# Format: (Category, Subset, Gender, Base_Suffix)
# Pattern: LNU04 (Rate), LNU03 (Unemp Level), LNU01 (Labor Force)
subsets = [
    ('General', 'Total 16+', 'Combined', '000000'),
    ('General', 'Total 16+', 'Male', '000001'),
    ('General', 'Total 16+', 'Female', '000002'),
    ('Age', '16-19', 'Combined', '000012'),
    ('Age', '16-19', 'Male', '000013'),
    ('Age', '16-19', 'Female', '000014'),
    ('Age', '20-24', 'Combined', '000036'),
    ('Age', '20-24', 'Male', '000037'),
    ('Age', '20-24', 'Female', '000038'),
    ('Age', '25-34', 'Combined', '000089'),
    ('Age', '25-34', 'Male', '000164'),
    ('Age', '25-34', 'Female', '000327'),
    ('Race', 'White', 'Combined', '000003'),
    ('Race', 'Black', 'Combined', '000006'),
    ('Race', 'Hispanic', 'Combined', '000009'),
    ('Disability', 'With Disability', 'Combined', '074597'),
    ('Education', 'Bachelors Degree+', 'Combined', '027662'),
]

def fetch_triplet(category, subset, gender, suffix):
    results = []
    # IDs for Rate (04), Unemployed (03), Labor Force (01)
    ids = {
        'Rate': f'LNU04{suffix}',
        'Unemployed': f'LNU03{suffix}',
        'Labor_Force': f'LNU01{suffix}'
    }
    
    # Store annual series here
    data_frames = {}
    titles = {}

    for attr, s_id in ids.items():
        try:
            info = fred.get_series_info(s_id)
            titles[attr] = info.title # PULL EXACT NAME FROM FRED DOCUMENTATION
            series = fred.get_series(s_id)
            data_frames[attr] = series.resample('YE').mean()
        except:
            data_frames[attr] = None
            titles[attr] = "Not Available"

    # Align years from 1948 to current
    all_years = range(1948, 2027)
    for year in all_years:
        row = {
            'Year': year,
            'Category': category,
            'Subset': subset,
            'Gender': gender,
            'Official_Rate_Title': titles.get('Rate'),
            'Rate_%': None,
            'Unemployed_Level': None,
            'Labor_Force_Level': None
        }
        
        # Fill existing data
        if data_frames['Rate'] is not None and year in data_frames['Rate'].index.year:
            row['Rate_%'] = round(data_frames['Rate'].loc[f'{year}-12-31'], 2)
        if data_frames['Unemployed'] is not None and year in data_frames['Unemployed'].index.year:
            row['Unemployed_Level'] = round(data_frames['Unemployed'].loc[f'{year}-12-31'], 2)
        if data_frames['Labor_Force'] is not None and year in data_frames['Labor_Force'].index.year:
            row['Labor_Force_Level'] = round(data_frames['Labor_Force'].loc[f'{year}-12-31'], 2)

        # 4. COMPLIMENTARY CALCULATION LOGIC
        # If Rate is missing, calculate it: (Unemp / LF) * 100
        if pd.isna(row['Rate_%']) and row['Unemployed_Level'] and row['Labor_Force_Level']:
            row['Rate_%'] = round((row['Unemployed_Level'] / row['Labor_Force_Level']) * 100, 2)
            row['Calculation_Flag'] = 'Calculated from Level'
        
        # If Unemployed Level is missing: (Rate * LF) / 100
        elif pd.isna(row['Unemployed_Level']) and row['Rate_%'] and row['Labor_Force_Level']:
            row['Unemployed_Level'] = round((row['Rate_%'] * row['Labor_Force_Level']) / 100, 2)
            row['Calculation_Flag'] = 'Calculated from Rate'
            
        results.append(row)
    return results

# Main execution
all_data = []
for subset in subsets:
    print(f"Processing: {subset[1]} {subset[2]}...")
    all_data.extend(fetch_triplet(*subset))

df = pd.DataFrame(all_data)
conn = sqlite3.connect('fred_triangulated_unemployment_data.db')
df.to_sql('unemployment_data', conn, if_exists='replace', index=False)
conn.close()

# Export flat JSON for the static progressive web app
df.to_json('public/unemployment_data.json', orient='records')

print("\nSUCCESS: Gaps filled using math where possible. Database and 'public/unemployment_data.json' are ready.")