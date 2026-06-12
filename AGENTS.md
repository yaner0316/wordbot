# AGENTS.md

## 项目概览
单词机器人 (WordBot) - 英语单词学习与考核系统。
- **后端**：Node.js + Express，端口 5000
- **前端**：Single Page Application (纯 JS + Tailwind CSS CDN)
- **存储**：飞书多维表格 API (Bitable)
- **AI**：MiniMax API（生成干扰词、例句等，可选）

## 目录结构
```
/workspace/projects/
├── backend/
│   ├── server.js    # Express 服务入口，API 路由
│   ├── feishu.js    # 飞书 API 封装（CRUD、出题、统计）
│   ├── config.js    # 集中配置管理（环境变量）
│   └── .env         # 环境变量文件（敏感信息）
├── index.html       # 前端 SPA 入口
├── .coze            # 构建/运行配置
├── AGENTS.md        # 本文件
└── DESIGN.md        # 设计规范
```

## 构建与测试命令
```bash
# 安装依赖
cd /workspace/projects && npm install

# 启动开发服务（端口 5000）
node backend/server.js

# 检查语法
node --check backend/server.js
node --check backend/feishu.js
node --check backend/config.js
```

## API 路由
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | / | 前端首页 |
| POST | /api/quiz | 生成 10 道考题 |
| POST | /api/submit | 提交答案 |
| GET | /api/stats/:user | 获取用户统计 |
| GET | /api/history/:user | 获取用户考核历史 |
| GET | /api/admin/users | 获取所有用户 |
| GET | /api/admin/stats | 全局统计 |
| POST | /api/admin/addWord | 添加单词 |

## 关键函数
### `backend/feishu.js`
- `generateQuiz(userId)` - 生成 10 道题（type1 语境填空 / type2 英英释义 / type3 中英释义）
- `buildQuizQuestion()` - 构建单题，含干扰项过滤和 a/an 冠词约束检查
- `submitAnswers()` - 批改答案并更新单词状态
- `getStats(userId)` - 计算用户统计数据
- `getRecords(table)` - 获取飞书表格全部记录（分页）
- `secureRandom(arr, count)` - Fisher-Yates 随机洗牌

### `backend/server.js`
- `/api/quiz` - 调用 generateQuiz 返回题目，答案随机分布到 A/B/C/D
- `/api/history/:user` - 按 test_id 分组返回历史考核

### `index.html`
- 4 页面：首页 / 出题 / 结果分析 / 历史
- `renderQuestion()` - 渲染题目（含冠词约束提示）
- `renderResults()` - 渲染结果页（含详细逐题分析）
- `toggleAnalysis()` - 展开/收起答案分析

## 设计规范
详见 `DESIGN.md`。

## 常见问题
1. **答案总是 A**：已修复，`secureRandom` 现在始终执行洗牌
2. **双下划线**：已修复，blank 用 `&nbsp;` 替代 `______`
3. **search timeout**：已修复，stats/history 改用 `getRecords` 替代 `searchRecords`
4. **环境变量缺失**：检查 `/workspace/projects/backend/.env`，或按 `.env.example` 模板配置