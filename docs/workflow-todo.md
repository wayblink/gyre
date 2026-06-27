# Workflow TODO

## Current Assessment

The workflow module has useful foundations: workflow definitions are persisted, tasks form a DAG through input mappings and control dependencies, operators are registered by code, and assertions can block or warn downstream tasks.

The current implementation is still prototype-heavy in execution semantics, runtime persistence, artifact handling, dataframe fidelity, and operator configuration.

## P0

- Split Preview and Execute semantics.
- Make Preview side-effect-free. Preview must not create Files records or write generated workbooks.
- Persist every workflow execution as a run record.
- Persist every task execution as a step record with status, duration, error, task snapshot, and preview/result snapshot.
- Persist generated files and future typed outputs as workflow run artifacts.
- Make output operators idempotent enough for real execution: explicit generated file artifact, clear file name, and traceable run/task ownership.

## P1

- Enrich `WorkflowDataFrame` with column schema, value/display value, cell provenance, source file/sheet/range, formats, null/error semantics, and formula/source metadata.
- Replace custom frontend operator branches with schema-driven config rendering, keeping custom overrides only where necessary.
- Isolate SQL execution. Avoid global `alasql.tables` mutation during concurrent workflow runs.
- Improve semi-structured Excel input operators with anchor/section detection, header inference, section metadata, and range drift tolerance.
- Make assertion results first-class artifacts with actual value, expected value, delta/tolerance, strategy, reviewer, and approval status.

## P2

- Add workflow definition revisioning and operator version compatibility.
- Add retries, cancellation, skip/resume, manual approval records, audit logs, and execution history views.
- Add async job execution for long-running workflows.
- Add input file version snapshotting so historical runs can be reproduced.
