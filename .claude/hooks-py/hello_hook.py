#!/usr/bin/env python3
"""Hook de demostración — solo registra que fue invocado."""

import json
import sys
from datetime import datetime
from pathlib import Path


def main() -> None:
    log_path = Path(".claude/hooks.log")
    log_path.parent.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().isoformat()

    raw_input = sys.stdin.read()

    try:
        data = json.loads(raw_input)
    except json.JSONDecodeError as e:
        with log_path.open("a") as f:
            f.write(f"[{timestamp}] ERROR: JSON inválido: {e}\n")
            f.write(f"[{timestamp}] raw input was: {raw_input!r}\n")
        sys.exit(0)

    tool_name = data.get("tool_name", "<unknown>")

    with log_path.open("a") as f:
        f.write(f"[{timestamp}] tool={tool_name}\n")
        f.write(f"[{timestamp}] full data={data}\n")

    sys.exit(0)


if __name__ == "__main__":
    main()
