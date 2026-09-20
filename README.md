# 寺院僧人挂单与常住管理平台

面向寺院客堂的云游僧人挂单、寮房床位、常住考察（羯磨）、常住档案与早晚课考勤管理系统。

- **前端**：Vue 3 + TypeScript + Naive UI + Vite
- **后端**：Fastify + TypeScript
- **数据库**：PostgreSQL（生产）/ PGlite（内置 WASM PostgreSQL，零配置演示）

## 功能模块

### 1. 挂单登记
云游僧人到寺登记：**法名、出家寺庙、戒牒编号、到寺日期、预计住几天**（联系电话选填）。
支持续单、退单（自动释放床位）、超期未续单自动提示。

### 2. 寮房床位
- 维护寮房（房间号、楼栋/方位）与床位（床位号）
- 为挂单僧人安排 **房间号 / 床位号**
- 数据库部分唯一索引保证：一张床位同一时间只能有一位在住僧人
- 床位占用情况可视化，退单自动释放

### 3. 常住考察与羯磨
- 挂单僧人发心常住 → 登记 **3–6 个月**考察期（后端强校验 3 ≤ 月数 ≤ 6）
- 考察期进度与到期提醒
- 考察通过 → 办理**羯磨仪式**，同步建立常住档案并释放云水堂床位
- 考察未通过 → 记录原因，可继续挂单或退单

### 4. 常住僧人档案
记录：**法名、字辈（派字）、剃度师、受戒时间与戒场、担任职务**
（住持/知客/维那/典座/僧值/寮元/衣钵/书记/汤药/清众）、戒牒编号、羯磨日期等。
支持职务变动编辑、外出/退住状态管理。

### 5. 早晚课考勤
- 按日期 + 早课/晚课生成当日在寺人员名单（挂单中 + 常住）
- 到 / 缺 / 假 三态登记，可批量操作，可填请假事由
- **缺勤累计满 3 次自动提醒**：保存考勤时后端实时返回预警人员，
  页面弹出通知；概览页与侧边栏常驻红色角标
- 数据库视图 `v_absence_alerts` 持续维护预警名单

### 6. 概览首页
挂单/考察/常住人数、床位入住率、缺勤预警、挂单超期、考察到期、寮房入住进度一屏总览。

## 快速开始

```bash
npm install          # 安装全部依赖
npm run dev          # 同时启动后端(:3000)与前端(:5173)
```

打开 http://localhost:5173 即可。

**未配置 `DATABASE_URL` 时，后端自动使用内置 PGlite**（数据落在 `server/.pgdata`），
首次启动自动写入演示数据（3 位常住、3 位挂单僧人、寮房床位、考勤记录，
其中「法空」已缺勤 3 次、「行远」挂单超期、「常照」考察今日到期，便于直接体验各提醒功能）。

## 使用真实 PostgreSQL

方式一：Docker Compose

```bash
docker compose up -d        # 启动 PostgreSQL 16，自动执行 db/schema.sql
echo 'DATABASE_URL=postgres://sangha:sangha@localhost:5432/sangha' > server/.env
npm run dev
```

方式二：已有 PostgreSQL 实例

```bash
createdb sangha
psql -d sangha -f db/schema.sql
export DATABASE_URL=postgres://用户:密码@主机:5432/sangha
SEED=1 npm run dev:server   # SEED=1 可选：写入演示数据
```

> 后端用 `node --env-file`/tsx 不会自动读 `.env`，可用 `export $(grep -v '^#' server/.env | xargs)`
> 或进程管理器注入；本地演示不设置任何变量即可运行。

## 目录结构

```
db/schema.sql              PostgreSQL 建表 + 视图（缺勤统计/预警、超期、考察到期）
docker-compose.yml         PostgreSQL 16 一键启动
server/
  src/db.ts                数据库适配层（pg / PGlite 自动切换）+ 演示数据
  src/routes/              registrations / rooms / probation / residents / attendance / dashboard
web/
  src/views/               6 个功能页面
  src/types.ts             与后端对应的 TS 类型
```

## 关键设计

| 需求 | 实现 |
| --- | --- |
| 床位不可重复安排 | `registrations` 上 `WHERE status='挂单中'` 的部分唯一索引 |
| 考察期 3–6 个月 | 接口 `CHECK (months BETWEEN 3 AND 6)`，起止日期用 interval 计算 |
| 羯磨成为常住 | 一个事务内：建 residents 档案 + 挂单置「转常住」并释放床位 + 考察置「通过」 |
| 缺勤满 3 次提醒 | `v_absence_summary` / `v_absence_alerts` 视图 + 保存考勤事务内实时返回预警 |
| 考勤唯一 | `(日期, 课次, 人员类型, 人员ID)` 唯一索引，UPSERT 支持反复修改 |
| 挂单/常住统一考勤 | attendance 用 person_type + reg_id/resident_id 互斥外键建模 |
```
