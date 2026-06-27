import { dataframeAssertOperator } from './dataframeAssert.js';
import { dataframePersistExcelOperator } from './dataframePersistExcel.js';
import { dataframeSchemaAssertOperator } from './dataframeSchemaAssert.js';
import { dataframeShapeAssertOperator } from './dataframeShapeAssert.js';
import { dataframeSqlAssertOperator } from './dataframeSqlAssert.js';
import { sheetRangeExtractOperator } from './sheetRangeExtract.js';
import { sheetSectionsExtractOperator } from './sheetSectionsExtract.js';
import { sqlComputeOperator } from './sqlCompute.js';

export const workflowOperatorDefinitions = [
  sheetRangeExtractOperator,
  sheetSectionsExtractOperator,
  sqlComputeOperator,
  dataframeAssertOperator,
  dataframeSqlAssertOperator,
  dataframeSchemaAssertOperator,
  dataframeShapeAssertOperator,
  dataframePersistExcelOperator,
] as const;

export const workflowOperatorDefinitionByCode = new Map(
  workflowOperatorDefinitions.map((definition) => [definition.code, definition]),
);
