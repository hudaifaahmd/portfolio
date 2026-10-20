# Databricks notebook source
# MAGIC %md
# MAGIC # 06 - Reconciliation And Audit
# MAGIC
# MAGIC Independently read persisted tables for one source month. Reconcile counts, rounded amount metrics, nulls, provenance and dimension references. Persist per-check results before raising on failure. Date-period anomalies are warnings, not silent deletions.
# MAGIC
# MAGIC Run sequentially with no upstream pipeline modifying these tables.

# COMMAND ----------

# MAGIC %run ./01_setup_and_config

# COMMAND ----------

from datetime import date
from pyspark.sql import functions as F


def make_check(name, expected, actual, severity="ERROR", detail=""):
    status = "PASS" if expected == actual else ("WARN" if severity == "WARN" else "FAIL")
    return (name, severity, str(expected), str(actual), status, detail)


def overall_check_status(checks):
    statuses = {row[4] for row in checks}
    return "FAIL" if "FAIL" in statuses else ("WARN" if "WARN" in statuses else "PASS")


def metric_expressions():
    expressions = [F.count(F.lit(1)).alias("row_count")]
    for name in ["fare_amount", "total_amount"]:
        amount = F.col(name)
        decimal_amount = F.expr(f"try_cast(`{name}` AS decimal(20,2))")
        double_amount = F.expr(f"try_cast(`{name}` AS double)")
        expressions.extend([
            F.coalesce(F.sum(decimal_amount * 100), F.lit(0)).alias(f"{name}_cents"),
            F.coalesce(F.sum(F.when(amount.isNull(), 1).otherwise(0)), F.lit(0)).alias(f"{name}_nulls"),
            F.coalesce(F.sum(F.when(
                amount.isNotNull() & (
                    decimal_amount.isNull() | F.isnan(double_amount) |
                    (F.abs(double_amount) == F.lit(float("inf")))
                ), 1
            ).otherwise(0)), F.lit(0)).alias(f"{name}_invalid"),
        ])
    return expressions


def measure_layer(df):
    return df.agg(*metric_expressions()).first().asDict()


def missing_key_count(facts, fact_key, dimension, dimension_key):
    keys = facts.select(F.col(fact_key).alias("_reference_key")).distinct()
    available = dimension.select(F.col(dimension_key).alias("_reference_key")).distinct()
    return keys.join(available, "_reference_key", "left_anti").count()


def duplicate_key_groups(df, key):
    return df.groupBy(key).count().where(F.col("count") > 1).count()

# COMMAND ----------

# DBTITLE 1,Load Persisted Source-Month Tables
year, month = int(process_year), int(process_month)
period_start = date(year, month, 1)
next_month_start = date(year + (month == 12), 1 if month == 12 else month + 1, 1)
month_predicate = f"_process_year = {year} AND _process_month = {month}"
layer_tables = {
    "bronze": bronze_table, "quarantine": quarantine_table,
    "silver": silver_table, "gold": gold_fact_table
}
layers = {}
for layer, table_name in layer_tables.items():
    df = spark.table(table_name).where(month_predicate)
    require_columns(df, ["fare_amount", "total_amount", "_batch_id"])
    layers[layer] = df
require_columns(layers["quarantine"], ["_dq_error"])
require_columns(layers["silver"], ["pickup_date", "pickup_ts", "pickup_location_id", "dropoff_location_id"])
require_columns(layers["gold"], ["date_key", "pickup_ts", "pickup_location_id", "dropoff_location_id", "pickup_zone_key", "dropoff_zone_key"])
date_dimension = spark.table(gold_date_table)
zone_dimension = spark.table(gold_zone_table)
require_columns(date_dimension, ["date_key", "pickup_date"])
require_columns(zone_dimension, ["zone_id"])

metrics = {name: measure_layer(df) for name, df in layers.items()}
bronze_count = metrics["bronze"]["row_count"]
quarantine_count = metrics["quarantine"]["row_count"]
silver_count = metrics["silver"]["row_count"]
gold_count = metrics["gold"]["row_count"]
print(f"process_year={process_year}, process_month={process_month}")
for name, values in metrics.items():
    print(f"{name}_count={values['row_count']}")

# COMMAND ----------

# DBTITLE 1,Reconcile Counts, Amounts And Nulls
checks = [
    make_check("bronze_has_rows", True, bronze_count > 0),
    make_check("silver_rows_or_fully_quarantined", True, silver_count > 0 or (bronze_count > 0 and quarantine_count == bronze_count), detail="Empty accepted output is valid only for a fully quarantined nonempty source."),
    make_check("bronze_equals_silver_plus_quarantine", bronze_count, silver_count + quarantine_count),
    make_check("silver_equals_gold_rows", silver_count, gold_count),
]
for amount in ["fare_amount", "total_amount"]:
    for suffix in ["cents", "nulls", "invalid"]:
        metric = f"{amount}_{suffix}"
        checks.append(make_check(
            f"bronze_split_{metric}", metrics["bronze"][metric],
            metrics["silver"][metric] + metrics["quarantine"][metric],
            detail="Cents are summed after rounding each source value to decimal(20,2)."
        ))
        checks.append(make_check(
            f"silver_gold_{metric}", metrics["silver"][metric], metrics["gold"][metric]
        ))
    # Raw/rejected invalid values are evidence; only accepted/served values must be valid.
    for layer in ["silver", "gold"]:
        checks.append(make_check(f"{layer}_{amount}_invalid", 0, metrics[layer][f"{amount}_invalid"]))

bad_reasons = layers["quarantine"].where(
    F.col("_dq_error").isNull() | (F.trim(F.col("_dq_error")) == "")
).count()
checks.append(make_check("quarantine_has_error_reasons", 0, bad_reasons))

# COMMAND ----------

# DBTITLE 1,Check Provenance And Shared Dimension References
bronze_batches = layers["bronze"].select("_batch_id").distinct()
for layer in layers:
    missing_batches = layers[layer].where(F.col("_batch_id").isNull()).count()
    checks.append(make_check(f"{layer}_null_batch_ids", 0, missing_batches))
    if layer != "bronze":
        unexpected = layers[layer].select("_batch_id").distinct().join(
            bronze_batches, "_batch_id", "left_anti"
        ).count()
        checks.append(make_check(f"{layer}_unexpected_bronze_batch_ids", 0, unexpected))

# Full outer joins expose batches missing from either side, not just unknown IDs.
batch_metrics = None
metric_names = list(metrics["bronze"])
for layer, df in layers.items():
    grouped = df.groupBy("_batch_id").agg(*metric_expressions()).select(
        "_batch_id", *[F.col(name).alias(f"{layer}_{name}") for name in metric_names]
    )
    batch_metrics = grouped if batch_metrics is None else batch_metrics.join(grouped, "_batch_id", "full")
batch_mismatch = F.lit(False)
for name in metric_names:
    b = F.coalesce(F.col(f"bronze_{name}"), F.lit(0))
    q = F.coalesce(F.col(f"quarantine_{name}"), F.lit(0))
    s = F.coalesce(F.col(f"silver_{name}"), F.lit(0))
    g = F.coalesce(F.col(f"gold_{name}"), F.lit(0))
    batch_mismatch = batch_mismatch | (b != s + q) | (s != g)
batch_mismatches = batch_metrics.where(batch_mismatch)
checks.append(make_check("per_batch_layer_metric_mismatches", 0, batch_mismatches.count()))

for dimension_name, df, key in [
    ("date", date_dimension, "date_key"), ("zone", zone_dimension, "zone_id")
]:
    checks.append(make_check(f"{dimension_name}_null_keys", 0, df.where(F.col(key).isNull()).count()))
    checks.append(make_check(f"{dimension_name}_duplicate_key_groups", 0, duplicate_key_groups(df, key)))

for fact_key, dimension, dimension_key in [
    ("date_key", date_dimension, "date_key"),
    ("pickup_zone_key", zone_dimension, "zone_id"),
    ("dropoff_zone_key", zone_dimension, "zone_id"),
]:
    checks.append(make_check(f"gold_null_{fact_key}", 0, layers["gold"].where(F.col(fact_key).isNull()).count()))
    checks.append(make_check(f"gold_missing_{fact_key}", 0,
                             missing_key_count(layers["gold"], fact_key, dimension, dimension_key)))

date_mismatches = date_dimension.where(
    F.col("pickup_date").isNull() |
    (F.col("date_key") != F.date_format("pickup_date", "yyyyMMdd").cast("int"))
).count()
checks.append(make_check("date_dimension_key_matches_date", 0, date_mismatches))

gold_date_assignments = layers["gold"].where(
    ~F.col("date_key").eqNullSafe(F.date_format(F.to_date("pickup_ts"), "yyyyMMdd").cast("int"))
).count()
checks.append(make_check("gold_date_key_matches_pickup_timestamp", 0, gold_date_assignments))
silver_date_assignments = layers["silver"].where(
    ~F.col("pickup_date").eqNullSafe(F.to_date("pickup_ts"))
).count()
checks.append(make_check("silver_pickup_date_matches_timestamp", 0, silver_date_assignments))

for original, mapped in [("pickup_location_id", "pickup_zone_key"), ("dropoff_location_id", "dropoff_zone_key")]:
    available = zone_dimension.select(F.col("zone_id").alias("_expected_zone_match")).distinct()
    assignments = layers["gold"].join(available, F.col(original) == F.col("_expected_zone_match"), "left")
    incorrect = assignments.where(
        ~F.col(mapped).eqNullSafe(F.coalesce(F.col("_expected_zone_match"), F.lit(-1)))
    ).count()
    checks.append(make_check(f"gold_{mapped}_matches_original_location", 0, incorrect))

# COMMAND ----------

# DBTITLE 1,Report Source-Period Date And Unknown-Zone Warnings
outside_period = layers["silver"].where(
    (F.col("pickup_date") < F.lit(period_start)) |
    (F.col("pickup_date") >= F.lit(next_month_start))
)
out_of_period_count = outside_period.count()
allowed_pickup_start, allowed_pickup_end = pickup_date_bounds(year, month, boundary_grace_days)
outside_allowed_silver = layers["silver"].where(pickup_outside_allowed_window("pickup_ts")).count()
outside_allowed_gold = layers["gold"].where(pickup_outside_allowed_window("pickup_ts")).count()
checks.append(make_check(
    "silver_pickup_date_outside_allowed_window", 0, outside_allowed_silver,
    detail=f"Policy={date_policy_version}; allowed pickup dates [{allowed_pickup_start}, {allowed_pickup_end}); grace_days={boundary_grace_days}"
))
checks.append(make_check(
    "gold_pickup_date_outside_allowed_window", 0, outside_allowed_gold,
    detail=f"Policy={date_policy_version}; rerun updated quality, Silver and Gold if this fails."
))
silver_null_dates = layers["silver"].where(F.col("pickup_date").isNull()).count()
checks.append(make_check("silver_null_pickup_dates", 0, silver_null_dates))
checks.append(make_check(
    "silver_pickup_date_outside_source_month", 0, out_of_period_count, "WARN",
    f"Retained boundary spillover is still visible; policy={date_policy_version}, grace_days={boundary_grace_days}. Beyond-grace dates are separate critical checks."
))
unknown_count = layers["gold"].where(
    (F.col("pickup_zone_key") == -1) | (F.col("dropoff_zone_key") == -1)
).count()
checks.append(make_check(
    "gold_unknown_zone_trips", 0, unknown_count, "WARN",
    "Mapped unknown members preserve trips; investigate original location IDs."
))
silver_dates = layers["silver"].groupBy("pickup_date").count().orderBy("pickup_date")
print(f"source_period_start={period_start}, next_period_start={next_month_start}")
print(f"silver_out_of_period_trip_count={out_of_period_count}")
print(f"allowed_pickup_dates=[{allowed_pickup_start}, {allowed_pickup_end})")
print(f"silver_outside_allowed_window_count={outside_allowed_silver}")
print(f"gold_outside_allowed_window_count={outside_allowed_gold}")
print(f"gold_unknown_zone_trip_count={unknown_count}")
print(f"shared_date_dimension_count={date_dimension.count()}")
print(f"current_period_distinct_pickup_dates={layers['silver'].select('pickup_date').distinct().count()}")

# COMMAND ----------

# DBTITLE 1,Persist Per-Check Results And Audit Before Failing
overall_status = overall_check_status(checks)
check_results_table = f"{recon_table}_checks"
reconciled_at_utc = utc_now()
result_rows = [
    (batch_id, process_year, process_month, name, severity, expected, actual,
     status, detail, overall_status, reconciled_at_utc)
    for name, severity, expected, actual, status, detail in checks
]
result_schema = (
    "batch_id string, process_year string, process_month string, check_name string, "
    "severity string, expected_value string, actual_value string, check_status string, "
    "detail string, overall_status string, reconciled_at_utc string"
)
result_df = spark.createDataFrame(result_rows, result_schema)
# Append execution history intentionally; never replace business data in this notebook.
result_df.write.format("delta").mode("append").saveAsTable(check_results_table)
write_audit_record("reconciliation", check_results_table, overall_status,
                   bronze_count, gold_count, quarantine_count)
print(f"reconciliation_checks_table={check_results_table}")
print(f"overall_status={overall_status}")
display(result_df.orderBy("check_status", "check_name"))
display(batch_mismatches.limit(20))
display(silver_dates)
display(outside_period.select("pickup_date", "pickup_ts", "dropoff_ts", "_batch_id").limit(20))

if overall_status == "FAIL":
    failed = [row[0] for row in checks if row[4] == "FAIL"]
    raise ValueError(f"Reconciliation failed for {batch_id}: {failed}")
elif overall_status == "WARN":
    print("COMPLETED WITH WARNINGS: required checks passed; review date/reference warnings.")
else:
    print("SUCCESS: all configured reconciliation checks passed.")

