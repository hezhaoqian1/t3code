---
name: company-data-quality
description: Check approved datasets or database query results for missing values, duplicates, invalid ranges, broken relationships, stale data, unexpected changes, and metric-definition conflicts. Use before reporting, during reconciliation, when numbers disagree, or when a user asks whether data is complete and reliable.
---

# Company Data Quality

## Workflow

1. Read the relevant data dictionary, business rules, access policy, and source metadata.
2. Define the expected grain, primary or business key, mandatory fields, valid ranges, time coverage, and comparison baseline.
3. Run the smallest set of checks needed: completeness, uniqueness, validity, consistency, timeliness, referential integrity, and distribution changes.
4. Use `$company-database-query` for database checks and retain read-only behavior.
5. Classify findings as critical, high, medium, or informational. Include evidence, affected scope, likely impact, and a reproducible check.
6. Save a quality report to `outputs/` when requested.

## Boundaries

- Do not repair, delete, or update source records.
- Do not label a value erroneous only because it is unusual; compare it with documented rules and business context.
- Distinguish source defects, transformation defects, definition conflicts, expected business events, and insufficient evidence.
- Redact sensitive example rows unless the user is authorized and the detail is necessary.
