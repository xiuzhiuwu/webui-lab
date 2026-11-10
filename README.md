# WebUI Lab

Web Programming課程實作專案。

## 學號
s115321012

## Google 登入設定

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 建立 OAuth 2.0「網頁應用程式」用戶端 ID，並將本機網址（例如 `http://localhost:8000`）加入「已授權的 JavaScript 來源」。
2. 安裝 Python 套件：

   ```powershell
   python -m pip install -r requirements.txt
   ```

3. 在 PowerShell 設定 OAuth 用戶端 ID 並啟動伺服器：

   ```powershell
   $env:GOOGLE_CLIENT_ID = "你的用戶端 ID.apps.googleusercontent.com"
   python -m uvicorn server:app --reload
   ```

4. 開啟 `http://localhost:8000`，使用 Google 帳戶登入。使用 HTTPS 部署時，請設定 `COOKIE_SECURE=true`；資料庫預設建立於專案目錄的 `studyflow.db`，可用 `DATABASE_PATH` 指定其他位置。

登入後端會驗證 Google ID token、建立或更新 SQLite 使用者資料，並以七天有效期的 HttpOnly cookie 維持登入。登出會撤銷該工作階段。任務、完成狀態及子任務會存入 SQLite，並以登入使用者 ID 隔離；任務資料可跨瀏覽器工作階段讀取。任務清單可切換查看待辦與已完成任務，完成狀態可重新開啟。舊版瀏覽器儲存的任務（含子任務與完成狀態）只會在首次登入時匯入一次。目前不會記錄專注時數或產生統計數據；數據分析頁會顯示尚未啟用的提示。
