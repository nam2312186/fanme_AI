#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-chatbot.fanme.internal}"
OUT_DIR="${OUT_DIR:-frontend/certs}"
CA_NAME="${CA_NAME:-fanme-internal-ca}"
CA_KEY="$OUT_DIR/$CA_NAME.key.pem"
CA_CERT="$OUT_DIR/$CA_NAME.crt.pem"
SERVER_KEY="$OUT_DIR/$DOMAIN.key.pem"
SERVER_CSR="$OUT_DIR/$DOMAIN.csr.pem"
SERVER_CERT="$OUT_DIR/$DOMAIN.crt.pem"
OPENSSL_CNF="$OUT_DIR/$DOMAIN.openssl.cnf"

shift || true
DNS_NAMES=("$DOMAIN" "$@")

mkdir -p "$OUT_DIR"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required but was not found." >&2
  exit 1
fi

if [[ ! -f "$CA_KEY" || ! -f "$CA_CERT" ]]; then
  echo "Creating FanMe internal CA..."
  openssl req \
    -x509 \
    -newkey rsa:4096 \
    -sha256 \
    -days 3650 \
    -nodes \
    -subj "/CN=FanMe Internal Development CA/O=FanMe/C=VN" \
    -keyout "$CA_KEY" \
    -out "$CA_CERT"
else
  echo "Using existing CA: $CA_CERT"
fi

{
  echo "[req]"
  echo "default_bits = 2048"
  echo "prompt = no"
  echo "default_md = sha256"
  echo "distinguished_name = dn"
  echo "req_extensions = req_ext"
  echo
  echo "[dn]"
  echo "CN = $DOMAIN"
  echo "O = FanMe"
  echo "C = VN"
  echo
  echo "[req_ext]"
  echo "subjectAltName = @alt_names"
  echo
  echo "[alt_names]"
  index=1
  for dns in "${DNS_NAMES[@]}"; do
    echo "DNS.$index = $dns"
    index=$((index + 1))
  done
} > "$OPENSSL_CNF"

echo "Creating certificate for: ${DNS_NAMES[*]}"
openssl req \
  -new \
  -newkey rsa:2048 \
  -nodes \
  -keyout "$SERVER_KEY" \
  -out "$SERVER_CSR" \
  -config "$OPENSSL_CNF"

openssl x509 \
  -req \
  -in "$SERVER_CSR" \
  -CA "$CA_CERT" \
  -CAkey "$CA_KEY" \
  -CAcreateserial \
  -out "$SERVER_CERT" \
  -days 825 \
  -sha256 \
  -extensions req_ext \
  -extfile "$OPENSSL_CNF"

chmod 600 "$CA_KEY" "$SERVER_KEY"

echo
echo "Generated:"
echo "  CA certificate:     $CA_CERT"
echo "  Server certificate: $SERVER_CERT"
echo "  Server key:         $SERVER_KEY"
echo
echo "Next steps:"
echo "  1. Point $DOMAIN to this server in internal DNS, or add it to /etc/hosts on each client:"
echo "       <server-lan-ip> $DOMAIN"
echo "  2. Trust the CA certificate on every device that will open the chatbot:"
echo "       $CA_CERT"
echo "  3. Add this Logto redirect URI:"
echo "       https://$DOMAIN:5173/callback"
echo "  4. Open:"
echo "       https://$DOMAIN:5173/"
