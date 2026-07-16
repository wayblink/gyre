import { dataframeAssertOperator } from './dataframeAssert.js';
import { dataframePersistExcelOperator } from './dataframePersistExcel.js';
import { dataframeSchemaAssertOperator } from './dataframeSchemaAssert.js';
import { dataframeShapeAssertOperator } from './dataframeShapeAssert.js';
import { dataframeSqlAssertOperator } from './dataframeSqlAssert.js';
import { dataframeUnionOperator } from './dataframeUnion.js';
import { dbUpsertOperator } from './dbUpsert.js';
import { sheetRangeExtractOperator } from './sheetRangeExtract.js';
import { sheetOptionalRangeExtractOperator } from './sheetOptionalRangeExtract.js';
import { sheetSectionsExtractOperator } from './sheetSectionsExtract.js';
import { sqlComputeOperator } from './sqlCompute.js';
import { workbookPersistExcelOperator } from './workbookPersistExcel.js';

export const workflowOperatorDefinitions = [
  sheetRangeExtractOperator,
  sheetOptionalRangeExtractOperator,
  sheetSectionsExtractOperator,
  sqlComputeOperator,
  dataframeUnionOperator,
  dataframeAssertOperator,
  dataframeSqlAssertOperator,
  dataframeSchemaAssertOperator,
  dataframeShapeAssertOperator,
  dataframePersistExcelOperator,
  workbookPersistExcelOperator,
  dbUpsertOperator,
] as const;

export const workflowOperatorDefinitionByCode = new Map(
  workflowOperatorDefinitions.map((definition) => [definition.code, definition]),
);
