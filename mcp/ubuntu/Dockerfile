FROM node:24.20.0-trixie-slim
RUN npm install --no-audit --no-fund --prefix /opt mcp-ssh-manager@3.8.6 \
 && node -e "const v=require('/opt/node_modules/mcp-ssh-manager/package.json').version; if(v!=='3.8.6'){console.error('version mismatch '+v);process.exit(1)}; console.log('mcp-ssh-manager '+v)" \
 && rm -rf /root/.npm
COPY server.mjs /bridge/server.mjs
ENV BRIDGE_PORT=8765 \
    BRIDGE_TOKEN_FILE=/bridge-config/bridge-bearer-token \
    BRIDGE_CHILD_ARGS="/opt/node_modules/mcp-ssh-manager/src/index.js" \
    BRIDGE_AUDIT_FILE=/audit/ubuntu-mcp-audit.jsonl \
    SSH_MANAGER_KNOWN_HOSTS=/bridge-config/known_hosts
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8765/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "/bridge/server.mjs"]
