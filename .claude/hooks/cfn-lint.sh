#!/usr/bin/env bash
# Hook PostToolUse de Claude Code: ejecuta cfn-lint cada vez que se edita un template.yaml.
# Si hay errores, sale con código 2 para que Claude vea el resultado y los corrija.
file=$(jq -r '.tool_input.file_path // empty')
[[ "$file" == */template.yaml ]] || exit 0

if ! out=$(cfn-lint "$file" 2>&1); then
  echo "cfn-lint encontró problemas en $file:" >&2
  echo "$out" >&2
  exit 2
fi
