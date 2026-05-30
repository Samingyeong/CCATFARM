"""
SQLite 데이터베이스 설정 및 사용자 모델
"""
import sqlite3
import hashlib
import os
from pathlib import Path

DB_PATH = Path(__file__).parent / "ccatfarm.db"


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """테이블 생성"""
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()


def hash_password(password: str) -> str:
    salt = os.environ.get("PASSWORD_SALT", "ccatfarm2024")
    return hashlib.sha256(f"{password}{salt}".encode()).hexdigest()


def create_user(username: str, password: str, name: str = "") -> dict | None:
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, name) VALUES (?, ?, ?)",
            (username, hash_password(password), name)
        )
        conn.commit()
        user = conn.execute(
            "SELECT id, username, name FROM users WHERE username = ?",
            (username,)
        ).fetchone()
        return dict(user) if user else None
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()


def verify_user(username: str, password: str) -> dict | None:
    conn = get_db()
    user = conn.execute(
        "SELECT id, username, name, password_hash FROM users WHERE username = ?",
        (username,)
    ).fetchone()
    conn.close()
    if not user:
        return None
    if user["password_hash"] != hash_password(password):
        return None
    return {"id": user["id"], "username": user["username"], "name": user["name"]}


# 앱 시작 시 DB 초기화
init_db()
