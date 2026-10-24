FROM local/vps-ops-supervisor:1.0.19

LABEL org.opencontainers.image.version="1.0.20"
LABEL org.opencontainers.image.revision="KOMAA-1458"

COPY apply-auth-compat.py /tmp/apply-auth-compat.py
COPY test /opt/sup/candidate-test
RUN python3 /tmp/apply-auth-compat.py \
    && bash -n /opt/sup/watcher.sh \
    && bash /opt/sup/candidate-test/auth-matrix.test.sh /opt/sup/watcher.sh \
    && rm /tmp/apply-auth-compat.py
