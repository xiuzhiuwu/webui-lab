import hashlib
import json
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Literal

from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.staticfiles import StaticFiles
from google.auth import exceptions as google_auth_exceptions
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel, Field

app = FastAPI()

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
PROJECT_ROOT = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.getenv("DATABASE_PATH", PROJECT_ROOT / "studyflow.db"))
SESSION_COOKIE_NAME = "studyflow_session"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").strip().lower() in {
    "1",
    "true",
    "yes",
}


class GoogleAuthSchema(BaseModel):
    token: str = Field(min_length=1, max_length=8192)


class SubtaskSchema(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    title: str = Field(min_length=1, max_length=300)
    completed: bool = False


class TaskCreateSchema(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    category: Literal["Study", "Work", "Life"] = "Study"
    estimated_pomodoros: int = Field(default=1, ge=1, le=100)
    subtasks: list[SubtaskSchema] = Field(default_factory=list, max_length=100)
    completed: bool = False


class TaskCompletionSchema(BaseModel):
    completed: bool


class TaskImportSchema(BaseModel):
    tasks: list[TaskCreateSchema] = Field(max_length=1000)


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


@app.on_event("startup")
def initialize_database() -> None:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                google_id TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                name TEXT,
                picture TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS login_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                expires_at INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                category TEXT NOT NULL,
                estimated_pomodoros INTEGER NOT NULL,
                subtasks_json TEXT NOT NULL DEFAULT '[]',
                completed INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        task_columns = {
            column["name"]
            for column in connection.execute("PRAGMA table_info(tasks)").fetchall()
        }
        if "subtasks_json" not in task_columns:
            connection.execute(
                "ALTER TABLE tasks ADD COLUMN subtasks_json TEXT NOT NULL DEFAULT '[]'"
            )
        if "completed" not in task_columns:
            connection.execute(
                "ALTER TABLE tasks ADD COLUMN completed INTEGER NOT NULL DEFAULT 0"
            )


def get_authenticated_user(request: Request) -> sqlite3.Row:
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="尚未登入",
        )

    token_hash = hashlib.sha256(session_token.encode("utf-8")).hexdigest()
    with get_connection() as connection:
        user = connection.execute(
            """
            SELECT users.id, users.email, users.name, users.picture
            FROM login_sessions
            JOIN users ON users.id = login_sessions.user_id
            WHERE login_sessions.token_hash = ? AND login_sessions.expires_at > ?
            """,
            (token_hash, int(time.time())),
        ).fetchone()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登入已失效，請重新登入",
        )
    return user


def task_to_dict(task: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": task["id"],
        "title": task["title"],
        "category": task["category"],
        "estimatedPomodoros": task["estimated_pomodoros"],
        "subtasks": json.loads(task["subtasks_json"]),
        "completed": bool(task["completed"]),
        "status": "done" if task["completed"] else "todo",
    }


def normalize_subtasks(subtasks: list[SubtaskSchema]) -> list[dict[str, Any]]:
    normalized = []
    for subtask in subtasks:
        title = subtask.title.strip()
        if not title:
            continue
        normalized.append(
            {
                "id": secrets.token_urlsafe(12),
                "title": title,
                "completed": subtask.completed,
            }
        )
    return normalized


@app.get("/api/auth/config")
async def google_auth_config() -> dict[str, Any]:
    return {
        "configured": bool(GOOGLE_CLIENT_ID),
        "client_id": GOOGLE_CLIENT_ID,
    }


@app.post("/api/auth/google")
async def google_login(payload: GoogleAuthSchema, response: Response) -> dict[str, Any]:
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="伺服器尚未設定 GOOGLE_CLIENT_ID",
        )

    try:
        id_info = id_token.verify_oauth2_token(
            payload.token,
            google_requests.Request(),
            audience=GOOGLE_CLIENT_ID,
        )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google 登入憑證無效或已過期",
        ) from None
    except google_auth_exceptions.TransportError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="目前無法驗證 Google 登入憑證，請稍後再試",
        ) from None

    google_id = id_info.get("sub")
    email = id_info.get("email")
    if not google_id or not email or id_info.get("email_verified") is not True:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google 帳戶缺少已驗證的電子郵件",
        )

    name = id_info.get("name") or email
    picture = id_info.get("picture")
    try:
        with get_connection() as connection:
            connection.execute(
                """
                INSERT INTO users (google_id, email, name, picture)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(google_id) DO UPDATE SET
                    email = excluded.email,
                    name = excluded.name,
                    picture = excluded.picture
                """,
                (google_id, email, name, picture),
            )
            user = connection.execute(
                "SELECT id, email, name, picture FROM users WHERE google_id = ?",
                (google_id,),
            ).fetchone()
            if user is None:
                raise RuntimeError("Google user was not persisted")

            now = int(time.time())
            connection.execute(
                "DELETE FROM login_sessions WHERE expires_at <= ?",
                (now,),
            )
            session_token = secrets.token_urlsafe(32)
            connection.execute(
                """
                INSERT INTO login_sessions (token_hash, user_id, expires_at)
                VALUES (?, ?, ?)
                """,
                (
                    hashlib.sha256(session_token.encode("utf-8")).hexdigest(),
                    user["id"],
                    now + SESSION_MAX_AGE_SECONDS,
                ),
            )
    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="此電子郵件已連結至另一個 Google 帳戶",
        ) from None

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_token,
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )
    return {
        "status": "success",
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "picture": user["picture"],
        },
    }


@app.get("/api/auth/me")
async def current_user(request: Request) -> dict[str, Any]:
    user = get_authenticated_user(request)
    return {
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "picture": user["picture"],
        }
    }


@app.get("/api/tasks")
async def list_tasks(request: Request) -> dict[str, list[dict[str, Any]]]:
    user = get_authenticated_user(request)
    with get_connection() as connection:
        tasks = connection.execute(
            """
            SELECT id, title, category, estimated_pomodoros, subtasks_json, completed
            FROM tasks
            WHERE user_id = ?
            ORDER BY created_at DESC, rowid DESC
            """,
            (user["id"],),
        ).fetchall()
    return {"tasks": [task_to_dict(task) for task in tasks]}


@app.post("/api/tasks", status_code=status.HTTP_201_CREATED)
async def create_task(
    payload: TaskCreateSchema,
    request: Request,
) -> dict[str, Any]:
    user = get_authenticated_user(request)
    title = payload.title.strip()
    if not title:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="任務名稱不可空白",
        )

    task_id = secrets.token_urlsafe(12)
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO tasks (
                id, user_id, title, category, estimated_pomodoros, subtasks_json, completed
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                user["id"],
                title,
                payload.category,
                payload.estimated_pomodoros,
                json.dumps(normalize_subtasks(payload.subtasks), ensure_ascii=False),
                int(payload.completed),
            ),
        )
        task = connection.execute(
            """
            SELECT id, title, category, estimated_pomodoros, subtasks_json, completed
            FROM tasks
            WHERE id = ? AND user_id = ?
            """,
            (task_id, user["id"]),
        ).fetchone()
    return {"task": task_to_dict(task)}


@app.put("/api/tasks/{task_id}")
async def update_task(
    task_id: str,
    payload: TaskCreateSchema,
    request: Request,
) -> dict[str, Any]:
    user = get_authenticated_user(request)
    title = payload.title.strip()
    if not title:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="任務名稱不可空白",
        )

    with get_connection() as connection:
        result = connection.execute(
            """
            UPDATE tasks
            SET title = ?, category = ?, estimated_pomodoros = ?, subtasks_json = ?
            WHERE id = ? AND user_id = ?
            """,
            (
                title,
                payload.category,
                payload.estimated_pomodoros,
                json.dumps(normalize_subtasks(payload.subtasks), ensure_ascii=False),
                task_id,
                user["id"],
            ),
        )
        if result.rowcount == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到此任務",
            )
        task = connection.execute(
            """
            SELECT id, title, category, estimated_pomodoros, subtasks_json, completed
            FROM tasks
            WHERE id = ? AND user_id = ?
            """,
            (task_id, user["id"]),
        ).fetchone()
    return {"task": task_to_dict(task)}


@app.post("/api/tasks/import")
async def import_tasks(
    payload: TaskImportSchema,
    request: Request,
) -> dict[str, int]:
    user = get_authenticated_user(request)
    imported_count = 0
    with get_connection() as connection:
        existing_count = connection.execute(
            "SELECT COUNT(*) FROM tasks WHERE user_id = ?",
            (user["id"],),
        ).fetchone()[0]
        if existing_count:
            return {"imported": 0}

        for task in payload.tasks:
            title = task.title.strip()
            if not title:
                continue
            connection.execute(
                """
                INSERT INTO tasks (
                    id, user_id, title, category, estimated_pomodoros, subtasks_json, completed
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    secrets.token_urlsafe(12),
                    user["id"],
                    title,
                    task.category,
                    task.estimated_pomodoros,
                    json.dumps(normalize_subtasks(task.subtasks), ensure_ascii=False),
                    int(task.completed),
                ),
            )
            imported_count += 1
    return {"imported": imported_count}


@app.patch("/api/tasks/{task_id}/subtasks/{subtask_id}")
async def toggle_subtask(
    task_id: str,
    subtask_id: str,
    request: Request,
) -> dict[str, Any]:
    user = get_authenticated_user(request)
    with get_connection() as connection:
        task = connection.execute(
            """
            SELECT id, title, category, estimated_pomodoros, subtasks_json, completed
            FROM tasks
            WHERE id = ? AND user_id = ?
            """,
            (task_id, user["id"]),
        ).fetchone()
        if task is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到此任務",
            )

        subtasks = json.loads(task["subtasks_json"])
        subtask = next((item for item in subtasks if item["id"] == subtask_id), None)
        if subtask is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到此子任務",
            )
        subtask["completed"] = not subtask["completed"]
        connection.execute(
            "UPDATE tasks SET subtasks_json = ? WHERE id = ? AND user_id = ?",
            (json.dumps(subtasks, ensure_ascii=False), task_id, user["id"]),
        )
        updated_task = dict(task)
        updated_task["subtasks_json"] = json.dumps(subtasks, ensure_ascii=False)
    return {"task": task_to_dict(updated_task)}


@app.patch("/api/tasks/{task_id}/completion")
async def set_task_completion(
    task_id: str,
    payload: TaskCompletionSchema,
    request: Request,
) -> dict[str, Any]:
    user = get_authenticated_user(request)
    with get_connection() as connection:
        result = connection.execute(
            "UPDATE tasks SET completed = ? WHERE id = ? AND user_id = ?",
            (int(payload.completed), task_id, user["id"]),
        )
        if result.rowcount == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到此任務",
            )
        task = connection.execute(
            """
            SELECT id, title, category, estimated_pomodoros, subtasks_json, completed
            FROM tasks
            WHERE id = ? AND user_id = ?
            """,
            (task_id, user["id"]),
        ).fetchone()
    return {"task": task_to_dict(task)}


@app.delete("/api/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: str, request: Request) -> Response:
    user = get_authenticated_user(request)
    with get_connection() as connection:
        result = connection.execute(
            "DELETE FROM tasks WHERE id = ? AND user_id = ?",
            (task_id, user["id"]),
        )
    if result.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="找不到此任務",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/api/auth/logout")
async def logout(request: Request, response: Response) -> dict[str, str]:
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    if session_token:
        token_hash = hashlib.sha256(session_token.encode("utf-8")).hexdigest()
        with get_connection() as connection:
            connection.execute(
                "DELETE FROM login_sessions WHERE token_hash = ?",
                (token_hash,),
            )

    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )
    return {"status": "success"}


app.mount("/css", StaticFiles(directory=PROJECT_ROOT / "client" / "css"), name="css")
app.mount("/js", StaticFiles(directory=PROJECT_ROOT / "client" / "js"), name="js")
app.mount(
    "/",
    StaticFiles(directory=PROJECT_ROOT / "client" / "html", html=True),
    name="html",
)
