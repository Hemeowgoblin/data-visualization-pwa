import pandas as pd
import sqlite3
import os
from fredapi import Fred

# Configuration
API_KEY = os.environ.get('FRED_API_KEY', "d9db361476e27b27396d59e190de8c7a")
fred = Fred(api_key=API_KEY)

# THE TRIANGULATION MAP
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
    ids = {'Rate': f'LNU04{suffix}', 'Unemployed': f'LNU03{suffix}', 'Labor_Force': f'LNU01{suffix}'}
    data_frames = {}
    titles = {}
    for attr, s_id in ids.items():
        try:
            info = fred.get_series_info(s_id)
            titles[attr] = info.title
            series = fred.get_series(s_id)
            data_frames[attr] = series.resample('YE').mean()
        except:
            data_frames[attr] = None
    
    for year in range(1948, 2027):
        row = {'Year': year, 'Category': category, 'Subset': subset, 'Gender': gender, 'Rate_%': None, 'Unemployed_Level': None, 'Labor_Force_Level': None}
        if data_frames['Rate'] is not None and year in data_frames['Rate'].index.year:
            row['Rate_%'] = round(data_frames['Rate'].loc[f'{year}-12-31'], 2)
        if data_frames['Unemployed'] is not None and year in data_frames['Unemployed'].index.year:
            row['Unemployed_Level'] = round(data_frames['Unemployed'].loc[f'{year}-12-31'], 2)
        if data_frames['Labor_Force'] is not None and year in data_frames['Labor_Force'].index.year:
            row['Labor_Force_Level'] = round(data_frames['Labor_Force'].loc[f'{year}-12-31'], 2)
        # Re-apply math logic
        if pd.isna(row['Rate_%']) and row['Unemployed_Level'] and row['Labor_Force_Level'] and row['Labor_Force_Level'] > 0:
            row['Rate_%'] = round((row['Unemployed_Level'] / row['Labor_Force_Level']) * 100, 2)
        results.append(row)
    return results

if __name__ == "__main__":
    all_data = []
    for subset in subsets:
        print(f"Processing: {subset[1]} {subset[2]}...")
        all_data.extend(fetch_triplet(*subset))
    df = pd.DataFrame(all_data)
    
    # Post-process: % of unemployment level to total unemployment level per category
    totals = df.groupby(['Year', 'Category', 'Gender'])['Unemployed_Level'].transform('sum')
    df['Unemployed_Percent_Of_Category'] = (df['Unemployed_Level'] / totals) * 100
    df['Unemployed_Percent_Of_Category'] = df['Unemployed_Percent_Of_Category'].round(2)

    conn = sqlite3.connect('fred_triangulated_unemployment_data.db')
    df.to_sql('unemployment_data', conn, if_exists='replace', index=False)
    conn.close()
    
    # Export flat JSON for the static progressive web app
    df.to_json('public/unemployment_data.json', orient='records')
    print("Database and JSON generated.")
    
    print("Calling convert_db.py...")
    import subprocess
    subprocess.run(['python', 'convert_db.py'])