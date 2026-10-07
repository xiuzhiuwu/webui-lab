from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

app = FastAPI()

# 將 directory 改為 "client/html" 或 "client"
app.mount("/", StaticFiles(directory="client/html", html=True), name="client")