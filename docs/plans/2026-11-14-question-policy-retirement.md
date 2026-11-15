# 三部分审核与旧规则退役

状态：本地实施与回归完成；未部署、未应用生产迁移、不写生产题库。

## 已确认标准

- 目标仍是在句子情境中理解已选择的具体词义；四个选项恰有一个成立。
- 小学分低年级（1–3）和高年级（4–6），旧存储值“小学”兼容为高年级。两档均仅允许目标名词单复数变化，不允许目标动词变形；初中及以上允许同一词条和义项的语法变形。
- 无词数上限。按实际语言、推理和背景知识负担判断难度。
- 三部分审核：题干 → 干扰项唯一性（一次盲审）→ 翻译；不保留第二次重复盲审，不增加第四层审核。
- 干扰项允许词组、不同词性、形近词、同词性词、反义词；优先已录入词。禁止伪造词形，避免只凭词性猜答案；错误选项之间近义或包含不是独立否决理由。
- 不补写题干没有的动机、动作或背景来救活干扰项，也不凭空添加限制以排除成立选项。
- 返修携带被否决版本、具体证据；只清除受影响阶段及其下游。

## 实施与退役范围

1. 同步 PROJECT.md 权威规则、生成提示词、确定性校验、审核与返修。
2. 增加明确的现行规则版本；旧断点、旧审核证据不得冒充新政策结果；新题选择和发布均拒绝旧版，历史答题快照仍可读取。
3. 准备数据库版本屏障及现有覆盖统计兼容改动，不执行生产迁移。
4. 同步前后端难度值与展示；不重写用户历史难度/成绩。
5. 为规则退役和三个审核阶段添加行为测试；先定向失败用例，再实现，再受影响测试，最后完整回归。数据库变更用本地 PGlite 验证。

## 工作基线

后端沿用已授权未提交修复工作树 app/.worktrees/audit-repair-20261113（HEAD 812bc49）；本地 origin/main 已到 97ca416，后续合并发布需验证集成。网页端从本地 origin/main c07f363 新建隔离工作树。旧分支及历史验证文件保持不变。

## 停止条件

规则、可执行路径和旧版本屏障一致，受影响测试及完整回归通过，记录未验证事项后停止。线上仍执行旧发布版本，必须在用户另行授权部署并验证后才能声称线上退役完成。

## 完成记录（2026-11-15）

实施范围 1–5 均完成。后端完整回归 1,435 通过 / 7 跳过 / 0 失败；网页 331 通过。版本屏障、旧断点退出、三阶段顺序与最小返修已由行为测试和本地 PGlite 验证。达到本轮停止条件。

交付与证据：项目根 artifacts/question-policy-retirement-20261114/RESULT.md、source-manifest.json、backend-final.log、web-final-pass.log。真实外部模型调用 0，未重跑十词质量实验；不把程序回归当作语言质量证明。

剩余：后续授权的十词实测；集成 main 后续提交；另行授权的协调部署及线上核验。根 README 已写明当前任务工作树，历史快照不可作为执行入口。

## 新流程十词实测（2026-11-15，用户后续授权）

已使用 Sol 6.1 low 从同十词重新生成，按 context-learning-v3 三阶段完成：9 初稿通过、paleontologists 第一轮返修通过；未用第二轮。74 请求全部成功，619,702 tokens；不部署、不入库。正式源码冻结且哈希核验未变。

证据位于项目根 artifacts/formal-ten-v3-sol61-20261115/。FINDINGS.md 单列 toss 唯一性疑点及 abuse/toss 干扰项释义与当前用法不匹配；程序全通过不等于十题质量均已证明。已完成一次限定十题阅读核对，停止扩审和返修。下步只讨论这些实际问题；部署仍待另行授权。

## 2026-11-15 Contextual option glosses (authorized, in progress)

- Scope: generation and existing translation review only; three examples: had protected them / slap a coin / I must + success. Keep context-learning-v3 and blind-completion-v6; retire question-content-v2 by upgrading translation evidence to v3.
- Update the still-unpublished 20261115 policy migration and its verifier; no production migration, deploy, bank insert or additional review layer. Existing SQL function security/ACL unchanged; checked Supabase changelog and database-functions documentation; validation uses local PGlite only.
- Add focused failing tests, patch contextual input propagation and prompts, invalidate only stale translation checkpoint artifacts, then affected/full backend regression. No frontend/API shape change.
- Freeze the final ten approved rows in artifacts/formal-ten-v3-sol61-20261115; user accepted all ten including toss. Regenerate glosses, review all translation content with Sol gpt-6.1-sol / low, at most two translation repairs per question. Keep English stems/options/order/keys fixed; keep existing sentence translation unless review requires its repair. No new stem/option audit.
- Save costs, per-question review/repair and immutable English comparison under artifacts/contextual-glosses-sol61-20261115; stop after these checks.

### Contextual glosses completion

- Completed locally. Both translation prompts share the contextual glossary rules and all three examples; formal translation receives exact stem, option words and selected target sense through adapter wrappers. Translation evidence is now question-content-v3; old v2 proofs and stale glossary checkpoints cannot be reused. Existing stem/option proofs are retained. The still-unpublished 20261115 migration and verifier now require v3; no deployed migration was rewritten or applied.
- TDD evidence: tests-red.log → 61/61 focused checks passed. Full backend: 1445 tests, 1438 passed, 7 skipped, 0 failed. Local PGlite rejects v2 publication and preserves history. Syntax and diff checks passed. No frontend change.
- Fixed-ten Sol gpt-6.1-sol / low run: 10/10 translation approvals on first round, 0 repairs, exactly 20 calls (10 gloss generation + 10 existing translation reviews). English stems/options/order/answer keys unchanged; all original sentence translations retained and reviewed. No stem/option audit, additional review layer, database write, bank insert, deployment or production migration.
- Tokens: input 162025 (cached 57728), output 5073, total 167098; monetary charge unavailable from CLI. Main corrections: protected/comforted/praised become active action glosses; slap a coin becomes 拍打; irrelevant dictionary senses removed. success example is prompt/test calibration, not an extra model sample.
- Evidence: D:/Projects/04-Wordbot-开发任务/artifacts/contextual-glosses-sol61-20261115/REPORT.md, CALLS.md, frozen-ten.json, manifest.json, results.json, verification.json, per-word raw outputs and test logs. The prior experiment remains immutable evidence. User acceptance of toss is retained.
- Stop condition met. Remaining action is a future separately authorized release; do not deploy or insert these experimental questions.

## Authorized release and fixed-ten publication — 2026-11-15

User explicitly authorized deployment, retirement of old formal rules and bank insertion of all ten tested questions. This supersedes earlier stop-before-deployment instructions. Preserve the recent main learning-progress changes; pin the reviewed primary-band frontend commit. Reuse prior language-quality evidence; no new language audit. Verify integration/CI, temporarily pause claim RPC without deleting jobs or changing ACLs, apply the registered policy barrier through the normal release workflow, verify live SHAs and resume claims. Import each question under its original meaning/account (4 yusi + 6 qiuqiu), retaining fixed English and replacing only approved translation evidence; no mastery reset/history rewrite. Save scoped preflight, pause/restore backup, publication plan/receipt/readback and real-flow checks in project-root artifacts/question-policy-release-20261115. Formal two-question reserve remains required; importing one question per meaning does not waive it. Production model remains existing MiniMax configuration; Sol is the validated experiment provider.
