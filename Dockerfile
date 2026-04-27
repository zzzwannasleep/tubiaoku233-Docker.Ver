FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000
ENV REMBG_MODEL=u2netp
ENV U2NET_HOME=/opt/rembg-models

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY api ./api
COPY static ./static
COPY templates ./templates
COPY .env.example ./.env.example
COPY README.md ./README.md

RUN mkdir -p /app/data/images/square /app/data/images/circle /app/data/images/transparent
RUN mkdir -p /opt/rembg-models && python -c "from rembg import new_session; new_session('u2netp')"

EXPOSE 8000

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "4", "--timeout", "120", "api.index:app"]
