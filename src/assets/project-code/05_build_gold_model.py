# Databricks notebook source
# MAGIC %md
# MAGIC # 05 - Build Gold Model
# MAGIC
# MAGIC Load persisted Silver, download the official zone lookup, upsert shared dimensions, and replace only the selected source month's facts. Separate end-to-end reconciliation remains a later stage.

# COMMAND ----------

# MAGIC %run ./01_setup_and_config

# COMMAND ----------

import csv
import io
import os
from hashlib import sha256
from urllib.request import urlopen
from pyspark.sql import functions as F


def parse_zone_lookup(payload):
    reader = csv.DictReader(io.StringIO(payload.decode("utf-8-sig")))
    expected = {"LocationID", "Borough", "Zone", "service_zone"}
    if not expected.issubset(set(reader.fieldnames or [])):
        raise ValueError("Zone lookup is missing required CSV headers")
    rows, seen = [], set()
    for record in reader:
        zone_id = int(record["LocationID"])
        zone_name = (record["Zone"] or "").strip()
        if zone_id <= 0 or zone_id in seen or not zone_name:
            raise ValueError("Invalid/duplicate zone key or empty zone name")
        seen.add(zone_id)
        rows.append((zone_id, record["Borough"], zone_name, record["service_zone"]))
    if not rows:
        raise ValueError("Zone lookup is empty")
    return rows


def upsert_dimension(df, table_name, key_name, view_name):
    df.createOrReplaceTempView(view_name)
    columns = df.columns
    updates = ", ".join(f"t.{name} = s.{name}" for name in columns if name != key_name)
    names = ", ".join(columns)
    values = ", ".join(f"s.{name}" for name in columns)
    # Preserve target keys absent from this month's updates.
    spark.sql(f"""
        MERGE INTO {table_name} AS t
        USING {view_name} AS s ON t.{key_name} = s.{key_name}
        WHEN MATCHED THEN UPDATE SET {updates}
        WHEN NOT MATCHED THEN INSERT ({names}) VALUES ({values})
    """)


def require_unique_keys(df, key_name):
    if df.where(F.col(key_name).isNull()).limit(1).count():
        raise ValueError(f"Dimension has null {key_name}")
    if df.groupBy(key_name).count().where(F.col("count") > 1).limit(1).count():
        raise ValueError(f"Dimension has duplicate {key_name}")


def fact_metrics(df):
    # Rounded per-row cents are a comparison metric; source double fields remain unchanged.
    return df.agg(
        F.count(F.lit(1)).alias("row_count"),
        F.coalesce(F.sum(F.col("total_amount").cast("decimal(20,2)") * 100), F.lit(0)).alias("total_cents"),
        F.coalesce(F.sum(F.col("fare_amount").cast("decimal(20,2)") * 100), F.lit(0)).alias("fare_cents"),
        F.coalesce(F.sum(F.when(F.col("total_amount").isNull(), 1).otherwise(0)), F.lit(0)).alias("total_nulls"),
        F.coalesce(F.sum(F.when(F.col("fare_amount").isNull(), 1).otherwise(0)), F.lit(0)).alias("fare_nulls"),
    ).first().asDict()


def check_fact_metrics(expected, actual):
    if expected != actual:
        raise ValueError(f"Silver/Gold metrics differ: silver={expected}, gold={actual}")

# COMMAND ----------

# DBTITLE 1,Load Persisted Silver Month
month_predicate = f"_process_year = {int(process_year)} AND _process_month = {int(process_month)}"
silver_batch_df = spark.table(silver_table).where(month_predicate)
require_columns(silver_batch_df, [
    "pickup_date", "pickup_ts", "dropoff_ts", "vendor_id", "pickup_location_id",
    "dropoff_location_id", "payment_type_id", "passenger_count", "trip_distance",
    "trip_duration_minutes", "fare_amount", "total_amount", "_batch_id",
    "_process_year", "_process_month"
])
silver_metrics = fact_metrics(silver_batch_df)
silver_count = silver_metrics["row_count"]
if silver_count == 0:
    period_bronze_count = spark.table(bronze_table).where(month_predicate).count()
    period_quarantine_count = spark.table(quarantine_table).where(month_predicate).count()
    if period_bronze_count == 0 or period_quarantine_count != period_bronze_count:
        raise ValueError("Empty Silver is allowed only when a nonempty Bronze month is fully quarantined")
    print("All source rows quarantined: clearing the monthly Gold slice while preserving shared dimensions.")
if silver_batch_df.where(F.col("pickup_date").isNull()).limit(1).count():
    raise ValueError("Resolve Silver null pickup dates before creating Gold")
print(f"process_year={process_year}, process_month={process_month}")
print(f"silver_count={silver_count}")

# COMMAND ----------

# DBTITLE 1,Download And Validate Official TLC Zone Lookup
zone_lookup_url = "https://d37ci6vzurychx.cloudfront.net/misc/taxi_zone_lookup.csv"
max_lookup_bytes = 2 * 1024 * 1024
with urlopen(zone_lookup_url, timeout=120) as response:
    zone_payload = response.read(max_lookup_bytes + 1)
if len(zone_payload) > max_lookup_bytes:
    raise ValueError("Zone lookup exceeded the two-megabyte size limit")
zone_rows = parse_zone_lookup(zone_payload)
zone_lookup_sha256 = sha256(zone_payload).hexdigest()
spark.sql(f"CREATE VOLUME IF NOT EXISTS {catalog_name}.{schema_name}.landing")
reference_directory = f"/Volumes/{catalog_name}/{schema_name}/landing/reference/taxi_zones/{batch_id}"
os.makedirs(reference_directory, exist_ok=True)
zone_lookup_file = f"{reference_directory}/taxi_zone_lookup.csv"
with open(zone_lookup_file, "wb") as target:
    target.write(zone_payload)
print(f"zone_lookup_file={zone_lookup_file}")
print(f"zone_lookup_sha256={zone_lookup_sha256}")
print(f"official_zone_count={len(zone_rows)}")

dim_zone_df = (
    spark.createDataFrame(
        zone_rows + [(-1, "Unknown", "Unknown / unmapped location", "Unknown")],
        "zone_id int, borough string, zone_name string, service_zone string"
    )
    .withColumn("zone_source", F.lit(zone_lookup_url))
)

# COMMAND ----------

# DBTITLE 1,Upsert Shared Dimensions Without Removing Earlier Keys
dim_date_df = (
    silver_batch_df.select("pickup_date").distinct()
    .withColumn("date_key", F.date_format("pickup_date", "yyyyMMdd").cast("int"))
    .withColumn("year", F.year("pickup_date"))
    .withColumn("month", F.month("pickup_date"))
    .withColumn("day", F.dayofmonth("pickup_date"))
    .withColumn("day_of_week", F.date_format("pickup_date", "EEEE"))
    .withColumn("is_weekend", F.dayofweek("pickup_date").isin([1, 7]))
)
require_unique_keys(dim_date_df, "date_key")
require_unique_keys(dim_zone_df, "zone_id")
spark.sql(f"""CREATE TABLE IF NOT EXISTS {gold_date_table} (
    pickup_date DATE, date_key INT, year INT, month INT, day INT,
    day_of_week STRING, is_weekend BOOLEAN
) USING DELTA""")
spark.sql(f"""CREATE TABLE IF NOT EXISTS {gold_zone_table} (
    zone_id INT, borough STRING, zone_name STRING, service_zone STRING, zone_source STRING
) USING DELTA""")

for table_name, required, key in [
    (gold_date_table, dim_date_df.columns, "date_key"),
    (gold_zone_table, dim_zone_df.columns, "zone_id"),
]:
    existing = spark.table(table_name)
    require_columns(existing, required)
    require_unique_keys(existing, key)

upsert_dimension(dim_date_df, gold_date_table, "date_key", "gold_date_updates")
upsert_dimension(dim_zone_df, gold_zone_table, "zone_id", "gold_zone_updates")
date_dimension = spark.table(gold_date_table)
zone_dimension = spark.table(gold_zone_table)
require_unique_keys(date_dimension, "date_key")
require_unique_keys(zone_dimension, "zone_id")

# COMMAND ----------

# DBTITLE 1,Build Trip Facts With Explicit Unknown Zone Mapping
# Original location IDs remain for traceability; separate keys handle unmapped IDs.
pickup_keys = zone_dimension.select(F.col("zone_id").alias("_pickup_match"))
dropoff_keys = zone_dimension.select(F.col("zone_id").alias("_dropoff_match"))
fact_df = (
    silver_batch_df
    .join(pickup_keys, F.col("pickup_location_id") == F.col("_pickup_match"), "left")
    .join(dropoff_keys, F.col("dropoff_location_id") == F.col("_dropoff_match"), "left")
    .withColumn("pickup_zone_key", F.coalesce(F.col("_pickup_match"), F.lit(-1)))
    .withColumn("dropoff_zone_key", F.coalesce(F.col("_dropoff_match"), F.lit(-1)))
    .withColumn("date_key", F.date_format("pickup_date", "yyyyMMdd").cast("int"))
    .select(
        "date_key", "pickup_ts", "dropoff_ts", "vendor_id",
        "pickup_location_id", "dropoff_location_id", "pickup_zone_key", "dropoff_zone_key",
        "payment_type_id", "passenger_count", "trip_distance", "trip_duration_minutes",
        "fare_amount", "total_amount", "_batch_id", "_process_year", "_process_month"
    )
)
check_fact_metrics(silver_metrics, fact_metrics(fact_df))
missing_dates = fact_df.select("date_key").distinct().join(date_dimension.select("date_key"), "date_key", "left_anti")
if missing_dates.limit(1).count():
    raise ValueError("Gold facts contain date keys missing from the date dimension")
unknown_zone_count = fact_df.where((F.col("pickup_zone_key") == -1) | (F.col("dropoff_zone_key") == -1)).count()
print(f"unknown_zone_trip_count={unknown_zone_count}")

# COMMAND ----------

# DBTITLE 1,Replace Monthly Facts And Verify Stored Metrics
(
    fact_df.write.format("delta").mode("overwrite")
    .option("replaceWhere", month_predicate)
    .partitionBy("_process_year", "_process_month")
    .saveAsTable(gold_fact_table)
)
stored_fact_df = spark.table(gold_fact_table).where(month_predicate)
gold_metrics = fact_metrics(stored_fact_df)
try:
    check_fact_metrics(silver_metrics, gold_metrics)
    for key in ["pickup_zone_key", "dropoff_zone_key"]:
        missing = stored_fact_df.select(F.col(key).alias("zone_id")).distinct().join(
            zone_dimension.select("zone_id"), "zone_id", "left_anti"
        )
        if missing.limit(1).count():
            raise ValueError(f"Stored Gold has missing zone references: {key}")
    missing_dates = stored_fact_df.select("date_key").distinct().join(date_dimension.select("date_key"), "date_key", "left_anti")
    if missing_dates.limit(1).count():
        raise ValueError("Stored Gold has missing date references")
except Exception as error:
    write_audit_record("gold", gold_fact_table, "FAILED", silver_count, gold_metrics["row_count"], None, str(error))
    raise

write_audit_record("gold", gold_fact_table, "SUCCESS", silver_count, gold_metrics["row_count"], 0)
print(f"gold_fact_table={gold_fact_table}")
print(f"silver_count={silver_count}")
print(f"stored_gold_count={gold_metrics['row_count']}")
print(f"silver_total_cents={silver_metrics['total_cents']}, gold_total_cents={gold_metrics['total_cents']}")
print(f"silver_fare_cents={silver_metrics['fare_cents']}, gold_fare_cents={gold_metrics['fare_cents']}")
print(f"date_dimension_count={date_dimension.count()}")
print(f"zone_dimension_count={zone_dimension.count()}")
print("SUCCESS: Gold monthly facts, shared dimensions, count/amount checks and reference checks completed")
display(stored_fact_df.limit(10))

