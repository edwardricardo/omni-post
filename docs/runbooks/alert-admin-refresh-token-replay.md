# Runbook — `AdminRefreshTokenReplayRejected`

> Alert: `prometheus/alerts/api.yml`
> Métrica: `api_security_threats_total{threat_type="admin_refresh_token_replay", endpoint="admin_auth_refresh"}`
> **Routing pending §4.2.b**: hoy TODAS las reglas de este repo se EVALÚAN pero no se entregan — el bloque `alertmanagers:` de `prometheus/prometheus.yml` está comentado. Nadie recibe una notificación push por esto; hay que mirarlo.

## Síntoma

El claim de rotación de refresh tokens (`AuthServiceSession.refreshTokens`) rechazó al menos
un intento en los últimos 15 minutos porque el token presentado YA había sido rotado. El
servicio emitió el evento de auditoría con `reason = "ROTATED_TOKEN_REPLAYED"` (severidad
HIGH) e incrementó el contador de amenazas. El intento rechazado no obtiene par nuevo:
termina en `TOKEN_BLACKLISTED` y el par que llegó a acuñar nunca se escribe en ninguna fila.

## Severidad: WARNING

La alerta es `warning` aunque el evento de auditoría sea HIGH, por el falso positivo
documentado más abajo: un rechazo aislado es compatible con dos pestañas refrescando a la
vez. Un rechazo sostenido sí es señal y escala según la última sección.

## Perfil de volumen esperado

Leer esto ANTES de interpretar la serie. La honestidad acá importa más que la tranquilidad:
esta serie **no está en cero por construcción**, y el motivo es una decisión de alcance que
se tomó a sabiendas.

- **Estado estable: cerca de cero.** Un refresh normal rota su propio token y no vuelve a
  presentarlo.
- **La revocación en vuelo NO emite esta serie.** Un logout, una revocación administrativa o
  una revocación masiva que commitea entre la lectura y la escritura del claim también hace
  que el claim matchee cero filas. Eso es un cierre de sesión ordinario, no un ataque: el
  código lo distingue con una relectura de la fila y lo audita como
  `SESSION_REVOKED_MIDFLIGHT` (MEDIUM), **sin** tocar el contador. Si esa relectura llega
  tarde (la revocación commitea DESPUÉS de ella) el veredicto cae del lado ruidoso y se
  reporta como replay — la dirección conservadora, elegida a propósito.
- **Dos pestañas refrescando a la vez SÍ pueden emitirla.** Es el falso positivo de abajo.
- **La familia de tokens NO se revoca ante una detección.** Ver "Lo que esta alerta NO hace".

## Falso positivo aceptado — refresh simultáneo desde dos clientes

Dos pestañas (o una pestaña y una llamada en background) del **mismo admin** pueden presentar
el mismo refresh token casi a la vez. Una gana la rotación y la otra es rechazada. En ese caso:

- el par de la perdedora **nunca se almacena** y no queda credencial colgando;
- la alerta se emite sin que ese intento la haya merecido;
- **la respuesta correcta es que el usuario vuelva a iniciar sesión** en esa pestaña.

Es un problema de disponibilidad, nunca una credencial perdida. Está deliberadamente no
resuelto acá.

## Lo que esta alerta NO hace — revocación de familia diferida

Un replay detectado se rechaza pero **no revoca el resto de la familia de sesiones**. Si el
que perdió la carrera era el tenedor legítimo, el par del atacante sigue vivo hasta que
expira. Actuar sobre la detección (revocar la familia, al estilo de la detección de reuse de
refresh tokens de OAuth) es trabajo propio y va junto con el flujo de refresh de customer,
que hoy no tiene rotación server-side en absoluto: **SMELL-113**. Hasta que ese trabajo
aterrice, la remediación de abajo es MANUAL.

## Diagnóstico paso-a-paso

1. **Aislar al sujeto**: buscar en `AuditLog` las filas de los últimos 15 minutos cuyo
   `details.reason` sea `ROTATED_TOKEN_REPLAYED`. La fila trae `details.tokenHash` (los
   primeros 16 hex del SHA-256 del token presentado — nunca el token) y, si el cliente lo
   envió, el hash del fingerprint, la IP y el user agent.
2. **Separar de la revocación en vuelo**: contar en la misma ventana las filas con
   `reason = "SESSION_REVOKED_MIDFLIGHT"`. Si dominan, lo que hay es rotación de sesiones
   normal y no un replay; esa serie no alimenta el contador.
3. **Contar por `tokenHash`**: un único rechazo para un `tokenHash` es compatible con el
   falso positivo de arriba. Varios rechazos del mismo hash, o rechazos de varios hashes en
   la misma ventana, no lo son.
4. **Revisar el origen**: comparar IP y user agent del rechazo contra los de la rotación
   exitosa inmediatamente anterior (evento `SESSION_CREATED` con `category: AUTHENTICATION`,
   severidad LOW, que sí trae `sessionId`). Orígenes distintos = el refresh token está
   comprometido.
5. **Revisar la serie completa**: en Prometheus,
   `increase(api_security_threats_total{threat_type="admin_refresh_token_replay"}[1h])` para
   distinguir un pico puntual de una tendencia.

## Remediation

- **Replay confirmado** (orígenes distintos, o varios rechazos del mismo hash): tratar la
  sesión como comprometida. Revocar TODAS las sesiones del admin
  (`AuthService.revokeAllSessions`) y forzar el re-login; la revocación de familia no es
  automática (ver arriba).
- **Sospecha de compromiso de cuenta**: además de revocar, revisar MFA y considerar el reset
  de password.
- **Rechazo aislado, mismo origen, mismo user agent**: casi seguro el refresh simultáneo.
  Confirmar que el admin pudo volver a entrar y cerrar sin más acción.
- **Emisión sostenida sin sujeto único**: revisar si un cliente reintenta automáticamente un
  refresh fallido. Un reintento automático sobre un token ya rotado produce exactamente esta
  serie y no es un ataque, es un bug de cliente.

## Cuándo escalar

- Replay confirmado sobre cualquier sujeto admin → escalar de inmediato al equipo de
  seguridad (la superficie admin es la más privilegiada del sistema).
- Más de un `tokenHash` afectado en la misma ventana → posible campaña; escalar.
- Emisión sostenida por más de una hora sin causa identificada → escalar al equipo de backend.

## Links

- Regla de alerta: `prometheus/alerts/api.yml` (`AdminRefreshTokenReplayRejected`)
- Emisión: `apps/api/src/auth/authServiceSession.ts` (`refreshTokens`)
- Contador: `apps/api/src/metrics/apiMetrics.ts` (`securityThreats`)
- Alerta hermana, misma forma: `docs/runbooks/alert-mfa-backup-code-reuse.md`
