# 后端 API 摘要

本文件只记录当前源码已确认的接口边界，不是完整 OpenAPI 定义。产品授权以 [`PROJECT.md`](../../PROJECT.md) 为准；发布与数据库操作以 [`docs/OPERATIONS.md`](../OPERATIONS.md) 为准。不要从本清单推断尚未实现的接口。

## 登录与会话

| 接口 | 行为 |
|---|---|
| `POST /api/auth/register` | 创建孩子账号并签发孩子角色（`role=user`）会话。 |
| `POST /api/auth/login` | 校验孩子凭据并签发 `role=user` 会话。 |
| `POST /api/auth/parent/login` | 校验家长凭据并签发 `role=parent` 会话。 |
| `GET /api/auth/parent/status` | 需要当前孩子会话；仅返回当前用户是否已设置家长凭据：`{ hasParentCredentials: boolean }`。 |
| `POST /api/auth/parent/setup` | 需要当前孩子会话且目标用户必须与会话一致；验证孩子密码，已有家长凭据时还需当前家长凭据。成功后仍是孩子角色会话。 |
| `POST /api/auth/parent/logout` | 需要有效用户会话；将 Cookie 降回会话所属用户的孩子角色（`role=user`），已是孩子角色时可重复调用。 |
| `POST /api/auth/parent/reset-child-password` | 通过家长凭据重置孩子密码。 |
| `POST /api/auth/logout` | 清除浏览器会话 Cookie。 |

会话由签名的 `wordbot_session` HttpOnly Cookie 承载，有效期为 24 小时。生产 Cookie 使用 `Secure`、`SameSite=None` 和 `Partitioned`；本地开发使用 `SameSite=Lax`。受保护请求必须携带有效会话，且请求中的用户标识必须与会话用户一致；缺少、过期或无效会话返回 `401 UNAUTHORIZED`，跨用户请求返回 `403 FORBIDDEN`。

普通用户会话可访问本人学习数据。孩子可通过 `POST /api/words` 新增自己的词义；重复单词需确认或新增词义缺少释义时返回 `409`（代码分别为 `DUPLICATE_WORD_CONFIRMATION_REQUIRED`、`NEW_MEANING_REQUIRES_MEANING`）。设置、词库管理写操作、清理测试记录及复习标记变更要求 `role=parent`；不满足时返回 `403 PARENT_SESSION_REQUIRED`。`PUT`/`DELETE /api/word` 也要求家长会话。未列为当前用户会话白名单的 `/api/admin/*` 路由要求 admin token。

## 已确认的主要接口

- `GET /api/health`：运行状态，不证明真实学习流程可用。
- `POST /api/quiz`：获取正式或测试题目；需有效用户会话。
- `GET /api/quiz/session`、`POST /api/quiz/session/progress`：读取并保存正式答题进度；需有效用户会话。
- `POST /api/submit`：提交答题结果；需有效用户会话。
- `POST /api/reviews`、`GET /api/reviews/active`、`POST /api/reviews/:reviewId/submit`、`POST /api/reviews/:reviewId/defer`、`GET /api/reviews/summary`：复习流程；需有效用户会话。
- `GET /api/stats/:user`、`GET /api/history/:user`：本人统计与历史；需有效用户会话。
- `POST /api/admin/validateWords`：校验候选单词，需要本人用户会话。`POST /api/admin/addWord`、`POST /api/admin/addWords`：家长写入入口。`POST /api/words` 是孩子新增本人词义的用户会话入口。
- `GET /api/word`：本人查询单词；`PUT /api/word` 和 `DELETE /api/word` 需家长会话。
- `GET /api/admin/reviewWords`、`POST /api/admin/reviewWords/mark`、`POST /api/admin/reviewWords/clear`：查询或修改复习标记；写入需家长会话。
- `POST /api/admin/cleanup`：清理本人测试模式记录，需家长会话。
- `GET /api/admin/users`、`GET /api/admin/stats`：管理级接口，需 admin token。

`POST /api/quiz/session/progress` 在试卷已结束或不活跃时返回 `409 QUIZ_SESSION_INACTIVE`；并发保存的旧 `baseRevision` 会返回 `409 QUIZ_PROGRESS_CONFLICT`。涉及单词删除时，如正式历史阻止删除，也会以 `409 WORD_DELETE_BLOCKED_BY_FORMAL_HISTORY` 拒绝。收到 409 时保留本机草稿并按响应代码刷新或处理确认流程；不要以盲目重试覆盖其他设备的较新状态。

`GET /api/admin/questionCache/status?userId=<当前用户>` 的 `status.learning` 区分总词义、已掌握、冷却、等待识别复习、缺录入时间和可选词义数量，并提供 `nextCooldownEndsAt`。该时间只表示最早冷却结束，不保证届时已有十道可用题；正式开考仍由现有可选题数决定。查询失败不等于题数为零。

`status.generation.counts.blockedInvalidWord` 和 `status.readiness.queue.blockedInvalidWordCount` 单列格式不符合生成条件的词义任务，不把它们算成普通 pending/retrying。对应的 `generation.failures` 条目为 `status: blocked_invalid_word`、`lastErrorCode: INVALID_GENERATION_WORD`、`nextAttemptAt: null`，保留本用户的 `wordId` 供既有词库管理定位；应修正词义所属单词，不能通过重复重建解决。可用题不足十道且存在此类阻塞时 readiness 为 `needs_attention`；已有足够合格题时仍可开考，阻塞问题独立提示。公网 health 中同类问题以 `learningSupply.status: invalid_data_blocked` 暴露，不冒称供题健康。队列读取失败时为 `learningSupply.status: queue_unavailable`，不能把未知状态显示成 ready。

云端没有活跃试卷（`active: false`）不能单独证明一次超时提交已保存。客户端应保留结果未知的原答卷，允许查看只读备份或历史；再次确认同一提交必须复用原始请求内容，不能因切页、重载或其他设备开始新试卷而删除待核对答案。

`POST /api/submit` 的 `newlyMasteredMeanings` 返回本次新增掌握的 `{ meaningId, recordId, word, meaningZh }`，`masteredWords` 仅列出所有词义均已掌握的拼写。正式提交在已有会话状态中保存服务端基线和固定反馈，重复提交返回相同摘要；没有基线的历史提交保守返回空摘要。中断恢复按原词义版本补写，版本已变或缺失时保留后续状态。此反馈不改变现行计分或奖励公式。

## 隔离冒烟检查

只在本机服务和一次性 Supabase 环境中使用合成账号。注册后接口会签发孩子会话；如需验证家长流程，再通过隔离测试账号设置凭据、登录家长模式并测试退出降级。随后通过本地网页检查取题、作答、提交、结果和历史。请求目标固定为 `http://127.0.0.1:5000`，测试账号不得含真实儿童数据；不要将生产用户 ID、Cookie、密码或线上地址复制到命令中。发布前的生产用户验证按 `PROJECT.md` 和 `docs/OPERATIONS.md` 的授权及读回要求单独执行。
