# ════════════════════════════════════════════════════════════════════

# WORKFLOW OBLIGATORIO — OmniPost remediation v2.1 (preamble v2)

# ════════════════════════════════════════════════════════════════════

# Este preamble define el ciclo de batch. Los hooks de .claude/hooks/

# enforzan partes de él automáticamente.

## Reglas no-negociables

1. Plan Mode formal por batch (sin excepciones)
2. Canon research exhaustivo (sin filtrar "es mucho trabajo")
3. Adopción comprehensive del canon (no diferir)
4. Batches < 2h, self-contained
5. Canon index FIRST antes de cualquier edit (gate enforced)
6. Comentarios describen estado actual (no historia/migración)
7. Sin trailer Co-Authored-By: Claude
8. Solo branch refactor/remediation-v2.1\*
9. Ante ambigüedad: AskUserQuestion, no deliberes
   Op-1. Commits/push solo cuando Edward los pida explícitamente
   Op-2. Auditar POST_REMEDIATION_BACKLOG.md al cerrar cada batch
   Op-3. Ir en orden; si hay bloqueo se salta y se vuelve

## Paso 0 — Canon research FIRST (antes que el plan)

Tu primera acción en cualquier batch es leer/actualizar `canon_research_index.md`
con las fuentes canónicas relevantes para el alcance. Esto NO es opcional —
`pre-edit.sh` bloquea cualquier edit si el canon index no fue tocado en los
últimos 30 min.

Si el canon necesario ya está en el index, validá que las URLs siguen vivas.
Si falta canon, agregá entries con título + URL + summary de 1 línea.

## Paso 1 — Preflight (después del canon, antes de tocar código)

Producí este YAML completo en `.claude/current-batch-plan.md`. Todos los
campos son obligatorios; usá "n/a" con razón si alguno no aplica.

```yaml
preflight:
  batch_id: <id corto, ej. B7-billing-dunning>
  scope_summary: <una línea>
  scope_loc_estimate: <número; si > 400 STOP y pedí split>
  estimated_duration_min: <minutos; si > 120 STOP, regla 4>

  canon_index_checked: <yes>
  canon_research_completed_at: <ISO timestamp>
  canon_entries_consumed:
    - <título de entry reutilizada>
  canon_entries_added:
    - title: <título>
      url: <fuente>
      summary: <una línea>

  ambiguities_detected:
    - <descripción>
  # Si la lista no está vacía, NO sigas — invocá AskUserQuestion (regla 9).

  files_to_modify:
    - <path>
  files_to_create:
    - <path>

  acceptance_criteria:
    - <cómo sabremos que cerró bien>

  rollback_plan: <una línea>
```

## Paso 2 — Esperar aprobación de Edward (refuerzo nuevo)

Después de producir el plan, **declará explícitamente**:

> "Plan listo en .claude/current-batch-plan.md. Esperando que Edward ejecute
> 'omnipost-approve plan' antes de proceder."

NO empieces a editar. `pre-edit.sh` bloqueará todo edit hasta que exista
`.claude/current-batch-plan.approved`.

Edward revisará el plan, posiblemente pedirá cambios. Si modificás el plan
después de la aprobación, ÉSTA SE INVALIDA AUTOMÁTICAMENTE — vas a tener
que pedir re-aprobación.

CC NO PUEDE crear el archivo `.approved`. `pre-bash.sh` bloquea cualquier
intento de hacerlo (touch, echo, cat, etc.).

## Paso 3 — Audit del estado actual

- Broad-pattern grep antes de scope-lock.
- Comparar implementación actual vs canon, punto-por-punto.
- Leé los archivos antes de proponer cambios.

## Paso 4 — Diagnóstico

- PASS (matches canon): reportá con cita y evidencia. Cero cambios.
- GAP (diverge): si hay decisión ambigua → AskUserQuestion. Si no, ejecutá.

## Paso 5 — Si necesitás eliminar código (refuerzo nuevo)

ANTES de eliminar cualquier cosa significativa (≥30 líneas, archivos enteros,
o eliminación vía rm/git rm), tenés que:

### 5.1 — Producir `.claude/current-deletion-justification.yml`

Respondiendo las 3 preguntas:

```yaml
deletion_justification:
  scope:
    - path: <archivo o ruta>
      type: <file|function|block|directory>
      lines_removed: <número>

  question_1_what:
    - <Qué es exactamente lo que vas a eliminar>

  question_2_what_does_it_do:
    - <Funcionalidad declarada>

  question_3_existing_replacement:
    exists: <yes|no|partial>
    replacement:
      - path: <dónde vive el replacement>
        method: <método/función específica>
        notes: <relación con lo eliminado>
    consumers_migrated: <yes|no|partial> # CRÍTICO
    grep_evidence: |
      <output literal de rg/grep mostrando que no hay consumers>

  reversibility:
    git_sha_before_deletion: <hash>
    backup_branch: backup/pre-deletion-<batch-id>
    rollback_command: <comando exacto>
```

Ver `.claude/templates/deletion-justification-example.yml` para referencia.

### 5.2 — Esperar `omnipost-approve deletion`

Después de producir la justification, declará:

> "Justification de eliminación lista. Esperando 'omnipost-approve deletion'."

La aprobación tiene 30 min de validez (más estricta que la del plan).

### 5.3 — Reglas críticas de eliminación

- Si `consumers_migrated: no` o `partial`, NO ELIMINES. Migrá consumers primero.
- Si `question_3.exists: no`, considerá si la eliminación es realmente segura
  o si estás eliminando funcionalidad sin reemplazo.
- Si tenés CUALQUIER duda, AskUserQuestion antes de producir la justification.

## Paso 6 — Cierre obligatorio

Producí este YAML en `.claude/current-batch-closeout.yml`. El `stop.sh`
hook lo lee y bloquea el cierre si falta algo.

```yaml
closeout:
  batch_id: <mismo del preflight>
  result: <pass|gap-fixed|gap-deferred>

  files_modified:
    - <path>
  tests_added: <int>
  jsdoc_blocks_added: <int>

  # Refuerzo nuevo: tracking de eliminaciones del batch
  deletions_in_batch:
    - justification_id: <batch_id de la justification que cubrió>
      paths: [<paths eliminados>]
      total_lines: <int>
  # Vacío [] si no hubo eliminaciones.

  canon_index_diff: <commit hash | "untouched" | "added: <titles>">
  backlog_audited: <yes|no>
  backlog_entries_proposed:
    - title: <título>
      reason: <por qué surge>

  gaps_diferidos:
    - what: <qué no se adoptó del canon>
      why: <razón>
      tracked_in: <entry de backlog | "none">

  rules_attestation:
    r1_plan_mode: yes
    r2_canon_exhaustive: <yes — fuentes: [...]>
    r3_canon_comprehensive: <yes | partial — ver gaps>
    r5_canon_first: yes
    r6_comments_current_state: yes
    r7_no_co_authored: yes
    r8_branch_correct: yes
    op2_backlog_audit: yes

  verification_gates_run:
    - <comando ejecutado>

  open_questions_for_edward:
    - <preguntas pendientes>
```

## Variables de entorno relevantes

- `EDWARD_AUTHORIZED_COMMIT=yes` — para autorizar commits puntuales.
- `EDWARD_AUTHORIZED_DESTRUCTIVE=yes` — para rm -rf masivos / git reset --hard.
- `EDWARD_AUTHORIZED_SENSITIVE=yes` — para edits a .env, encryption, prisma/.
- `CLAUDE_BATCH_BYPASS=yes` — bypass para fixes triviales fuera de batch.
- `CLAUDE_HOOKS_DEBUG=yes` — verbose de los hooks.

## Si un hook bloquea algo que parece correcto

NO intentes saltarlo (ni con touch sobre .approved, ni reescribiendo el comando).
Reportá el bloqueo a Edward con el mensaje exacto del hook. Edward decide.

# ════════════════════════════════════════════════════════════════════

# FIN DEL PREAMBLE — abajo va la tarea específica de este batch

# ════════════════════════════════════════════════════════════════════
