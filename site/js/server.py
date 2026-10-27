from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

app = FastAPI()

# 關鍵：html=True 讓它自動找 index.html
app.mount("/", StaticFiles(directory="site", html=True), name="site")