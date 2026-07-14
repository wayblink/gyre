import { dataframeAssertOperator } from './dataframeAssert.js';
import { dataframePersistExcelOperator } from './dataframePersistExcel.js';
import { dataframeSchemaAssertOperator } from './dataframeSchemaAssert.js';
import { dataframeShapeAssertOperator } from './dataframeShapeAssert.js';
import { dataframeSqlAssertOperator } from './dataframeSqlAssert.js';
import { dataframeUnionOperator } from './dataframeUnion.js';
import { dbUpsertOperator } from './dbUpsert.js';
import { esopPagePersistOperator } from './esopPagePersist.js';
import { fivePercentHoldersPersistOperator } from './fivePercentHoldersPersist.js';
import { planSummaryPersistOperator } from './planSummaryPersist.js';
import { sheetRangeExtractOperator } from './sheetRangeExtract.js';
import { sheetSectionsExtractOperator } from './sheetSectionsExtract.js';
import { sqlComputeOperator } from './sqlCompute.js';

export const workflowOperatorDefinitions = [
  sheetRangeExtractOperator,
  sheetSectionsExtractOperator,
  sqlComputeOperator,
  dataframeUnionOperator,
  dataframeAssertOperator,
  dataframeSqlAssertOperator,
  dataframeSchemaAssertOperator,
  dataframeShapeAssertOperator,
  dataframePersistExcelOperator,
  dbUpsertOperator,
  esopPagePersistOperator,
  planSummaryPersistOperator,
  fivePercentHoldersPersistOperator,
] as const;

export const workflowOperatorDefinitionByCode = new Map(
  workflowOperatorDefinitions.map((definition) => [definition.code, definition]),
);
