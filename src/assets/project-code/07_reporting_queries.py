# Databricks notebook source
# MAGIC %md
# MAGIC # 07 - Reporting Queries
# MAGIC
# MAGIC Source-period reports over persisted Gold, with real zone names and operational context. Source financial amounts are not a validated net-revenue definition. No business table is modified.

# COMMAND ----------

# MAGIC %run ./01_setup_and_config

# COMMAND ----------

from datetime import date
from pyspark.sql import functions as F

year, month = int(process_year), int(process_month)
period_start = date(year, month, 1)
next_month_start = date(year + (month == 12), 1 if month == 12 else month + 1, 1)
month_predicate = f"_process_year = {year} AND _process_month = {month}"
report_fact_view = "taxi_report_facts"
report_facts = spark.table(gold_fact_table).where(month_predicate)
require_columns(report_facts, [
    "_process_year", "_process_month", "date_key", "pickup_zone_key", "dropoff_zone_key",
    "payment_type_id", "total_amount", "fare_amount", "trip_distance", "trip_duration_minutes"
])
report_count = report_facts.count()
if report_count == 0:
    raise ValueError("No Gold rows for the selected source period. Complete notebook 05 first.")

for table_name, key, required in [
    (gold_zone_table, "zone_id", ["zone_id", "borough", "zone_name"]),
    (gold_date_table, "date_key", ["date_key", "pickup_date"]),
]:
    dimension = spark.table(table_name)
    require_columns(dimension, required)
    if dimension.where(F.col(key).isNull()).limit(1).count():
        raise ValueError(f"Null dimension key in {table_name}")
    if dimension.groupBy(key).count().where(F.col("count") > 1).limit(1).count():
        raise ValueError(f"Duplicate dimension key in {table_name}; reporting joins would multiply trips")
    fact_keys = ["pickup_zone_key", "dropoff_zone_key"] if key == "zone_id" else ["date_key"]
    for fact_key in fact_keys:
        available = dimension.select(F.col(key).alias("_key"))
        missing = report_facts.select(F.col(fact_key).alias("_key")).distinct().join(available, "_key", "left_anti")
        if missing.limit(1).count():
            raise ValueError(f"Missing dimension reference for {fact_key}; run notebook 06 to investigate.")

report_facts.createOrReplaceTempView(report_fact_view)
print(f"source_period={year}-{month:02d}")
print(f"report_fact_count={report_count}")

# COMMAND ----------

# DBTITLE 1,Show Latest Reconciliation Attempt For This Source Period
check_results_table = f"{recon_table}_checks"
latest_reconciliation_status = "NOT_RUN"
if spark.catalog.tableExists(check_results_table):
    latest_attempt_df = spark.sql(f"""
        SELECT batch_id, overall_status, MAX(reconciled_at_utc) AS last_checked_at
        FROM {check_results_table}
        WHERE process_year = '{year}' AND CAST(process_month AS INT) = {month}
        GROUP BY batch_id, overall_status
        ORDER BY last_checked_at DESC, batch_id DESC
        LIMIT 1
    """)
    latest_attempt = latest_attempt_df.first()
    if latest_attempt is not None:
        latest_reconciliation_status = latest_attempt["overall_status"]
        display(latest_attempt_df)
        latest_checks = spark.table(check_results_table).where(
            (F.col("process_year") == str(year)) &
            (F.col("process_month").cast("int") == month) &
            (F.col("batch_id") == latest_attempt["batch_id"])
        )
        display(latest_checks.where(F.col("check_status") != "PASS").orderBy("check_name"))

print(f"latest_recorded_reconciliation_status={latest_reconciliation_status}")
print("The recorded check attempt may predate later data changes; run notebook 06 after any upstream rerun.")
if latest_reconciliation_status == "FAIL":
    raise ValueError("Latest reconciliation failed. Investigate notebook 06 before publishing these reports.")
if latest_reconciliation_status in ["NOT_RUN", "WARN"]:
    print("PROVISIONAL REPORTS: reconciliation is absent or has warnings; inspect quality observations before sharing.")

# COMMAND ----------

# DBTITLE 1,Source-Month Trip And Amount Summary
monthly_summary_df = spark.sql(f"""
SELECT
  _process_year AS source_year,
  _process_month AS source_month,
  COUNT(*) AS trip_count,
  ROUND(SUM(CAST(total_amount AS DECIMAL(20,2))), 2) AS source_total_amount,
  ROUND(SUM(CAST(fare_amount AS DECIMAL(20,2))), 2) AS source_fare_amount,
  SUM(CASE WHEN total_amount IS NULL THEN 1 ELSE 0 END) AS null_total_amount_count,
  ROUND(AVG(total_amount), 2) AS avg_source_total_amount,
  ROUND(AVG(trip_distance), 2) AS avg_trip_distance,
  ROUND(AVG(trip_duration_minutes), 2) AS avg_trip_duration_minutes
FROM {report_fact_view}
GROUP BY _process_year, _process_month
ORDER BY source_year, source_month
""")
display(monthly_summary_df)

# COMMAND ----------

# DBTITLE 1,Pickup-Date Distribution Including Out-Of-Period Dates
daily_summary_df = spark.sql(f"""
SELECT d.pickup_date,
  COUNT(*) AS trip_count,
  ROUND(SUM(CAST(f.total_amount AS DECIMAL(20,2))), 2) AS source_total_amount,
  CASE WHEN d.pickup_date < '{period_start}' OR d.pickup_date >= '{next_month_start}'
       THEN 1 ELSE 0 END AS outside_source_month
FROM {report_fact_view} AS f
LEFT JOIN {gold_date_table} AS d ON f.date_key = d.date_key
GROUP BY d.pickup_date
ORDER BY d.pickup_date
""")
display(daily_summary_df)

# COMMAND ----------

# DBTITLE 1,Top Pickup Zones By Accepted Trip Count
top_pickup_zones_df = spark.sql(f"""
SELECT z.zone_id, z.borough, z.zone_name,
  COUNT(*) AS trip_count,
  ROUND(SUM(CAST(f.total_amount AS DECIMAL(20,2))), 2) AS source_total_amount
FROM {report_fact_view} AS f
LEFT JOIN {gold_zone_table} AS z ON f.pickup_zone_key = z.zone_id
GROUP BY z.zone_id, z.borough, z.zone_name
ORDER BY trip_count DESC, z.zone_id
LIMIT 20
""")
display(top_pickup_zones_df)

# COMMAND ----------

# DBTITLE 1,Top Dropoff Zones By Accepted Trip Count
top_dropoff_zones_df = spark.sql(f"""
SELECT z.zone_id, z.borough, z.zone_name,
  COUNT(*) AS trip_count,
  ROUND(SUM(CAST(f.total_amount AS DECIMAL(20,2))), 2) AS source_total_amount
FROM {report_fact_view} AS f
LEFT JOIN {gold_zone_table} AS z ON f.dropoff_zone_key = z.zone_id
GROUP BY z.zone_id, z.borough, z.zone_name
ORDER BY trip_count DESC, z.zone_id
LIMIT 20
""")
display(top_dropoff_zones_df)

# COMMAND ----------

# DBTITLE 1,Top Pickup-To-Dropoff Routes
top_routes_df = spark.sql(f"""
SELECT p.zone_id AS pickup_zone_key, p.zone_name AS pickup_zone,
       d.zone_id AS dropoff_zone_key, d.zone_name AS dropoff_zone,
       COUNT(*) AS trip_count,
       ROUND(SUM(CAST(f.total_amount AS DECIMAL(20,2))), 2) AS source_total_amount,
       ROUND(AVG(f.trip_duration_minutes), 2) AS avg_trip_duration_minutes
FROM {report_fact_view} AS f
LEFT JOIN {gold_zone_table} AS p ON f.pickup_zone_key = p.zone_id
LEFT JOIN {gold_zone_table} AS d ON f.dropoff_zone_key = d.zone_id
GROUP BY p.zone_id, p.zone_name, d.zone_id, d.zone_name
ORDER BY trip_count DESC, p.zone_id, d.zone_id
LIMIT 20
""")
display(top_routes_df)

# COMMAND ----------

# DBTITLE 1,Payment Code Distribution Without Invented Descriptions
payment_distribution_df = spark.sql(f"""
SELECT payment_type_id,
  COUNT(*) AS trip_count,
  ROUND(SUM(CAST(total_amount AS DECIMAL(20,2))), 2) AS source_total_amount
FROM {report_fact_view}
GROUP BY payment_type_id
ORDER BY trip_count DESC, payment_type_id
""")
display(payment_distribution_df)

# COMMAND ----------

# DBTITLE 1,Quality Counts And Quarantine Reasons
bronze_report_count = spark.table(bronze_table).where(month_predicate).count()
quarantine_report = spark.table(quarantine_table).where(month_predicate)
quarantine_report_count = quarantine_report.count()
silver_report_count = spark.table(silver_table).where(month_predicate).count()
quality_summary_df = spark.createDataFrame(
    [(year, month, bronze_report_count, quarantine_report_count, silver_report_count, report_count,
      round(100.0 * quarantine_report_count / bronze_report_count, 4) if bronze_report_count else None)],
    "source_year int, source_month int, bronze_count long, quarantine_count long, silver_count long, gold_count long, quarantine_pct double"
)
display(quality_summary_df)
require_columns(quarantine_report, ["_dq_error"])
reason_distribution_df = (
    quarantine_report
    .select(F.explode(F.split(F.col("_dq_error"), "; ")).alias("reason"))
    .where(F.col("reason").isNotNull() & (F.trim(F.col("reason")) != ""))
    .groupBy("reason").count()
    .orderBy(F.col("count").desc(), F.col("reason"))
)
display(reason_distribution_df)
print("A trip can have multiple reasons, so reason counts need not sum to the quarantine row count.")
print("COMPLETED: selected-period reports displayed. This notebook does not create a dashboard or schedule.")

