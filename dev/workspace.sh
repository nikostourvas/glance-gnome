#!/bin/bash
# Switches the nested shell to workspace N (counting from 1), with GNOME's
# switch animation (the keyboard shortcuts go to the real session).
source "$(dirname "$(readlink -f "$0")")/common.sh"
"$dev/eval.sh" "const wm = global.workspace_manager;
    const i = Math.min(${1:-1} - 1, wm.get_n_workspaces() - 1);
    wm.get_workspace_by_index(i).activate(global.get_current_time()); i + 1" >/dev/null
