"""
summarized_directory_database_downloader.py

Downloads all FRED data series listed in 'summarized_directory.csv' and stores
them as monthly entries (with full category labels) into 'summarized_directory_database.db'.

Each row in the output table corresponds to one monthly observation,
and includes all label columns from the CSV directory.

After downloading, this script automatically calls
'summarized_directory_database_postprocess.py'.

A log CSV ('summarized_directory_database_downloader_log.csv') is written
with status details for every series attempted, including observation counts.

April 8, 2026: there are 8593 records in the compact unemployment database.

"""

import os
import sys
import time
import sqlite3
import subprocess
import traceback
from datetime import datetime
import pandas as pd
from fredapi import Fred

# ── Configuration ───────────────────────────────────────────────────────────────
API_KEY    = os.environ.get('FRED_API_KEY', "d9db361476e27b27396d59e190de8c7a")
CSV_PATH   = "summarized_directory.csv"
DB_PATH    = "summarized_directory_database.db"
LOG_PATH   = "summarized_directory_database_downloader_log.csv"
TABLE      = "monthly_data"
POSTPROCESS_SCRIPT = "summarized_directory_database_postprocess.py"

# Rate-limit retry settings
MAX_RETRIES       = 3       # maximum attempts per series
RETRY_WAIT_SEC    = 60      # seconds to wait after a "Too Many Requests" error
INTER_REQUEST_SEC = 0.6     # polite pause between every successful request (~100/min)

# ── Initialise FRED client ──────────────────────────────────────────────────────
fred = Fred(api_key=API_KEY)


# ══════════════════════════════════════════════════════════════════════════════
# Helper utilities
# ══════════════════════════════════════════════════════════════════════════════

def load_directory(csv_path: str) -> pd.DataFrame:
    """Read the CSV directory and return a clean DataFrame."""
    df = pd.read_csv(csv_path)
    df.columns = [c.strip() for c in df.columns]
    for col in df.select_dtypes(include="object").columns:
        df[col] = df[col].str.strip()
    return df


def get_expected_count(series_id: str) -> int:
    """
    Query series info from FRED to determine how many monthly observations
    should exist between 'observation_start' and 'observation_end'.
    """
    try:
        info = fred.get_series_info(series_id)
        start = pd.to_datetime(info.observation_start)
        end = pd.to_datetime(info.observation_end)
        
        # Simple monthly calculation: (end_year - start_year) * 12 + (end_month - start_month) + 1
        return (end.year - start.year) * 12 + (end.month - start.month) + 1
    except:
        return 0


def download_series(series_id: str, conn: sqlite3.Connection) -> tuple[pd.Series | None, str, str, str, int, int]:
    """
    Download a single FRED series with automatic retry on rate-limit errors.
    If partial data was previously inserted for this series, it is deleted before retrying.

    Returns
    -------
    (data, status, warning, detail, expected_count, actual_count)
    """
    expected = get_expected_count(series_id)
    
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            # Clean up any partial data from previous failed attempts
            conn.execute(f"DELETE FROM {TABLE} WHERE series_id = ?", (series_id,))
            conn.commit()

            data = fred.get_series(series_id)
            if data is None or data.empty:
                return None, "skipped", "EmptyResponse", "FRED returned an empty series.", expected, 0
            
            actual = len(data)
            return data, "ok", "", "", expected, actual

        except Exception as exc:
            exc_str   = str(exc)
            exc_lower = exc_str.lower()

            # ── Server error (5xx) or Rate limit (429) ──────────────────────
            is_rate_limit = "too many requests" in exc_lower or "rate limit" in exc_lower or "429" in exc_str
            is_server_err = "internal server error" in exc_lower or "500" in exc_str

            if is_rate_limit or is_server_err:
                if attempt < MAX_RETRIES:
                    wait_time = RETRY_WAIT_SEC if is_rate_limit else 5 # Wait less for common server hiccups
                    category = "Rate limit" if is_rate_limit else "Server error"
                    print(f"  [WARN] {category} hit for {series_id} (attempt {attempt}/{MAX_RETRIES}). Waiting {wait_time}s...")
                    time.sleep(wait_time)
                    continue
                
                err_type = "RateLimit" if is_rate_limit else "ServerError"
                return None, "failed", err_type, f"Gave up after {MAX_RETRIES} attempts. Last error: {exc_str}", expected, 0

            # ── Not found ────────────────────────────────────────────────────
            elif "not found" in exc_lower or "404" in exc_str:
                return None, "failed", "NotFound", f"Series ID not found: {exc_str}", expected, 0

            # ── Any other error ──────────────────────────────────────────────
            else:
                return None, "failed", "UnknownError", str(exc), expected, 0

    return None, "failed", "MaxRetries", "Exhausted retries.", expected, 0


def build_rows(series_id: str,
               monthly_data: pd.Series,
               meta: dict) -> list[dict]:
    """
    Convert a monthly FRED Series into a list of row dicts that include
    all label columns from the CSV directory.
    """
    rows = []
    for date, value in monthly_data.items():
        row = {
            "series_id":               series_id,
            "date":                    date.strftime("%Y-%m-%d"),
            "year":                    date.year,
            "month":                   date.month,
            "value":                   None if pd.isna(value) else round(float(value), 6),
            "units":                   meta.get("Units"),
            "gender":                  meta.get("Gender"),
            "age":                     meta.get("Age [years]"),
            "disability":              meta.get("Disability"),
            "race":                    meta.get("Race"),
            "industry_and_class":      meta.get("Industry and Class of Worker"),
            "educational_attainment":  meta.get("Educational Attainment"),
            "occupation":              meta.get("Occupation"),
            "veteran_status":          meta.get("Veteran Status"),
            "period_of_service":       meta.get("Period of Service"),
            "nativity":                meta.get("Nativity"),
            "metric":                  meta.get("Metric"),
            "series_description":      meta.get("Series Description"),
        }
        rows.append(row)
    return rows


def init_database(conn: sqlite3.Connection) -> None:
    """Create the monthly_data table (drop if it already exists)."""
    conn.execute(f"DROP TABLE IF EXISTS {TABLE}")
    conn.execute(f"""
        CREATE TABLE {TABLE} (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            series_id                TEXT    NOT NULL,
            date                     TEXT    NOT NULL,
            year                     INTEGER NOT NULL,
            month                    INTEGER NOT NULL,
            value                    REAL,
            units                    TEXT,
            gender                   TEXT,
            age                      TEXT,
            disability               TEXT,
            race                     TEXT,
            industry_and_class       TEXT,
            educational_attainment   TEXT,
            occupation               TEXT,
            veteran_status           TEXT,
            period_of_service        TEXT,
            nativity                 TEXT,
            metric                   TEXT,
            series_description       TEXT
        )
    """)
    conn.execute(f"CREATE INDEX IF NOT EXISTS idx_series_date ON {TABLE} (series_id, date)")
    conn.execute(f"CREATE INDEX IF NOT EXISTS idx_metric       ON {TABLE} (metric)")
    conn.commit()
    print(f"Database initialised: {DB_PATH}")


def insert_rows(conn: sqlite3.Connection, rows: list[dict]) -> None:
    """Bulk-insert a list of row dicts into the database."""
    if not rows:
        return
    cols         = list(rows[0].keys())
    placeholders = ", ".join("?" * len(cols))
    col_names    = ", ".join(cols)
    values       = [tuple(r[c] for c in cols) for r in rows]
    conn.executemany(
        f"INSERT INTO {TABLE} ({col_names}) VALUES ({placeholders})",
        values,
    )
    conn.commit()


# ══════════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════════

def main() -> None:
    directory = load_directory(CSV_PATH)
    total     = len(directory)
    print(f"Loaded {total} series from '{CSV_PATH}'")

    conn = sqlite3.connect(DB_PATH)
    init_database(conn)

    log_rows = []

    for position, (idx, row_meta) in enumerate(directory.iterrows(), start=1):
        series_id   = row_meta["Series ID"]
        metric      = row_meta.get("Metric", "unknown")
        print(f"[{position}/{total}] Downloading {series_id} ({metric})...")

        monthly, status, warning, detail, expected, actual = download_series(series_id, conn)

        rows_inserted = 0
        if monthly is not None and not monthly.empty:
            rows = build_rows(series_id, monthly, row_meta.to_dict())
            insert_rows(conn, rows)
            rows_inserted = len(rows)
            print(f"  ✓  Inserted {rows_inserted} monthly rows (Expected: {expected}, Actual: {actual}).")
            time.sleep(INTER_REQUEST_SEC)
        else:
            print(f"  [SKIP] {series_id}: {warning} – {detail[:120]}")

        log_rows.append({
            "series_id":          series_id,
            "metric":             metric,
            "status":             status,
            "warning":            warning,
            "expected_obs_count": expected,
            "actual_obs_count":   actual,
            "count_match":        "TRUE" if (expected == actual and expected > 0) else "FALSE",
            "rows_inserted":      rows_inserted,
            "fred_message":       detail,
        })

    conn.close()
    
    log_df = pd.DataFrame(log_rows)
    log_df.to_csv(LOG_PATH, index=False)
    print(f"\nDone! Log saved to '{LOG_PATH}'.")

    # 6. Call post-processing script
    print(f"\nCalling '{POSTPROCESS_SCRIPT}'...")
    result = subprocess.run([sys.executable, POSTPROCESS_SCRIPT], capture_output=False)
    if result.returncode != 0:
        print(f"[WARN] '{POSTPROCESS_SCRIPT}' failed with code {result.returncode}.")
    else:
        print(f"'{POSTPROCESS_SCRIPT}' completed successfully.")


if __name__ == "__main__":
    main()
