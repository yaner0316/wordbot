# 测试基线

## 后端测试

已确认后端使用 Node 内置测试：

- 脚本：`node --test`
- 位置：`D:\Projects\04-Wordbot-开发任务\app\backend\test`

已确认测试文件：

- `article-context.test.js`
- `assessment-mode.test.js`
- `game-reward.test.js`
- `http-app.test.js`
- `language-enrichment.test.js`
- `mastery-evidence.test.js`
- `option-meanings.test.js`
- `quiz-builder.test.js`
- `review-priority.test.js`
- `review-question-builder.test.js`
- `review-record.test.js`
- `review-service.test.js`
- `review-session.test.js`
- `runtime-health.test.js`
- `submission-coordinator.test.js`

## 前端测试

已确认前端测试目录：

- `D:\Projects\04-Wordbot-开发任务\web\test`

已确认测试文件：

- `quiz-logic.test.cjs`
- `review-flow.test.cjs`
- `stage2-behavior.test.cjs`
- `submission-guard.test.cjs`

## 已验证测试范围

当前已经通过的关键测试范围：

- 掌握规则测试：`16/16`
- 题干和选项逻辑测试：通过
- 复习流程测试：通过
- 提交防重入测试：通过
- 前端结构测试：`18/18`

## 建议回归顺序

1. 先跑后端单测
2. 再跑前端结构测试
3. 最后看浏览器体验

## 待确认

- 最近一次测试执行时间
- 是否有 CI
- 是否有端到端测试
- 是否需要补性能回归测试
