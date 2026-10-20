# Databricks notebook source
# MAGIC %md
# MAGIC # 10 - Backfill Coverage And Operational History
# MAGIC Read-only status for the current runtime/policy version. Run notebook 08 in plan mode first to create its operational table. No historical periods are marked complete merely because old tables exist.

# COMMAND ----------

# MAGIC %run ./09_runtime_sources

# COMMAND ----------

from datetime import datetime
import re
from zoneinfo import ZoneInfo
from taxi_pipeline.planning import month_range
from pyspark.sql import functions as F
from pyspark.sql.window import Window

dbutils.widgets.text('start_period','2024-01','First source month')
dbutils.widgets.text('end_period','','Last source month; blank = latest due')
dbutils.widgets.text('boundary_grace_days','1','Boundary grace days')
dbutils.widgets.text('catalog_name','workspace','Catalog')
dbutils.widgets.text('schema_name','nyc_taxi_lakehouse','Schema')
status_start = dbutils.widgets.get('start_period')
status_end = dbutils.widgets.get('end_period') or due_period(datetime.now(ZoneInfo('Asia/Kolkata')).date(),2)
status_policy = policy_identity(COMPLETION_POLICY_DIGEST,int(dbutils.widgets.get('boundary_grace_days')))
status_catalog = dbutils.widgets.get('catalog_name')
status_schema = dbutils.widgets.get('schema_name')
if not all(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',value) for value in [status_catalog,status_schema]):
    raise ValueError('Catalog/schema must be simple SQL identifiers')
status_table = f'{status_catalog}.{status_schema}.pipeline_month_events'
if not spark.catalog.tableExists(status_table):
    raise ValueError('Run notebook 08 in plan mode first to bootstrap the operations table')
period_df = spark.createDataFrame([(p,) for p in month_range(status_start,status_end)],'source_period string')
window = Window.partitionBy('source_period').orderBy(F.col('event_time_utc').desc(),F.col('event_id').desc())
latest = (spark.table(status_table).withColumn('_rn',F.row_number().over(window))
          .where((F.col('_rn')==1)&(F.col('policy_version')==status_policy)).drop('_rn'))
coverage = (period_df.join(latest,'source_period','left')
            .withColumn('status',F.coalesce(F.col('status'),F.lit('NOT_PROCESSED_BY_CURRENT_VERSION'))))
display(coverage.select('source_period','status','stage','gold_count','quarantine_count',
                        'out_of_period_count','event_time_utc','error_message').orderBy('source_period'))
display(coverage.groupBy('status').count())
display(spark.table(status_table).orderBy(F.col('event_time_utc').desc()).limit(100))
