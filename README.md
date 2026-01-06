# 🎓 講師工作坊管理系統 v2.0

Firebase 即時同步版本 - LINE Bot + 網頁版資料同步

## ✨ 新功能

- 🔥 **Firebase Firestore** 雲端資料庫
- 🔄 **即時同步** LINE Bot 和網頁版使用同一份資料
- 💾 **永久保存** 資料不會因重啟消失
- 👥 **多人協作** 支援多管理員

## 🚀 部署步驟

### Step 1: 更新 GitHub

```bash
# 替換所有檔案後
git add .
git commit -m "Upgrade to Firebase version"
git push
```

### Step 2: 設定 Render 環境變數

在 Render Dashboard → Environment 加入：

| Key | Value |
|-----|-------|
| `FIREBASE_SERVICE_ACCOUNT` | 整個 JSON 字串（見下方說明）|

### 如何設定 FIREBASE_SERVICE_ACCOUNT

1. 把你的 Firebase JSON 金鑰壓成一行
2. 貼到 Render 環境變數

**範例格式：**
```
{"type":"service_account","project_id":"workshop-manager-dd50f","private_key_id":"xxx","private_key":"-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n","client_email":"firebase-adminsdk@...","client_id":"..."}
```

## 📱 LINE Bot 指令

| 指令 | 說明 |
|------|------|
| `總覽` | 查看統計（Firebase 即時數據）|
| `活動列表` | 查看所有活動 |
| `最新報名` | 查看報名資料 |
| `生成文宣` | AI 生成宣傳文案 |
| `db` | 檢查資料庫連線狀態 |

## 🔧 API 端點

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/api/events` | 取得所有活動 |
| POST | `/api/events` | 新增活動 |
| GET | `/api/registrations` | 取得報名 |
| POST | `/api/registrations` | 新增報名 |
| GET | `/api/status` | 資料庫狀態 |

## 📁 專案結構

```
workshop-bot-firebase/
├── server.js          # 主程式（含 Firebase）
├── package.json       # 依賴套件
├── public/
│   └── index.html     # 網頁前端
└── .env.example       # 環境變數範本
```
