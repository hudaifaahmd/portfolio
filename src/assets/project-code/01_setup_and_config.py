# Databricks notebook source
# MAGIC %md
# MAGIC # 01 - Setup And Configuration
# MAGIC
# MAGIC This notebook defines project configuration, database/schema names, table names, processing parameters, and helper functions used by later notebooks.

# COMMAND ----------

from datetime import date, datetime, timedelta, timezone
import re
from uuid import uuid4
from pyspark.sql import functions as F
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, DoubleType, TimestampType

# COMMAND ----------

# DBTITLE 1,Create Widgets If Needed
project_name = "nyc_taxi_lakehouse"
_active_context = globals().get("_pipeline_context", {})
if not isinstance(_active_context, dict):
    raise ValueError("Pipeline context must be a dictionary")
# Project policy, not a guarantee about TLC publication/event-time semantics.
boundary_grace_days = _active_context.get("boundary_grace_days", 1)
date_policy_version = "quality_v2_pickup_grace_numeric_contract"

if "process_year" in _active_context and "process_month" in _active_context:
    process_year = str(_active_context["process_year"])
    process_month = str(_active_context["process_month"]).zfill(2)
else:
    dbutils.widgets.text("process_year", "2024", "Process Year")
    dbutils.widgets.text("process_month", "01", "Process Month")
    process_year = str(_active_context.get("process_year", dbutils.widgets.get("process_year")))
    process_month = str(_active_context.get("process_month", dbutils.widgets.get("process_month"))).zfill(2)
if not (2009 <= int(process_year) <= datetime.now(timezone.utc).year and 1 <= int(process_month) <= 12):
    raise ValueError("Invalid processing year/month")
batch_id = _active_context.get("batch_id") or f"{project_name}_{process_year}_{process_month}_{uuid4().hex}"
run_started_at = _active_context.get("run_started_at") or datetime.now(timezone.utc).isoformat()
# Stable wall-clock derivation; source timestamps are not claimed to be NYC-to-UTC converted.
spark.conf.set("spark.sql.session.timeZone", "UTC")

print(f"project_name={project_name}")
print(f"process_year={process_year}")
print(f"process_month={process_month}")
print(f"batch_id={batch_id}")
print(f"date_policy_version={date_policy_version}, boundary_grace_days={boundary_grace_days}")

# COMMAND ----------

# DBTITLE 1,Database And Table Names
catalog_name = _active_context.get("catalog_name", "workspace")
schema_name = _active_context.get("schema_name", project_name)
for identifier in [catalog_name, schema_name]:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", identifier):
        raise ValueError("Catalog/schema must be simple SQL identifiers")

bronze_table = f"{catalog_name}.{schema_name}.bronze_taxi_trips"
silver_table = f"{catalog_name}.{schema_name}.silver_taxi_trips"
gold_fact_table = f"{catalog_name}.{schema_name}.gold_fact_taxi_trips"
gold_zone_table = f"{catalog_name}.{schema_name}.gold_dim_zone"
gold_date_table = f"{catalog_name}.{schema_name}.gold_dim_date"
quarantine_table = f"{catalog_name}.{schema_name}.quarantine_taxi_trips"
audit_table = f"{catalog_name}.{schema_name}.pipeline_audit"
recon_table = f"{catalog_name}.{schema_name}.pipeline_reconciliation"

source_url = f"https://d37ci6vzurychx.cloudfront.net/trip-data/yellow_tripdata_{process_year}-{process_month}.parquet"

print(source_url)

# COMMAND ----------

# DBTITLE 1,Create Schema
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {catalog_name}.{schema_name}")

# COMMAND ----------

# DBTITLE 1,Utility Functions
def pickup_date_bounds(year, month, grace_days):
    if not isinstance(grace_days, int) or isinstance(grace_days, bool) or grace_days < 0:
        raise ValueError("boundary_grace_days must be a nonnegative integer")
    start = date(year, month, 1)
    next_start = date(year + (month == 12), 1 if month == 12 else month + 1, 1)
    return start - timedelta(days=grace_days), next_start + timedelta(days=grace_days)


def pickup_outside_allowed_window(timestamp_column):
    lower, upper = pickup_date_bounds(int(process_year), int(process_month), boundary_grace_days)
    pickup_day = F.to_date(F.col(timestamp_column))
    return (pickup_day < F.lit(lower)) | (pickup_day >= F.lit(upper))


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def add_ingestion_metadata(df, source_name):
    return (
        df.withColumn("_batch_id", F.lit(batch_id))
          .withColumn("_source_name", F.lit(source_name))
          .withColumn("_ingested_at_utc", F.current_timestamp())
          .withColumn("_process_year", F.lit(int(process_year)))
          .withColumn("_process_month", F.lit(int(process_month)))
    )


def write_audit_record(layer_name, table_name, status, source_count=None, target_count=None, rejected_count=None, error_message=None):
    rows = [(
        batch_id,
        project_name,
        layer_name,
        table_name,
        int(source_count) if source_count is not None else None,
        int(target_count) if target_count is not None else None,
        int(rejected_count) if rejected_count is not None else None,
        status,
        error_message,
        run_started_at,
        utc_now()
    )]
    schema = "batch_id string, project_name string, layer_name string, table_name string, source_count long, target_count long, rejected_count long, status string, error_message string, started_at_utc string, ended_at_utc string"
    spark.createDataFrame(rows, schema).write.mode("append").format("delta").saveAsTable(audit_table)


def require_columns(df, required_columns):
    missing = sorted(set(required_columns) - set(df.columns))
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

