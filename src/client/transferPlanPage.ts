import type { TransferPlanPeriod, TransferPlanResponse } from '../shared/types.js';

export type TransferPlanTableView = 'summaryRows' | 'periodRows';

type RenderDeps = {
  escapeHtml: (value: unknown) => string;
  formatNumber: (value: unknown) => string;
};

type TransferPlanTableHtml = {
  headHtml: string;
  bodyHtml: string;
};

function renderCancelledInput(item: TransferPlanPeriod, deps: RenderDeps): string {
  return `
    <input
      class="transfer-plan-cancel-input${item.manuallyEdited ? ' is-edited' : ''}"
      type="number"
      step="1"
      value="${item.cancelledQuantity}"
      data-transfer-cancelled-id="${item.id}"
      aria-label="${deps.escapeHtml(item.period)} cancelled quantity"
      title="Source value: ${item.sourceCancelled}"
    >`;
}

function renderSummaryRowsTable(data: TransferPlanResponse, deps: RenderDeps): TransferPlanTableHtml {
  return {
    headHtml: `
      <tr>
        <th>Summary</th>
        ${data.items.map((item) => `<th>${deps.escapeHtml(item.period)}</th>`).join('')}
        <th>Total</th>
      </tr>`,
    bodyHtml: `
      <tr>
        <th>In total</th>
        ${data.items.map((item) => `<td>${deps.formatNumber(item.inTotal)}</td>`).join('')}
        <td class="transfer-plan-total">${deps.formatNumber(data.totals.inTotal)}</td>
      </tr>
      <tr class="transfer-plan-cancelled-row">
        <th>Options cancelled/forfeited</th>
        ${data.items.map((item) => `<td>${renderCancelledInput(item, deps)}</td>`).join('')}
        <td class="transfer-plan-total">${deps.formatNumber(data.totals.cancelledQuantity)}</td>
      </tr>
      <tr class="transfer-plan-result-row">
        <th>Transfer to Futu</th>
        ${data.items.map((item) => `<td>${deps.formatNumber(item.transferToFutu)}</td>`).join('')}
        <td class="transfer-plan-total">${deps.formatNumber(data.totals.transferToFutu)}</td>
      </tr>`,
  };
}

function renderPeriodRowsTable(data: TransferPlanResponse, deps: RenderDeps): TransferPlanTableHtml {
  return {
    headHtml: `
      <tr>
        <th>Period</th>
        <th>In total</th>
        <th>Options cancelled/forfeited</th>
        <th>Transfer to Futu</th>
      </tr>`,
    bodyHtml: `
      ${data.items
        .map(
          (item) => `
            <tr>
              <th>${deps.escapeHtml(item.period)}</th>
              <td>${deps.formatNumber(item.inTotal)}</td>
              <td>${renderCancelledInput(item, deps)}</td>
              <td>${deps.formatNumber(item.transferToFutu)}</td>
            </tr>`,
        )
        .join('')}
      <tr class="transfer-plan-result-row">
        <th>Total</th>
        <td class="transfer-plan-total">${deps.formatNumber(data.totals.inTotal)}</td>
        <td class="transfer-plan-total">${deps.formatNumber(data.totals.cancelledQuantity)}</td>
        <td class="transfer-plan-total">${deps.formatNumber(data.totals.transferToFutu)}</td>
      </tr>`,
  };
}

export function renderTransferPlanSummaryTable(
  data: TransferPlanResponse,
  view: TransferPlanTableView,
  deps: RenderDeps,
): TransferPlanTableHtml {
  if (view === 'periodRows') {
    return renderPeriodRowsTable(data, deps);
  }
  return renderSummaryRowsTable(data, deps);
}
