#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_CDP = "http://127.0.0.1:59224";
const DEFAULT_ASSIGNMENT_JSON = "../chaoxing-grader/score_rankings_behinder_adjusted.json";
const DEFAULT_OUT_DIR = "out/final-grades";
const DEFAULT_ALIAS_JSON = "data/discussion-aliases.json";
const DEFAULT_EXCLUDED_JSON = "data/excluded-students.json";
const PASS_THRESHOLD = 60;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const EXAM_LINKS = [
  {
    className: "信安24实验班",
    url: "https://mooc2-ans.chaoxing.com/mooc2-ans/exam/test/marklist?clazzid=-1&courseid=241341550&ut=&cpi=342110777&id=128625301&paperId=543447356&reviewclassid=0&prePageNum=1&prePageSize=12&topicid=0&perspectiveType=0",
  },
  {
    className: "信安24-01",
    url: "https://mooc2-ans.chaoxing.com/mooc2-ans/exam/test/marklist?clazzid=-1&courseid=241341550&ut=&cpi=342110777&id=128625117&paperId=543447344&reviewclassid=0&prePageNum=1&prePageSize=12&topicid=0&perspectiveType=0",
  },
  {
    className: "信安2504",
    url: "https://mooc2-ans.chaoxing.com/mooc2-ans/exam/test/marklist?clazzid=-1&courseid=241341550&ut=&cpi=342110777&id=128624951&paperId=543447330&reviewclassid=0&prePageNum=1&prePageSize=12&topicid=0&perspectiveType=0",
  },
];

const DISCUSSION_URL =
  "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/tch?courseid=241341550&clazzid=142139151&cpi=342110777&enc=7cfc95c1e5cabbac38f50557f8386d71&t=1783341242823&pageHeader=5&v=2&hideHead=0&perspectiveType=";

const CLASS_NAME_ALIASES = new Map([
  ["2024信安实验班", "信安24实验班"],
  ["信安25-04", "信安2504"],
  ["信安24实验班", "信安24实验班"],
  ["信安24-01", "信安24-01"],
  ["信安2504", "信安2504"],
]);

function parseArgs(argv) {
  const args = {
    cdp: process.env.CDP_HTTP || DEFAULT_CDP,
    assignmentJson: DEFAULT_ASSIGNMENT_JSON,
    outDir: DEFAULT_OUT_DIR,
    aliasJson: DEFAULT_ALIAS_JSON,
    excludedJson: DEFAULT_EXCLUDED_JSON,
    term: "2025-2026,2",
    teacher: "z20220230804",
    minOrdinaryWeight: 0.2,
    maxOrdinaryWeight: 0.6,
    step: 0.01,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--cdp") args.cdp = next, i += 1;
    else if (arg === "--assignment-json") args.assignmentJson = next, i += 1;
    else if (arg === "--out-dir") args.outDir = next, i += 1;
    else if (arg === "--alias-json") args.aliasJson = next, i += 1;
    else if (arg === "--excluded-json") args.excludedJson = next, i += 1;
    else if (arg === "--term") args.term = next, i += 1;
    else if (arg === "--teacher") args.teacher = next, i += 1;
    else if (arg === "--min-ordinary-weight") args.minOrdinaryWeight = Number(next), i += 1;
    else if (arg === "--max-ordinary-weight") args.maxOrdinaryWeight = Number(next), i += 1;
    else if (arg === "--step") args.step = Number(next), i += 1;
    else if (arg === "--help") {
      console.log(`Usage:
  node scripts/final-grade-report.mjs [options]

Options:
  --cdp <url>                    CDP HTTP endpoint, default ${DEFAULT_CDP}
  --assignment-json <file>        assignment ranking JSON, default ${DEFAULT_ASSIGNMENT_JSON}
  --out-dir <dir>                 output directory, default ${DEFAULT_OUT_DIR}
  --alias-json <file>             local discussion alias map, default ${DEFAULT_ALIAS_JSON}
  --excluded-json <file>          local student exclusion list, default ${DEFAULT_EXCLUDED_JSON}
  --term <term>                   attendance term, default 2025-2026,2
  --teacher <teacher-code>        attendance teacher filter, default z20220230804
  --min-ordinary-weight <number>  constrained search lower bound, default 0.2
  --max-ordinary-weight <number>  constrained search upper bound, default 0.6
  --step <number>                 ratio search step, default 0.01
`);
      process.exit(0);
    }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)(message);
        this.pending.delete(message.id);
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId;
    this.nextId += 1;
    this.ws.send(JSON.stringify({ id, method, params }));
    const message = await new Promise((resolve) => this.pending.set(id, resolve));
    if (message.error) throw new Error(`${method}: ${JSON.stringify(message.error)}`);
    return message.result;
  }

  async eval(expression, timeoutMs = 30000) {
    const result = await this.send("Runtime.evaluate", {
      expression: timeoutExpression(expression, timeoutMs),
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value ?? result.result.description;
  }

  close() {
    this.ws.close();
  }
}

function timeoutExpression(expression, timeoutMs) {
  return `(async()=> {
    const work = (async()=>(${expression}))();
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("CDP eval timeout")), ${timeoutMs}));
    return await Promise.race([work, timeout]);
  })()`;
}

async function getTargets(cdpBase) {
  return await (await fetch(`${cdpBase}/json/list`)).json();
}

async function getBrowserClient(cdpBase) {
  const version = await (await fetch(`${cdpBase}/json/version`)).json();
  return new CdpClient(version.webSocketDebuggerUrl);
}

async function openPage(cdpBase, browser, url) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const targets = await getTargets(cdpBase);
  const target = targets.find((item) => item.id === targetId);
  if (!target) throw new Error(`Cannot find created target ${targetId}`);
  const page = new CdpClient(target.webSocketDebuggerUrl);
  await page.send("Page.enable");
  await page.send("Page.navigate", { url });

  for (let i = 0; i < 80; i += 1) {
    await sleep(250);
    const state = await page.eval("document.readyState + '|' + location.href", 5000).catch(() => "");
    if (String(state).startsWith("complete|")) return { targetId, page };
  }
  return { targetId, page };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadAssignmentRows(assignmentJson, excludedStudents = { names: new Set(), studentNos: new Set() }) {
  const source = readJson(assignmentJson);
  const classRows = new Map();
  const rosterByNo = new Map();
  const rosterByName = new Map();
  const excludedRows = [];

  for (const classSummary of source.classSummaries || []) {
    const rows = [];
    for (const row of classSummary.rows || []) {
      const studentNo = String(row.studentNo || "");
      const name = String(row.name || "");
      if (excludedStudents.studentNos.has(studentNo) || excludedStudents.names.has(name)) {
        excludedRows.push({ className: classSummary.className, studentNo, name });
        continue;
      }
      const assignmentAverage = (Number(row.finalTotal || 0) / Number(classSummary.assignmentCount || 1));
      const normalized = {
        className: classSummary.className,
        name,
        studentNo,
        assignmentAverage: round(assignmentAverage),
        assignmentFinalTotal: Number(row.finalTotal || 0),
        assignmentCount: Number(classSummary.assignmentCount || 0),
      };
      rows.push(normalized);
      rosterByNo.set(normalized.studentNo, normalized);
      if (!rosterByName.has(normalized.name)) rosterByName.set(normalized.name, []);
      rosterByName.get(normalized.name).push(normalized);
    }
    classRows.set(classSummary.className, rows);
  }

  return { generatedAt: source.generatedAt, classRows, rosterByNo, rosterByName, excludedRows };
}

function loadAliasMap(aliasJson) {
  const resolved = path.resolve(aliasJson);
  if (!fs.existsSync(resolved)) return new Map();
  const source = readJson(resolved);
  return new Map(
    Object.entries(source || {}).map(([alias, realName]) => [String(alias).trim().toLowerCase(), String(realName).trim()]),
  );
}

function loadExcludedStudents(excludedJson) {
  const resolved = path.resolve(excludedJson);
  if (!fs.existsSync(resolved)) return { names: new Set(), studentNos: new Set(), raw: [] };
  const source = readJson(resolved);
  const items = Array.isArray(source) ? source : source.excluded || [];
  const names = new Set();
  const studentNos = new Set();
  for (const item of items) {
    if (typeof item === "string") names.add(item.trim());
    else {
      if (item.name) names.add(String(item.name).trim());
      if (item.studentNo) studentNos.add(String(item.studentNo).trim());
    }
  }
  return { names, studentNos, raw: items };
}

async function collectExamScores(cdpBase) {
  const browser = await getBrowserClient(cdpBase);
  const result = new Map();
  try {
    for (const link of EXAM_LINKS) {
      const { targetId, page } = await openPage(cdpBase, browser, link.url);
      try {
        const data = await page.eval(`(async()=> {
          const value = (id) => document.getElementById(id)?.value ?? "";
          for (let i = 0; i < 80; i += 1) {
            if (document.getElementById("courseid") && window.clazzAndRelationId) break;
            await new Promise(resolve => setTimeout(resolve, 250));
          }
          const checkedClazzId = value("checkedclazzid");
          const relationId = window.clazzAndRelationId?.[checkedClazzId] ?? new URL(location.href).searchParams.get("id") ?? "";

          async function fetchPage(pageNo) {
            const params = new URLSearchParams({
              courseid: value("courseid"),
              clazzid: checkedClazzId,
              cpi: value("cpi"),
              ut: value("ut"),
              id: String(relationId),
              sw: value("sw"),
              schoolId: "-1",
              schoolName: "",
              sort: "",
              sorttype: "",
              state: "1",
              status: "-1",
              groupIds: value("groupIds"),
              groupid: value("groupid") || "-1",
              reviewMarkLabel: "0",
              markType: value("markType") || "0",
              hideInvigilation: value("hideInvigilation") || "0",
              hideRetest: value("hideRetest") || "",
              updateScore: value("updateScore") || "1",
              allowAnnotationRedoDownload: value("allowAnnotationRedoDownload") || "1",
              pages: String(pageNo),
              size: "200",
            });
            const response = await fetch("/mooc2-ans/exam/test/markresult-new", {
              method: "POST",
              headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
              body: params,
              credentials: "include",
            });
            return await response.json();
          }

          const first = await fetchPage(1);
          const rows = [...(first.data || [])];
          const totalPage = Number(first.totalPage || 1);
          for (let pageNo = 2; pageNo <= totalPage; pageNo += 1) {
            const page = await fetchPage(pageNo);
            rows.push(...(page.data || []));
          }
          return {
            className: ${JSON.stringify(link.className)},
            total: first.total || rows.length,
            rows: rows.map((row) => ({
              studentNo: String(row.loginName || row.userName || row.stuNo || ""),
              name: row.createUserName || row.name || "",
              score: Number(row.answerScore ?? 0),
              status: row.status,
              mark: row.mark,
              submitTime: row.submitTime || "",
            })),
          };
        })()`, 60000);
        result.set(link.className, data);
        console.log(`exam ${link.className}: ${data.rows.length}/${data.total}`);
      } finally {
        page.close();
        await browser.send("Target.closeTarget", { targetId }).catch(() => {});
      }
    }
  } finally {
    browser.close();
  }
  return result;
}

async function collectDiscussionSuccess(cdpBase, rosterByName, aliasMap) {
  let page = null;
  let targetId = null;
  let browser = null;
  const targets = await getTargets(cdpBase);
  const groupTarget = targets.find((target) => target.url.includes("groupweb.chaoxing.com/course/topic/topicList"));
  const pageHeaderTarget = targets.find((target) => target.url.includes("pageHeader=5"));

  try {
    if (groupTarget) {
      page = new CdpClient(groupTarget.webSocketDebuggerUrl);
    } else {
      browser = await getBrowserClient(cdpBase);
      let opened;
      if (pageHeaderTarget) {
        page = new CdpClient(pageHeaderTarget.webSocketDebuggerUrl);
      } else {
        opened = await openPage(cdpBase, browser, DISCUSSION_URL);
        page = opened.page;
        targetId = opened.targetId;
      }
      const iframeSrc = await waitForEval(
        page,
        `(() => [...document.querySelectorAll("iframe")].map((frame) => frame.src).find((src) => src.includes("groupweb.chaoxing.com")) || "")()`,
        (value) => Boolean(value),
        20000,
      );
      if (iframeSrc) {
        page.close();
        if (targetId) await browser.send("Target.closeTarget", { targetId }).catch(() => {});
        const openedFrame = await openPage(cdpBase, browser, iframeSrc);
        page = openedFrame.page;
        targetId = openedFrame.targetId;
      }
    }

    if (!page && pageHeaderTarget) page = new CdpClient(pageHeaderTarget.webSocketDebuggerUrl);
    if (!page) return { byClass: new Map(), rawText: "", warning: "discussion page not found" };

    let rawText = await page.eval(`(() => document.body.innerText)()`, 10000);
    if (!rawText.includes("存储XSS")) {
      rawText = await waitForEval(
        page,
        `(() => document.body.innerText)()`,
        (value) => String(value || "").includes("存储XSS"),
        25000,
      );
    }
    const parsed = parseDiscussionSuccess(rawText, rosterByName, aliasMap);
    console.log(
      `discussion success: ${[...parsed.byClass.entries()]
        .map(([className, names]) => `${className} ${names.size}`)
        .join(", ") || "0"}`,
    );
    return parsed;
  } finally {
    if (targetId && browser) await browser.send("Target.closeTarget", { targetId }).catch(() => {});
    if (browser) browser.close();
    if (page) page.close();
  }
}

async function waitForEval(page, expression, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;
  while (Date.now() < deadline) {
    lastValue = await page.eval(expression, 5000).catch(() => null);
    if (predicate(lastValue)) return lastValue;
    await sleep(500);
  }
  return lastValue;
}

function parseDiscussionSuccess(rawText, rosterByName, aliasMap) {
  const byClass = new Map();
  const lines = String(rawText || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  let currentClassName = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineClassName = detectDiscussionClass(line);
    if (lineClassName) currentClassName = lineClassName;
    if (!line.includes("在存储XSS实验中成功弹窗的同学")) continue;
    const className = lineClassName || currentClassName;
    if (!className) continue;

    const nameParts = [line.split("在存储XSS实验中成功弹窗的同学").at(-1) || ""];
    for (let lookahead = index + 1; lookahead < Math.min(lines.length, index + 10); lookahead += 1) {
      const nextLine = lines[lookahead];
      if (/老师/.test(nextLine) && detectDiscussionClass(nextLine)) break;
      if (nextLine.includes("在存储XSS实验中成功弹窗的同学")) break;
      nameParts.push(nextLine);
    }

    const namesText = nameParts.join(" ");
    const tokens = namesText
      .replace(/[，,、;；]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim().replace(/[。.!！]+$/g, ""))
      .filter(Boolean);

    if (!byClass.has(className)) byClass.set(className, new Set());
    const set = byClass.get(className);
    for (const token of tokens) {
      const mapped = aliasMap.get(token.toLowerCase()) || token;
      if (rosterByName.has(mapped)) set.add(mapped);
    }
  }

  return { byClass, rawText };
}

function detectDiscussionClass(line) {
  if (line.includes("信安24-01")) return "信安24-01";
  if (line.includes("信安24实验班")) return "信安24实验班";
  if (line.includes("信安2504")) return "信安2504";
  return null;
}

async function collectAttendance(cdpBase, term, teacher) {
  const targets = await getTargets(cdpBase);
  const target = targets.find((item) => item.url.includes("newca.zjtongji.edu.cn"));
  if (!target) return { rows: [], warning: "attendance page not found" };

  const page = new CdpClient(target.webSocketDebuggerUrl);
  try {
    const rows = await page.eval(`(async()=> {
      const tokenName = layui.setter.request.tokenName;
      const token = layui.sessionData(layui.setter.tableName)[tokenName];
      if (!token) throw new Error("attendance token not found in browser session");
      async function getJson(path, params = {}) {
        params._t = String(Date.now());
        const response = await fetch("/attendng/" + path + "?" + new URLSearchParams(params), {
          headers: { [tokenName]: token },
          credentials: "include",
        });
        const json = await response.json();
        if (!json.success) throw new Error(json.message || path + " request failed");
        return json.result;
      }

      const summary = await getJson("attend/c/dean/getStuAttend/yearTerm", {
        page: "1",
        rows: "500",
        timeType: "yearTerm",
        stuName: "",
        signCount: "",
        signType: "",
        courseName: "",
        openCollege: "",
        teacherName: ${JSON.stringify(teacher)},
        param1: ${JSON.stringify(term)},
        param2: "",
      });
      const byNo = new Map();
      for (const row of summary.records || []) {
        byNo.set(String(row.sno || row.stuNo || row.loginName || ""), {
          studentNo: String(row.sno || row.stuNo || row.loginName || ""),
          name: row.stuName || row.name || "",
          className: row.className || "",
          courseName: row.courseName || "",
          signCount: Number(row.signCount || 0),
          total: Number(row.total || 0),
          notSignCount: Number(row.notSignCount || 0),
          leaveCount: Number(row.leaveCount || 0),
          lateCount: Number(row.lateCount || 0),
          earlyCount: Number(row.earlyCount || 0),
          signInRate: Number(row.signInRate || 0),
          publicLeaveCount: 0,
          privateLeaveCount: 0,
          sickLeaveCount: 0,
          unknownLeaveCount: 0,
          leaveReasons: [],
          attendanceEvents: [],
        });
      }

      const teacherRecords = await getJson("attend/m/teaRecord/list", {
        page: "1",
        rows: "500",
        sort: "c_day",
        order: "desc",
        dateEnd: "",
        dateStart: "",
        courseId: "",
        className: "",
      });
      const wantedClasses = new Set(["信安24-01", "信安24实验班", "2024信安实验班", "信安25-04", "信安2504"]);
      const records = (teacherRecords.records || []).filter((record) =>
        (record.tno === ${JSON.stringify(teacher)} || record.teacherName === ${JSON.stringify(teacher)}) &&
        wantedClasses.has(record.className) &&
        (!record.schoolYear || String(record.schoolYear).includes("2025-2026")) &&
        (!record.schoolTerm || String(record.schoolTerm).includes("2"))
      );

      for (const record of records) {
        const students = await getJson("attend/c/dean/getStuRecord/" + record.id, { page: "1", rows: "200" });
        for (const student of students.records || []) {
          const studentNo = String(student.sno || student.stuNo || "");
          if (!studentNo) continue;
          if (!byNo.has(studentNo)) {
            byNo.set(studentNo, {
              studentNo,
              name: student.stuName || "",
              className: record.className || student.className || "",
              courseName: record.courseName || student.courseName || "",
              signCount: 0,
              total: 0,
              notSignCount: 0,
              leaveCount: 0,
              lateCount: 0,
              earlyCount: 0,
              signInRate: 0,
              publicLeaveCount: 0,
              privateLeaveCount: 0,
              sickLeaveCount: 0,
              unknownLeaveCount: 0,
              leaveReasons: [],
              attendanceEvents: [],
            });
          }
          const target = byNo.get(studentNo);
          const event = {
            date: record.cday || student.cday || "",
            className: record.className || student.className || "",
            courseName: record.courseName || student.courseName || "",
            status: String(student.status || ""),
            leaveReason: student.leaveReason || "",
            recordId: record.id,
          };
          target.attendanceEvents.push(event);
          if (event.status === "2") {
            const reason = event.leaveReason || "";
            target.leaveReasons.push([event.date, reason || "未填写原因"].join(":"));
            if (/公|因公|公务|比赛|竞赛|学校|学院/.test(reason)) target.publicLeaveCount += 1;
            else if (/病/.test(reason)) target.sickLeaveCount += 1;
            else if (/私|事假/.test(reason)) target.privateLeaveCount += 1;
            else target.unknownLeaveCount += 1;
          }
        }
      }

      for (const row of byNo.values()) {
        const detailedLeaveCount =
          row.publicLeaveCount + row.privateLeaveCount + row.sickLeaveCount + row.unknownLeaveCount;
        if (detailedLeaveCount > 0) row.leaveCount = detailedLeaveCount;
      }
      return [...byNo.values()];
    })()`, 90000);
    console.log(`attendance rows: ${rows.length}`);
    return { rows };
  } finally {
    page.close();
  }
}

function attendanceScore(row) {
  if (!row) return { score: 100, penalty: 0, note: "无考勤记录，按不扣分处理" };

  const publicLeave = Number(row.publicLeaveCount || 0);
  const sickLeave = Number(row.sickLeaveCount || 0);
  const privateLeave = Number(row.privateLeaveCount || 0);
  const unknownLeave = Number(row.unknownLeaveCount || 0);
  const penalty =
    row.notSignCount * 3 +
    publicLeave * 0.5 +
    sickLeave * 1 +
    privateLeave * 1.5 +
    unknownLeave * 1.5 +
    row.lateCount * 1 +
    row.earlyCount * 1;
  const parts = [];
  if (publicLeave) parts.push(`公假${publicLeave}`);
  if (sickLeave) parts.push(`病假${sickLeave}`);
  if (privateLeave) parts.push(`私假${privateLeave}`);
  if (unknownLeave) parts.push(`未分类请假${unknownLeave}`);
  const note = parts.join("，");

  return { score: round(clamp(100 - penalty)), penalty: round(penalty), note };
}

function buildGrades({ assignment, examScores, discussion, attendance }) {
  const attendanceByNo = new Map();
  for (const row of attendance.rows || []) {
    const normalizedClass = CLASS_NAME_ALIASES.get(row.className) || row.className;
    attendanceByNo.set(row.studentNo, { ...row, className: normalizedClass });
  }

  const examByNo = new Map();
  for (const examClass of examScores.values()) {
    for (const row of examClass.rows || []) examByNo.set(row.studentNo, row);
  }

  const classes = new Map();
  for (const [className, rows] of assignment.classRows) {
    const tableRows = rows.map((row) => {
      const attendanceRow = attendanceByNo.get(row.studentNo);
      const att = attendanceScore(attendanceRow);
      const discussionSet = discussion.byClass.get(className) || new Set();
      const discussionBonus = discussionSet.has(row.name) ? 5 : 0;
      const ordinaryScore = round(clamp(row.assignmentAverage * 0.85 + att.score * 0.10 + discussionBonus));
      const exam = examByNo.get(row.studentNo);
      return {
        className,
        studentNo: row.studentNo,
        name: row.name,
        ordinaryScore,
        examScore: round(Number(exam?.score ?? 0)),
        assignmentAverage: row.assignmentAverage,
        discussionBonus,
        attendanceScore: att.score,
        attendancePenalty: att.penalty,
        attendanceNote: att.note,
        notSignCount: attendanceRow?.notSignCount ?? "",
        leaveCount: attendanceRow?.leaveCount ?? "",
        publicLeaveCount: attendanceRow?.publicLeaveCount ?? "",
        privateLeaveCount: attendanceRow?.privateLeaveCount ?? "",
        sickLeaveCount: attendanceRow?.sickLeaveCount ?? "",
        unknownLeaveCount: attendanceRow?.unknownLeaveCount ?? "",
        leaveReasons: (attendanceRow?.leaveReasons || []).join("；"),
        lateCount: attendanceRow?.lateCount ?? "",
        earlyCount: attendanceRow?.earlyCount ?? "",
        examSubmitTime: exam?.submitTime || "",
      };
    });
    classes.set(className, tableRows);
  }
  return classes;
}

function optimizeWeights(classes, minOrdinaryWeight, maxOrdinaryWeight, step) {
  const allRows = [...classes.values()].flat();
  return {
    constrained: findBestWeight(allRows, minOrdinaryWeight, maxOrdinaryWeight, step, 0.4),
    unconstrained: findBestWeight(allRows, 0, 1, step, 0.4),
  };
}

function findBestWeight(rows, minWeight, maxWeight, step, targetWeight) {
  let best = null;
  const countSteps = Math.round((maxWeight - minWeight) / step);
  for (let i = 0; i <= countSteps; i += 1) {
    const ordinaryWeight = round(minWeight + i * step, 4);
    const examWeight = round(1 - ordinaryWeight, 4);
    const finalRows = rows.map((row) => finalScore(row, ordinaryWeight));
    const passCount = finalRows.filter((score) => score >= PASS_THRESHOLD).length;
    const avg = finalRows.reduce((sum, score) => sum + score, 0) / Math.max(1, finalRows.length);
    const candidate = {
      ordinaryWeight,
      examWeight,
      passCount,
      failCount: rows.length - passCount,
      averageFinalScore: round(avg),
    };
    if (!best) best = candidate;
    else if (candidate.passCount > best.passCount) best = candidate;
    else if (
      candidate.passCount === best.passCount &&
      Math.abs(candidate.ordinaryWeight - targetWeight) < Math.abs(best.ordinaryWeight - targetWeight)
    ) {
      best = candidate;
    }
  }
  return best;
}

function finalScore(row, ordinaryWeight) {
  return round(row.ordinaryScore * ordinaryWeight + row.examScore * (1 - ordinaryWeight));
}

function applyFinalScores(classes, ordinaryWeight) {
  const scored = new Map();
  for (const [className, rows] of classes) {
    scored.set(
      className,
      rows
        .map((row) => ({
          ...row,
          finalScore: finalScore(row, ordinaryWeight),
          passed: finalScore(row, ordinaryWeight) >= PASS_THRESHOLD,
        }))
        .sort((a, b) => b.finalScore - a.finalScore || b.examScore - a.examScore || a.studentNo.localeCompare(b.studentNo)),
    );
  }
  return scored;
}

function writeOutputs(outDir, classes, metadata) {
  ensureDir(outDir);
  const jsonPath = path.join(outDir, "final-grade-report.json");
  fs.writeFileSync(jsonPath, JSON.stringify({ metadata, classes: Object.fromEntries(classes) }, null, 2));

  const htmlPath = path.join(outDir, "final-grade-report.html");
  fs.writeFileSync(htmlPath, renderHtml(classes, metadata));
  let xlsxPath = path.join(outDir, "final-grade-report.xlsx");
  try {
    writeXlsx(jsonPath, xlsxPath);
  } catch (error) {
    if (!String(error.message || error).includes("Permission denied")) throw error;
    xlsxPath = path.join(outDir, `final-grade-report-${timestampForFilename(new Date())}.xlsx`);
    writeXlsx(jsonPath, xlsxPath);
  }
  return { jsonPath, htmlPath, xlsxPath };
}

function timestampForFilename(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function writeXlsx(jsonPath, xlsxPath) {
  const helper = path.join(SCRIPT_DIR, "write_final_grade_xlsx.py");
  const result = spawnSync("python3", [helper, jsonPath, xlsxPath], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`xlsx generation failed: ${result.stderr || result.stdout}`);
  }
}

function renderHtml(classes, metadata) {
  const summaryRows = [...classes.entries()].map(([className, rows]) => {
    const passCount = rows.filter((row) => row.passed).length;
    const avg = rows.reduce((sum, row) => sum + row.finalScore, 0) / Math.max(1, rows.length);
    return `<tr><td>${htmlEscape(className)}</td><td>${rows.length}</td><td>${passCount}</td><td>${rows.length - passCount}</td><td>${round(avg)}</td></tr>`;
  });

  const classSections = [...classes.entries()]
    .map(([className, rows]) => {
      const body = rows
        .map(
          (row, index) => `<tr class="${row.passed ? "" : "fail"}">
            <td>${index + 1}</td>
            <td>${htmlEscape(row.studentNo)}</td>
            <td>${htmlEscape(row.name)}</td>
            <td>${row.ordinaryScore}</td>
            <td>${row.examScore}</td>
            <td>${row.finalScore}</td>
            <td>${row.passed ? "及格" : "不及格"}</td>
            <td>${row.assignmentAverage}</td>
            <td>${row.discussionBonus}</td>
            <td>${row.attendanceScore}</td>
            <td>${htmlEscape(row.notSignCount)}</td>
            <td>${htmlEscape(row.leaveCount)}</td>
            <td>${htmlEscape(row.publicLeaveCount)}</td>
            <td>${htmlEscape(row.privateLeaveCount)}</td>
            <td>${htmlEscape(row.sickLeaveCount)}</td>
            <td>${htmlEscape(row.unknownLeaveCount)}</td>
            <td>${htmlEscape(row.lateCount)}</td>
            <td>${htmlEscape(row.earlyCount)}</td>
            <td>${htmlEscape(row.attendanceNote)}</td>
            <td>${htmlEscape(row.leaveReasons)}</td>
          </tr>`,
        )
        .join("\n");
      return `<section>
        <h2>${htmlEscape(className)}</h2>
        <table>
          <thead>
            <tr>
              <th>排名</th><th>学号</th><th>姓名</th><th>平时成绩</th><th>期末成绩</th><th>最终成绩</th><th>状态</th>
              <th>作业均分</th><th>讨论加分</th><th>考勤分</th><th>未签到</th><th>请假</th><th>公假</th><th>私假</th><th>病假</th><th>未分类请假</th><th>迟到</th><th>早退</th><th>考勤备注</th><th>请假明细</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>信息安全代码审计最终成绩统计</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #18202a; background: #f7f8fa; }
    h1 { font-size: 24px; margin: 0 0 12px; }
    h2 { font-size: 19px; margin: 28px 0 10px; }
    .meta { line-height: 1.7; color: #415066; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; background: white; font-size: 13px; }
    th, td { border: 1px solid #d8dee8; padding: 7px 8px; text-align: left; white-space: nowrap; }
    th { background: #edf1f7; position: sticky; top: 0; z-index: 1; }
    tr.fail td { background: #fff1f0; }
    section { margin-top: 22px; }
  </style>
</head>
<body>
  <h1>信息安全代码审计最终成绩统计</h1>
  <div class="meta">
    生成时间：${htmlEscape(metadata.generatedAt)}<br>
    采用比例：平时 ${round(metadata.selected.ordinaryWeight * 100, 0)}% / 期末 ${round(metadata.selected.examWeight * 100, 0)}%，及格线 ${PASS_THRESHOLD} 分。<br>
    常规范围最优：平时 ${round(metadata.optimization.constrained.ordinaryWeight * 100, 0)}% / 期末 ${round(metadata.optimization.constrained.examWeight * 100, 0)}%，及格 ${metadata.optimization.constrained.passCount} 人。无限制搜索最优：平时 ${round(metadata.optimization.unconstrained.ordinaryWeight * 100, 0)}% / 期末 ${round(metadata.optimization.unconstrained.examWeight * 100, 0)}%，及格 ${metadata.optimization.unconstrained.passCount} 人。<br>
    平时成绩 = 作业均分 * 85% + 考勤分 * 10% + 存储 XSS 成功弹窗讨论加分 5 分，封顶 100。
  </div>
  <table>
    <thead><tr><th>班级</th><th>人数</th><th>及格人数</th><th>不及格人数</th><th>最终均分</th></tr></thead>
    <tbody>${summaryRows.join("\n")}</tbody>
  </table>
  ${classSections}
</body>
</html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const assignmentPath = path.resolve(args.assignmentJson);
  const outDir = path.resolve(args.outDir);
  const excludedStudents = loadExcludedStudents(args.excludedJson);
  const assignment = loadAssignmentRows(assignmentPath, excludedStudents);
  const aliasMap = loadAliasMap(args.aliasJson);

  console.log(`assignment source: ${assignmentPath}`);
  if (aliasMap.size) console.log(`discussion aliases: ${aliasMap.size}`);
  if (assignment.excludedRows.length) console.log(`excluded rows: ${assignment.excludedRows.length}`);
  const [examScores, discussion, attendance] = await Promise.all([
    collectExamScores(args.cdp),
    collectDiscussionSuccess(args.cdp, assignment.rosterByName, aliasMap),
    collectAttendance(args.cdp, args.term, args.teacher),
  ]);

  if (discussion.warning) console.warn(`discussion warning: ${discussion.warning}`);
  if (attendance.warning) console.warn(`attendance warning: ${attendance.warning}`);

  const classes = buildGrades({ assignment, examScores, discussion, attendance });
  const optimization = optimizeWeights(classes, args.minOrdinaryWeight, args.maxOrdinaryWeight, args.step);
  const selected = optimization.constrained;
  const scored = applyFinalScores(classes, selected.ordinaryWeight);
  const metadata = {
    generatedAt: new Date().toISOString(),
    assignmentGeneratedAt: assignment.generatedAt,
    cdp: args.cdp,
    selected,
    optimization,
    scoringPolicy: {
      passThreshold: PASS_THRESHOLD,
      ordinaryScore: "assignmentAverage * 0.85 + attendanceScore * 0.10 + discussionBonus(5)",
      attendancePenalty: "notSign*3 + publicLeave*0.5 + sickLeave*1 + privateLeave*1.5 + unknownLeave*1.5 + late*1 + early*1",
      tieBreaker: "within equal pass counts, choose ordinary weight closest to 40%",
      constrainedSearch: [args.minOrdinaryWeight, args.maxOrdinaryWeight],
    },
    excludedRows: assignment.excludedRows,
  };
  const outputs = writeOutputs(outDir, scored, metadata);

  console.log(`selected ratio: ordinary ${round(selected.ordinaryWeight * 100, 0)}%, exam ${round(selected.examWeight * 100, 0)}%`);
  for (const [className, rows] of scored) {
    const passCount = rows.filter((row) => row.passed).length;
    console.log(`${className}: ${passCount}/${rows.length} pass`);
  }
  console.log(`html: ${outputs.htmlPath}`);
  console.log(`xlsx: ${outputs.xlsxPath}`);
  console.log(`json: ${outputs.jsonPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
