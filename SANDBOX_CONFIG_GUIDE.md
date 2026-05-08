# Trae IDE 沙箱配置指南

## 问题说明

当前使用 Trae IDE 运行 Expo 开发服务器时遇到了沙箱权限限制，导致无法访问系统的 `.expo` 缓存目录。

错误信息：
```
Error: EPERM: operation not permitted, open 'C:\Users\NewAdmin\.expo\native-modules-cache\tmp\...'
TRAE Sandbox Error: hit restricted
Not allow operate files: C:\Users\NewAdmin\.expo\native-modules-cache\tmp\...
Hint: You can configure sandbox rules via Settings -> Conversation -> Custom Sandbox Configuration.
```

## 解决方案

按照以下步骤配置沙箱权限：

### 步骤 1: 打开 Trae 设置

1. 在 Trae IDE 中，点击左下角的 **设置图标** 或使用快捷键 `Ctrl+,`
2. 在搜索框中输入 "sandbox" 或 "沙箱"

### 步骤 2: 找到沙箱配置

1. 在设置菜单中，导航到：
   - **Conversation** (对话)
   - **Custom Sandbox Configuration** (自定义沙箱配置)

### 步骤 3: 添加允许的路径

在沙箱配置中添加以下路径：

```
C:\Users\NewAdmin\.expo\**  
C:\Users\NewAdmin\AppData\Local\expo\**
```

或者更广泛地允许访问 AppData 目录：

```
C:\Users\NewAdmin\AppData\Local\**
```

### 步骤 4: 保存并重启

1. 点击 **保存** 或 **应用**
2. **重启 Trae IDE** 或重启当前终端会话
3. 重新运行 `npm start` 或 `npx expo start`

## 验证配置

配置完成后，运行以下命令验证：

```bash
cd d:\Personal\XY\word_bot\word_bot\WordBot
npm start
```

应该能看到 Expo 开发服务器成功启动：

```
Starting Metro Bundler
› Metro waiting on http://localhost:8081
› Scan the QR code above with Expo Go (Android) or the Camera app (iOS)
```

## 替代方案

如果沙箱配置无法解决问题，可以尝试：

### 方案 A: 使用外部终端

1. 打开 Windows Terminal 或 PowerShell（不在 Trae 沙箱中）
2. 手动运行 Expo 命令
3. 在 Trae 中查看日志和输出

### 方案 B: 直接构建 APK

```bash
cd d:\Personal\XY\word_bot\word_bot\WordBot
npx expo run:android
```

### 方案 C: 使用 EAS Build

```bash
cd d:\Personal\XY\word_bot\word_bot\WordBot
npx eas login
npx eas build -p android --profile preview
```

## 后端服务状态

后端服务已确认正常运行：

- **状态**: ✅ 运行中
- **端口**: 3000
- **API端点**: 
  - `GET http://localhost:3000/api/stats/yusi`
  - `POST http://localhost:3000/api/quiz`
  - `POST http://localhost:3000/api/submit`

## 测试命令

### 测试后端API

```powershell
# 获取用户统计
curl http://localhost:3000/api/stats/yusi

# 生成测试题目（需要POST）
curl -Method POST -Uri http://localhost:3000/api/quiz -Body (@{user="yusi"} | ConvertTo-Json) -ContentType "application/json"
```

### 启动前端开发服务器（配置完成后）

```powershell
cd d:\Personal\XY\word_bot\word_bot\WordBot
npm start
```

## 遇到问题？

如果配置后仍然遇到问题，请检查：

1. 路径是否正确（注意用户名前的 `C:\Users\NewAdmin`）
2. 是否使用了通配符 `**`
3. 是否保存了配置
4. 是否重启了 IDE 或终端

## 参考资源

- [Expo 官方文档](https://docs.expo.dev/)
- [React Native 开发指南](https://reactnative.dev/docs/environment-setup)
- [Trae IDE 沙箱配置文档](https://trae.ai/docs/sandbox)
