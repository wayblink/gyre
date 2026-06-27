/**
 * CapTable 股权管理系统 - 数据模块
 * 包含按月组织的股权数据、备注数据、更新计划、基础设置数据等
 */

// ============ 0. 基础设置 - 员工映射表 ============
const employeeMappings = [
    { id: 1, name: "张三", empId: "EMP001", futuId: "FTU1001", shareworksId: "SW2001" },
    { id: 2, name: "李四", empId: "EMP002", futuId: "FTU1002", shareworksId: "SW2002" },
    { id: 3, name: "王五", empId: "EMP003", futuId: "FTU1003", shareworksId: "SW2003" },
    { id: 4, name: "赵六", empId: "EMP004", futuId: "", shareworksId: "SW2004" },
    { id: 5, name: "陈七", empId: "EMP005", futuId: "FTU1005", shareworksId: "" },
    { id: 6, name: "刘八", empId: "EMP006", futuId: "", shareworksId: "" }
];

// ============ 0. 基础设置 - 计划管理表 ============
const planManagements = [
    { id: 1, name: "G类期权计划", createTime: "2024-06-01", status: "生效中" },
    { id: 2, name: "C类期权计划", createTime: "2025-09-01", status: "生效中" },
    { id: 3, name: "员工持股计划 ESOP", createTime: "2023-01-15", status: "生效中" },
    { id: 4, name: "管理层激励计划", createTime: "2024-03-10", status: "已终止" },
    { id: 5, name: "顾问期权计划", createTime: "2026-02-10", status: "生效中" }
];

// ============ 0. 基础设置 - 股东管理 ============
const shareholders = [
    { id: 1, name: "A先生", identity: "护照 P12345678", track: true },
    { id: 2, name: "B女士", identity: "身份证 31010119900101****", track: true },
    { id: 3, name: "BCI Investment Fund", identity: "注册号 CI-987654", track: true },
    { id: 4, name: "Futu Securities", identity: "牌照号 FUTU-001", track: false },
    { id: 5, name: "Series A 优先股持有人", identity: "信托编号 TR-2023-001", track: true },
    { id: 6, name: "C先生", identity: "护照 P87654321", track: false }
];

// ============ 1. 月度更新计划列表（全局，按月份管理） ============
const updatePlans = [
    {
        id: 1,
        month: "2026-05",
        monthLabel: "5月",
        operationTime: "2026/5/10",
        operator: "Gu",
        status: "进行中",
        remark: "5月数据更新中，涉及Cullgen新股发行和期权行权"
    },
    {
        id: 2,
        month: "2026-04",
        monthLabel: "4月",
        operationTime: "2026/4/10",
        operator: "Gu",
        status: "已完成",
        remark: "4月数据已完成更新并归档"
    },
    {
        id: 3,
        month: "2026-03",
        monthLabel: "3月",
        operationTime: "2026/3/15",
        operator: "Gu",
        status: "已完成",
        remark: "3月Q1季度末数据更新"
    },
    {
        id: 4,
        month: "2026-06",
        monthLabel: "6月",
        operationTime: "2026/6/10",
        operator: "Gu",
        status: "待启动",
        remark: "预计6月10日启动月度数据更新"
    },
    {
        id: 5,
        month: "2026-02",
        monthLabel: "2月",
        operationTime: "2026/2/12",
        operator: "Chen",
        status: "已完成",
        remark: "春节后首个月度更新"
    }
];

// ============ 2. 文件检查清单（按计划ID映射） ============
// 包含3个数据源表格：Fixed Values、Shareworks、Futu
const fileCheckLists = {
    default: {
        fixedValues: [
            { item: "Cullgen common stock", value: 14450527, action: "edit" },
            { item: "Gyre 2023 China SubPlan Total", value: 7815396, action: "edit" },
            { item: "Warrants for Convertible Preferred Stock", value: 540666, action: "edit" },
            { item: "Options Outstanding- Cullgen", value: 4156815, action: "edit" },
            { item: "Options Available- Cullgen", value: 10994, action: "edit" }
        ],
        shareworksData: [
            { fileName: "EQ Control Book", isRequired: "Required", uploadedFile: "Control_Books_Detail_Data_02.06.2026_16.42.xlsx", item: "EOM", status: "pass", value: 111488849, action: "-" },
            { fileName: "", isRequired: "", uploadedFile: "", item: "2025 BC Subplan shares transferred to Futu", status: "warning", value: 4876873, action: "edit" },
            { fileName: "Option Plans Summary", isRequired: "Required", uploadedFile: "G_Option_Plans_Summary_SL.xlsx", item: "\u03A3 all option plan outstanding shares", status: "pass", value: 14386054, action: "-" },
            { fileName: "", isRequired: "", uploadedFile: "", item: "\u03A3 all option plan available shares", status: "pass", value: 3639230, action: "-" },
            { fileName: "Option Plans detail", isRequired: "Optional", uploadedFile: "Not uploaded", item: "", status: "", value: null, action: "-" }
        ],
        futuData: [
            { fileName: "Futu BCI Exercises to Date", isRequired: "Required", uploadedFile: "Futu_BCI_Exercises_to_Date.xlsx", metric: "Exercises to Date", status: "pass", value: 2938523, action: "-" },
            { fileName: "Option plans summary(include cancel)", isRequired: "Required", uploadedFile: "Option_plans_summary.xlsx", metric: "GYRE 2025 BC Subplan canceled", status: "pass", value: -28170, action: "-" },
            { fileName: "Option Plans detail", isRequired: "Optional", uploadedFile: "Not uploaded", metric: "", status: "", value: null, action: "-" }
        ]
    }
};

// 为每个计划ID生成文件检查清单
function getFileCheckList(planId) {
    const template = fileCheckLists.default;
    const list = JSON.parse(JSON.stringify(template));

    // 已完成的计划（4月、3月、2月）：所有状态标记为 pass
    if (planId === 2 || planId === 3 || planId === 5) {
        list.shareworksData.forEach(item => {
            if (item.status === "warning") item.status = "pass";
            if (item.uploadedFile === "Not uploaded") item.uploadedFile = "N/A";
        });
        list.futuData.forEach(item => {
            if (item.uploadedFile === "Not uploaded") item.uploadedFile = "N/A";
        });
    }
    // 待启动的计划（6月）：保持默认状态
    // 进行中的计划（id=1，5月）：使用模板状态
    return list;
}

// ============ 3. 原股权数据（保留并增强） ============
const capTableData = {
    "2026-05": {
        eomDate: "2026/5/31",
        reconciliation: {
            item: "Equity Outstanding as of",
            lastMonth: 97028322,
            newShares: 14460527,
            eomBalance: 111488849
        },
        capitalization: [
            // Issued Shares -Equity Asset Class
            { type: "cat-header-blue", description: "Issued Shares -Equity Asset Class" },
            { type: "cat-sub-label", description: "Asset Class Summary: EOM", shares: 111488849, formula: 'value=1+2+3+4, sourced from <span class="link-blue" data-link="control-book">Control book</span>', highlightShares: true },
            { type: "data", number: "1", description: "Common Shares OS", shares: 91466285, percent: 0.685, formula: "value=EOM-2-3-4" },
            { type: "data", number: "2", description: "Cullgen common stock", shares: 14450527, percent: 0.1082, formula: "Fixed value" },
            { type: "data", number: "3", description: "BCI Shares Held by Futu", shares: 4876873, percent: 0.0365, formula: 'value=ΣGyre Gyre granted options(1) - utu exercises to date(2)<br><span class="formula-indent">(1) Fixed value</span><br><span class="formula-indent">(2) is aggregated from Futu exercise reports(<span class="link-blue" data-link="futu-exercise">Futu BCI Exercises to Date</span>)</span>' },
            { type: "data", number: "4", description: "2025 BC Subplan shares transferred to Futu", shares: 695164, percent: 0.0052, formula: "value =aggregated from <span class=\"link-blue\" data-link=\"control-detail-1\">Control Book</span> monthly report, with note 'Omnibus Inc. Pl'" },
            // Derivative Equity Incentives
            { type: "cat-header-blue", description: "Derivative Equity Incentives" },
            { type: "data", number: "5", description: "Warrants for Convertible Preferred Stock", shares: 540666, percent: 0.004, formula: "Fixed value" },
            { type: "data", number: "6", description: "Options Outstanding- Gyre", shares: 13690894, percent: 0.1025, formula: 'value=Σ <span class="link-blue" data-link="option-outstanding">all option plan outstanding shares</span>(1) - 2025 BC Subplan shares transferred to Futu(2)<br><span class="formula-indent">(1) Fixed value</span><br><span class="formula-indent">(2) is Item 4</span>' },
            { type: "data", number: "7", description: "Options Available- Gyre", shares: 3639230, percent: 0.0273, formula: 'value=Σ <span class="link-blue" data-link="option-available">all option plan available shares</span>' },
            { type: "data", number: "8", description: "Options Outstanding- Cullgen", shares: 4156815, percent: 0.0311, formula: "Fixed value" },
            { type: "data", number: "9", description: "Options Available- Cullgen", shares: 10994, percent: 0.0001, formula: "Fixed value" }
        ],
        totalFullyDiluted: 133527448,
        notes: [
            { id: 1, time: "2026-05-31 10:30", content: "本月新增股份主要来自：1) Cullgen 普通股发行 14,450,527股；2) BCI Futu 股份转移；3) 期权行权。所有变动已完成记账。" },
            { id: 2, time: "2026-05-31 11:45", content: "EOM 月末总流通股份：111,488,849股。完全稀释总股份：133,527,448股（含已发行期权、认股权证等）。" }
        ],
        holdings: [
            {
                id: 1, costCenter: "G&A", participantType: "Non-Employee Advisor/Consultant",
                employeeNumber: 10001, lastName: "Card", firstName: "GD", middleName: "",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2023 NQ BOD Grants $6.93",
                grantType: "Options (NQ)", employeeGrantNumber: 3007, grantDate: "01-Jan-2024",
                vestingStartDate: "31-Oct-2023", serviceStartDate: "31-Oct-2023", originalVCD: "",
                expireDate: "31-Oct-2033", expireDateParticipant: "31-Oct-2033",
                earliestExpireCancel: "31-Oct-2033", latestExpireCancel: "31-Oct-2033",
                sharesGranted: 1866, exercisePrice: 6.93, vestingSchedule: "3yr Annually",
                earlyExercise: "No", sharesVested: 1244, sharesUnvested: 622,
                sharesExercised: 0, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 1866, outstandingUnvested: 622, outstandingVested: 1244
            },
            {
                id: 2, costCenter: "R&D", participantType: "Employee",
                employeeNumber: 10002, lastName: "Wang", firstName: "Alice", middleName: "",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2023 Employee Option Grant $8.50",
                grantType: "Options (NQ)", employeeGrantNumber: 3008, grantDate: "15-Mar-2024",
                vestingStartDate: "01-Jan-2024", serviceStartDate: "01-Jan-2024", originalVCD: "",
                expireDate: "15-Mar-2034", expireDateParticipant: "15-Mar-2034",
                earliestExpireCancel: "15-Mar-2034", latestExpireCancel: "15-Mar-2034",
                sharesGranted: 5000, exercisePrice: 8.50, vestingSchedule: "4yr Monthly",
                earlyExercise: "No", sharesVested: 1250, sharesUnvested: 3750,
                sharesExercised: 0, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 5000, outstandingUnvested: 3750, outstandingVested: 1250
            },
            {
                id: 3, costCenter: "Sales", participantType: "Employee",
                employeeNumber: 10003, lastName: "Li", firstName: "Bob", middleName: "J",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2023 Sales Incentive $7.20",
                grantType: "Options (ISO)", employeeGrantNumber: 3009, grantDate: "01-Jun-2024",
                vestingStartDate: "01-Jun-2024", serviceStartDate: "01-Jun-2024", originalVCD: "",
                expireDate: "01-Jun-2034", expireDateParticipant: "01-Jun-2034",
                earliestExpireCancel: "01-Jun-2034", latestExpireCancel: "01-Jun-2034",
                sharesGranted: 3200, exercisePrice: 7.20, vestingSchedule: "4yr Quarterly",
                earlyExercise: "Yes", sharesVested: 800, sharesUnvested: 2400,
                sharesExercised: 200, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 3000, outstandingUnvested: 2400, outstandingVested: 600
            },
            {
                id: 4, costCenter: "G&A", participantType: "Non-Employee Director",
                employeeNumber: 10004, lastName: "Zhang", firstName: "Carol", middleName: "",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2023 Director RSU Grant",
                grantType: "RSU", employeeGrantNumber: 3010, grantDate: "01-Sep-2024",
                vestingStartDate: "01-Sep-2024", serviceStartDate: "01-Sep-2024", originalVCD: "",
                expireDate: "01-Sep-2027", expireDateParticipant: "01-Sep-2027",
                earliestExpireCancel: "01-Sep-2027", latestExpireCancel: "01-Sep-2027",
                sharesGranted: 2500, exercisePrice: 0.00, vestingSchedule: "3yr Annually",
                earlyExercise: "N/A", sharesVested: 833, sharesUnvested: 1667,
                sharesExercised: 0, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 2500, outstandingUnvested: 1667, outstandingVested: 833
            },
            {
                id: 5, costCenter: "R&D", participantType: "Employee",
                employeeNumber: 10005, lastName: "Chen", firstName: "David", middleName: "",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2024 New Hire Grant $9.10",
                grantType: "Options (NQ)", employeeGrantNumber: 3011, grantDate: "15-Jan-2025",
                vestingStartDate: "15-Jan-2025", serviceStartDate: "15-Jan-2025", originalVCD: "",
                expireDate: "15-Jan-2035", expireDateParticipant: "15-Jan-2035",
                earliestExpireCancel: "15-Jan-2035", latestExpireCancel: "15-Jan-2035",
                sharesGranted: 8000, exercisePrice: 9.10, vestingSchedule: "4yr Monthly",
                earlyExercise: "No", sharesVested: 1667, sharesUnvested: 6333,
                sharesExercised: 0, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 8000, outstandingUnvested: 6333, outstandingVested: 1667
            },
            {
                id: 6, costCenter: "Marketing", participantType: "Employee",
                employeeNumber: 10006, lastName: "Liu", firstName: "Emma", middleName: "",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2024 Marketing Team Grant $8.80",
                grantType: "Options (NQ)", employeeGrantNumber: 3012, grantDate: "01-Apr-2025",
                vestingStartDate: "01-Apr-2025", serviceStartDate: "01-Apr-2025", originalVCD: "",
                expireDate: "01-Apr-2035", expireDateParticipant: "01-Apr-2035",
                earliestExpireCancel: "01-Apr-2035", latestExpireCancel: "01-Apr-2035",
                sharesGranted: 4200, exercisePrice: 8.80, vestingSchedule: "4yr Quarterly",
                earlyExercise: "No", sharesVested: 525, sharesUnvested: 3675,
                sharesExercised: 0, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 4200, outstandingUnvested: 3675, outstandingVested: 525
            },
            {
                id: 7, costCenter: "G&A", participantType: "Non-Employee Advisor/Consultant",
                employeeNumber: 10007, lastName: "Wu", firstName: "Frank", middleName: "",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2024 Consultant Grant $10.00",
                grantType: "Options (NQ)", employeeGrantNumber: 3013, grantDate: "01-Jul-2025",
                vestingStartDate: "01-Jul-2025", serviceStartDate: "01-Jul-2025", originalVCD: "",
                expireDate: "01-Jul-2035", expireDateParticipant: "01-Jul-2035",
                earliestExpireCancel: "01-Jul-2035", latestExpireCancel: "01-Jul-2035",
                sharesGranted: 1500, exercisePrice: 10.00, vestingSchedule: "2yr Annually",
                earlyExercise: "No", sharesVested: 375, sharesUnvested: 1125,
                sharesExercised: 0, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 1500, outstandingUnvested: 1125, outstandingVested: 375
            },
            {
                id: 8, costCenter: "R&D", participantType: "Employee",
                employeeNumber: 10008, lastName: "Zhao", firstName: "Grace", middleName: "M",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2025 Performance Grant $11.50",
                grantType: "RSU", employeeGrantNumber: 3014, grantDate: "01-Jan-2026",
                vestingStartDate: "01-Jan-2026", serviceStartDate: "01-Jan-2026", originalVCD: "",
                expireDate: "01-Jan-2029", expireDateParticipant: "01-Jan-2029",
                earliestExpireCancel: "01-Jan-2029", latestExpireCancel: "01-Jan-2029",
                sharesGranted: 6000, exercisePrice: 0.00, vestingSchedule: "3yr Annually",
                earlyExercise: "N/A", sharesVested: 0, sharesUnvested: 6000,
                sharesExercised: 0, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 6000, outstandingUnvested: 6000, outstandingVested: 0
            },
            {
                id: 9, costCenter: "Sales", participantType: "Employee",
                employeeNumber: 10009, lastName: "Sun", firstName: "Henry", middleName: "",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2025 Sales Bonus $12.00",
                grantType: "Options (NQ)", employeeGrantNumber: 3015, grantDate: "15-Mar-2026",
                vestingStartDate: "15-Mar-2026", serviceStartDate: "15-Mar-2026", originalVCD: "",
                expireDate: "15-Mar-2036", expireDateParticipant: "15-Mar-2036",
                earliestExpireCancel: "15-Mar-2036", latestExpireCancel: "15-Mar-2036",
                sharesGranted: 3500, exercisePrice: 12.00, vestingSchedule: "4yr Monthly",
                earlyExercise: "No", sharesVested: 0, sharesUnvested: 3500,
                sharesExercised: 0, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 3500, outstandingUnvested: 3500, outstandingVested: 0
            },
            {
                id: 10, costCenter: "G&A", participantType: "Non-Employee Director",
                employeeNumber: 10010, lastName: "Zhou", firstName: "Iris", middleName: "",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2026 Director Option $13.00",
                grantType: "Options (NQ)", employeeGrantNumber: 3016, grantDate: "01-May-2026",
                vestingStartDate: "01-May-2026", serviceStartDate: "01-May-2026", originalVCD: "",
                expireDate: "01-May-2036", expireDateParticipant: "01-May-2036",
                earliestExpireCancel: "01-May-2036", latestExpireCancel: "01-May-2036",
                sharesGranted: 2000, exercisePrice: 13.00, vestingSchedule: "3yr Annually",
                earlyExercise: "No", sharesVested: 0, sharesUnvested: 2000,
                sharesExercised: 0, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 2000, outstandingUnvested: 2000, outstandingVested: 0
            }
        ]
    },
    "2026-04": {
        eomDate: "2026/4/30",
        reconciliation: {
            item: "Equity Outstanding as of",
            lastMonth: 95000000,
            newShares: 2028322,
            eomBalance: 97028322
        },
        capitalization: [
            { description: "Common Shares OS", shares: 91466285, percent: 72.40 },
            { description: "Cullgen common stock", shares: 0, percent: 0 },
            { description: "BCI Shares Held by Futu", shares: 4876873, percent: 3.86 },
            { description: "Warrants for Convertible Preferred Stock", shares: 540666, percent: 0.43 },
            { description: "Options Outstanding - G", shares: 13500000, percent: 10.69 },
            { description: "Options Available - G", shares: 3500000, percent: 2.77 },
            { description: "Options Outstanding - C", shares: 4000000, percent: 3.17 },
            { description: "Options Available - C", shares: 10000, percent: 0.01 }
        ],
        totalFullyDiluted: 126406824,
        notes: [{ id: 1, time: "2026-04-30 17:00", content: "本月新增股份2,028,322股，主要来自G类期权行权。" }],
        holdings: [
            {
                id: 1, costCenter: "G&A", participantType: "Non-Employee Advisor/Consultant",
                employeeNumber: 10001, lastName: "Card", firstName: "GD", middleName: "",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2023 NQ BOD Grants $6.93",
                grantType: "Options (NQ)", employeeGrantNumber: 3007, grantDate: "01-Jan-2024",
                vestingStartDate: "31-Oct-2023", serviceStartDate: "31-Oct-2023", originalVCD: "",
                expireDate: "31-Oct-2033", expireDateParticipant: "31-Oct-2033",
                earliestExpireCancel: "31-Oct-2033", latestExpireCancel: "31-Oct-2033",
                sharesGranted: 1866, exercisePrice: 6.93, vestingSchedule: "3yr Annually",
                earlyExercise: "No", sharesVested: 1244, sharesUnvested: 622,
                sharesExercised: 0, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 1866, outstandingUnvested: 622, outstandingVested: 1244
            },
            {
                id: 2, costCenter: "R&D", participantType: "Employee",
                employeeNumber: 10002, lastName: "Wang", firstName: "Alice", middleName: "",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2023 Employee Option Grant $8.50",
                grantType: "Options (NQ)", employeeGrantNumber: 3008, grantDate: "15-Mar-2024",
                vestingStartDate: "01-Jan-2024", serviceStartDate: "01-Jan-2024", originalVCD: "",
                expireDate: "15-Mar-2034", expireDateParticipant: "15-Mar-2034",
                earliestExpireCancel: "15-Mar-2034", latestExpireCancel: "15-Mar-2034",
                sharesGranted: 5000, exercisePrice: 8.50, vestingSchedule: "4yr Monthly",
                earlyExercise: "No", sharesVested: 1042, sharesUnvested: 3958,
                sharesExercised: 0, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 5000, outstandingUnvested: 3958, outstandingVested: 1042
            },
            {
                id: 3, costCenter: "Sales", participantType: "Employee",
                employeeNumber: 10003, lastName: "Li", firstName: "Bob", middleName: "J",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2023 Sales Incentive $7.20",
                grantType: "Options (ISO)", employeeGrantNumber: 3009, grantDate: "01-Jun-2024",
                vestingStartDate: "01-Jun-2024", serviceStartDate: "01-Jun-2024", originalVCD: "",
                expireDate: "01-Jun-2034", expireDateParticipant: "01-Jun-2034",
                earliestExpireCancel: "01-Jun-2034", latestExpireCancel: "01-Jun-2034",
                sharesGranted: 3200, exercisePrice: 7.20, vestingSchedule: "4yr Quarterly",
                earlyExercise: "Yes", sharesVested: 600, sharesUnvested: 2400,
                sharesExercised: 200, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 3000, outstandingUnvested: 2400, outstandingVested: 600
            },
            {
                id: 4, costCenter: "G&A", participantType: "Non-Employee Director",
                employeeNumber: 10004, lastName: "Zhang", firstName: "Carol", middleName: "",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2023 Director RSU Grant",
                grantType: "RSU", employeeGrantNumber: 3010, grantDate: "01-Sep-2024",
                vestingStartDate: "01-Sep-2024", serviceStartDate: "01-Sep-2024", originalVCD: "",
                expireDate: "01-Sep-2027", expireDateParticipant: "01-Sep-2027",
                earliestExpireCancel: "01-Sep-2027", latestExpireCancel: "01-Sep-2027",
                sharesGranted: 2500, exercisePrice: 0.00, vestingSchedule: "3yr Annually",
                earlyExercise: "N/A", sharesVested: 625, sharesUnvested: 1875,
                sharesExercised: 0, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 2500, outstandingUnvested: 1875, outstandingVested: 625
            },
            {
                id: 5, costCenter: "R&D", participantType: "Employee",
                employeeNumber: 10005, lastName: "Chen", firstName: "David", middleName: "",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2024 New Hire Grant $9.10",
                grantType: "Options (NQ)", employeeGrantNumber: 3011, grantDate: "15-Jan-2025",
                vestingStartDate: "15-Jan-2025", serviceStartDate: "15-Jan-2025", originalVCD: "",
                expireDate: "15-Jan-2035", expireDateParticipant: "15-Jan-2035",
                earliestExpireCancel: "15-Jan-2035", latestExpireCancel: "15-Jan-2035",
                sharesGranted: 8000, exercisePrice: 9.10, vestingSchedule: "4yr Monthly",
                earlyExercise: "No", sharesVested: 1250, sharesUnvested: 6750,
                sharesExercised: 0, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 8000, outstandingUnvested: 6750, outstandingVested: 1250
            },
            {
                id: 6, costCenter: "Marketing", participantType: "Employee",
                employeeNumber: 10006, lastName: "Liu", firstName: "Emma", middleName: "",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2024 Marketing Team Grant $8.80",
                grantType: "Options (NQ)", employeeGrantNumber: 3012, grantDate: "01-Apr-2025",
                vestingStartDate: "01-Apr-2025", serviceStartDate: "01-Apr-2025", originalVCD: "",
                expireDate: "01-Apr-2035", expireDateParticipant: "01-Apr-2035",
                earliestExpireCancel: "01-Apr-2035", latestExpireCancel: "01-Apr-2035",
                sharesGranted: 4200, exercisePrice: 8.80, vestingSchedule: "4yr Quarterly",
                earlyExercise: "No", sharesVested: 263, sharesUnvested: 3937,
                sharesExercised: 0, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 4200, outstandingUnvested: 3937, outstandingVested: 263
            }
        ]
    },
    "2026-03": {
        eomDate: "2026/3/31",
        reconciliation: { item: "Equity Outstanding as of", lastMonth: 93500000, newShares: 1500000, eomBalance: 95000000 },
        capitalization: [
            { description: "Common Shares OS", shares: 90000000, percent: 75.50 },
            { description: "BCI Shares Held by Futu", shares: 4876873, percent: 4.09 },
            { description: "Warrants for Convertible Preferred Stock", shares: 540666, percent: 0.45 },
            { description: "Options Outstanding - G", shares: 12000000, percent: 10.06 },
            { description: "Options Outstanding - C", shares: 3500000, percent: 2.94 }
        ],
        totalFullyDiluted: 119170539,
        notes: [{ id: 1, time: "2026-03-31 16:30", content: "Q1 季度末股权整理完成。本月新增股份1,500,000股。" }],
        holdings: [
            {
                id: 1, costCenter: "G&A", participantType: "Non-Employee Advisor/Consultant",
                employeeNumber: 10001, lastName: "Card", firstName: "GD", middleName: "",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2023 NQ BOD Grants $6.93",
                grantType: "Options (NQ)", employeeGrantNumber: 3007, grantDate: "01-Jan-2024",
                vestingStartDate: "31-Oct-2023", serviceStartDate: "31-Oct-2023", originalVCD: "",
                expireDate: "31-Oct-2033", expireDateParticipant: "31-Oct-2033",
                earliestExpireCancel: "31-Oct-2033", latestExpireCancel: "31-Oct-2033",
                sharesGranted: 1866, exercisePrice: 6.93, vestingSchedule: "3yr Annually",
                earlyExercise: "No", sharesVested: 1037, sharesUnvested: 829,
                sharesExercised: 0, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 1866, outstandingUnvested: 829, outstandingVested: 1037
            },
            {
                id: 2, costCenter: "R&D", participantType: "Employee",
                employeeNumber: 10002, lastName: "Wang", firstName: "Alice", middleName: "",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2023 Employee Option Grant $8.50",
                grantType: "Options (NQ)", employeeGrantNumber: 3008, grantDate: "15-Mar-2024",
                vestingStartDate: "01-Jan-2024", serviceStartDate: "01-Jan-2024", originalVCD: "",
                expireDate: "15-Mar-2034", expireDateParticipant: "15-Mar-2034",
                earliestExpireCancel: "15-Mar-2034", latestExpireCancel: "15-Mar-2034",
                sharesGranted: 5000, exercisePrice: 8.50, vestingSchedule: "4yr Monthly",
                earlyExercise: "No", sharesVested: 833, sharesUnvested: 4167,
                sharesExercised: 0, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 5000, outstandingUnvested: 4167, outstandingVested: 833
            },
            {
                id: 3, costCenter: "Sales", participantType: "Employee",
                employeeNumber: 10003, lastName: "Li", firstName: "Bob", middleName: "J",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2023 Sales Incentive $7.20",
                grantType: "Options (ISO)", employeeGrantNumber: 3009, grantDate: "01-Jun-2024",
                vestingStartDate: "01-Jun-2024", serviceStartDate: "01-Jun-2024", originalVCD: "",
                expireDate: "01-Jun-2034", expireDateParticipant: "01-Jun-2034",
                earliestExpireCancel: "01-Jun-2034", latestExpireCancel: "01-Jun-2034",
                sharesGranted: 3200, exercisePrice: 7.20, vestingSchedule: "4yr Quarterly",
                earlyExercise: "Yes", sharesVested: 400, sharesUnvested: 2600,
                sharesExercised: 200, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 3000, outstandingUnvested: 2600, outstandingVested: 400
            },
            {
                id: 4, costCenter: "G&A", participantType: "Non-Employee Director",
                employeeNumber: 10004, lastName: "Zhang", firstName: "Carol", middleName: "",
                planName: "GCOPR 2023 Omnibus Incentive Plan", grantName: "2023 Director RSU Grant",
                grantType: "RSU", employeeGrantNumber: 3010, grantDate: "01-Sep-2024",
                vestingStartDate: "01-Sep-2024", serviceStartDate: "01-Sep-2024", originalVCD: "",
                expireDate: "01-Sep-2027", expireDateParticipant: "01-Sep-2027",
                earliestExpireCancel: "01-Sep-2027", latestExpireCancel: "01-Sep-2027",
                sharesGranted: 2500, exercisePrice: 0.00, vestingSchedule: "3yr Annually",
                earlyExercise: "N/A", sharesVested: 417, sharesUnvested: 2083,
                sharesExercised: 0, sharesRepurchase: 0, sharesCancelled: 0,
                sharesOutstanding: 2500, outstandingUnvested: 2083, outstandingVested: 417
            }
        ]
    }
};

/**
 * 获取指定月份的数据
 */
function getMonthData(monthKey) {
    if (capTableData[monthKey]) {
        return capTableData[monthKey];
    }
    return capTableData["2026-05"];
}

/**
 * 数字格式化：添加千分位
 */
function formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return "-";
    return Number(num).toLocaleString("en-US");
}

/**
 * 百分比格式化
 */
function formatPercent(num) {
    if (num === null || num === undefined || isNaN(num)) return "-";
    return Number(num).toFixed(2) + "%";
}

/**
 * 格式化月份显示（中文）
 */
function formatMonthCN(monthKey) {
    const [year, month] = monthKey.split("-");
    return `${year}年${parseInt(month)}月`;
}

/**
 * 获取月末日期字符串
 */
function getEOMDate(monthKey) {
    const [year, month] = monthKey.split("-");
    const y = parseInt(year);
    const m = parseInt(month);
    const lastDay = new Date(y, m, 0).getDate();
    return `${y}/${m}/${lastDay}`;
}

// ============ 4. 蓝色超链接弹窗数据 ============
const linkModalData = {
    "control-book": {
        title: "Control Book",
        columns: [
            { key: "securityId", label: "Security ID" },
            { key: "security", label: "Security" },
            { key: "asOfDate", label: "As of Date" },
            { key: "processDate", label: "Process Date" },
            { key: "transType", label: "Trans. Type" },
            { key: "transNo", label: "Trans. No." },
            { key: "brokerNo", label: "Broker No." },
            { key: "sharesIssued", label: "Shares Issued" },
            { key: "sharesRetired", label: "Shares Retired" },
            { key: "issuedOutstanding", label: "Issued & Outstanding" },
            { key: "comment", label: "Comment" },
            { key: "netShares", label: "Net Shares issued in Period" }
        ],
        rows: [
            { securityId: 27591, security: "GYRE", asOfDate: "03-Dec-2025", processDate: "10-Dec-2025", transType: "O.I.", transNo: null, brokerNo: null, sharesIssued: 568797, sharesRetired: null, issuedOutstanding: 96901954, comment: "Omnibus Inc. Pl.", netShares: 568797 },
            { securityId: 27591, security: "GYRE", asOfDate: "20-Jan-2026", processDate: "27-Jan-2026", transType: "BOOK ENTRY ISSUANCE", transNo: "0000010072", brokerNo: null, sharesIssued: 61657, sharesRetired: null, issuedOutstanding: 96963611, comment: "Omnibus Inc. Pl.", netShares: 61657 },
            { securityId: 27591, security: "GYRE", asOfDate: "17-Mar-2026", processDate: "19-Mar-2026", transType: "O.I.", transNo: null, brokerNo: null, sharesIssued: 30390, sharesRetired: null, issuedOutstanding: 96994001, comment: "Omnibus Inc. Pl", netShares: 30390 },
            { securityId: 27591, security: "GYRE", asOfDate: "24-Apr-2026", processDate: "29-Apr-2026", transType: "O.I.", transNo: null, brokerNo: null, sharesIssued: 34321, sharesRetired: null, issuedOutstanding: 97028322, comment: "Omnibus Inc. Pl", netShares: 34321 },
            { securityId: 27591, security: "GYRE", asOfDate: "04-May-2026", processDate: "15-May-2026", transType: "Agr. & Pl. of Merger", transNo: null, brokerNo: null, sharesIssued: 14450527, sharesRetired: null, issuedOutstanding: 111478849, comment: null, netShares: null },
            { securityId: 27591, security: "GYRE", asOfDate: "29-May-2026", processDate: "29-May-2026", transType: "CEDE-FAST", transNo: null, brokerNo: "0015", sharesIssued: 10000, sharesRetired: null, issuedOutstanding: 111488849, comment: "DIR # CA 84", netShares: 14460527 }
        ]
    },
    "futu-exercise": {
        title: "Futu BCI Exercises to Date",
        columns: [
            { key: "name", label: "Name" },
            { key: "employeeNo", label: "Employee No." },
            { key: "futubullId", label: "Futubull ID" },
            { key: "userId", label: "User ID" },
            { key: "grantNo", label: "Grant No." },
            { key: "grantDate", label: "Grant Date" },
            { key: "grantPrice", label: "Grant Price(USD)" },
            { key: "exerciseDate", label: "Exercise Date" },
            { key: "orderedQty", label: "Ordered Qty" },
            { key: "exercisedQty", label: "Exercised Qty" },
            { key: "exerciseCost", label: "Exercise Cost(USD)" },
            { key: "deductionQty", label: "Deduction/Selling Qty." },
            { key: "dealtQty", label: "Dealt Qty." }
        ],
        rows: [
            { name: "test employee", employeeNo: "K00381", futubullId: 26241911, userId: 12942000003, grantNo: "K00381", grantDate: "2023-10-31", grantPrice: 0.75, exerciseDate: "2024-08-26", orderedQty: 2968927, exercisedQty: 2938523, exerciseCost: 2210555, deductionQty: 738771, dealtQty: 738771 }
        ],
        summary: {
            orderedQty: 2968927,
            exercisedQty: 2938523,
            exerciseCost: 2210555,
            deductionQty: 738771,
            dealtQty: 738771
        }
    },
    "control-detail-1": {
        title: "Control book月度报表取数",
        columns: [
            { key: "securityId", label: "Security ID" },
            { key: "security", label: "Security" },
            { key: "asOfDate", label: "As of Date" },
            { key: "processDate", label: "Process Date" },
            { key: "transType", label: "Trans. Type" },
            { key: "transNo", label: "Trans. No." },
            { key: "brokerNo", label: "Broker No." },
            { key: "sharesIssued", label: "Shares Issued" },
            { key: "sharesRetired", label: "Shares Retired" },
            { key: "issuedOutstanding", label: "Issued & Outstanding" },
            { key: "comment", label: "Comment" },
            { key: "netShares", label: "Net Shares issued in Period" }
        ],
        rows: [
            { securityId: 27591, security: "GYRE", asOfDate: "03-Dec-2025", processDate: "10-Dec-2025", transType: "O.I.", transNo: null, brokerNo: null, sharesIssued: 568797, sharesRetired: null, issuedOutstanding: 96901954, comment: "Omnibus Inc. Pl.", netShares: 568797 },
            { securityId: 27591, security: "GYRE", asOfDate: "20-Jan-2026", processDate: "27-Jan-2026", transType: "BOOK ENTRY ISSUANCE", transNo: "0000010072", brokerNo: null, sharesIssued: 61657, sharesRetired: null, issuedOutstanding: 96963611, comment: "Omnibus Inc. Pl.", netShares: 61657 },
            { securityId: 27591, security: "GYRE", asOfDate: "17-Mar-2026", processDate: "19-Mar-2026", transType: "O.I.", transNo: null, brokerNo: null, sharesIssued: 30390, sharesRetired: null, issuedOutstanding: 96994001, comment: "Omnibus Inc. Pl", netShares: 30390 },
            { securityId: 27591, security: "GYRE", asOfDate: "24-Apr-2026", processDate: "29-Apr-2026", transType: "O.I.", transNo: null, brokerNo: null, sharesIssued: 34321, sharesRetired: null, issuedOutstanding: 97028322, comment: "Omnibus Inc. Pl", netShares: 34321 },
            { securityId: 27591, security: "GYRE", asOfDate: "04-May-2026", processDate: "15-May-2026", transType: "Agr. & Pl. of Merger", transNo: null, brokerNo: null, sharesIssued: 14450527, sharesRetired: null, issuedOutstanding: 111478849, comment: null, netShares: null },
            { securityId: 27591, security: "GYRE", asOfDate: "29-May-2026", processDate: "29-May-2026", transType: "CEDE-FAST", transNo: null, brokerNo: "0015", sharesIssued: 10000, sharesRetired: null, issuedOutstanding: 111488849, comment: "DIR # CA 84", netShares: 14460527 }
        ]
    },
    "option-outstanding": {
        title: "Option Plans Summary - Outstanding",
        columns: [
            { key: "planName", label: "Plan Name" },
            { key: "granted", label: "Granted" },
            { key: "exercised", label: "Exercised" },
            { key: "repurchased", label: "Repurchased" },
            { key: "cancelled", label: "Cancelled" },
            { key: "optionsOutstanding", label: "Options Outstanding" },
            { key: "optionsAvailable", label: "Options Available" }
        ],
        rows: [
            { planName: "GYRE 2025 BC Subplan", granted: 2100000, exercised: 0, repurchased: 0, cancelled: -28170, optionsOutstanding: 2071830, optionsAvailable: 0 },
            { planName: "GYRE 2023 China Subplan (Plan exhausted)", granted: 0, exercised: 0, repurchased: 0, cancelled: 0, optionsOutstanding: 0, optionsAvailable: 0 },
            { planName: "GYRE 2023 Omnibus Incentive Plan", granted: 3668418, exercised: -250049, repurchased: 0, cancelled: -435000, optionsOutstanding: 2983369, optionsAvailable: 3639230 },
            { planName: "GYRE 2023 Non-China BCI grants", granted: 9202609, exercised: -210417, repurchased: 0, cancelled: 0, optionsOutstanding: 8992192, optionsAvailable: 0 },
            { planName: "2018 Omnibus Incentive Plan", granted: 1554874, exercised: -55238, repurchased: 0, cancelled: -1313701, optionsOutstanding: 185935, optionsAvailable: 0 },
            { planName: "CBIO 2015 Stock Incentive Plan", granted: 359686, exercised: -13264, repurchased: 0, cancelled: -193690, optionsOutstanding: 152732, optionsAvailable: 0 }
        ],
        summary: {
            planName: "In total",
            granted: 16893587,
            exercised: -528968,
            repurchased: 0,
            cancelled: -1970560,
            optionsOutstanding: 14386058,
            optionsAvailable: 3639230
        }
    },
    "option-available": {
        title: "Option Plans Summary - Available",
        columns: [
            { key: "planName", label: "Plan Name" },
            { key: "granted", label: "Granted" },
            { key: "exercised", label: "Exercised" },
            { key: "repurchased", label: "Repurchased" },
            { key: "cancelled", label: "Cancelled" },
            { key: "optionsOutstanding", label: "Options Outstanding" },
            { key: "optionsAvailable", label: "Options Available" }
        ],
        rows: [
            { planName: "GYRE 2025 BC Subplan", granted: 2100000, exercised: 0, repurchased: 0, cancelled: -28170, optionsOutstanding: 2071830, optionsAvailable: 0 },
            { planName: "GYRE 2023 China Subplan (Plan exhausted)", granted: 0, exercised: 0, repurchased: 0, cancelled: 0, optionsOutstanding: 0, optionsAvailable: 0 },
            { planName: "GYRE 2023 Omnibus Incentive Plan", granted: 3668418, exercised: -250049, repurchased: 0, cancelled: -435000, optionsOutstanding: 2983369, optionsAvailable: 3639230 },
            { planName: "GYRE 2023 Non-China BCI grants", granted: 9202609, exercised: -210417, repurchased: 0, cancelled: 0, optionsOutstanding: 8992192, optionsAvailable: 0 },
            { planName: "2018 Omnibus Incentive Plan", granted: 1554874, exercised: -55238, repurchased: 0, cancelled: -1313701, optionsOutstanding: 185935, optionsAvailable: 0 },
            { planName: "CBIO 2015 Stock Incentive Plan", granted: 359686, exercised: -13264, repurchased: 0, cancelled: -193690, optionsOutstanding: 152732, optionsAvailable: 0 }
        ],
        summary: {
            planName: "In total",
            granted: 16893587,
            exercised: -528968,
            repurchased: 0,
            cancelled: -1970560,
            optionsOutstanding: 14386058,
            optionsAvailable: 3639230
        }
    }
};

/**
 * 获取当前月份（YYYY-MM）
 */
function getCurrentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
}
