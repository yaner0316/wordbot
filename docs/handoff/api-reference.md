# 后端 API 清单

## 已确认接口

### `GET /api/health`

用途：返回运行状态。

### `POST /api/submit`

用途：提交答题结果。

已确认请求字段：

- `user`
- `testId`
- `answers`

### `POST /api/reviews`

用途：创建错题复习轮次。

已确认请求字段：

- `user`
- `sourceTestId`
- `parentReviewId`

### `GET /api/reviews/active`

用途：查询当前活跃复习轮次。

已确认请求字段：

- `user`
- `sourceTestId`

### `POST /api/reviews/:reviewId/submit`

用途：提交复习轮次。

已确认请求字段：

- `user`
- `answers`

### `POST /api/reviews/:reviewId/defer`

用途：将复习延后到下次。

已确认请求字段：

- `user`

### `GET /api/reviews/summary`

用途：获取复习摘要。

已确认请求字段：

- `user`
- `sourceTestId`

### `POST /api/quiz`

用途：生成或获取题目。

已确认请求字段：

- `user`
- `level`
- `mode`

### `GET /api/stats/:user`

用途：获取用户统计。

### `GET /api/history/:user`

用途：获取用户考核历史。

已确认查询字段：

- `mode`

### `GET /api/admin/users`

用途：获取所有用户。

### `GET /api/admin/stats`

用途：获取全局统计。

### `POST /api/admin/addWord`

用途：录入单个单词。

已确认请求字段：

- `targetUser`
- `word`
- `meaning`
- `pos`
- `context`

### `POST /api/admin/validateWords`

用途：校验单词列表。

已确认请求字段：

- `words`

### `POST /api/admin/addWords`

用途：批量录入单词或词组。

已确认请求字段：

- `targetUser`
- `words`

### `POST /api/admin/updateMulti`

用途：批量更新多义词信息。

已确认请求字段：

- `targetUser`
- `words`

### `GET /api/word`

用途：查询单词。

已确认查询字段：

- `userId`
- `word`
- `recordId`

### `PUT /api/word`

用途：修改单词信息或状态。

已确认请求字段：

- `userId`
- `word`
- `recordId`
- `meaning`
- `cnMeaning`
- `pos`
- `context`
- `distractors`
- `status`
- `qualityFlags`
- `qualityNote`

### `GET /api/admin/reviewWords`

用途：获取待复习单词。

### `POST /api/admin/reviewWords/mark`

用途：标记单词进入复习。

已确认请求字段：

- `recordId`
- `flags`
- `note`

### `POST /api/admin/reviewWords/clear`

用途：清除单词复习标记。

已确认请求字段：

- `recordId`

### `DELETE /api/word`

用途：删除单词。

已确认查询字段：

- `userId`
- `word`

### `POST /api/admin/cleanup`

用途：清理用户测试数据。

已确认请求字段：

- `user`
- `days`

## 已确认接口关系

- 手动改状态走 `PUT /api/word`
- 录入单词走 `POST /api/admin/addWords`
- 复习相关接口由 `app/backend/http-app.js` 和 `app/backend/review-service.js` 共同提供
