# Databricks notebook source
# MAGIC %md
# MAGIC # NYC Taxi Lakehouse Data Engineering Project
# MAGIC
# MAGIC ## Project Goal
# MAGIC
# MAGIC Build a production-style Databricks Lakehouse pipeline using Medallion Architecture:
# MAGIC
# MAGIC - **Landing**: source files and reference inputs
# MAGIC - **Bronze**: raw structured Delta tables with ingestion metadata
# MAGIC - **Silver**: accepted, standardized records; source duplicates are not silently removed without a proven key
# MAGIC - **Gold**: analytics-ready fact and dimension tables
# MAGIC - **Quarantine**: invalid/rejected records with reasons
# MAGIC - **Audit**: pipeline run metadata and reconciliation results
# MAGIC
# MAGIC ## Main Source
# MAGIC
# MAGIC NYC Taxi TLC monthly trip data. This is a real-world public dataset that supports monthly processing across multiple years.
# MAGIC
# MAGIC ## Business Use Case
# MAGIC
# MAGIC Build reliable monthly taxi analytics for analysts:
# MAGIC
# MAGIC - Trip volume trends
# MAGIC - Source fare and total-amount trends (not a validated net-revenue definition)
# MAGIC - Payment type distribution
# MAGIC - Pickup/dropoff zone performance
# MAGIC - Vendor performance
# MAGIC - Data quality and rejection reporting

# COMMAND ----------

# MAGIC %md
# MAGIC ## Architecture
# MAGIC
# MAGIC This project uses **Databricks Lakehouse + Medallion Architecture**.
# MAGIC
# MAGIC Bronze/Silver/Gold is called **Medallion Architecture**. The broader platform pattern is called **Lakehouse Architecture**.
# MAGIC
# MAGIC ```text
# MAGIC Public Source Data
# MAGIC       |
# MAGIC       v
# MAGIC Landing Zone
# MAGIC       |
# MAGIC       v
# MAGIC Bronze Delta Tables
# MAGIC       |
# MAGIC       v
# MAGIC Data Quality + Quarantine
# MAGIC       |
# MAGIC       v
# MAGIC Silver Delta Tables
# MAGIC       |
# MAGIC       v
# MAGIC Reconciliation + Gold Modeling
# MAGIC       |
# MAGIC       v
# MAGIC Gold Fact/Dimension Tables
# MAGIC       |
# MAGIC       v
# MAGIC SQL Analytics / Portfolio Outputs
# MAGIC ```

# COMMAND ----------

# MAGIC %md
# MAGIC ## Notebook Order
# MAGIC
# MAGIC 1. `00_project_overview`
# MAGIC 2. `01_setup_and_config`
# MAGIC 3. `02_ingest_to_bronze`
# MAGIC 4. `03_quality_checks`
# MAGIC 5. `04_transform_to_silver`
# MAGIC 6. `05_build_gold_model`
# MAGIC 7. `06_reconciliation_and_audit`
# MAGIC 8. `07_reporting_queries`
# MAGIC
# MAGIC 9. `08_monthly_pipeline_runner`: bounded plan/run, availability checks, source-month execution and operational history
# MAGIC 10. `09_runtime_sources`: generated checksummed stage sources; import beside 08, do not edit manually
# MAGIC 11. `10_backfill_status`: current-version coverage and operational evidence
# MAGIC
# MAGIC The 08 runner executes canonical 01 through 06 once per month in an isolated Python namespace. It does not rely on cross-task Python variables or dynamic notebook APIs. Default plan mode does not perform source HTTP probes or business-table writes. The native job template is paused until verified and deployed; no live schedule is claimed by these source files.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Resume Skills Proven By This Project
# MAGIC
# MAGIC Add these only after implementation is complete:
# MAGIC
# MAGIC - Databricks Lakehouse Architecture
# MAGIC - Medallion Architecture
# MAGIC - Delta Lake Tables
# MAGIC - PySpark Batch ETL
# MAGIC - Data Quality Validation
# MAGIC - Data Reconciliation
# MAGIC - Audit Logging
# MAGIC - Dimensional Modeling
# MAGIC - Databricks Workflow Orchestration

