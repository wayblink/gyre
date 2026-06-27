/**
 * CapTable Equity Management System - Application Logic
 */

// 当前筛选月份
let currentMonth = "2026-05";
// 当前查看的计划
let currentPlan = null;
// 当前文件检查清单（可修改的副本，包含3个表格数据）
let currentFileList = null;
// 新增计划弹窗中已上传的文件
let uploadedFiles = [];

// Page title mapping
const pageTitles = {
    summary: "Summary",
    monthly: "Monthly Updates",
    holdings: "Holdings",
    settings: "Settings"
};

/**
 * 初始化
 */
document.addEventListener("DOMContentLoaded", function() {
    initNavigation();
    initMonthPicker();
    initSummaryPage();
    initMonthlyPage();
    initHoldingsPage();
    initSettingsPage();
});

/**
 * 侧边栏导航
 */
function initNavigation() {
    const navItems = document.querySelectorAll(".nav-item");
    navItems.forEach(item => {
        item.addEventListener("click", function() {
            const page = this.dataset.page;
            navItems.forEach(i => i.classList.remove("active"));
            this.classList.add("active");
            document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active"));
            document.getElementById("page-" + page).classList.add("active");
            document.getElementById("pageTitle").textContent = pageTitles[page];
        });
    });
}

/**
 * 月份选择器初始化
 */
function initMonthPicker() {
    const picker = document.getElementById("monthPicker");
    const pickerMonthly = document.getElementById("monthPickerMonthly");
    if (picker) picker.value = "2026-05";
    if (pickerMonthly) pickerMonthly.value = "";

    // 数据汇总页查询
    const btnSearch = document.getElementById("btnSearch");
    if (btnSearch) btnSearch.addEventListener("click", function() {
        const month = document.getElementById("monthPicker").value;
        if (!month) { alert("请选择月份"); return; }
        currentMonth = month;
        renderSummaryPage(month);
    });

    const btnReset = document.getElementById("btnReset");
    if (btnReset) btnReset.addEventListener("click", function() {
        document.getElementById("monthPicker").value = "2026-05";
        currentMonth = "2026-05";
        renderSummaryPage("2026-05");
    });

    const btnExport = document.getElementById("btnExport");
    if (btnExport) btnExport.addEventListener("click", function() { exportData(currentMonth); });

    const btnRefresh = document.getElementById("btnRefresh");
    if (btnRefresh) btnRefresh.addEventListener("click", function() { renderSummaryPage(currentMonth); });

    // 月度更新计划页查询
    const btnSearchMonthly = document.getElementById("btnSearchMonthly");
    if (btnSearchMonthly) btnSearchMonthly.addEventListener("click", function() {
        const month = document.getElementById("monthPickerMonthly").value;
        renderMonthlyPage(month);
    });
}

// ============================================================
// 【页面1】数据汇总
// ============================================================
function initSummaryPage() {
    renderSummaryPage(currentMonth);
    document.getElementById("btnAddNote").addEventListener("click", function() {
        document.getElementById("addNoteForm").classList.remove("hidden");
        document.getElementById("noteContent").focus();
    });
    document.getElementById("btnCancelNote").addEventListener("click", function() {
        document.getElementById("addNoteForm").classList.add("hidden");
        document.getElementById("noteContent").value = "";
    });
    document.getElementById("btnSaveNote").addEventListener("click", function() {
        const content = document.getElementById("noteContent").value.trim();
        if (!content) { alert("请输入备注内容"); return; }
        const data = getMonthData(currentMonth);
        data.notes.unshift({ id: Date.now(), time: formatDateTime(new Date()), content: content });
        document.getElementById("noteContent").value = "";
        document.getElementById("addNoteForm").classList.add("hidden");
        renderNotes(data.notes);
    });
}

function renderSummaryPage(month) {
    const data = getMonthData(month);
    document.getElementById("currentMonthText").textContent = formatMonthCN(month);
    document.getElementById("eomDate").textContent = data.eomDate || getEOMDate(month);

    // 对账表
    const tbody = document.getElementById("reconciliationBody");
    tbody.innerHTML = `
        <tr>
            <td style="text-align:left; font-weight:600;">${data.reconciliation.item}</td>
            <td>${getEOMDate(month)}</td>
            <td class="highlight-number">${formatNumber(data.reconciliation.lastMonth)}</td>
            <td class="highlight-number">${formatNumber(data.reconciliation.newShares)}</td>
            <td class="highlight-number">${formatNumber(data.reconciliation.eomBalance)}</td>
        </tr>
    `;

    // 资本结构表
    const capTbody = document.getElementById("capitalizationBody");
    capTbody.innerHTML = data.capitalization.map(item => {
        if (item.type === "cat-header-blue" || item.type === "cat-header-gray") {
            return `<tr class="cat-header-blue">
                <td></td>
                <td colspan="4" style="text-align:left;">${item.description}</td>
            </tr>`;
        }
        // 资产类汇总：EOM 这种带有数据的子分类行
        if (item.type === "cat-sub-label" && item.shares !== undefined) {
            const sharesHtml = item.highlightShares
                ? `<span class="highlight-yellow">${formatNumber(item.shares)}</span>`
                : formatNumber(item.shares);
            return `<tr class="cat-sub-label">
                <td></td>
                <td style="text-align:left;">${item.description}</td>
                <td class="col-number">${sharesHtml}</td>
                <td></td>
                <td class="col-formula">${item.formula || ""}</td>
            </tr>`;
        }
        if (item.type === "cat-sub-label") {
            return `<tr class="cat-sub-label">
                <td></td>
                <td colspan="4" style="text-align:left;">${item.description}</td>
            </tr>`;
        }
        // 百分比格式：如果值 < 1 则视为小数（如 0.685 → 68.50%），否则视为已格式化的百分比数值
        let percentStr = "";
        if (item.percent !== null && item.percent !== undefined) {
            if (item.percent < 1) {
                percentStr = (item.percent * 100).toFixed(2) + "%";
            } else {
                percentStr = item.percent.toFixed(2) + "%";
            }
        }
        return `<tr class="cap-data-row">
            <td>${item.number}</td>
            <td style="text-align:left;">${item.description}</td>
            <td class="col-number">${formatNumber(item.shares)}</td>
            <td class="col-percent">${percentStr}</td>
            <td class="col-formula">${item.formula || ""}</td>
        </tr>`;
    }).join("");

    document.getElementById("totalShares").textContent = formatNumber(data.totalFullyDiluted);

    // 绑定蓝色超链接点击事件
    capTbody.querySelectorAll('.link-blue').forEach(link => {
        link.addEventListener('click', function() {
            const linkType = this.dataset.link;
            openLinkModal(linkType);
        });
    });

    // 备注
    renderNotes(data.notes);
}

function renderNotes(notes) {
    const container = document.getElementById("notesContainer");
    if (!notes || notes.length === 0) {
        container.innerHTML = `<div class="note-empty">暂无备注，点击右上角"添加备注"按钮添加</div>`;
        return;
    }
    container.innerHTML = notes.map(note => `
        <div class="note-item">
            <div class="note-header">
                <span class="note-time">🕒 ${note.time}</span>
                <div class="note-actions">
                    <button class="note-action-btn" data-id="${note.id}" data-action="delete" title="删除">🗑️</button>
                </div>
            </div>
            <div class="note-content">${escapeHtml(note.content)}</div>
        </div>
    `).join("");

    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener("click", function() {
            if (confirm("确定删除此备注吗？")) {
                const id = parseInt(this.dataset.id);
                const data = getMonthData(currentMonth);
                data.notes = data.notes.filter(n => n.id !== id);
                renderNotes(data.notes);
            }
        });
    });
}

// ============================================================
// 【页面2】月度更新计划（重点重构）
// ============================================================
function initMonthlyPage() {
    renderMonthlyPage("");

    // 新增计划按钮
    const btnAdd = document.getElementById("btnAddUpdate");
    if (btnAdd) {
        btnAdd.addEventListener("click", function() {
            document.getElementById("newPlanMonth").value = "2026-06";
            document.getElementById("newPlanOperator").value = "Gu";
            document.getElementById("newPlanRemark").value = "";
            uploadedFiles = [];
            renderUploadFileList();
            document.getElementById("addPlanModal").classList.remove("hidden");
        });
    }

    // File upload logic
    initFileUpload();

    // 新增计划弹窗 - 取消
    const btnCancelAdd = document.getElementById("btnCancelAddModal");
    if (btnCancelAdd) btnCancelAdd.addEventListener("click", function() {
        document.getElementById("addPlanModal").classList.add("hidden");
    });

    // 新增计划弹窗 - 提交
    const btnSubmitAdd = document.getElementById("btnSubmitAdd");
    if (btnSubmitAdd) btnSubmitAdd.addEventListener("click", function() {
        const month = document.getElementById("newPlanMonth").value;
        const operator = document.getElementById("newPlanOperator").value.trim();
        const remark = document.getElementById("newPlanRemark").value.trim();
        if (!month || !operator) { alert("请填写月份和操作人"); return; }

        const newId = Math.max(...updatePlans.map(p => p.id)) + 1;
        const [year, m] = month.split("-");
        const now = new Date();
        const timeStr = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;
        const newPlan = {
            id: newId,
            month: month,
            monthLabel: `${parseInt(m)}月`,
            operationTime: timeStr,
            operator: operator,
            status: "待启动",
            remark: remark || "新建的月度数据更新计划"
        };
        updatePlans.unshift(newPlan);
        document.getElementById("addPlanModal").classList.add("hidden");
        renderMonthlyPage("");
        alert(`✅ 已成功创建 ${year}年${parseInt(m)}月 更新计划`);
    });

    // 文件检查弹窗 - 关闭
    const btnCloseModal = document.getElementById("btnCloseModal");
    if (btnCloseModal) btnCloseModal.addEventListener("click", closeFileModal);

    // 文件检查弹窗 - 跳过本步骤
    const btnSkipUpload = document.getElementById("btnSkipUpload");
    if (btnSkipUpload) btnSkipUpload.addEventListener("click", function() {
        if (confirm("确定跳过文件上传步骤？跳过将直接进入更新确认阶段。")) {
            // 将所有 warning 状态改为 pass
            if (currentFileList) {
                currentFileList.shareworksData.forEach(item => {
                    if (item.status === "warning") item.status = "pass";
                });
                currentFileList.futuData.forEach(item => {
                    if (item.status === "warning") item.status = "pass";
                });
            }
            renderSourceTables();
        }
    });

    // 文件检查弹窗 - 保存并退出
    const btnSaveExit = document.getElementById("btnSaveExit");
    if (btnSaveExit) btnSaveExit.addEventListener("click", function() {
        if (confirm("确定保存当前进度并退出吗？")) {
            closeFileModal();
            alert("💾 当前更新进度已保存");
        }
    });

    // 文件检查弹窗 - 确认无误更新数据
    const btnConfirm = document.getElementById("btnConfirmUpdate");
    if (btnConfirm) btnConfirm.addEventListener("click", function() {
        // 统计所有表格中的 pass 和 warning 状态
        let passCount = 0;
        let totalCount = 0;
        if (currentFileList) {
            const allItems = [...currentFileList.shareworksData, ...currentFileList.futuData];
            totalCount = allItems.filter(i => i.status).length;
            passCount = allItems.filter(i => i.status === "pass").length;
        }
        if (passCount === 0) {
            if (!confirm("当前没有任何数据项检查通过，确认继续更新吗？")) return;
        }
        if (confirm(`共 ${totalCount} 个数据项，${passCount} 个检查通过。\n确认无误，开始执行数据更新？`)) {
            // 更新计划状态为"已完成"
            if (currentPlan) {
                currentPlan.status = "已完成";
                currentPlan.operationTime = formatDateTimeSimple(new Date());
            }
            closeFileModal();
            renderMonthlyPage("");
            alert("✅ 数据更新完成！计划状态已更新为【已完成】");
        }
    });
}

/**
 * 渲染月度更新计划列表
 * @param {string} filterMonth - 筛选月份，为空显示全部
 */
function renderMonthlyPage(filterMonth) {
    let plans = updatePlans;
    if (filterMonth) plans = plans.filter(p => p.month === filterMonth);

    // 统计卡片
    document.getElementById("planTotalCount").textContent = plans.length;
    document.getElementById("planCompletedCount").textContent = plans.filter(p => p.status === "已完成").length;
    document.getElementById("planInProgressCount").textContent = plans.filter(p => p.status === "进行中").length;
    document.getElementById("planPendingCount").textContent = plans.filter(p => p.status === "待启动").length;

    const tbody = document.getElementById("monthlyUpdateBody");
    if (plans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:32px; color:#64748b;">暂无月度更新计划</td></tr>`;
        return;
    }

    tbody.innerHTML = plans.map((plan, index) => {
        const statusClass = plan.status === "已完成" ? "status-completed" :
                           plan.status === "进行中" ? "status-inprogress" : "status-pending";
        return `
            <tr>
                <td>${index + 1}</td>
                <td><strong>${plan.monthLabel}</strong><br><span style="font-size:11px;color:#64748b;">${plan.month}</span></td>
                <td>${plan.operationTime}</td>
                <td>${plan.operator}</td>
                <td><span class="status-badge ${statusClass}">${plan.status}</span></td>
                <td>
                    <div class="action-buttons">
                        <button class="btn btn-primary" data-action="view" data-id="${plan.id}">查看详情</button>
                        <button class="btn btn-secondary" data-action="edit" data-id="${plan.id}">编辑</button>
                        <button class="btn btn-danger" data-action="delete" data-id="${plan.id}">删除</button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    // 绑定操作按钮事件
    tbody.querySelectorAll('[data-action="view"]').forEach(btn => {
        btn.addEventListener("click", function() { openFileModal(parseInt(this.dataset.id)); });
    });
    tbody.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener("click", function() {
            const plan = updatePlans.find(p => p.id === parseInt(this.dataset.id));
            const newMonth = prompt("修改月份（格式：YYYY-MM）：", plan.month);
            if (newMonth && /^\d{4}-\d{2}$/.test(newMonth)) {
                const [y, m] = newMonth.split("-");
                plan.month = newMonth;
                plan.monthLabel = `${parseInt(m)}月`;
                const newOperator = prompt("修改操作人：", plan.operator);
                if (newOperator) plan.operator = newOperator;
                renderMonthlyPage("");
            }
        });
    });
    tbody.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener("click", function() {
            const plan = updatePlans.find(p => p.id === parseInt(this.dataset.id));
            if (confirm(`确定删除【${plan.monthLabel}】的更新计划吗？此操作不可撤销。`)) {
                const idx = updatePlans.findIndex(p => p.id === parseInt(this.dataset.id));
                updatePlans.splice(idx, 1);
                renderMonthlyPage("");
            }
        });
    });
}

/**
 * 打开文件检查弹窗
 */
function openFileModal(planId) {
    currentPlan = updatePlans.find(p => p.id === planId);
    if (!currentPlan) return;

    // 初始化文件检查列表副本
    currentFileList = getFileCheckList(planId);

    // 更新计划信息
    document.getElementById("modalMonth").textContent = formatMonthCN(currentPlan.month) + ` (${currentPlan.monthLabel})`;
    document.getElementById("modalOperator").textContent = currentPlan.operator;
    const statusEl = document.getElementById("modalStatus");
    const statusClass = currentPlan.status === "已完成" ? "status-completed" :
                       currentPlan.status === "进行中" ? "status-inprogress" : "status-pending";
    statusEl.innerHTML = `<span class="status-badge ${statusClass}">${currentPlan.status}</span>`;

    // 标题
    document.getElementById("modalTitle").textContent =
        `【${currentPlan.monthLabel}】数据更新 - 文件检查`;

    renderSourceTables();
    document.getElementById("fileCheckModal").classList.remove("hidden");
}

/**
 * 关闭文件检查弹窗
 */
function closeFileModal() {
    document.getElementById("fileCheckModal").classList.add("hidden");
    currentPlan = null;
    currentFileList = null;
}

/**
 * 渲染3个数据源表格（Fixed Values、Shareworks、Futu）
 */
function renderSourceTables() {
    if (!currentFileList) return;

    // ===== Table 1: Fixed Values =====
    const fixedBody = document.getElementById("fixedValueBody");
    fixedBody.innerHTML = currentFileList.fixedValues.map((item, index) => {
        const actionHtml = item.action === "edit"
            ? `<a href="javascript:void(0)" class="source-edit-link" data-table="fixed" data-index="${index}">edit</a>`
            : `<span style="color:#94a3b8;">-</span>`;
        return `
            <tr>
                <td style="text-align:left;">${escapeHtml(item.item)}</td>
                <td class="col-number">${formatNumber(item.value)}</td>
                <td>${actionHtml}</td>
            </tr>
        `;
    }).join("");

    // ===== Table 2: Shareworks =====
    const swBody = document.getElementById("shareworksBody");
    swBody.innerHTML = currentFileList.shareworksData.map((item, index) => {
        // Status icon
        let statusIcon = "";
        if (item.status === "pass") {
            statusIcon = `<span class="source-status-icon source-status-pass" title="Pass">&#10003;</span>`;
        } else if (item.status === "warning") {
            statusIcon = `<span class="source-status-icon source-status-warning" title="Warning">&#9888;</span>`;
        } else {
            statusIcon = `<span style="color:#94a3b8;">-</span>`;
        }

        // Uploaded file display
        let uploadedHtml = "";
        if (!item.uploadedFile) {
            uploadedHtml = `<span style="color:#94a3b8;">-</span>`;
        } else if (item.uploadedFile === "Not uploaded") {
            if (item.fileName) {
                uploadedHtml = `<span class="source-not-uploaded">Not uploaded</span> <button class="source-upload-btn" data-table="shareworks" data-index="${index}">Upload</button>`;
            } else {
                uploadedHtml = `<span class="source-not-uploaded">Not uploaded</span>`;
            }
        } else {
            uploadedHtml = `<div class="source-file-actions"><a href="javascript:void(0)" class="source-file-link" title="${escapeHtml(item.uploadedFile)}">${escapeHtml(item.uploadedFile)}</a><button class="source-file-delete" data-table="shareworks" data-index="${index}" title="Delete file">&times;</button></div>`;
        }

        // Is required display
        let requiredHtml = "";
        if (!item.isRequired) {
            requiredHtml = `<span style="color:#94a3b8;">-</span>`;
        } else if (item.isRequired === "Required") {
            requiredHtml = `<span class="source-required-badge">Required</span>`;
        } else {
            requiredHtml = `<span class="source-optional-badge">Optional</span>`;
        }

        // Action
        let actionHtml = "";
        if (item.action === "edit") {
            actionHtml = `<a href="javascript:void(0)" class="source-edit-link" data-table="shareworks" data-index="${index}">edit</a>`;
        } else {
            actionHtml = `<span style="color:#94a3b8;">-</span>`;
        }

        // Value
        let valueHtml = "";
        if (item.value === null || item.value === undefined) {
            valueHtml = `<span style="color:#94a3b8;">-</span>`;
        } else {
            valueHtml = `<span class="col-number">${formatNumber(item.value)}</span>`;
        }

        return `
            <tr>
                <td style="text-align:left;${item.fileName ? ' font-weight:600;' : ''}">${item.fileName ? escapeHtml(item.fileName) : ''}</td>
                <td>${requiredHtml}</td>
                <td>${uploadedHtml}</td>
                <td style="text-align:left;${item.fileName ? '' : ' padding-left:24px; color:#475569;'}">${item.item ? escapeHtml(item.item) : ''}</td>
                <td style="text-align:center;">${statusIcon}</td>
                <td>${valueHtml}</td>
                <td>${actionHtml}</td>
            </tr>
        `;
    }).join("");

    // ===== Table 3: Futu =====
    const futuBody = document.getElementById("futuBody");
    futuBody.innerHTML = currentFileList.futuData.map((item, index) => {
        // Status icon
        let statusIcon = "";
        if (item.status === "pass") {
            statusIcon = `<span class="source-status-icon source-status-pass" title="Pass">&#10003;</span>`;
        } else if (item.status === "warning") {
            statusIcon = `<span class="source-status-icon source-status-warning" title="Warning">&#9888;</span>`;
        } else {
            statusIcon = `<span style="color:#94a3b8;">-</span>`;
        }

        // Uploaded file display
        let uploadedHtml = "";
        if (!item.uploadedFile) {
            uploadedHtml = `<span style="color:#94a3b8;">-</span>`;
        } else if (item.uploadedFile === "Not uploaded") {
            if (item.fileName) {
                uploadedHtml = `<span class="source-not-uploaded">Not uploaded</span> <button class="source-upload-btn" data-table="futu" data-index="${index}">Upload</button>`;
            } else {
                uploadedHtml = `<span class="source-not-uploaded">Not uploaded</span>`;
            }
        } else {
            uploadedHtml = `<div class="source-file-actions"><a href="javascript:void(0)" class="source-file-link" title="${escapeHtml(item.uploadedFile)}">${escapeHtml(item.uploadedFile)}</a><button class="source-file-delete" data-table="futu" data-index="${index}" title="Delete file">&times;</button></div>`;
        }

        // Is required display
        let requiredHtml = "";
        if (!item.isRequired) {
            requiredHtml = `<span style="color:#94a3b8;">-</span>`;
        } else if (item.isRequired === "Required") {
            requiredHtml = `<span class="source-required-badge">Required</span>`;
        } else {
            requiredHtml = `<span class="source-optional-badge">Optional</span>`;
        }

        // Metric
        let metricHtml = item.metric ? escapeHtml(item.metric) : `<span style="color:#94a3b8;">-</span>`;

        // Action
        let actionHtml = "";
        if (item.action === "edit") {
            actionHtml = `<a href="javascript:void(0)" class="source-edit-link" data-table="futu" data-index="${index}">edit</a>`;
        } else {
            actionHtml = `<span style="color:#94a3b8;">-</span>`;
        }

        // Value
        let valueHtml = "";
        if (item.value === null || item.value === undefined) {
            valueHtml = `<span style="color:#94a3b8;">-</span>`;
        } else {
            valueHtml = `<span class="col-number">${formatNumber(item.value)}</span>`;
        }

        return `
            <tr>
                <td style="text-align:left; font-weight:600;">${escapeHtml(item.fileName)}</td>
                <td>${requiredHtml}</td>
                <td>${uploadedHtml}</td>
                <td style="text-align:left;">${metricHtml}</td>
                <td style="text-align:center;">${statusIcon}</td>
                <td>${valueHtml}</td>
                <td>${actionHtml}</td>
            </tr>
        `;
    }).join("");

    // Bind edit links for all tables
    document.querySelectorAll('.source-edit-link').forEach(link => {
        link.addEventListener('click', function() {
            const table = this.dataset.table;
            const idx = parseInt(this.dataset.index);
            let currentValue;
            if (table === "fixed") {
                currentValue = currentFileList.fixedValues[idx].value;
            } else if (table === "shareworks") {
                currentValue = currentFileList.shareworksData[idx].value;
            } else if (table === "futu") {
                currentValue = currentFileList.futuData[idx].value;
            }
            const newValue = prompt("Enter new value:", currentValue);
            if (newValue !== null && !isNaN(Number(newValue))) {
                if (table === "fixed") {
                    currentFileList.fixedValues[idx].value = Number(newValue);
                } else if (table === "shareworks") {
                    currentFileList.shareworksData[idx].value = Number(newValue);
                } else if (table === "futu") {
                    currentFileList.futuData[idx].value = Number(newValue);
                }
                renderSourceTables();
            }
        });
    });

    // Bind upload buttons
    document.querySelectorAll('.source-upload-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const table = this.dataset.table;
            const idx = parseInt(this.dataset.index);
            const input = document.createElement('input');
            input.type = 'file';
            input.style.display = 'none';
            input.accept = '.xlsx,.xls,.csv';
            document.body.appendChild(input);
            input.addEventListener('change', function() {
                if (this.files && this.files.length > 0) {
                    const fileName = this.files[0].name;
                    if (table === "shareworks") {
                        currentFileList.shareworksData[idx].uploadedFile = fileName;
                        currentFileList.shareworksData[idx].status = "pass";
                    } else if (table === "futu") {
                        currentFileList.futuData[idx].uploadedFile = fileName;
                        currentFileList.futuData[idx].status = "pass";
                    }
                    renderSourceTables();
                }
                document.body.removeChild(input);
            });
            input.click();
        });
    });

    // Bind delete buttons
    document.querySelectorAll('.source-file-delete').forEach(btn => {
        btn.addEventListener('click', function() {
            const table = this.dataset.table;
            const idx = parseInt(this.dataset.index);
            if (table === "shareworks") {
                currentFileList.shareworksData[idx].uploadedFile = "Not uploaded";
                currentFileList.shareworksData[idx].status = "";
            } else if (table === "futu") {
                currentFileList.futuData[idx].uploadedFile = "Not uploaded";
                currentFileList.futuData[idx].status = "";
            }
            renderSourceTables();
        });
    });
}

// ============================================================
// 【页面3】持股明细
// ============================================================
function initHoldingsPage() {
    renderHoldingsPage(currentMonth);
    const btnSearch = document.getElementById("btnSearchHoldings");
    if (btnSearch) btnSearch.addEventListener("click", function() { renderHoldingsPage(currentMonth); });
}

function renderHoldingsPage(month) {
    const data = getMonthData(month);
    const tbody = document.getElementById("holdingsBody");
    const keyword = document.getElementById("searchHolder").value.trim().toLowerCase();
    const typeFilter = document.getElementById("filterGrantType").value;

    let holdings = data.holdings || [];
    if (keyword) {
        holdings = holdings.filter(h =>
            h.lastName.toLowerCase().includes(keyword) ||
            h.firstName.toLowerCase().includes(keyword) ||
            h.planName.toLowerCase().includes(keyword) ||
            h.grantName.toLowerCase().includes(keyword) ||
            String(h.employeeNumber).includes(keyword)
        );
    }
    if (typeFilter) {
        holdings = holdings.filter(h => h.grantType === typeFilter);
    }

    if (holdings.length === 0) {
        tbody.innerHTML = `<tr><td colspan="21" style="text-align:center; padding:var(--space-10); color:var(--text-muted);">No matching records found</td></tr>`;
        return;
    }

    tbody.innerHTML = holdings.map((item, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>${item.costCenter}</td>
            <td style="text-align:left;">${item.participantType}</td>
            <td>${item.employeeNumber}</td>
            <td style="text-align:left; font-weight:var(--font-semibold);">${item.lastName}</td>
            <td style="text-align:left;">${item.firstName}</td>
            <td style="text-align:left;">${item.planName}</td>
            <td style="text-align:left;">${item.grantName}</td>
            <td><span class="grant-type-badge ${getGrantTypeClass(item.grantType)}">${item.grantType}</span></td>
            <td>${item.employeeGrantNumber}</td>
            <td>${item.grantDate}</td>
            <td>${item.vestingStartDate}</td>
            <td>${item.expireDate}</td>
            <td class="col-number">${formatNumber(item.sharesGranted)}</td>
            <td class="col-number">$${item.exercisePrice.toFixed(2)}</td>
            <td>${item.vestingSchedule}</td>
            <td>${item.earlyExercise}</td>
            <td class="col-number">${formatNumber(item.sharesVested)}</td>
            <td class="col-number">${formatNumber(item.sharesUnvested)}</td>
            <td class="col-number">${formatNumber(item.sharesExercised)}</td>
            <td class="col-number" style="font-weight:var(--font-semibold);">${formatNumber(item.sharesOutstanding)}</td>
        </tr>
    `).join("");
}

function getGrantTypeClass(type) {
    if (type === "Options (NQ)") return "type-nq";
    if (type === "Options (ISO)") return "type-iso";
    if (type === "RSU") return "type-rsu";
    if (type === "Common Stock") return "type-common";
    return "";
}

// ============================================================
// 【页面4】基础设置 - 3个子菜单
// ============================================================
function initSettingsPage() {
    // 子菜单标签切换
    const subTabs = document.querySelectorAll(".sub-tab");
    subTabs.forEach(tab => {
        tab.addEventListener("click", function() {
            const sub = this.dataset.sub;
            subTabs.forEach(t => t.classList.remove("active"));
            this.classList.add("active");
            document.querySelectorAll(".sub-content").forEach(c => c.classList.remove("active"));
            document.getElementById("sub-" + sub).classList.add("active");
        });
    });

    // 通用弹窗关闭按钮（data-close属性）
    document.querySelectorAll("[data-close]").forEach(btn => {
        btn.addEventListener("click", function() {
            const modalId = this.dataset.close;
            document.getElementById(modalId).classList.add("hidden");
        });
    });

    // ===== a. 员工映射表 =====
    renderEmployeeTable();
    document.getElementById("btnSearchEmployee").addEventListener("click", renderEmployeeTable);
    document.getElementById("btnAddEmployee").addEventListener("click", function() {
        document.getElementById("newEmpName").value = "";
        document.getElementById("newEmpId").value = "";
        document.getElementById("newEmpFutu").value = "";
        document.getElementById("newEmpShare").value = "";
        document.getElementById("addEmployeeModal").classList.remove("hidden");
    });
    document.getElementById("btnSubmitEmployee").addEventListener("click", function() {
        const name = document.getElementById("newEmpName").value.trim();
        const empId = document.getElementById("newEmpId").value.trim();
        if (!name || !empId) { alert("请填写员工姓名和身份ID"); return; }
        const newId = Math.max(...employeeMappings.map(e => e.id), 0) + 1;
        employeeMappings.push({
            id: newId,
            name: name,
            empId: empId,
            futuId: document.getElementById("newEmpFutu").value.trim(),
            shareworksId: document.getElementById("newEmpShare").value.trim()
        });
        document.getElementById("addEmployeeModal").classList.add("hidden");
        renderEmployeeTable();
    });

    // ===== b. 计划管理表 =====
    renderPlanManageTable();
    document.getElementById("btnSearchPlan").addEventListener("click", renderPlanManageTable);
    document.getElementById("btnAddPlan").addEventListener("click", function() {
        document.getElementById("newPlanName").value = "";
        document.getElementById("newPlanDesc").value = "";
        document.getElementById("addPlanManageModal").classList.remove("hidden");
    });
    document.getElementById("btnSubmitPlanManage").addEventListener("click", function() {
        const name = document.getElementById("newPlanName").value.trim();
        if (!name) { alert("请填写计划名称"); return; }
        const newId = Math.max(...planManagements.map(p => p.id), 0) + 1;
        planManagements.push({
            id: newId,
            name: name,
            createTime: formatDateTimeSimple(new Date()),
            status: "生效中"
        });
        document.getElementById("addPlanManageModal").classList.add("hidden");
        renderPlanManageTable();
    });

    // ===== c. 股东管理 =====
    renderShareholderTable();
    document.getElementById("btnSearchShareholder").addEventListener("click", renderShareholderTable);
    document.getElementById("btnAddShareholder").addEventListener("click", function() {
        document.getElementById("newShName").value = "";
        document.getElementById("newShId").value = "";
        document.getElementById("newShTrack").value = "true";
        document.getElementById("addShareholderModal").classList.remove("hidden");
    });
    document.getElementById("btnSubmitShareholder").addEventListener("click", function() {
        const name = document.getElementById("newShName").value.trim();
        const identity = document.getElementById("newShId").value.trim();
        if (!name || !identity) { alert("请填写股东姓名和身份信息"); return; }
        const newId = Math.max(...shareholders.map(s => s.id), 0) + 1;
        shareholders.push({
            id: newId,
            name: name,
            identity: identity,
            track: document.getElementById("newShTrack").value === "true"
        });
        document.getElementById("addShareholderModal").classList.add("hidden");
        renderShareholderTable();
    });
}

// 渲染员工映射表
function renderEmployeeTable() {
    const tbody = document.getElementById("employeeBody");
    const keyword = document.getElementById("searchEmployee").value.trim().toLowerCase();
    let list = employeeMappings;
    if (keyword) list = list.filter(e => e.name.toLowerCase().includes(keyword));

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:32px; color:#64748b;">暂无员工数据</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((item, index) => `
        <tr>
            <td>${index + 1}</td>
            <td style="text-align:left; font-weight:600;">${item.name}</td>
            <td>${item.empId}</td>
            <td>${item.futuId || "-"}</td>
            <td>${item.shareworksId || "-"}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-secondary btn-sm" data-action="edit-emp" data-id="${item.id}">编辑</button>
                    <button class="btn btn-danger btn-sm" data-action="del-emp" data-id="${item.id}">删除</button>
                </div>
            </td>
        </tr>
    `).join("");

    tbody.querySelectorAll('[data-action="edit-emp"]').forEach(btn => {
        btn.addEventListener("click", function() {
            const emp = employeeMappings.find(e => e.id === parseInt(this.dataset.id));
            const newName = prompt("员工姓名：", emp.name);
            if (newName === null) return;
            const newEmpId = prompt("员工身份ID：", emp.empId);
            if (newEmpId === null) return;
            emp.name = newName;
            emp.empId = newEmpId;
            emp.futuId = prompt("futu员工ID号：", emp.futuId) || "";
            emp.shareworksId = prompt("shareworks员工ID号：", emp.shareworksId) || "";
            renderEmployeeTable();
        });
    });
    tbody.querySelectorAll('[data-action="del-emp"]').forEach(btn => {
        btn.addEventListener("click", function() {
            const emp = employeeMappings.find(e => e.id === parseInt(this.dataset.id));
            if (confirm(`确定删除员工【${emp.name}】吗？`)) {
                const idx = employeeMappings.findIndex(e => e.id === parseInt(this.dataset.id));
                employeeMappings.splice(idx, 1);
                renderEmployeeTable();
            }
        });
    });
}

// 渲染计划管理表
function renderPlanManageTable() {
    const tbody = document.getElementById("planManageBody");
    const keyword = document.getElementById("searchPlan").value.trim().toLowerCase();
    let list = planManagements;
    if (keyword) list = list.filter(p => p.name.toLowerCase().includes(keyword));

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:32px; color:#64748b;">暂无计划数据</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((item, index) => {
        const statusClass = item.status === "生效中" ? "status-completed" : "status-pending";
        return `
            <tr>
                <td>${index + 1}</td>
                <td style="text-align:left; font-weight:600;">${item.name}</td>
                <td>${item.createTime}</td>
                <td><span class="status-badge ${statusClass}">${item.status}</span></td>
                <td>
                    <div class="action-buttons">
                        <button class="btn btn-secondary btn-sm" data-action="edit-plan" data-id="${item.id}">编辑</button>
                        <button class="btn btn-danger btn-sm" data-action="del-plan" data-id="${item.id}">删除</button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    tbody.querySelectorAll('[data-action="edit-plan"]').forEach(btn => {
        btn.addEventListener("click", function() {
            const plan = planManagements.find(p => p.id === parseInt(this.dataset.id));
            const newName = prompt("计划名称：", plan.name);
            if (newName !== null && newName.trim()) {
                plan.name = newName.trim();
                renderPlanManageTable();
            }
        });
    });
    tbody.querySelectorAll('[data-action="del-plan"]').forEach(btn => {
        btn.addEventListener("click", function() {
            const plan = planManagements.find(p => p.id === parseInt(this.dataset.id));
            if (confirm(`确定删除计划【${plan.name}】吗？`)) {
                const idx = planManagements.findIndex(p => p.id === parseInt(this.dataset.id));
                planManagements.splice(idx, 1);
                renderPlanManageTable();
            }
        });
    });
}

// 渲染股东管理表
function renderShareholderTable() {
    const tbody = document.getElementById("shareholderBody");
    const keyword = document.getElementById("searchShareholder").value.trim().toLowerCase();
    let list = shareholders;
    if (keyword) list = list.filter(s => s.name.toLowerCase().includes(keyword));

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:32px; color:#64748b;">暂无股东数据</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((item, index) => {
        const trackHtml = item.track
            ? `<label class="toggle-switch"><input type="checkbox" checked data-id="${item.id}" data-field="track"><span class="toggle-slider"></span></label><span class="toggle-track-yes">是</span>`
            : `<label class="toggle-switch"><input type="checkbox" data-id="${item.id}" data-field="track"><span class="toggle-slider"></span></label><span class="toggle-track-no">否</span>`;
        return `
            <tr>
                <td>${index + 1}</td>
                <td style="text-align:left; font-weight:600;">${item.name}</td>
                <td style="text-align:left;">${item.identity}</td>
                <td>${trackHtml}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn btn-secondary btn-sm" data-action="edit-sh" data-id="${item.id}">编辑</button>
                        <button class="btn btn-danger btn-sm" data-action="del-sh" data-id="${item.id}">删除</button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    // 绑定toggle开关
    tbody.querySelectorAll('input[data-field="track"]').forEach(chk => {
        chk.addEventListener("change", function() {
            const sh = shareholders.find(s => s.id === parseInt(this.dataset.id));
            sh.track = this.checked;
            renderShareholderTable();
        });
    });

    tbody.querySelectorAll('[data-action="edit-sh"]').forEach(btn => {
        btn.addEventListener("click", function() {
            const sh = shareholders.find(s => s.id === parseInt(this.dataset.id));
            const newName = prompt("股东姓名：", sh.name);
            if (newName === null) return;
            const newId = prompt("身份信息：", sh.identity);
            if (newId === null) return;
            sh.name = newName;
            sh.identity = newId;
            renderShareholderTable();
        });
    });
    tbody.querySelectorAll('[data-action="del-sh"]').forEach(btn => {
        btn.addEventListener("click", function() {
            const sh = shareholders.find(s => s.id === parseInt(this.dataset.id));
            if (confirm(`确定删除股东【${sh.name}】吗？`)) {
                const idx = shareholders.findIndex(s => s.id === parseInt(this.dataset.id));
                shareholders.splice(idx, 1);
                renderShareholderTable();
            }
        });
    });
}

// ============================================================
// File Upload (New Plan Modal)
// ============================================================
function initFileUpload() {
    const dropzone = document.getElementById("uploadDropzone");
    const fileInput = document.getElementById("fileInput");
    const browseLink = document.getElementById("dropzoneContent");

    if (!dropzone || !fileInput) return;

    // Click to browse
    browseLink.addEventListener("click", function() {
        fileInput.click();
    });

    // File input change
    fileInput.addEventListener("change", function() {
        if (this.files.length > 0) {
            addFiles(this.files);
            this.value = "";
        }
    });

    // Drag & drop
    dropzone.addEventListener("dragover", function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.add("drag-over");
    });

    dropzone.addEventListener("dragleave", function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove("drag-over");
    });

    dropzone.addEventListener("drop", function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove("drag-over");
        if (e.dataTransfer.files.length > 0) {
            addFiles(e.dataTransfer.files);
        }
    });
}

function addFiles(fileList) {
    for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        // Avoid duplicates by name + size
        const exists = uploadedFiles.some(f => f.name === file.name && f.size === file.size);
        if (!exists) {
            uploadedFiles.push({
                id: Date.now() + i,
                name: file.name,
                size: file.size,
                type: file.type
            });
        }
    }
    renderUploadFileList();
}

function removeFile(fileId) {
    uploadedFiles = uploadedFiles.filter(f => f.id !== fileId);
    renderUploadFileList();
}

function renderUploadFileList() {
    const container = document.getElementById("uploadFileList");
    if (!container) return;

    if (uploadedFiles.length === 0) {
        container.innerHTML = "";
        return;
    }

    container.innerHTML = uploadedFiles.map(file => {
        const ext = file.name.split(".").pop().toLowerCase();
        const iconClass = ["xlsx", "xls", "csv", "pdf", "doc", "docx"].includes(ext) ? ext : "default";
        return `
            <div class="upload-file-item">
                <div class="upload-file-icon ${iconClass}">${ext.substring(0, 4)}</div>
                <div class="upload-file-info">
                    <div class="upload-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
                    <div class="upload-file-size">${formatFileSize(file.size)}</div>
                </div>
                <button class="upload-file-remove" data-remove="${file.id}" title="Remove">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
        `;
    }).join("");

    // Bind remove buttons
    container.querySelectorAll("[data-remove]").forEach(btn => {
        btn.addEventListener("click", function() {
            removeFile(parseInt(this.dataset.remove));
        });
    });
}

function formatFileSize(bytes) {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0);
    return size + " " + units[i];
}

// ============================================================
// 工具方法
// ============================================================
function exportData(month) {
    const data = getMonthData(month);
    let csv = "\ufeff";
    csv += `CapTable 股权数据 - ${formatMonthCN(month)}\n\n`;
    csv += "【流通股份对账】\n项目,截至日期,上月末,本月新增,本月末\n";
    csv += `${data.reconciliation.item},${data.eomDate},${data.reconciliation.lastMonth},${data.reconciliation.newShares},${data.reconciliation.eomBalance}\n\n`;
    csv += "【资本结构】\nDescription,股份,占比\n";
    data.capitalization.forEach(item => {
        csv += `"${item.description}",${item.shares},${item.percent}%\n`;
    });
    csv += `完全稀释总股份,${data.totalFullyDiluted},100%\n\n`;

    if (data.notes && data.notes.length > 0) {
        csv += "【备注】\n时间,内容\n";
        data.notes.forEach(note => {
            csv += `${note.time},"${note.content.replace(/\n/g, " ")}\n"`;
        });
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `CapTable_${month}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function formatDateTime(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const h = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${d} ${h}:${min}`;
}

function formatDateTimeSimple(date) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    return `${y}/${m}/${d}`;
}

/**
 * 打开蓝色超链接对应的弹窗（带表格）
 */
function openLinkModal(linkType) {
    const data = linkModalData[linkType];
    if (!data) return;

    // 设置标题
    document.getElementById("linkModalTitle").textContent = data.title;

    // 构建表格HTML
    let html = '<div class="link-modal-table-wrapper">';
    html += '<table class="link-modal-table">';

    // 表头
    html += '<thead><tr>';
    data.columns.forEach(col => {
        html += `<th>${escapeHtml(col.label)}</th>`;
    });
    html += '</tr></thead>';

    // 表体
    html += '<tbody>';
    data.rows.forEach(row => {
        html += '<tr>';
        data.columns.forEach(col => {
            const val = row[col.key];
            let cellContent;
            if (val === null || val === undefined) {
                cellContent = '<span style="color:#94a3b8;">-</span>';
            } else if (typeof val === 'number') {
                cellContent = formatNumber(val);
            } else {
                cellContent = escapeHtml(String(val));
            }
            // Plan Name 列左对齐加蓝色超链接样式
            if (col.key === 'planName') {
                html += `<td style="text-align:left;"><span class="link-modal-plan-name">${cellContent}</span></td>`;
            } else {
                html += `<td>${cellContent}</td>`;
            }
        });
        html += '</tr>';
    });

    // 汇总行（如果有）
    if (data.summary) {
        html += '<tr class="link-modal-summary-row">';
        data.columns.forEach(col => {
            const val = data.summary[col.key];
            if (val === null || val === undefined) {
                html += '<td></td>';
            } else if (typeof val === 'number') {
                html += `<td>${formatNumber(val)}</td>`;
            } else {
                html += `<td style="text-align:left; font-weight:700;">${escapeHtml(String(val))}</td>`;
            }
        });
        html += '</tr>';
    }

    html += '</tbody></table></div>';

    // 富途行权报表额外显示汇总信息
    if (linkType === 'futu-exercise' && data.summary) {
        html += '<div class="link-modal-summary-box">';
        html += '<div class="link-modal-summary-title">Summary</div>';
        html += '<div class="link-modal-summary-grid">';
        html += `<div class="link-modal-summary-item"><span class="link-modal-summary-label">Ordered Qty:</span><span class="link-modal-summary-value">${formatNumber(data.summary.orderedQty)}</span></div>`;
        html += `<div class="link-modal-summary-item"><span class="link-modal-summary-label">Exercised Qty:</span><span class="link-modal-summary-value">${formatNumber(data.summary.exercisedQty)}</span></div>`;
        html += `<div class="link-modal-summary-item"><span class="link-modal-summary-label">Exercise Cost(USD):</span><span class="link-modal-summary-value">${formatNumber(data.summary.exerciseCost)}</span></div>`;
        html += `<div class="link-modal-summary-item"><span class="link-modal-summary-label">Deduction/Selling Qty:</span><span class="link-modal-summary-value">${formatNumber(data.summary.deductionQty)}</span></div>`;
        html += `<div class="link-modal-summary-item"><span class="link-modal-summary-label">Dealt Qty:</span><span class="link-modal-summary-value">${formatNumber(data.summary.dealtQty)}</span></div>`;
        html += '</div></div>';
    }

    document.getElementById("linkModalContent").innerHTML = html;
    document.getElementById("linkDetailModal").classList.remove("hidden");
}

/**
 * 关闭链接详情弹窗
 */
function closeLinkModal() {
    document.getElementById("linkDetailModal").classList.add("hidden");
}

// 绑定链接详情弹窗关闭按钮
document.addEventListener("DOMContentLoaded", function() {
    const btnCloseLink = document.getElementById("btnCloseLinkModal");
    const btnCloseLinkFooter = document.getElementById("btnCloseLinkModalFooter");
    if (btnCloseLink) btnCloseLink.addEventListener("click", closeLinkModal);
    if (btnCloseLinkFooter) btnCloseLinkFooter.addEventListener("click", closeLinkModal);

    // 点击遮罩关闭
    const linkModalOverlay = document.getElementById("linkDetailModal");
    if (linkModalOverlay) {
        linkModalOverlay.addEventListener("click", function(e) {
            if (e.target === this) closeLinkModal();
        });
    }
});
