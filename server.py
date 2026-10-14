from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

app = FastAPI()

# 1. 掛載 CSS 與 JS 靜態資源資料夾
app.mount("/css", StaticFiles(directory="webui-lab-main/site/css"), name="css")
app.mount("/js", StaticFiles(directory="webui-lab-main/site/js"), name="js")

# 2. 掛載 html 資料夾至根目錄，html=True 會自動提供 index.html
app.mount("/", StaticFiles(directory="webui-lab-main/site/html", html=True), name="site")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=7777, reload=True)