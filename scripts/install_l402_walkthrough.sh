#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${L402_INSTALL_BASE_URL:-https://l402.lightningnode.app}"
INSTALL_DIR="${L402_INSTALL_DIR:-$HOME/.local/bin}"
COMMAND_NAME="l402-walkthrough"
MODULE_NAME="${COMMAND_NAME}.mjs"
TARGET_PATH="${INSTALL_DIR}/${COMMAND_NAME}"
MODULE_PATH="${INSTALL_DIR}/${MODULE_NAME}"
SOURCE_URL="${BASE_URL%/}/${MODULE_NAME}"

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required to install ${COMMAND_NAME}" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/l402-walkthrough.XXXXXX")"

cleanup() {
  rm -f "$TMP_FILE"
}

trap cleanup EXIT

echo "Downloading ${COMMAND_NAME} from:"
echo "  ${SOURCE_URL}"
echo

curl -fsSL "$SOURCE_URL" -o "$TMP_FILE"
chmod +x "$TMP_FILE"
mv "$TMP_FILE" "$MODULE_PATH"

cat > "$TARGET_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail

exec node "${MODULE_PATH}" "\$@"
EOF
chmod +x "$TARGET_PATH"

echo "Installed ${COMMAND_NAME} to:"
echo "  ${TARGET_PATH}"
echo "Installed module to:"
echo "  ${MODULE_PATH}"
echo

if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node --version)"
  echo "Detected Node.js: ${NODE_VERSION}"
else
  echo "warning: Node.js was not found on your PATH."
  echo
  echo "The installed launcher is:"
  echo "  ${TARGET_PATH}"
  echo
  echo "Install Node.js 18+ first, then run:"
  echo "  ${TARGET_PATH}"
  exit 0
fi

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*)
    echo
    echo "Next step:"
    echo "  ${COMMAND_NAME}"
    ;;
  *)
    echo "Your install directory is not on PATH yet."
    echo
    echo "Add this to your shell profile:"
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    echo
    echo "Then either restart your shell or run:"
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    echo
    echo "Next step:"
    echo "  ${COMMAND_NAME}"
    ;;
esac
