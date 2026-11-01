#!/bin/bash
# Runs JavaScript in the nested shell and prints the result (JSON). The code
# may use `dev` (dev/devhelper) and the shell's `global` and `Main`. Code
# that uses await runs in an async function, so it needs an explicit return.
source "$(dirname "$(readlink -f "$0")")/common.sh"
code=$1
if [[ $code == *await* ]]; then
    code="(async () => { $code })()"
fi
in_session gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Eval "$code"
