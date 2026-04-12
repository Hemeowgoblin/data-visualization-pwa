"""
summarized_directory_database_postprocess.py

Four-stage post-processing pipeline:

  Stage A  →  summarized_directory_database_yearly.db
               Yearly averages of each series.
               * Retains ALL years that have at least one monthly entry in 
                 the database (even if the value is NULL).
               * If multiple monthly values exist, it averages non-NULLs.
               * If all monthly values are NULL, the yearly value is NULL.

  Stage B  →  summarized_directory_database_yearly_compact.db
               Pivots yearly data into triplets:
                 rate, level, labor_force (and their series IDs)
               plus all 10 category labels.

  Stage C  →  In-place update of compact DB:
               Fills missing values using: level = (rate * labor_force) / 100
               Sets series ID to 'Calculated' for derived values.

  Stage D  →  public/unemployment_data.json
               Exports the compact data to JSON for the website.
               Calculates 'percent_of_group' (subset level / total level).
"""

import sqlite3
import json
import os
import pandas as pd

# ── File paths ───────────────────────────────────────────────────────────────────
MONTHLY_DB  = "summarized_directory_database.db"
YEARLY_DB   = "summarized_directory_database_yearly.db"
COMPACT_DB  = "summarized_directory_database_yearly_compact.db"
OUTPUT_JSON = "public/unemployment_data.json"

MONTHLY_TABLE = "monthly_data"
YEARLY_TABLE  = "yearly_data"
COMPACT_TABLE = "compact_data"

# Label columns carried through every stage
LABEL_COLS = [
    "gender",
    "age",
    "disability",
    "race",
    "industry_and_class",
    "educational_attainment",
    "occupation",
    "veteran_status",
    "period_of_service",
    "nativity",
]


# ══════════════════════════════════════════════════════════════════════════════
# STAGE A – Monthly → Yearly averages
# ══════════════════════════════════════════════════════════════════════════════

def stage_a_yearly_averages() -> None:
    """
    Groups monthly data by (series_id, year) and computes the mean value.
    Retains all years that had at least one monthly entry in the source table.
    """
    print("\n── Stage A: building yearly averages ─────────────────────────────")

    src = sqlite3.connect(MONTHLY_DB)
    # Read ALL rows (including NULL values)
    query = f"""
        SELECT
            series_id, year, value,
            units, metric, series_description,
            {', '.join(LABEL_COLS)}
        FROM {MONTHLY_TABLE}
    """
    df = pd.read_sql_query(query, src)
    src.close()

    if df.empty:
        print("  [WARN] Monthly database is empty.")
        return

    group_cols = ["series_id", "year", "units", "metric", "series_description"] + LABEL_COLS

    # pandas mean() skips NaN by default. 
    # If all values in a group are NaN, it returns NaN.
    # Groupby will keep all (series_id, year) pairs that exist in df.
    yearly = df.groupby(group_cols, as_index=False, dropna=False)["value"].mean()
    yearly["value"] = yearly["value"].round(6)

    dst = sqlite3.connect(YEARLY_DB)
    dst.execute(f"DROP TABLE IF EXISTS {YEARLY_TABLE}")
    yearly.to_sql(YEARLY_TABLE, dst, index=False)
    dst.execute(f"CREATE INDEX IF NOT EXISTS idx_sid_yr ON {YEARLY_TABLE} (series_id, year)")
    dst.commit()
    dst.close()

    print(f"  ✓  Wrote {len(yearly):,} yearly rows to '{YEARLY_DB}'.")


# ══════════════════════════════════════════════════════════════════════════════
# STAGE B – Yearly → Compact triplet table
# ══════════════════════════════════════════════════════════════════════════════

def stage_b_compact() -> None:
    """Pivots yearly averages into (rate, level, labor_force) columns."""
    print("\n── Stage B: building compact triplet table ─────────────────────")

    src = sqlite3.connect(YEARLY_DB)
    df  = pd.read_sql_query(f"SELECT * FROM {YEARLY_TABLE}", src)
    src.close()

    if df.empty: return

    # Separate by metric
    rate_df  = df[df["metric"] == "rate"].copy()
    level_df = df[df["metric"] == "level"].copy()
    lf_df    = df[df["metric"] == "labor_force"].copy()

    def rename_metric_cols(sub: pd.DataFrame, prefix: str) -> pd.DataFrame:
        sub = sub.rename(columns={"value": prefix, "series_id": f"{prefix}_series_id"})
        return sub.drop(columns=[c for c in ["units", "metric"] if c in sub.columns])

    merge_keys = ["year", "series_description"] + LABEL_COLS

    rate_df  = rename_metric_cols(rate_df,  "rate")
    level_df = rename_metric_cols(level_df, "level")
    lf_df    = rename_metric_cols(lf_df,    "labor_force")

    compact = rate_df[merge_keys + ["rate", "rate_series_id"]].merge(
        level_df[merge_keys + ["level", "level_series_id"]], on=merge_keys, how="outer"
    ).merge(
        lf_df[merge_keys + ["labor_force", "labor_force_series_id"]], on=merge_keys, how="outer"
    )

    ordered = ["year", "series_description"] + LABEL_COLS + [
        "rate", "rate_series_id", "level", "level_series_id", "labor_force", "labor_force_series_id"
    ]
    compact = compact[[c for c in ordered if c in compact.columns]].sort_values(["year", "series_description"])

    dst = sqlite3.connect(COMPACT_DB)
    dst.execute(f"DROP TABLE IF EXISTS {COMPACT_TABLE}")
    compact.to_sql(COMPACT_TABLE, dst, index=False)
    dst.execute(f"CREATE INDEX IF NOT EXISTS idx_yr ON {COMPACT_TABLE} (year)")
    dst.commit()
    dst.close()

    print(f"  ✓  Wrote {len(compact):,} compact rows to '{COMPACT_DB}'.")


# ══════════════════════════════════════════════════════════════════════════════
# STAGE C – Fill missing values
# ══════════════════════════════════════════════════════════════════════════════

def stage_c_fill_missing() -> None:
    """Fills missing values using the rate/level/labor_force identity."""
    print("\n── Stage C: filling missing values ──────────────────────────────")

    conn = sqlite3.connect(COMPACT_DB)
    df   = pd.read_sql_query(f"SELECT rowid, rate, level, labor_force FROM {COMPACT_TABLE}", conn)

    fill_counts = {"rate": 0, "level": 0, "labor_force": 0}

    for _, row in df.iterrows():
        rid, r, l, f = int(row["rowid"]), row["rate"], row["level"], row["labor_force"]
        r_null, l_null, f_null = pd.isna(r), pd.isna(l), pd.isna(f)

        updates = {}
        if r_null and not l_null and not f_null and f != 0:
            updates["rate"], updates["rate_series_id"] = round((l / f) * 100, 6), "Calculated"
            fill_counts["rate"] += 1
        elif l_null and not r_null and not f_null:
            updates["level"], updates["level_series_id"] = round((r * f) / 100, 6), "Calculated"
            fill_counts["level"] += 1
        elif f_null and not r_null and not l_null and r != 0:
            updates["labor_force"], updates["labor_force_series_id"] = round((l / r) * 100, 6), "Calculated"
            fill_counts["labor_force"] += 1

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            conn.execute(f"UPDATE {COMPACT_TABLE} SET {set_clause} WHERE rowid = ?", list(updates.values()) + [rid])

    conn.commit()
    conn.close()
    print(f"  ✓  Filled {sum(fill_counts.values()):,} values.")


# ══════════════════════════════════════════════════════════════════════════════
# STAGE D – Export JSON
# ══════════════════════════════════════════════════════════════════════════════

def stage_d_export_json() -> None:
    """Exports to public/unemployment_data.json and calculates percent_of_group."""
    print("\n── Stage D: exporting JSON ─────────────────────────────────────")

    conn = sqlite3.connect(COMPACT_DB)
    df   = pd.read_sql_query(f"SELECT * FROM {COMPACT_TABLE}", conn)
    conn.close()

    if df.empty: return

    # Identify the 'group' for percentage calculation.
    # We group by Year and Gender. For the 'dimension' grouping, it depends on which labels are 'All'.
    # In this dataset, for a specific series, usually only one label column is not 'All'.
    # We will compute a 'percent_of_group' by summing 'level' over (Year, Gender, and all other labels matching).
    
    # Create a helper key for identical demographics except for the variable dimension
    # (Simplified: we'll just sum level by Year + Gender + any rows that share the same "metric group")
    # Actually, the user wants percent of category. We'll group by Year and the labels that are NOT the variable.
    
    df["percent_of_group"] = None
    
    # We'll iterate over dimensions to find the totals
    for dim in LABEL_COLS:
        if dim == "gender": continue
        
        # Subsets where THIS dimension is varied (not "All") and OTHERS are "All"
        other_dims = [d for d in LABEL_COLS if d != dim and d != "gender"]
        mask = (df[dim] != "All")
        for od in other_dims:
            mask &= (df[od] == "All")
            
        group_df = df[mask].copy()
        if not group_df.empty:
            # Group by year and gender to find the total level for this category
            totals = group_df.groupby(["year", "gender"])["level"].transform("sum")
            df.loc[group_df.index, "percent_of_group"] = (group_df["level"] / totals * 100).round(2)

    # Sort and clean
    df = df.sort_values(["year", "series_description"])
    
    # Rename columns to match website expectations (PascalCase or specific names)
    # The developer requested new standard labels, but the website code uses specific keys.
    # I'll provide a clean list of dicts.
    
    # Convert to JSON
    # Replace NaN with null for JSON compatibility
    records = df.where(pd.notnull(df), None).to_dict(orient="records")
    
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, "w") as f:
        json.dump(records, f)

    print(f"  ✓  Exported {len(records):,} records to '{OUTPUT_JSON}'.")


if __name__ == "__main__":
    stage_a_yearly_averages()
    stage_b_compact()
    stage_c_fill_missing()
    stage_d_export_json()
    print("\nPost-processing complete.")
