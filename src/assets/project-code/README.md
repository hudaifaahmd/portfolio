# NYC Taxi Lakehouse

Personal reference project by Hudaifa Ahamed. Evidence reviewed October 18, 2026.

## End-To-End Flow

NYC TLC monthly yellow-taxi Parquet -> landing -> Bronze -> quality rules ->
Silver plus quarantine -> Gold -> reconciliation -> analytics and operations.
Implementation: Databricks Free Edition, Python, PySpark, SQL, Delta tables,
and a native daily scheduled Job.

## Verified Snapshot

Coverage: January 2024 through August 2026, 32 source periods.

| Measure | Exact result |
| --- | ---: |
| Bronze rows | 119,595,677 |
| Silver rows | 115,842,411 |
| Gold rows | 115,842,411 |
| Quarantined rows | 3,753,266 |
| Gold source total amount, USD | 3,388,158,595.79 |
| Null Gold total amounts | 0 |
| Weighted quarantine | 3.13829570946783% |

Bronze = Silver + quarantine; Silver = Gold. The monthly reconciliation export
contains 1,536 PASS, 32 WARN, and 0 FAIL across 49 checks per month.
All 32 latest monthly completions were COMPLETED_WARN.
661 accepted pickup-date boundary observations were recorded; beyond-grace
date checks passed. These are not globally unique-trip counts.

The amount is a sum of accepted source total_amount, not validated net revenue.
Negative amounts are among policy exclusions. There is no global deduplication
claim or production SLA.

## Notebook Map

00 overview; 01 configuration; 02 ingestion; 03 quality checks; 04 Silver;
05 Gold; 06 reconciliation; 07 reporting; 08 bounded runner;
09 bundled runtime sources; 10 backfill status.

Import the Python notebook sources into one Databricks workspace folder.
Keep 09 beside 08; start the runner in PLAN mode. Review configuration,
tables, permissions, and available compute before RUN mode, which writes data.
Do not overlap a manual writer with the scheduled Job.

The observed daily schedule is 09:00 Asia/Calcutta, with maximum concurrency 1.
A scheduler-triggered task succeeded on October 18 in 49 seconds.
An unchanged-source manual check skipped June-August 2026 without processing.
Controlled forced replacement and interrupted-run recovery remain unverified live.

## Public Presentation

The portfolio reads a public aggregate report with a dated local snapshot as
fallback. The baseline uses the October 17 check export, cross-checked with
persisted-table SQL on October 18. No raw taxi records, credentials, private
batch IDs or workspace URLs are included. This is monthly batch evidence, not
real-time trips or a daily Job heartbeat.

On October 19 the manually launched two-task Job succeeded: runner 53 seconds,
publisher 14 seconds, UNCHANGED. This demonstrates the dependent-task unchanged
path, not new-data promotion or a scheduler-launched two-task run.

Reviewed source: https://github.com/hudaifaahmd/nyc-taxi-lakehouse.
Git-folder changes do not deploy to the existing Job,
which continues to reference the original workspace notebooks.

Source: https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page

This is an independent learning project, not an official City report. It is not
affiliated with or endorsed by the City of New York or Databricks. Source data
accuracy and completeness are not guaranteed. Databricks Free Edition is for
non-commercial use and has no SLA; this is not a commercial reporting service.
