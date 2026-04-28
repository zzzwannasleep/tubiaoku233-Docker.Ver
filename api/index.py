from __future__ import annotations

import json
import math
import os
import re
import threading
from functools import wraps
from io import BytesIO
from pathlib import Path
from urllib.parse import quote, urlparse

from dotenv import load_dotenv
from flask import (
    Flask,
    Response,
    abort,
    has_request_context,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    url_for,
)
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.middleware.proxy_fix import ProxyFix

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

app = Flask(
    __name__,
    static_folder=os.path.join(os.path.dirname(__file__), "../static"),
    template_folder=os.path.join(os.path.dirname(__file__), "../templates"),
)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "1" if default else "0").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    raw = (os.getenv(name, "") or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


LIBRARY_TITLE = (os.getenv("LIBRARY_TITLE", "图标库") or "图标库").strip()
PUBLIC_BASE_URL = (os.getenv("PUBLIC_BASE_URL", "") or "").strip().rstrip("/")
RANDOM_BG_API = (os.getenv("RANDOM_BG_API", "") or "").strip()
COOKIE_SECURE = env_bool("COOKIE_SECURE", False)
ADMIN_ENABLED = env_bool("ADMIN_ENABLED", False)
ADMIN_PASSWORD = (os.getenv("ADMIN_PASSWORD", "") or "").strip()
ADMIN_COOKIE_MAX_AGE = env_int("ADMIN_COOKIE_MAX_AGE", 86400)
ADMIN_PAGE_SIZE = max(1, env_int("ADMIN_PAGE_SIZE", 24))
REMBG_ENABLED = env_bool("REMBG_ENABLED", True)
REMBG_MODEL = (os.getenv("REMBG_MODEL", "u2netp") or "u2netp").strip()

max_upload_mb = env_int("MAX_UPLOAD_MB", 20)
if max_upload_mb > 0:
    app.config["MAX_CONTENT_LENGTH"] = max_upload_mb * 1024 * 1024

data_dir_raw = (os.getenv("APP_DATA_DIR", "") or "").strip()
DATA_DIR = Path(data_dir_raw).expanduser().resolve() if data_dir_raw else (ROOT_DIR / "data").resolve()
IMAGE_ROOT = DATA_DIR / "images"
os.environ.setdefault("U2NET_HOME", str((DATA_DIR / ".u2net").resolve()))

CATEGORY_ORDER = ["default", "square", "circle", "transparent"]
UPLOAD_CATEGORY_ORDER = ["circle", "square", "transparent"]
AGGREGATE_JSON_FILE = "icons-all.json"
CATEGORY_CONFIG = {
    "default": {"json_file": "icons.json", "folder": "", "label": "默认"},
    "square": {"json_file": "icons-square.json", "folder": "square", "label": "方形"},
    "circle": {"json_file": "icons-circle.json", "folder": "circle", "label": "圆形"},
    "transparent": {"json_file": "icons-transparent.json", "folder": "transparent", "label": "透明"},
}
STORAGE_LOCK = threading.RLock()
REMBG_SESSION_LOCK = threading.RLock()
REMBG_SESSION = None
REMBG_SESSION_MODEL = None

app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev_secret_change_me")
serializer = URLSafeTimedSerializer(app.secret_key)


def normalize_category(raw: str | None) -> str:
    value = (raw or "").strip().lower()
    mapping = {
        "": "default",
        "default": "default",
        "root": "default",
        "main": "default",
        "square": "square",
        "rect": "square",
        "box": "square",
        "circle": "circle",
        "round": "circle",
        "transparent": "transparent",
        "alpha": "transparent",
    }
    return mapping.get(value, "default")


def category_config(category: str) -> dict:
    return CATEGORY_CONFIG[normalize_category(category)]


def empty_catalog() -> dict:
    return {"name": LIBRARY_TITLE, "description": "", "icons": []}


def catalog_path(category: str) -> Path:
    return DATA_DIR / category_config(category)["json_file"]


def image_dir(category: str) -> Path:
    folder = category_config(category)["folder"]
    return IMAGE_ROOT / folder if folder else IMAGE_ROOT


def safe_rel_path(raw: str | None) -> str:
    parts = []
    for part in Path((raw or "").replace("\\", "/")).parts:
        if part in {"", ".", ".."}:
            continue
        parts.append(part)
    return "/".join(parts)


def resolve_media_path(rel_path: str) -> Path:
    safe_path = safe_rel_path(rel_path)
    target = (IMAGE_ROOT / safe_path).resolve()
    root = IMAGE_ROOT.resolve()
    if target != root and root not in target.parents:
        raise ValueError("invalid media path")
    return target


def ensure_storage() -> None:
    with STORAGE_LOCK:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        IMAGE_ROOT.mkdir(parents=True, exist_ok=True)
        Path(os.environ["U2NET_HOME"]).mkdir(parents=True, exist_ok=True)
        for key in CATEGORY_ORDER:
            image_dir(key).mkdir(parents=True, exist_ok=True)
            path = catalog_path(key)
            if not path.exists():
                path.write_text(
                    json.dumps(empty_catalog(), ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )


def extract_path_from_url(url: str) -> str:
    if not url:
        return ""
    parsed = urlparse(url)
    path = parsed.path or url
    marker = "/media/"
    if marker in path:
        return path.split(marker, 1)[1].lstrip("/")
    if path.startswith("media/"):
        return path[len("media/") :]
    return ""


def normalize_icon_item(item: dict) -> dict | None:
    if not isinstance(item, dict):
        return None
    name = (str(item.get("name") or "").strip() or "icon")
    path = safe_rel_path(str(item.get("path") or "").strip())
    url = str(item.get("url") or "").strip()
    if not path and url:
        path = extract_path_from_url(url)
    if not path and not url:
        return None

    normalized = {"name": name}
    if path:
        normalized["path"] = path
    elif url:
        normalized["url"] = url
    return normalized


def read_catalog_unlocked(category: str) -> dict:
    ensure_storage()
    path = catalog_path(category)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        data = {}

    if not isinstance(data, dict):
        data = {}

    icons = []
    for item in data.get("icons") or []:
        normalized = normalize_icon_item(item)
        if normalized:
            icons.append(normalized)

    return {
        "name": str(data.get("name") or LIBRARY_TITLE),
        "description": str(data.get("description") or ""),
        "icons": icons,
    }


def read_catalog(category: str) -> dict:
    with STORAGE_LOCK:
        return read_catalog_unlocked(category)


def write_catalog_unlocked(category: str, content: dict) -> None:
    payload = {
        "name": str(content.get("name") or LIBRARY_TITLE),
        "description": str(content.get("description") or ""),
        "icons": [],
    }
    for item in content.get("icons") or []:
        normalized = normalize_icon_item(item)
        if not normalized:
            continue
        payload["icons"].append(normalized)

    catalog_path(category).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def build_media_url(rel_path: str) -> str:
    safe_path = safe_rel_path(rel_path)
    quoted_path = quote(safe_path, safe="/")
    if PUBLIC_BASE_URL:
        return f"{PUBLIC_BASE_URL}/media/{quoted_path}"
    if has_request_context():
        return request.url_root.rstrip("/") + url_for("serve_media", path=safe_path)
    return f"/media/{quoted_path}"


def catalog_for_response(category: str) -> dict:
    content = read_catalog(category)
    payload = {
        "name": content.get("name") or LIBRARY_TITLE,
        "description": content.get("description") or "",
        "icons": [],
    }
    for item in content.get("icons") or []:
        url = item.get("url") or (build_media_url(item.get("path", "")) if item.get("path") else "")
        if not url:
            continue
        payload["icons"].append({"name": item.get("name") or "icon", "url": url})
    return payload


def aggregate_catalog_for_response() -> dict:
    payload = {
        "name": LIBRARY_TITLE,
        "description": "",
        "icons": [],
    }

    for category in CATEGORY_ORDER:
        content = read_catalog(category)
        for item in content.get("icons") or []:
            url = item.get("url") or (build_media_url(item.get("path", "")) if item.get("path") else "")
            if not url:
                continue
            payload["icons"].append(
                {
                    "name": item.get("name") or "icon",
                    "url": url,
                    "category": category,
                }
            )

    return payload


def get_unique_name(name: str, content: dict) -> str:
    base_name = (name or "icon").strip() or "icon"
    icons = content.get("icons", [])
    if not any((item.get("name") or "") == base_name for item in icons):
        return base_name

    counter = 1
    while any((item.get("name") or "") == f"{base_name}{counter}" for item in icons):
        counter += 1
    return f"{base_name}{counter}"


def guess_image_ext(filename: str, mimetype: str) -> str:
    ext = Path(filename or "").suffix.lower()
    if re.fullmatch(r"\.[a-z0-9]{1,8}", ext or ""):
        return ext

    mt = (mimetype or "").lower()
    mapping = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
    }
    return mapping.get(mt, ".png")


def sanitize_filename_base(name: str) -> str:
    base = (name or "").strip()
    base = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", base)
    base = re.sub(r"\s+", "_", base)
    base = base.strip("._-")
    return base or "image"


def unique_media_rel_path_unlocked(base: str, ext: str, category: str) -> str:
    folder = category_config(category)["folder"]
    for index in range(1000):
        suffix = "" if index == 0 else str(index)
        filename = f"{base}{suffix}{ext}"
        rel_path = f"{folder}/{filename}" if folder else filename
        if not resolve_media_path(rel_path).exists():
            return rel_path
    raise Exception("文件重名过多，无法生成唯一文件名")


def save_local_upload(image, desired_name: str, category: str) -> dict:
    category = normalize_category(category)
    name = (desired_name or Path(getattr(image, "filename", "") or "").stem or "image").strip() or "image"
    ext = guess_image_ext(getattr(image, "filename", "") or "", getattr(image, "mimetype", "") or "")

    try:
        image.stream.seek(0)
    except Exception:
        pass
    raw_bytes = image.read()
    if not raw_bytes:
        raise Exception("空文件无法上传")

    with STORAGE_LOCK:
        content = read_catalog_unlocked(category)
        final_name = get_unique_name(name, content)
        rel_path = unique_media_rel_path_unlocked(sanitize_filename_base(final_name), ext, category)
        target = resolve_media_path(rel_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw_bytes)

        content.setdefault("icons", []).append({"name": final_name, "path": rel_path})
        write_catalog_unlocked(category, content)

    return {
        "name": final_name,
        "path": rel_path,
        "url": build_media_url(rel_path),
        "category": category,
    }


def category_from_path(rel_path: str) -> str:
    safe_path = safe_rel_path(rel_path)
    if not safe_path:
        return "default"
    first = safe_path.split("/", 1)[0].lower()
    if first in {"square", "circle", "transparent"}:
        return first
    return "default"


def list_admin_items(page: int, q: str | None) -> dict:
    page = max(1, page)
    keyword = (q or "").strip().lower()
    items = []
    counts = {}

    for category in CATEGORY_ORDER:
        content = read_catalog(category)
        counts[category] = len(content.get("icons") or [])

        for item in content.get("icons") or []:
            rel_path = item.get("path", "")
            url = item.get("url") or (build_media_url(rel_path) if rel_path else "")
            filename = Path(rel_path).name if rel_path else ""

            exists = False
            mtime = 0.0
            if rel_path:
                try:
                    target = resolve_media_path(rel_path)
                    exists = target.exists()
                    if exists:
                        mtime = target.stat().st_mtime
                except Exception:
                    exists = False

            haystack = " ".join(
                [
                    str(item.get("name") or ""),
                    rel_path,
                    filename,
                    category,
                    url,
                ]
            ).lower()
            if keyword and keyword not in haystack:
                continue

            items.append(
                {
                    "key": rel_path or f"legacy:{category}:{item.get('name', '')}:{url}",
                    "path": rel_path,
                    "url": url,
                    "category": category,
                    "category_label": category_config(category)["label"],
                    "icon_name": item.get("name") or "",
                    "filename": filename,
                    "exists": exists,
                    "_mtime": mtime,
                }
            )

    items.sort(key=lambda entry: (entry["_mtime"], entry["icon_name"]), reverse=True)

    total = len(items)
    last_page = max(1, math.ceil(total / ADMIN_PAGE_SIZE))
    page = min(page, last_page)
    start = (page - 1) * ADMIN_PAGE_SIZE
    page_items = items[start : start + ADMIN_PAGE_SIZE]

    for item in page_items:
        item.pop("_mtime", None)

    return {
        "page": page,
        "items": page_items,
        "pager": {
            "page": page,
            "per_page": ADMIN_PAGE_SIZE,
            "last_page": last_page,
            "total": total,
        },
        "catalog_stats": {
            "total": sum(counts.values()),
            "by_category": counts,
        },
    }


def delete_local_item(category: str, rel_path: str, url: str) -> dict:
    category = normalize_category(category or category_from_path(rel_path))
    rel_path = safe_rel_path(rel_path)
    url = (url or "").strip()

    with STORAGE_LOCK:
        content = read_catalog_unlocked(category)

        def matches(item: dict) -> bool:
            item_path = item.get("path", "")
            item_url = item.get("url", "")
            if rel_path and item_path == rel_path:
                return True
            if url and item_url == url:
                return True
            return False

        matched = [item for item in content.get("icons") or [] if matches(item)]
        if not matched:
            raise Exception("未找到对应记录")

        file_deleted = False
        if rel_path:
            target = resolve_media_path(rel_path)
            if target.exists():
                target.unlink()
                file_deleted = True

        content["icons"] = [item for item in content.get("icons") or [] if not matches(item)]
        write_catalog_unlocked(category, content)

    return {
        "removed": len(matched),
        "file_deleted": file_deleted,
        "category": category,
        "path": rel_path,
    }


def set_signed_cookie(response, key: str, payload: dict, max_age: int) -> None:
    response.set_cookie(
        key,
        serializer.dumps(payload),
        max_age=max_age,
        httponly=True,
        samesite="Lax",
        secure=COOKIE_SECURE,
    )


def check_signed_cookie(key: str, max_age: int) -> bool:
    raw = request.cookies.get(key, "")
    try:
        serializer.loads(raw, max_age=max_age)
        return True
    except (BadSignature, SignatureExpired):
        return False
    except Exception:
        return False


def require_admin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not ADMIN_ENABLED:
            return jsonify({"ok": False, "message": "管理后台未启用"}), 403
        if not check_signed_cookie("admin_auth", ADMIN_COOKIE_MAX_AGE):
            return jsonify({"ok": False, "message": "未登录或会话已过期"}), 401
        return fn(*args, **kwargs)

    return wrapper


# ===== AI cutout providers =====

def get_rembg_session():
    global REMBG_SESSION
    global REMBG_SESSION_MODEL

    if not REMBG_ENABLED:
        raise Exception("REMBG_ENABLED 已关闭")

    with REMBG_SESSION_LOCK:
        if REMBG_SESSION is not None and REMBG_SESSION_MODEL == REMBG_MODEL:
            return REMBG_SESSION

        try:
            from rembg import new_session
        except ImportError as exc:
            raise Exception("rembg 未安装，请先安装 requirements.txt 里的依赖") from exc

        REMBG_SESSION = new_session(model_name=REMBG_MODEL)
        REMBG_SESSION_MODEL = REMBG_MODEL
        return REMBG_SESSION


def call_rembg_remove_bg(image):
    if not REMBG_ENABLED:
        raise Exception("REMBG_ENABLED 已关闭")

    try:
        image.stream.seek(0)
    except Exception:
        pass
    raw_bytes = image.read()
    if not raw_bytes:
        raise Exception("缺少有效图片内容")

    try:
        from rembg import remove
    except ImportError as exc:
        raise Exception("rembg 未安装，请先安装 requirements.txt 里的依赖") from exc

    output = remove(raw_bytes, session=get_rembg_session())
    if isinstance(output, bytes):
        return output
    if hasattr(output, "save"):
        buffer = BytesIO()
        output.save(buffer, format="PNG")
        return buffer.getvalue()
    raise Exception("rembg 返回了无法识别的结果类型")


# ===== bootstrap =====

ensure_storage()


# ===== routes =====

@app.get("/healthz")
def healthz():
    return jsonify({"ok": True})


@app.get("/media/<path:path>")
def serve_media(path: str):
    try:
        safe_path = safe_rel_path(path)
        resolve_media_path(safe_path)
        return send_from_directory(IMAGE_ROOT, safe_path)
    except Exception:
        abort(404)


@app.get("/icons.json")
def icons_json():
    return Response(
        json.dumps(catalog_for_response("default"), ensure_ascii=False, indent=2),
        mimetype="application/json",
    )


@app.get("/icons-square.json")
def icons_square_json():
    return Response(
        json.dumps(catalog_for_response("square"), ensure_ascii=False, indent=2),
        mimetype="application/json",
    )


@app.get("/icons-circle.json")
def icons_circle_json():
    return Response(
        json.dumps(catalog_for_response("circle"), ensure_ascii=False, indent=2),
        mimetype="application/json",
    )


@app.get("/icons-transparent.json")
def icons_transparent_json():
    return Response(
        json.dumps(catalog_for_response("transparent"), ensure_ascii=False, indent=2),
        mimetype="application/json",
    )


@app.get(f"/{AGGREGATE_JSON_FILE}")
def icons_all_json():
    return Response(
        json.dumps(aggregate_catalog_for_response(), ensure_ascii=False, indent=2),
        mimetype="application/json",
    )


@app.get("/")
def home():
    categories = [
        {
            "key": key,
            "label": CATEGORY_CONFIG[key]["label"],
            "json_file": CATEGORY_CONFIG[key]["json_file"],
        }
        for key in UPLOAD_CATEGORY_ORDER
    ]
    return render_template(
        "index.html",
        bg_api=RANDOM_BG_API,
        categories=categories,
        admin_enabled=ADMIN_ENABLED,
        initial_category_label=categories[0]["label"] if categories else CATEGORY_CONFIG["default"]["label"],
        library_title=LIBRARY_TITLE,
    )


@app.get("/github")
def legacy_github_route():
    return redirect(url_for("home"))


@app.get("/editor")
def editor():
    return render_template(
        "editor.html",
        admin_enabled=ADMIN_ENABLED,
        bg_api=RANDOM_BG_API,
        library_title=LIBRARY_TITLE,
    )


@app.get("/manage")
def manage_page():
    if not ADMIN_ENABLED:
        return "Admin disabled", 403
    return render_template(
        "manage.html",
        bg_api=RANDOM_BG_API,
        library_title=LIBRARY_TITLE,
        icons_json=url_for("icons_json"),
    )


@app.post("/api/admin/login")
def api_admin_login():
    if not ADMIN_ENABLED:
        return jsonify({"ok": False, "message": "管理后台未启用"}), 403

    data = request.get_json(silent=True) or {}
    password = (data.get("password") or "").strip()
    if not ADMIN_PASSWORD:
        return jsonify({"ok": False, "message": "ADMIN_PASSWORD 未配置"}), 500
    if password != ADMIN_PASSWORD:
        return jsonify({"ok": False, "message": "密码错误"}), 403

    response = jsonify({"ok": True})
    set_signed_cookie(response, "admin_auth", {"admin": 1}, ADMIN_COOKIE_MAX_AGE)
    return response


@app.post("/api/admin/logout")
@require_admin
def api_admin_logout():
    response = jsonify({"ok": True})
    response.delete_cookie("admin_auth")
    return response


@app.get("/api/admin/images")
@require_admin
def api_admin_images():
    try:
        page = int(request.args.get("page", "1"))
    except ValueError:
        page = 1
    query = (request.args.get("q") or "").strip()

    payload = list_admin_items(page=page, q=query)
    return jsonify(
        {
            "ok": True,
            "items": payload["items"],
            "pager": payload["pager"],
            "catalog_stats": payload["catalog_stats"],
            "raw_icons_json": url_for("icons_json", _external=True),
        }
    )


@app.post("/api/admin/delete")
@require_admin
def api_admin_delete():
    data = request.get_json(silent=True) or {}
    items = data.get("items") or []
    if not isinstance(items, list) or not items:
        return jsonify({"ok": False, "message": "items 不能为空"}), 400

    results = []
    removed_total = 0
    deleted_files = 0

    for item in items:
        rel_path = safe_rel_path(item.get("path") or item.get("key") or "")
        category = normalize_category(item.get("category") or category_from_path(rel_path))
        url = (item.get("url") or "").strip()

        try:
            result = delete_local_item(category=category, rel_path=rel_path, url=url)
            removed_total += result["removed"]
            deleted_files += 1 if result["file_deleted"] else 0
            results.append({"ok": True, **result})
        except Exception as exc:
            results.append(
                {
                    "ok": False,
                    "category": category,
                    "path": rel_path,
                    "error": str(exc),
                }
            )

    return jsonify(
        {
            "ok": True,
            "results": results,
            "summary": {
                "removed": removed_total,
                "deleted_files": deleted_files,
            },
        }
    )


@app.post("/api/upload")
def upload_image():
    try:
        images = request.files.getlist("source")
        if not images:
            return jsonify({"error": "缺少图片"}), 400

        category = normalize_category(
            request.form.get("category") or request.form.get("github_folder") or "default"
        )
        manual_name = (request.form.get("name") or "").strip()

        results = []
        for image in images:
            if not image or not getattr(image, "filename", ""):
                continue

            auto_name = Path(image.filename).stem or "image"
            desired_name = manual_name if len(images) == 1 and manual_name else auto_name

            try:
                saved = save_local_upload(image, desired_name, category)
                results.append(
                    {
                        "ok": True,
                        "name": saved["name"],
                        "url": saved["url"],
                        "category": saved["category"],
                    }
                )
            except Exception as exc:
                results.append(
                    {
                        "ok": False,
                        "name": desired_name,
                        "error": str(exc),
                        "category": category,
                    }
                )

        if not results:
            return jsonify({"error": "没有处理任何文件"}), 400

        if len(results) == 1 and len(images) == 1:
            first = results[0]
            if first.get("ok"):
                return jsonify(
                    {
                        "success": True,
                        "name": first["name"],
                        "url": first["url"],
                        "category": first["category"],
                    }
                )
            return jsonify({"error": first.get("error") or "上传失败"}), 400

        return jsonify({"success": True, "results": results}), 200
    except Exception as exc:
        return jsonify({"error": "服务器内部错误", "details": str(exc)}), 500


@app.post("/api/finalize_batch")
def api_finalize_batch():
    return jsonify({"success": True, "message": "批量上传已直接在 /api/upload 中处理"}), 200


@app.post("/api/ai_cutout")
def api_ai_cutout_default():
    try:
        image = request.files.get("image")
        if not image:
            return jsonify({"error": "缺少图片"}), 400
        return Response(call_rembg_remove_bg(image), mimetype="image/png")
    except Exception as exc:
        return jsonify({"error": "AI 抠图失败", "details": str(exc)}), 500


if __name__ == "__main__":
    app.run(
        host=(os.getenv("HOST", "0.0.0.0") or "0.0.0.0").strip(),
        port=env_int("PORT", 8000),
        debug=env_bool("FLASK_DEBUG", False),
    )
