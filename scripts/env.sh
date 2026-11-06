#!/usr/bin/env bash
# Optional project-local toolchain used on machines without system Rust/Node/Java.
RA_PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RA_TOOLS="${ANYWORK_TOOLS:-${REMOTE_AGENT_TOOLS:-$RA_PROJECT_ROOT/../.remote-agent-tools}}"
if [[ -d "$RA_TOOLS/cargo/bin" ]]; then
    export CARGO_HOME="$RA_TOOLS/cargo" RUSTUP_HOME="$RA_TOOLS/rustup"
    export PATH="$RA_TOOLS/cargo/bin:$PATH"
fi
for RA_NODE in "$RA_TOOLS"/node-*-linux-x64/bin; do
    [[ ! -d "$RA_NODE" ]] || export PATH="$RA_NODE:$PATH"
done
if [[ -z "${JAVA_HOME:-}" ]]; then
    for RA_JDK in "$RA_TOOLS"/jdk-17*; do
        [[ ! -d "$RA_JDK" ]] || export JAVA_HOME="$RA_JDK"
    done
fi
if [[ -d "$RA_TOOLS/android-sdk" ]]; then export ANDROID_HOME="$RA_TOOLS/android-sdk"; fi
if [[ -d "$RA_TOOLS/gradle" ]]; then export GRADLE_USER_HOME="$RA_TOOLS/gradle"; fi
