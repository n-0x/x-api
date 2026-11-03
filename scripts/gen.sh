#!/usr/bin/env bash
# Generate one client from this checkout; never delete the output directory.
set -euo pipefail
if [ "$#" -ne 2 ] || { [ "$1" != go ] && [ "$1" != ts ]; }; then
    echo 'usage: scripts/gen.sh <go|ts> <outdir>' >&2
    exit 2
fi
TARGET=$1
mkdir -p -- "$2"
OUT=$(cd -- "$2" && pwd)
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
TOOLS="${N0X_PROTO_TOOLS:-$ROOT/.tools}"
mkdir -p "$TOOLS"
TOOLS=$(cd -- "$TOOLS" && pwd)
read -r TOOLCHAIN TOOL_GOOS TOOL_GOARCH <<<"$(go env GOVERSION GOOS GOARCH | tr '\n' ' ')"

tool_matches() {
	local binary=$1 package=$2 module=$3 version=$4
	[ -x "$binary" ] || return 1
	go version -m "$binary" 2>/dev/null | awk \
		-v toolchain="$TOOLCHAIN" -v package="$package" \
		-v module="$module" -v version="$version" \
		-v goos="GOOS=$TOOL_GOOS" -v goarch="GOARCH=$TOOL_GOARCH" '
		NR == 1 { compiler = ($NF == toolchain) }
		$1 == "path" { command = ($2 == package) }
		$1 == "mod" { pinned = ($2 == module && $3 == version) }
		$1 == "build" && $2 == goos { os = 1 }
		$1 == "build" && $2 == goarch { arch = 1 }
		END { exit !(compiler && command && pinned && os && arch) }'
}

ensure_tool() {
	local package=$1 module=$2 version=$3 binary="$TOOLS/${1##*/}"
	if ! tool_matches "$binary" "$package" "$module" "$version"; then
		# Pin the selected compiler too: go install pkg@version ignores go.mod.
		GOBIN="$TOOLS" GOTOOLCHAIN="$TOOLCHAIN" go install "$package@$version"
		tool_matches "$binary" "$package" "$module" "$version" || {
			echo "installed proto tool has unexpected build metadata: $binary" >&2
			return 1
		}
	fi
}

# Verify cached executables against compiler, command, module, version and platform.
ensure_tool github.com/bufbuild/buf/cmd/buf github.com/bufbuild/buf v1.70.0
if [ "$TARGET" = go ]; then
    ensure_tool google.golang.org/protobuf/cmd/protoc-gen-go google.golang.org/protobuf v1.36.11
    ensure_tool google.golang.org/grpc/cmd/protoc-gen-go-grpc google.golang.org/grpc/cmd/protoc-gen-go-grpc v1.5.1
    ensure_tool connectrpc.com/connect/v2/cmd/protoc-gen-connect-go connectrpc.com/connect/v2 v2.0.2
else
    # npm ci verifies the locked dependency tree, including the ES plugin pin.
    (cd "$ROOT" && npm ci --no-audit --no-fund)
fi
cd "$ROOT"
"$TOOLS/buf" lint
# buf accepts a JSON template; select one target and resolve absolute paths so
# callers can generate into another repository from any working directory.
TEMPLATE=$(node --input-type=module - "$TARGET" "$OUT" "$ROOT" "$TOOLS" <<'JS'
import { readFileSync } from 'node:fs';
const [target, out, root, tools] = process.argv.slice(2);
const config = JSON.parse(readFileSync(`${root}/buf.gen.yaml`, 'utf8'));
config.plugins = config.plugins.filter(p => target === 'ts'
  ? p.local === 'protoc-gen-es' : p.local !== 'protoc-gen-es');
for (const plugin of config.plugins) {
  plugin.local = plugin.local === 'protoc-gen-es'
    ? `${root}/node_modules/.bin/protoc-gen-es` : `${tools}/${plugin.local}`;
  plugin.out = out;
}
process.stdout.write(JSON.stringify(config));
JS
)
"$TOOLS/buf" generate --template "$TEMPLATE"
