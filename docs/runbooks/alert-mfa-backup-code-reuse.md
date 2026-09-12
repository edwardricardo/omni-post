# Runbook — `MfaBackupCodeReuseRejected`

> Alert: `prometheus/alerts/api.yml`
> Métrica: `api_security_threats_total{threat_type="mfa_backup_code_reuse", endpoint="mfa_verify"}`
> **Routing pending §4.2.b**: hoy TODAS las reglas de este repo se EVALÚAN pero no se entregan — el bloque `alertmanagers:` de `prometheus/prometheus.yml` está comentado. Nadie recibe una notificación push por esto; hay que mirarlo.

## Síntoma

El claim de un backup code fue rechazado al menos una vez en los últimos 15 minutos. El
servicio de MFA emitió el evento de auditoría `MFA_BACKUP_CODE_REUSE_REJECTED` (severidad
HIGH) y incrementó el contador de amenazas. El intento rechazado nunca obtiene sesión: la
verificación termina en `INVALID_TOKEN`.

## Severidad: WARNING

La alerta es `warning` aunque el evento de auditoría sea HIGH. La razón es el falso positivo
documentado más abajo: un rechazo aislado puede corresponder a una colisión entre claims
legítimos y no a un ataque. Un rechazo sostenido sí es señal y escala según la última sección.

## Perfil de volumen esperado

Este punto es la diferencia principal respecto del comportamiento anterior y conviene leerlo
antes de interpretar la serie.

- **Antes**: el evento HIGH se emitía únicamente cuando la escritura perdía la carrera, es
  decir sólo en la interleaving en la que el ataque ya había fallado.
- **Ahora**: el evento se emite en **todo rechazo que devuelve el adapter**, sin importar qué
  interleaving lo produjo — el ataque escalonado, la reutilización concurrente y los replays
  sobre un snapshot ya vencido.
- Los replays secuenciales sobre un snapshot fresco siguen filtrados en el servicio (la
  optimización de costo argon2) y terminan como `MFA_VERIFICATION_FAILED` (MEDIUM), igual que
  antes.

En consecuencia el volumen en estado estable se mantiene cerca de cero y **cualquier emisión
sostenida es señal, no ruido**. El umbral se ajusta acá, en la regla de alerta, nunca
suprimiendo la emisión en el código.

## Diagnóstico paso-a-paso

1. **Aislar al sujeto**: buscar en `AuditLog` las filas con
   `action = "MFA_BACKUP_CODE_REUSE_REJECTED"` de los últimos 15 minutos. La fila identifica
   al sujeto (admin o customer) y a la cuenta; no contiene secreto TOTP, backup code ni hash.
2. **Contar intentos por sujeto**: un único rechazo aislado para un sujeto es compatible con
   el falso positivo de abajo. Varios rechazos para el mismo sujeto, o rechazos para varios
   sujetos en la misma ventana, no lo son.
3. **Correlacionar con logins exitosos**: revisar si el mismo código fue consumido con éxito
   inmediatamente antes del rechazo. Un consumo exitoso seguido de un rechazo del mismo índice
   es exactamente la firma del ataque escalonado — el atacante presentó un código ya usado.
4. **Revisar el origen**: correlacionar las IP y los user agents de los intentos. Un consumo
   exitoso y un rechazo desde orígenes distintos indica que la credencial de recuperación está
   comprometida.
5. **Revisar la serie completa**: en Prometheus, `increase(api_security_threats_total{threat_type="mfa_backup_code_reuse"}[1h])`
   para ver si es un pico puntual o una tendencia.

## Falso positivo aceptado — colisión entre claims hermanos

Dos verificaciones concurrentes del **mismo usuario** que consumen backup codes de **índices
distintos** pueden colisionar: una gana y la otra es rechazada. En ese caso:

- el código de la llamada rechazada **no queda consumido**;
- la alerta se emite sin que ese intento la haya merecido;
- **la respuesta correcta es que el usuario reintente**, y el reintento tiene éxito.

Es un pequeño problema de disponibilidad, nunca una credencial perdida, y existe de forma
idéntica desde antes de este cambio. Está deliberadamente no resuelto acá: ampliar el alcance
para eliminarlo cambiaría un arreglo de seguridad de una sola preocupación por una comodidad
de disponibilidad.

## Remediation

- **Reutilización confirmada** (consumo exitoso previo del mismo índice, u orígenes
  distintos): tratar los backup codes del sujeto como comprometidos. Regenerar el set completo
  (`regenerateBackupCodes` invalida todos los códigos anteriores) y notificar al usuario.
- **Sospecha de compromiso de cuenta**: además de regenerar, revisar las sesiones activas del
  sujeto y forzar el re-login.
- **Rechazo aislado, sin consumo exitoso previo del mismo índice**: muy probablemente la
  colisión entre hermanos. Confirmar que el usuario pudo completar el login en el reintento y
  cerrar sin más acción.
- **Emisión sostenida sin sujeto único**: revisar si un cliente está reintentando
  automáticamente una verificación fallida; un reintento automático del claim viola el
  contrato del puerto, que exige rechazar y no reintentar.

## Cuándo escalar

- Reutilización confirmada sobre un sujeto admin → escalar de inmediato al equipo de
  seguridad.
- Más de un sujeto afectado en la misma ventana → posible campaña; escalar.
- Emisión sostenida por más de una hora sin causa identificada → escalar al equipo de backend.

## Links

- Regla de alerta: `prometheus/alerts/api.yml` (`MfaBackupCodeReuseRejected`)
- Contrato del claim: `packages/ports/src/MfaUserRepositoryPort.ts` (`markBackupCodeUsed`)
- Emisión: `apps/api/src/admin/auth/MfaService.ts` (`verifyMfaToken`)
- Contador: `apps/api/src/metrics/apiMetrics.ts` (`securityThreats`)
