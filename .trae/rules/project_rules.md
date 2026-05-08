# Project Rules

## Allow Expo Cache Access

This project requires access to Expo's native modules cache for running React Native development server.

### Required Permissions
- Allow read/write access to: `C:\Users\NewAdmin\.expo\**`
- Allow read/write access to: `C:\Users\NewAdmin\AppData\Local\expo\**`

### Commands
- `npm start` - Start Expo development server
- `npm run build:android` - Build Android APK
- `npx expo start` - Start Expo Metro bundler

## API Configuration
- Backend API URL: `http://localhost:3000`
- Required endpoints:
  - `GET /api/stats/:user` - Get user statistics
  - `POST /api/quiz` - Generate quiz questions
  - `POST /api/submit` - Submit quiz answers
