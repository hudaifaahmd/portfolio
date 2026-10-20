# Databricks notebook source
# MAGIC %md
# MAGIC # 03 - Quality Checks
# MAGIC
# MAGIC Apply configured quality rules, including the source-month pickup-date grace window, and replace that month's quarantine records. Original Bronze remains unchanged. Accepted rows are persisted by notebook 04.

# COMMAND ----------

# MAGIC %run ./01_setup_and_config

# COMMAND ----------

from pyspark.sql import functions as F

# COMMAND ----------

# DBTITLE 1,Load Current Batch From Bronze
bronze_batch_df = (
    spark.table(bronze_table)
    .where((F.col("_process_year") == int(process_year)) & (F.col("_process_month") == int(process_month)))
)

required_columns = [
    "VendorID",
    "tpep_pickup_datetime",
    "tpep_dropoff_datetime",
    "passenger_count",
    "trip_distance",
    "PULocationID",
    "DOLocationID",
    "payment_type",
    "fare_amount",
    "total_amount"
]

require_columns(bronze_batch_df, required_columns)

bronze_count = bronze_batch_df.count()
if bronze_count == 0:
    raise ValueError("No Bronze rows for this period. Run notebook 02 with matching year/month first.")
print(f"bronze_count={bronze_count}")

# COMMAND ----------

# DBTITLE 1,Build Validation Rules
allowed_pickup_start, allowed_pickup_end = pickup_date_bounds(int(process_year), int(process_month), boundary_grace_days)
print(f"allowed_pickup_dates=[{allowed_pickup_start}, {allowed_pickup_end})")
numeric_errors = []
for numeric_name in ["trip_distance", "fare_amount", "total_amount"]:
    numeric_value = F.expr(f"try_cast(`{numeric_name}` AS double)")
    numeric_errors.append(F.when(
        numeric_value.isNull() | F.isnan(numeric_value) | (F.abs(numeric_value) == F.lit(float("inf"))),
        F.lit(f"missing_or_nonfinite_{numeric_name}")
    ))
validated_df = (
    bronze_batch_df
    .withColumn(
        "_dq_error",
        F.concat_ws(
            "; ",
            F.when(F.col("VendorID").isNull(), F.lit("missing_vendor_id")),
            F.when(F.col("tpep_pickup_datetime").isNull(), F.lit("missing_pickup_datetime")),
            F.when(F.col("tpep_dropoff_datetime").isNull(), F.lit("missing_dropoff_datetime")),
            F.when(F.col("PULocationID").isNull(), F.lit("missing_pickup_location")),
            F.when(F.col("DOLocationID").isNull(), F.lit("missing_dropoff_location")),
            F.when(F.col("trip_distance") < 0, F.lit("negative_trip_distance")),
            F.when(F.col("fare_amount") < 0, F.lit("negative_fare_amount")),
            F.when(F.col("total_amount") < 0, F.lit("negative_total_amount")),
            F.when(F.col("tpep_dropoff_datetime") < F.col("tpep_pickup_datetime"), F.lit("dropoff_before_pickup")),
            F.when(pickup_outside_allowed_window("tpep_pickup_datetime"), F.lit("pickup_date_outside_allowed_window")),
            *numeric_errors
        )
    )
)

valid_df = validated_df.where(F.col("_dq_error") == "")
reject_df = (
    validated_df
    .where(F.col("_dq_error") != "")
    .withColumn("_rejected_at_utc", F.current_timestamp())
)

valid_count = valid_df.count()
reject_count = reject_df.count()

print(f"valid_count={valid_count}")
print(f"reject_count={reject_count}")

# COMMAND ----------

# DBTITLE 1,Write Quarantine Records
if valid_count + reject_count != bronze_count:
    write_audit_record("quality", quarantine_table, "FAILED", bronze_count, valid_count, reject_count, "Accepted plus rejected count differs from Bronze")
    raise ValueError("Quality reconciliation failed: accepted + rejected must equal Bronze")

month_predicate = f"_process_year = {int(process_year)} AND _process_month = {int(process_month)}"
# Write even an empty reject set so a corrected month's stale rejects are removed.
(
    reject_df.write
    .format("delta")
    .mode("overwrite")
    .option("mergeSchema", "true")
    .option("replaceWhere", month_predicate)
    .partitionBy("_process_year", "_process_month")
    .saveAsTable(quarantine_table)
)

stored_reject_count = spark.table(quarantine_table).where(month_predicate).count()
if stored_reject_count != reject_count:
    write_audit_record("quality", quarantine_table, "FAILED", bronze_count, valid_count, stored_reject_count, "Stored quarantine count differs from flagged count")
    raise ValueError("Quarantine reconciliation failed: stored count differs from flagged count")

write_audit_record("quality", quarantine_table, "SUCCESS", bronze_count, valid_count, reject_count)

print(f"stored_reject_count={stored_reject_count}")
print("SUCCESS: initial quality checks and monthly quarantine replacement completed")
display(reject_df.limit(20))

