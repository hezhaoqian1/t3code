---
name: company-database-query
description: Safely inspect approved company databases and run read-only SQL through the project's guarded database tool. Use for connection tests, data discovery, business metric queries, SQL drafting, query troubleshooting, or exporting approved query results from connections defined in config/database-connections.json.
---

# Company Database Query

## Workflow

1. Find the project root containing `AGENTS.md`.
2. Read `config/database-connections.json`, `config/department-access-profiles.json`, `knowledge/access-policy.md`, `knowledge/data-dictionary.md`, and `knowledge/business-rules.md`.
3. If the selected connection declares `access_profile_id`, require the matching enabled profile. Use only its `allowed_objects` and listed columns; treat `denied_columns` and `row_scope` as mandatory constraints.
4. Confirm the connection, business metric, time range, filters, grouping, and required output. State any unresolved assumption.
5. Draft one read-only statement. Prefer aggregates and the smallest necessary data scope.
6. Save non-trivial SQL to `work/<descriptive-name>.sql`.
7. Execute only through the project virtual environment and `tools/db_tool.py`.
8. Save final data to `outputs/` when requested and report the source, access profile, query time, filters, row count, truncation status, and limitations.

## Commands

Use the project virtual environment when present:

```powershell
.\.venv\Scripts\python.exe .\tools\db_tool.py list
.\.venv\Scripts\python.exe .\tools\db_tool.py test --connection corp_readonly
.\.venv\Scripts\python.exe .\tools\db_tool.py query --connection corp_readonly --file .\work\query.sql --format csv --output .\outputs\result.csv
```

If `.venv` or the required driver is missing, stop and provide IT-focused setup diagnostics. Never ask the business user to paste a password into chat.

## Guardrails

- Never execute writes, DDL, permission changes, stored procedures, multi-statements, or commands rejected by `db_tool.py`.
- Do not bypass the query guard with another client.
- Do not query unknown sensitive fields before checking the dictionary and access policy.
- Treat a successful client-side check as insufficient without a database-native read-only account.
- Never infer that a profile grants access. Stop when the database rejects an object or when the active connection and profile do not match.
- If the user requests prohibited access, explain the boundary and offer an aggregate or approved alternative.
