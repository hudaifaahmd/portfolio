# Databricks notebook source
# MAGIC %md
# MAGIC # 04 - Transform To Silver
# MAGIC
# MAGIC This notebook standardizes records accepted by notebook 03 and writes a monthly Silver snapshot. It preserves accepted source rows; no unique trip key has been established for deduplication.

# COMMAND ----------

# MAGIC %run ./03_quality_checks

# COMMAND ----------

from pyspark.sql import functions as F

# COMMAND ----------

# DBTITLE 1,Use Accepted Records From Quality Notebook
# %run makes valid_df, counts, configuration, and audit helpers available here.
print(f"bronze_count={bronze_count}")
print(f"valid_count={valid_count}")
print(f"reject_count={reject_count}")

# COMMAND ----------

# DBTITLE 1,Standardize And Derive Columns
silver_standardized_df = (
    valid_df
    .withColumn("pickup_ts", F.col("tpep_pickup_datetime").cast("timestamp"))
    .withColumn("dropoff_ts", F.col("tpep_dropoff_datetime").cast("timestamp"))
    .withColumn("pickup_date", F.to_date("pickup_ts"))
    .withColumn("trip_year", F.year("pickup_ts"))
    .withColumn("trip_month", F.month("pickup_ts"))
    .withColumn("trip_duration_minutes", (F.unix_timestamp("dropoff_ts") - F.unix_timestamp("pickup_ts")) / 60)
    .withColumn("vendor_id", F.col("VendorID").cast("int"))
    .withColumn("pickup_location_id", F.col("PULocationID").cast("int"))
    .withColumn("dropoff_location_id", F.col("DOLocationID").cast("int"))
    .withColumn("payment_type_id", F.col("payment_type").cast("int"))
    .withColumn("passenger_count", F.col("passenger_count").cast("int"))
    .withColumn("trip_distance", F.col("trip_distance").cast("double"))
    .withColumn("fare_amount", F.col("fare_amount").cast("double"))
    .withColumn("total_amount", F.col("total_amount").cast("double"))
)

silver_df = (
    silver_standardized_df
    .select(
        "vendor_id",
        "pickup_ts",
        "dropoff_ts",
        "pickup_date",
        "trip_year",
        "trip_month",
        "pickup_location_id",
        "dropoff_location_id",
        "payment_type_id",
        "passenger_count",
        "trip_distance",
        "trip_duration_minutes",
        "fare_amount",
        "total_amount",
        "_batch_id",
        "_source_name",
        "_ingested_at_utc",
        "_process_year",
        "_process_month"
    )
)

# COMMAND ----------

# DBTITLE 1,Write Silver Delta Table
source_count = bronze_count
target_count = silver_df.count()
if target_count != valid_count or target_count + reject_count != source_count:
    write_audit_record("silver", silver_table, "FAILED", source_count, target_count, reject_count, "Silver rows do not reconcile with accepted Bronze rows")
    raise ValueError("Silver reconciliation failed before writing")

month_predicate = f"_process_year = {int(process_year)} AND _process_month = {int(process_month)}"

(
    silver_df.write
    .format("delta")
    .mode("overwrite")
    .option("replaceWhere", month_predicate)
    .partitionBy("_process_year", "_process_month")
    .saveAsTable(silver_table)
)

stored_silver_count = spark.table(silver_table).where(month_predicate).count()
if stored_silver_count != target_count:
    write_audit_record("silver", silver_table, "FAILED", source_count, stored_silver_count, reject_count, "Stored Silver count differs from transformed count")
    raise ValueError("Silver reconciliation failed after writing")

write_audit_record("silver", silver_table, "SUCCESS", source_count, stored_silver_count, reject_count)

print(f"silver_table={silver_table}")
print(f"target_count={target_count}")
print(f"stored_silver_count={stored_silver_count}")
print("SUCCESS: Silver monthly replacement and count reconciliation completed")
display(silver_df.limit(10))

