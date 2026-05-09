# WordBot 单词考核系统 PRD

## 1. 产品概述

WordBot 是一个基于飞书多维表格的英语单词学习与考核系统，通过 AI 自动生成干扰词和释义，帮助用户高效记忆单词。

## 2. 数据结构

### 2.1 单词表 (WORD_TABLE)

| 字段 | 类型 | 说明 |
|------|------|------|
| Word | 文本 | 英文单词 |
| Meaning | 文本 | 英文释义（多个用分号分隔） |
| CN_Meaning | 文本 | 中文释义 |
| POS | 文本 | 词性 |
| Distractors | 文本 | 干扰词（逗号分隔） |
| Context | 文本 | 例句 |
| Status | 文本 | 状态（Pending/Mastered） |
| record_time | 数字 | 录入时间 |
| Error_Count | 数字 | 错误次数 |
| user | 文本 | 用户标识 |

### 2.2 考核记录表 (TEST_TABLE)

| 字段 | 类型 | 说明 |
|------|------|------|
| test_id | 文本 | 测试批次ID |
| user | 文本 | 用户标识 |
| word | 文本 | 单词 |
| question_type | 数字 | 题型（1/2/3） |
| correct_answer | 文本 | 正确答案 |
| test_time | 数字 | 测试时间 |

## 3. 题型设计

### 3.1 三种题型

| 题型 | 说明 | 题干来源 | 选项 |
|------|------|----------|------|
| type 1（语境填空） | 给出例句，挖空目标单词 | Context（例句） | 4个英文单词 |
| type 2（英英释义） | 给出英文释义，选择正确单词 | Meaning（英文释义） | 4个英文单词 |
| type 3（中英释义） | 给出中文释义，选择正确单词 | CN_Meaning（中文释义） | 4个英文单词 |

### 3.2 出题比例

- **type 1**：60%（最多6道）
- **type 2**：20%（最多2道）
- **type 3**：20%（最多2道）

### 3.3 题型选取规则

1. **前置条件**：单词必须同时满足
   - 有 Meaning
   - 有至少3个干扰项

2. **分类选取**：
   - 从有 CN_Meaning 的单词中选取 → type 3
   - 从有 Context 的单词中选取 → type 1
   - 其余有 Meaning 的单词 → type 2

3. **补足机制**：
   - 如果某类型数量不足，从剩余单词补 type1 或 type2
   - 不补 type3（保持比例）

### 3.4 单词状态更新规则

| 场景 | 条件 | 结果 |
|------|------|------|
| 同一单词多次考核 | 全部答对（correct >= total） | 更新为 Mastered |
| 同一单词多次考核 | 任何一次答错 | 保持 Pending |
| 新录入单词 | 初始状态 | Pending |

**说明**：
- 同一单词可能在一次测试中多次出现（不同题型）
- 只有该单词所有题目都答对，才标记为 Mastered
- 有任何一次答错，Error_Count +1，保持 Pending

## 4. 核心功能

### 4.1 单词录入 (addWords)

**流程**：
1. 获取单词英文释义（Dictionary API）
2. 生成3个干扰词（MiniMax API）
3. 生成例句（MiniMax API）
4. 翻译中文释义（MiniMax API）
5. 写入飞书表格

**fallback 机制**：
- 干扰词生成失败 → 从现有词库随机选取
- 例句生成失败 → 使用 API 返回的例句
- 中文翻译失败 → 留空，后续批量补充

### 4.2 题目生成 (generateQuiz)

**输入**：userId

**输出**：10道题目

**流程**：
1. 获取用户 Pending 状态的单词
2. 构建词库池
3. 按规则选取单词和题型
4. 生成题目和选项
5. 记录测试到 TEST_TABLE

**type 1 特殊处理**：
- 例句挖空使用正则替换
- 处理复数形式（如 opportunity → opportunities）
- 无 Context 不出 type 1

**type 2 特殊处理**：
- 使用完整 Meaning（不分隔）
- 无 Meaning 不出 type 2

**type 3 特殊处理**：
- 使用完整 CN_Meaning
- 无 CN_Meaning 不出 type 3

### 4.3 答案提交 (submitAnswers)

**输入**：userId, testId, answers[]

**流程**：
1. 查询 TEST_TABLE 中的正确答案
2. 比对用户答案
3. 更新单词状态：
   - 答对 → 保持 Pending（或 Mastered）
   - 答错 → Error_Count + 1
4. 更新统计数据

### 4.4 批量翻译 (translate_cn.js)

**功能**：为已有单词补充 CN_Meaning

**流程**：
1. 读取所有单词记录
2. 跳过已有 CN_Meaning 的单词
3. 调用 MiniMax API 翻译 Meaning
4. 更新 CN_Meaning 字段

### 4.5 例句补充 (fill_context_*.js)

**功能**：为已有单词补充 Context

**流程**：
1. 读取目标记录
2. 调用 MiniMax API 生成例句
3. 更新 Context 字段

## 5. 技术架构

### 5.1 技术栈

- **后端**：Node.js + Express
- **数据库**：飞书多维表格 API
- **AI 服务**：MiniMax API
- **词典 API**：Free Dictionary API
- **翻译 API**：MyMemory API（fallback）

### 5.2 环境变量

| 变量 | 说明 |
|------|------|
| FEISHU_APP_ID | 飞书应用 ID |
| FEISHU_APP_SECRET | 飞书应用密钥 |
| MINIMAX_API_KEY | MiniMax API 密钥 |

### 5.3 部署

- **平台**：Render
- **触发**：Git push 自动部署
- **环境变量**：Render Dashboard 配置

## 6. 用户流程

```
1. 单词录入 → addWords(wordList)
                      ↓
2. AI 生成 → 干扰词 + 例句 + 中文释义
                      ↓
3. 存入飞书 → WORD_TABLE
                      ↓
4. 开始考核 → generateQuiz(userId)
                      ↓
5. 随机出题 → 10道题（按比例）
                      ↓
6. 提交答案 → submitAnswers()
                      ↓
7. 更新状态 → 答对 Mastered
```

## 7. 优化建议

1. **例句质量**：当前 AI 生成的例句可能不完美，可考虑接入更多例句源
2. **干扰词优化**：可加入词性匹配，提升干扰词相关性
3. **记忆曲线**：根据 Error_Count 调整复习频率
4. **多义词处理**：Meaning 中的分号分隔多个释义，需要多选题型支持

## 8. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2024 | 基础功能：单词录入、考核、出题 |
| v1.1 | 2024 | 新增 type3（中英释义）题型 |
| v1.2 | 2024 | AI 生成干扰词、例句、中文释义 |
| v1.3 | 2024 | 优化出题比例和题型选取逻辑 |