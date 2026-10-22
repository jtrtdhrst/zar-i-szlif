#!/usr/bin/env bash
# Bootstrap for the EXISTING VPS administrator (run ON THE HOST, not in a container).
# Creates the dedicated harness-ops account idempotently, authorizes the
# Harness SSH key, and grants passwordless sudo for host administration.
# Safe to re-run: every step checks state first.
set -euo pipefail

PUBKEY="${1:-}"
if [ -z "$PUBKEY" ]; then
  echo "usage: $0 '<ssh-ed25519 AAAA... harness-ops@opencode-vps>'" >&2
  echo "expected fingerprint: SHA256:GPaohiLnEdBk+HpkRoY6srKZdAUH8j+gIn8bPRC6z1M" >&2
  exit 2
fi
echo "$PUBKEY" | ssh-keygen -lf /dev/stdin

if ! id harness-ops >/dev/null 2>&1; then
  sudo useradd -m -s /bin/bash harness-ops
  echo "created user harness-ops"
else
  echo "user harness-ops exists, no duplicate created"
fi
sudo -u harness-ops mkdir -p /home/harness-ops/.ssh
sudo chmod 700 /home/harness-ops/.ssh
touch /tmp/harness-ops-authorized_keys
chmod 600 /tmp/harness-ops-authorized_keys
printf '%s\n' "$PUBKEY" > /tmp/harness-ops-authorized_keys
if grep -qxF "$PUBKEY" /home/harness-ops/.ssh/authorized_keys 2>/dev/null; then
  echo "public key already authorized"
else
  cat /tmp/harness-ops-authorized_keys >> /home/harness-ops/.ssh/authorized_keys
  echo "public key appended"
fi
rm -f /tmp/harness-ops-authorized_keys
sudo chmod 600 /home/harness-ops/.ssh/authorized_keys
sudo chown -R harness-ops:harness-ops /home/harness-ops/.ssh
echo 'harness-ops ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/90-harness-ops >/dev/null
sudo chmod 440 /etc/sudoers.d/90-harness-ops
sudo visudo -cf /etc/sudoers.d/90-harness-ops
echo "--- host keys (server-side, for client known_hosts) ---"
sudo cat /etc/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ecdsa_key.pub /etc/ssh/ssh_host_rsa_key.pub
echo "--- verify (as harness-ops) ---"
sudo -u harness-ops ssh-keygen -lf /home/harness-ops/.ssh/authorized_keys
echo "BOOTSTRAP_DONE: test from OpenCode container:"
echo "  ssh -i <privkey> -o BatchMode=yes harness-ops@51.89.174.58 'id; hostname; sudo -n id'"
