# FanMe Internal Certificates

This folder is for local/internal TLS material used by the Vite dev server.

Generate certificates from the repository root:

```bash
./scripts/generate-internal-cert.sh chatbot.fanme.internal
```

Do not commit generated private keys. The repository `.gitignore` excludes
`*.key`, `*.crt`, `*.pem`, `*.csr`, and `*.srl` files in this folder.
