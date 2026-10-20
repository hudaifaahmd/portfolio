# Databricks notebook source
# MAGIC %md
# MAGIC # 08 - Bounded Monthly Pipeline Runner
# MAGIC Starts in PLAN mode: bootstrap operational metadata and show eligible periods without HTTP probes or ETL. Switch mode to RUN for one bounded sequential execution. Import notebook 09 beside this notebook. No dbutils.notebook.run, external tokens, or pip installs are required.

# COMMAND ----------

# MAGIC %run ./09_runtime_sources

# COMMAND ----------

from datetime import datetime
import json
from zoneinfo import ZoneInfo


def runner_widget(name, default, label):
    try:
        return dbutils.widgets.get(name)
    except Exception:
        dbutils.widgets.text(name, default, label)
        return dbutils.widgets.get(name)


# Remove stale standalone controls; source months come from the runner context.
for _legacy_widget in ('process_year','process_month'):
    try:
        dbutils.widgets.remove(_legacy_widget)
    except Exception:
        pass


runner_mode = runner_widget('mode','plan','Mode: plan or run').strip().lower()
if runner_mode not in ['plan','run']:
    raise ValueError('mode must be plan or run')
runner_start = runner_widget('start_period','2024-01','First source month').strip()
runner_end = runner_widget('end_period','','Last source month; blank = latest due').strip() or None
runner_max_months = int(runner_widget('max_months_per_run','1','Months per run: 1 to 30'))
runner_grace_days = int(runner_widget('boundary_grace_days','1','Boundary grace days'))
if runner_grace_days < 0:
    raise ValueError('boundary_grace_days must not be negative')
runner_catalog = runner_widget('catalog_name','workspace','Catalog').strip()
runner_schema = runner_widget('schema_name','nyc_taxi_lakehouse','Schema').strip()
runner_force_text = runner_widget('force_reprocess','false','Force one explicit source month').strip().lower()
if runner_force_text not in ['true','false']:
    raise ValueError('force_reprocess must be true or false')
runner_force = runner_force_text == 'true'
runner_today = datetime.now(ZoneInfo('Asia/Kolkata')).date()
runner_due = due_period(runner_today,2)
runner_policy = policy_identity(COMPLETION_POLICY_DIGEST,runner_grace_days)
print(f'runtime_bundle={BUNDLE_DIGEST[:16]}; max_months_per_run={runner_max_months}')
event_store = SparkEventStore(spark,runner_catalog,runner_schema)
completed_periods = event_store.completed(runner_policy,runner_start,runner_end or runner_due)
priority_periods = event_store.priority_pending(runner_policy,runner_start,runner_end or runner_due)
print(f'local_date={runner_today}; latest_due_period={runner_due}; mode={runner_mode}')
print(f'policy_version={runner_policy}; event_table={event_store.table}')


def process_source_month(period,run_id,progress):
    return execute_stages(PIPELINE_SOURCES,period,run_id,spark=spark,dbutils=dbutils,
                          grace_days=runner_grace_days,catalog=runner_catalog,schema=runner_schema,
                          progress=progress,show_previews=False,display_fn=display)


runner_result = run_controller(
    start=runner_start,end=runner_end,today=runner_today,completed=completed_periods,
    policy_version=runner_policy,max_months=runner_max_months,process=process_source_month,
    emit=event_store.emit,dry_run=runner_mode=='plan',force=runner_force,
    priority_pending=priority_periods,
)
print(json.dumps(runner_result,indent=2,default=str))
if runner_mode == 'plan':
    print('PLAN ONLY: no source probes, downloads, or business-table writes were performed.')
else:
    print('BOUNDED RUN FINISHED: inspect events and reconciliation before refreshing dashboards.')
