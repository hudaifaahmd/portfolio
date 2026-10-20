# Databricks notebook source
# MAGIC %md
# MAGIC # 02 - Ingest To Bronze
# MAGIC
# MAGIC This notebook ingests one monthly NYC Taxi trip file and writes it to a bronze Delta table with ingestion metadata.

# COMMAND ----------

# MAGIC %run ./01_setup_and_config

# COMMAND ----------

import os
import shutil
from hashlib import sha256
from urllib.request import urlopen
from pyspark.sql import functions as F

# COMMAND ----------

# DBTITLE 1,Read Source Data
year = int(process_year)
month = int(process_month)
if not (2009 <= year <= datetime.now(timezone.utc).year and 1 <= month <= 12):
    raise ValueError("Use a valid NYC taxi processing year and month")

spark.sql(f"CREATE VOLUME IF NOT EXISTS {catalog_name}.{schema_name}.landing")
landing_directory = f"/Volumes/{catalog_name}/{schema_name}/landing/yellow/{year}/{month:02d}/{batch_id}"
os.makedirs(landing_directory, exist_ok=True)
landing_file = f"{landing_directory}/yellow_tripdata_{year}-{month:02d}.parquet"


def read_monthly_taxi_file(url, destination):
    """Stream the original file to a Volume before the distributed Spark read."""
    try:
        with urlopen(url, timeout=120) as response, open(destination, "wb") as target:
            shutil.copyfileobj(response, target, length=1024 * 1024)
        with open(destination, "rb") as downloaded:
            if os.path.getsize(destination) < 12 or downloaded.read(4) != b"PAR1":
                raise ValueError("Downloaded source is not a valid Parquet file")
            downloaded.seek(-4, os.SEEK_END)
            if downloaded.read(4) != b"PAR1":
                raise ValueError("Downloaded Parquet file is incomplete")
    except Exception:
        if os.path.exists(destination):
            os.remove(destination)
        raise
    return spark.read.parquet(destination)


raw_df = read_monthly_taxi_file(source_url, landing_file)
require_columns(raw_df, ["VendorID", "tpep_pickup_datetime", "tpep_dropoff_datetime", "passenger_count",
                        "trip_distance", "PULocationID", "DOLocationID", "payment_type", "fare_amount", "total_amount"])
# Normalize known source numeric drift to existing Bronze column types without allowing truncation.
if spark.catalog.tableExists(bronze_table):
    numeric_types = {"byte", "short", "integer", "long", "float", "double", "decimal"}
    original_types = {field.name: field.dataType for field in raw_df.schema.fields}
    for field in spark.table(bronze_table).schema.fields:
        if field.name not in original_types or field.dataType == original_types[field.name]:
            continue
        source_type = original_types[field.name]
        if source_type.typeName() not in numeric_types or field.dataType.typeName() not in numeric_types:
            raise ValueError(f"Non-additive source schema change for {field.name}: {source_type} -> {field.dataType}")
        coerced = F.col(field.name).cast(field.dataType)
        lossy = raw_df.where(F.col(field.name).isNotNull() & (
            coerced.isNull() | ~coerced.cast("decimal(38,12)").eqNullSafe(F.col(field.name).cast("decimal(38,12)"))
        )).limit(1).count()
        if lossy:
            raise ValueError(f"Lossy source numeric schema change for {field.name}")
        raw_df = raw_df.withColumn(field.name, coerced)
source_hasher = sha256()
with open(landing_file, "rb") as landed_source:
    for chunk in iter(lambda: landed_source.read(1024 * 1024), b""):
        source_hasher.update(chunk)
source_file_sha256 = source_hasher.hexdigest()
print(f"source_sha256={source_file_sha256}")
source_count = raw_df.count()
if source_count == 0:
    raise ValueError("Empty source: refusing to replace existing Bronze data")

print(f"landing_file={landing_file}")
print(f"source_count={source_count}")
display(raw_df.limit(10))

# COMMAND ----------

# DBTITLE 1,Write Bronze Delta Table
bronze_df = add_ingestion_metadata(raw_df, source_url)
month_predicate = f"_process_year = {int(process_year)} AND _process_month = {int(process_month)}"

# Delta commits the selected month's replacement atomically, preserving other months.
(
    bronze_df.write
    .format("delta")
    .mode("overwrite")
    .option("mergeSchema", "true")
    .option("replaceWhere", month_predicate)
    .partitionBy("_process_year", "_process_month")
    .saveAsTable(bronze_table)
)

target_count = spark.table(bronze_table).where(month_predicate).count()
if target_count != source_count:
    write_audit_record("bronze", bronze_table, "FAILED", source_count, target_count, None, "Stored monthly count differs from source")
    raise ValueError(f"Bronze reconciliation failed: source={source_count}, target={target_count}")
write_audit_record("bronze", bronze_table, "SUCCESS", source_count, target_count, 0)

print(f"bronze_table={bronze_table}")
print(f"target_count={target_count}")
print("SUCCESS: monthly Bronze replacement and count reconciliation completed")

