FROM python:3.12-alpine

WORKDIR /app

COPY app.py test_app.py README.md ./

ENV HOST=0.0.0.0 \
    PORT=8080 \
    SOURCE_SHA=unknown

RUN python -m unittest -v

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2).status == 200 else 1)"

CMD ["python", "app.py"]
