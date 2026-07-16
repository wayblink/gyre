import { assembleShareworksName } from './employees.js';

export type PlanSummarySourceRow = {
  plan_name: string | null;
  grant_count: number | string | null;
  granted: number | string | null;
  exercised: number | string | null;
  cancelled: number | string | null;
  outstanding: number | string | null;
};

export type TransferPlanPeriodSourceRow = {
  id: number | string;
  source_file_id: number | string | null;
  period: string;
  in_total: number | string;
  source_cancelled: number | string;
  cancelled_quantity: number | string;
  manually_edited: boolean | string | number;
  sort_order: number | string;
};

export type TransferPlanPeriodResponseRow = {
  id: number;
  sourceFileId: number | null;
  period: string;
  inTotal: number;
  sourceCancelled: number;
  cancelledQuantity: number;
  transferToFutu: number;
  manuallyEdited: boolean;
  sortOrder: number;
};

export type PlanSummaryRow = {
  planName: string;
  grantCount: number;
  granted: number;
  exercised: number;
  cancelled: number;
  outstanding: number;
};

export type PlanSummaryResponse = {
  items: PlanSummaryRow[];
  totals: {
    planCount: number;
    grantCount: number;
    granted: number;
    exercised: number;
    cancelled: number;
    outstanding: number;
  };
};

export type FixedValueRow = {
  id: number | string;
  key: string;
  label: string;
  value: number | string;
  effective_from: string;
  effective_to: string | null;
  editable: boolean | string | number;
  updated_by: string;
  updated_at: string;
};

export type FixedValueResponseRow = {
  id: number;
  key: string;
  label: string;
  value: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  editable: boolean;
  updatedBy: string;
  updatedAt: string;
};

export type FivePercentHolderRow = {
  id: number | string;
  name: string;
  identity: string;
  tracked: boolean | string | number;
};

export type FivePercentHolderResponseRow = {
  id: number;
  name: string;
  identity: string;
  track: boolean;
  source: 'shareholder_tags';
};

export type ShareworksGrantSourceRow = {
  id: number | string;
  cost_center: string | null;
  participant_type: string | null;
  employee_number: string | null;
  last_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  plan_name: string | null;
  grant_name: string | null;
  grant_type: string | null;
  employee_grant_number: string | null;
  grant_date: string | null;
  vesting_start_date: string | null;
  service_start_date: string | null;
  original_vesting_start_date: string | null;
  expire_date: string | null;
  participant_expire_date: string | null;
  earliest_expire_cancel_date: string | null;
  latest_expire_cancel_date: string | null;
  shares_granted: number | string | null;
  exercise_price_per_share: number | string | null;
  vesting_schedule: string | null;
  early_exercise_allowed: string | null;
  shares_vested: number | string | null;
  shares_unvested: number | string | null;
  shares_exercised_released: number | string | null;
  shares_subject_to_repurchase: number | string | null;
  shares_cancelled_expired: number | string | null;
  shares_outstanding: number | string | null;
  outstanding_unvested: number | string | null;
  outstanding_vested_exercisable: number | string | null;
};

export type ShareworksGrantResponseRow = {
  id: number;
  employeeNumber: string | null;
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
  planName: string | null;
  grantName: string | null;
  grantType: string | null;
  employeeGrantNumber: string | null;
  grantDate: string | null;
  vestingStartDate: string | null;
  serviceStartDate: string | null;
  originalVestingStartDate: string | null;
  expireDate: string | null;
  participantExpireDate: string | null;
  earliestExpireCancelDate: string | null;
  latestExpireCancelDate: string | null;
  sharesGranted: number | null;
  exercisePricePerShare: number | null;
  vestingSchedule: string | null;
  earlyExerciseAllowed: string | null;
  sharesVested: number | null;
  sharesUnvested: number | null;
  sharesExercisedReleased: number | null;
  sharesSubjectToRepurchase: number | null;
  sharesCancelledExpired: number | null;
  sharesOutstanding: number | null;
  outstandingUnvested: number | null;
  outstandingVestedExercisable: number | null;
};

export type FutuMergeSourceRow = {
  id: number;
  employeeName: string;
  employeeNumber: string;
  grantNumber: string;
  incentiveType: string;
  grantDate: string | null;
  grantQuantity: number | null;
  grantPriceUsd: number | null;
  expireDate: string | null;
  planName: string | null;
  vestingRuleName: string | null;
  vestingStartDate: string | null;
  vestedQuantity: number | null;
  unvestedQuantity: number | null;
  exercisedQuantity: number | null;
  vestedCancelledQuantity: number | null;
  unvestedCancelledQuantity: number | null;
  outstandingQuantity: number | null;
};

export type ShareworksMergeSourceRow = Pick<
  ShareworksGrantResponseRow,
  | 'id'
  | 'lastName'
  | 'firstName'
  | 'middleName'
  | 'employeeNumber'
  | 'employeeGrantNumber'
  | 'grantType'
  | 'grantDate'
  | 'sharesGranted'
  | 'exercisePricePerShare'
  | 'expireDate'
  | 'planName'
  | 'vestingSchedule'
  | 'vestingStartDate'
  | 'sharesVested'
  | 'sharesUnvested'
  | 'sharesExercisedReleased'
  | 'sharesCancelledExpired'
  | 'sharesOutstanding'
>;

export type MergedGrantRow = {
  id: string;
  source: 'Futu' | 'Shareworks';
  employeeName: string;
  grantNumber: string;
  employeeNumber: string;
  incentiveType: string;
  grantDate: string | null;
  grantQuantity: number | null;
  grantPrice: number | null;
  expireDate: string | null;
  planName: string | null;
  vestingRuleName: string | null;
  vestingStartDate: string | null;
  sharesVested: number | null;
  sharesUnvested: number | null;
  sharesExercisedReleased: number | null;
  sharesCancelledExpired: number | null;
  sharesOutstanding: number | null;
};

export type ExerciseRecordSourceRow = {
  id: number | string;
  name: string;
  employee_number: string;
  futubull_id: string;
  user_id: string;
  grant_number: string;
  grant_date: string;
  grant_price_usd: number | string;
  exercise_date: string;
  ordered_quantity: number | string;
  exercised_quantity: number | string;
  exercise_cost_usd: number | string;
  deduction_selling_quantity: number | string;
  dealt_quantity: number | string;
};

export type ExerciseRecordResponseRow = {
  id: number;
  name: string;
  employeeNumber: string;
  futubullId: string;
  userId: string;
  grantNumber: string;
  grantDate: string;
  grantPriceUsd: number;
  exerciseDate: string;
  orderedQuantity: number;
  exercisedQuantity: number;
  exerciseCostUsd: number;
  deductionSellingQuantity: number;
  dealtQuantity: number;
};

export type SoldShareSourceRow = {
  id: number | string;
  name: string;
  employee_number: string;
  futubull_id: string;
  user_id: string;
  employment_status: string;
  related_party_identity: string;
  capital_gains_tax_visibility: string;
  sold_quantity: number | string;
  dealt_quantity: number | string;
  deal_amount_usd: number | string;
  taxable_income_usd: number | string;
  tax_payable_usd: number | string;
  transaction_fees_usd: number | string;
  net_deal_value_usd: number | string;
  grant_cost_usd: number | string;
  exercise_vesting_fee_usd: number | string;
  withholding_tax_usd: number | string;
  withholding_tax_cny: number | string;
  cash_net_proceeds_usd: number | string;
};

export type SoldShareResponseRow = {
  id: number;
  name: string;
  employeeNumber: string;
  futubullId: string;
  userId: string;
  employmentStatus: string;
  relatedPartyIdentity: string;
  capitalGainsTaxVisibility: string;
  soldQuantity: number;
  dealtQuantity: number;
  dealAmountUsd: number;
  taxableIncomeUsd: number;
  taxPayableUsd: number;
  transactionFeesUsd: number;
  netDealValueUsd: number;
  grantCostUsd: number;
  exerciseVestingFeeUsd: number;
  withholdingTaxUsd: number;
  withholdingTaxCny: number;
  cashNetProceedsUsd: number;
};

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 'true' || Number(value) === 1;
}

export function buildPlanSummary(rows: PlanSummarySourceRow[]): PlanSummaryResponse {
  const items = rows.map((row) => ({
    planName: String(row.plan_name || 'Unassigned Plan'),
    grantCount: toNumber(row.grant_count),
    granted: toNumber(row.granted),
    exercised: toNumber(row.exercised),
    cancelled: toNumber(row.cancelled),
    outstanding: toNumber(row.outstanding),
  }));

  return {
    items,
    totals: items.reduce(
      (acc, item) => ({
        planCount: acc.planCount + 1,
        grantCount: acc.grantCount + item.grantCount,
        granted: acc.granted + item.granted,
        exercised: acc.exercised + item.exercised,
        cancelled: acc.cancelled + item.cancelled,
        outstanding: acc.outstanding + item.outstanding,
      }),
      { planCount: 0, grantCount: 0, granted: 0, exercised: 0, cancelled: 0, outstanding: 0 },
    ),
  };
}

export function toFixedValue(row: FixedValueRow): FixedValueResponseRow {
  return {
    id: Number(row.id),
    key: row.key,
    label: row.label,
    value: toNumber(row.value),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    editable: toBoolean(row.editable),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

export function toFivePercentHolder(row: FivePercentHolderRow): FivePercentHolderResponseRow {
  return {
    id: Number(row.id),
    name: row.name,
    identity: row.identity,
    track: toBoolean(row.tracked),
    source: 'shareholder_tags',
  };
}

export function toShareworksGrant(row: ShareworksGrantSourceRow): ShareworksGrantResponseRow {
  return {
    id: Number(row.id),
    employeeNumber: row.employee_number,
    lastName: row.last_name,
    firstName: row.first_name,
    middleName: row.middle_name,
    planName: row.plan_name,
    grantName: row.grant_name,
    grantType: row.grant_type,
    employeeGrantNumber: row.employee_grant_number,
    grantDate: row.grant_date,
    vestingStartDate: row.vesting_start_date,
    serviceStartDate: row.service_start_date,
    originalVestingStartDate: row.original_vesting_start_date,
    expireDate: row.expire_date,
    participantExpireDate: row.participant_expire_date,
    earliestExpireCancelDate: row.earliest_expire_cancel_date,
    latestExpireCancelDate: row.latest_expire_cancel_date,
    sharesGranted: toNullableNumber(row.shares_granted),
    exercisePricePerShare: toNullableNumber(row.exercise_price_per_share),
    vestingSchedule: row.vesting_schedule,
    earlyExerciseAllowed: row.early_exercise_allowed,
    sharesVested: toNullableNumber(row.shares_vested),
    sharesUnvested: toNullableNumber(row.shares_unvested),
    sharesExercisedReleased: toNullableNumber(row.shares_exercised_released),
    sharesSubjectToRepurchase: toNullableNumber(row.shares_subject_to_repurchase),
    sharesCancelledExpired: toNullableNumber(row.shares_cancelled_expired),
    sharesOutstanding: toNullableNumber(row.shares_outstanding),
    outstandingUnvested: toNullableNumber(row.outstanding_unvested),
    outstandingVestedExercisable: toNullableNumber(row.outstanding_vested_exercisable),
  };
}

export function toExerciseRecord(row: ExerciseRecordSourceRow): ExerciseRecordResponseRow {
  return {
    id: Number(row.id),
    name: row.name,
    employeeNumber: row.employee_number,
    futubullId: row.futubull_id,
    userId: row.user_id,
    grantNumber: row.grant_number,
    grantDate: row.grant_date,
    grantPriceUsd: toNumber(row.grant_price_usd),
    exerciseDate: row.exercise_date,
    orderedQuantity: toNumber(row.ordered_quantity),
    exercisedQuantity: toNumber(row.exercised_quantity),
    exerciseCostUsd: toNumber(row.exercise_cost_usd),
    deductionSellingQuantity: toNumber(row.deduction_selling_quantity),
    dealtQuantity: toNumber(row.dealt_quantity),
  };
}

export function toSoldShare(row: SoldShareSourceRow): SoldShareResponseRow {
  return {
    id: Number(row.id),
    name: row.name,
    employeeNumber: row.employee_number,
    futubullId: row.futubull_id,
    userId: row.user_id,
    employmentStatus: row.employment_status,
    relatedPartyIdentity: row.related_party_identity,
    capitalGainsTaxVisibility: row.capital_gains_tax_visibility,
    soldQuantity: toNumber(row.sold_quantity),
    dealtQuantity: toNumber(row.dealt_quantity),
    dealAmountUsd: toNumber(row.deal_amount_usd),
    taxableIncomeUsd: toNumber(row.taxable_income_usd),
    taxPayableUsd: toNumber(row.tax_payable_usd),
    transactionFeesUsd: toNumber(row.transaction_fees_usd),
    netDealValueUsd: toNumber(row.net_deal_value_usd),
    grantCostUsd: toNumber(row.grant_cost_usd),
    exerciseVestingFeeUsd: toNumber(row.exercise_vesting_fee_usd),
    withholdingTaxUsd: toNumber(row.withholding_tax_usd),
    withholdingTaxCny: toNumber(row.withholding_tax_cny),
    cashNetProceedsUsd: toNumber(row.cash_net_proceeds_usd),
  };
}

export function toTransferPlanPeriod(
  row: TransferPlanPeriodSourceRow,
): TransferPlanPeriodResponseRow {
  const inTotal = toNumber(row.in_total);
  const cancelledQuantity = toNumber(row.cancelled_quantity);
  return {
    id: Number(row.id),
    sourceFileId: row.source_file_id === null ? null : Number(row.source_file_id),
    period: row.period,
    inTotal,
    sourceCancelled: toNumber(row.source_cancelled),
    cancelledQuantity,
    transferToFutu: inTotal + cancelledQuantity,
    manuallyEdited: toBoolean(row.manually_edited),
    sortOrder: Number(row.sort_order),
  };
}

export function mergeFutuGrant(row: FutuMergeSourceRow): MergedGrantRow {
  const cancelled =
    row.vestedCancelledQuantity === null && row.unvestedCancelledQuantity === null
      ? null
      : (row.vestedCancelledQuantity ?? 0) + (row.unvestedCancelledQuantity ?? 0);
  return {
    id: `futu-${row.id}`,
    source: 'Futu',
    employeeName: row.employeeName,
    grantNumber: row.grantNumber,
    employeeNumber: row.employeeNumber,
    incentiveType: row.incentiveType,
    grantDate: row.grantDate,
    grantQuantity: row.grantQuantity,
    grantPrice: row.grantPriceUsd,
    expireDate: row.expireDate,
    planName: row.planName,
    vestingRuleName: row.vestingRuleName,
    vestingStartDate: row.vestingStartDate,
    sharesVested: row.vestedQuantity,
    sharesUnvested: row.unvestedQuantity,
    sharesExercisedReleased: row.exercisedQuantity,
    sharesCancelledExpired: cancelled,
    sharesOutstanding: row.outstandingQuantity,
  };
}

export function mergeShareworksGrant(row: ShareworksMergeSourceRow): MergedGrantRow {
  return {
    id: `shareworks-${row.id}`,
    source: 'Shareworks',
    employeeName: assembleShareworksName(row.lastName, row.firstName, row.middleName),
    grantNumber: row.employeeGrantNumber ?? '',
    employeeNumber: row.employeeNumber ?? '',
    incentiveType: row.grantType ?? '',
    grantDate: row.grantDate,
    grantQuantity: row.sharesGranted,
    grantPrice: row.exercisePricePerShare,
    expireDate: row.expireDate,
    planName: row.planName,
    vestingRuleName: row.vestingSchedule,
    vestingStartDate: row.vestingStartDate,
    sharesVested: row.sharesVested,
    sharesUnvested: row.sharesUnvested,
    sharesExercisedReleased: row.sharesExercisedReleased,
    sharesCancelledExpired: row.sharesCancelledExpired,
    sharesOutstanding: row.sharesOutstanding,
  };
}
