"""
JWT 기반 인증 모듈
"""
import json
import hashlib
import time
import base64
import os

SECRET_KEY = os.environ.get("JWT_SECRET", "ccatfarm-secret-key-2024")
TOKEN_EXPIRE_HOURS = 24


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64decode(data: str) -> bytes:
    padding = 4 - len(data) % 4
    if padding != 4:
        data += "=" * padding
    return base64.urlsafe_b64decode(data)


def create_token(user_id: int, username: str) -> str:
    """간단한 JWT 생성 (HS256)"""
    header = _b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload_data = {
        "user_id": user_id,
        "username": username,
        "exp": int(time.time()) + TOKEN_EXPIRE_HOURS * 3600,
    }
    payload = _b64encode(json.dumps(payload_data).encode())
    signature_input = f"{header}.{payload}"
    signature = _b64encode(
        hashlib.sha256(f"{signature_input}{SECRET_KEY}".encode()).digest()
    )
    return f"{header}.{payload}.{signature}"


def verify_token(token: str) -> dict | None:
    """토큰 검증 → payload 반환 또는 None"""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        header, payload, signature = parts
        # 서명 검증
        expected_sig = _b64encode(
            hashlib.sha256(f"{header}.{payload}{SECRET_KEY}".encode()).digest()
        )
        if signature != expected_sig:
            return None
        # 만료 확인
        payload_data = json.loads(_b64decode(payload))
        if payload_data.get("exp", 0) < time.time():
            return None
        return payload_data
    except Exception:
        return None
