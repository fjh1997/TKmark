# 超星作业批改脚本

这个仓库用于超星学习通作业批改、考勤/考试数据采集和课程最终成绩统计。

## 功能

- 通过当前已登录的浏览器 CDP 会话读取超星考试成绩。
- 读取超星讨论区里“存储 XSS 实验中成功弹窗”的课堂成功名单。
- 读取课堂考勤系统的学期统计数据。
- 合并本地作业评分结果，生成三个班的最终成绩 HTML、XLSX 和 JSON。
- 自动搜索平时成绩/期末成绩比例，使及格人数尽可能多。

## 安全说明

仓库不保存 cookie、token、API key、学生成绩明细或浏览器用户数据。

本地输出目录 `out/`、采集缓存目录 `data/`、`.env` 和 `my-user-data/` 已加入 `.gitignore`。运行脚本前请确认浏览器已登录对应系统，脚本只通过当前浏览器会话临时读取数据。

## 环境

- Node.js 22 或更高版本。
- 已打开远程调试端口的 Edge/Chrome。
- WSL 场景可用 `wsl-host-cdp` 桥接宿主机浏览器。

## 生成最终成绩

默认读取相邻目录里的当前作业排名文件：

```bash
npm run final-grades -- \
  --cdp http://127.0.0.1:59224 \
  --assignment-json ../chaoxing-grader/score_rankings_behinder_adjusted.json \
  --alias-json data/discussion-aliases.json \
  --excluded-json data/excluded-students.json \
  --out-dir out/final-grades-20260706
```

输出：

- `final-grade-report.html`
- `final-grade-report.xlsx`
- `final-grade-report.json`

## 评分合成规则

默认平时成绩：

```text
平时成绩 = 作业均分 * 85% + 考勤分 * 10% + 课堂讨论成功弹窗加分 5 分
```

平时成绩封顶 100 分。考勤分默认从 100 分开始扣：

```text
未签到 * 3 + 普通请假 * 1.5 + 公假/因公请假 * 0.5 + 迟到 * 1 + 早退 * 1
```

考勤会先读取学生学期统计，再逐条读取教师端考勤详情里的学生状态。请假类型来自详情接口的 `leaveReason`，例如“事假（公）”“事假（私）”“病假”。默认扣分：

```text
未签到 * 3 + 公假 * 0.5 + 病假 * 1 + 私假 * 1.5 + 未分类请假 * 1.5 + 迟到 * 1 + 早退 * 1
```

如果详情里请假原因为空，脚本归为“未分类请假”。

最终成绩比例默认在“平时 20%-60%”的常规范围内搜索，目标是及格人数最多；如果及格人数相同，选择最接近平时 40% / 期末 60% 的比例。报告中也会同时列出 0%-100% 无限制搜索的结果，便于复核。

## 常用参数

```bash
node scripts/final-grade-report.mjs --help
```

可调参数包括 CDP 地址、作业 JSON 路径、输出目录、考勤学期、教师编号、平时成绩比例搜索范围和搜索步长。

如果讨论区成功名单使用拼音、缩写或昵称，本地创建 `data/discussion-aliases.json`：

```json
{
  "nickname_or_pinyin": "真实姓名"
}
```

`data/` 已被忽略，不会推送到 GitHub。

如果 roster 里混入教师、休学或不应统计的人员，本地创建 `data/excluded-students.json`：

```json
{
  "excluded": [
    { "studentNo": "学号或工号" },
    { "name": "姓名" }
  ]
}
```

排除名单只影响最终成绩统计、比例优化和导出的 Excel，不会修改原始采集数据。
