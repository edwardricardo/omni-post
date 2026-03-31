# OmniPost — Gestion de Redes Sociales, Reinventada

## El Problema

Manejar redes sociales en varias plataformas es un desgaste diario. Escribis un post, lo adaptas manualmente para cada red. Revisas metricas en 5 dashboards distintos. Respondes mensajes dispersos en 10 bandejas de entrada. Y las herramientas de IA que prometen ayudarte? Generan contenido generico que necesita edicion pesada porque no conocen tu marca. Estas pagando $99-249/mes por herramientas que crean mas trabajo, no menos.

## Que Hace OmniPost

OmniPost es la plataforma de gestion de redes sociales donde la IA realmente conoce tu marca. Configura tu Brand Voice una sola vez y cada caption, cada sugerencia de respuesta, cada optimizacion de contenido habla automaticamente en tu tono. Publica en 10 plataformas sociales desde un solo compositor, con variantes de contenido nativas de cada plataforma generadas por IA que aprende de tus publicaciones mas exitosas. Gestiona toda tu bandeja de entrada social con triaje inteligente que clasifica, prioriza y redacta respuestas. Mide analiticas reales, genera reportes compartibles, y deja que el sistema detecte oportunidades de forma autonoma: sugiriendo contenido reutilizado y tendencias que encajan con tu marca. Todas las funciones incluidas en todos los planes, con precios que escalan segun las plataformas y cuentas que realmente usas.

---

## Publica en Todas Partes, Sin Esfuerzo

### El Compositor

Escribe una vez, publica de forma nativa en 10 plataformas sociales: X (Twitter), Instagram, Facebook, YouTube, TikTok, LinkedIn, Pinterest, Snapchat, Telegram y Bluesky. El motor de adaptacion de contenido ajusta automaticamente tu post para cada plataforma, respetando limites de caracteres, normas de hashtags, requisitos de media y reglas de formato. Previsualiza exactamente como se vera tu post en cada plataforma antes de publicar. Subi imagenes, videos y documentos. Agrega emojis con el selector integrado. Menciona a miembros del equipo con @mention para colaborar.

### Programacion Inteligente

Planifica tu contenido con un calendario completo: vistas de mes, semana y dia. Configura posts recurrentes con cronogramas basados en cron que soportan repeticion exacta, rotacion de contenido o variaciones generadas por IA. Usa el predictor de horarios optimos potenciado por IA para encontrar los mejores momentos de publicacion en cada plataforma. Programa en lote con carga de CSV para grandes volumenes de contenido.

### Cola de Publicacion

Cada post se entrega a traves de una cola empresarial BullMQ con reintento automatico ante errores del proveedor. Monitorea el estado de publicacion en tiempo real desde el dashboard de la cola: ve lo que esta programado, en progreso, publicado o fallido. Cada adaptador de proveedor maneja las llamadas API especificas de la plataforma, limites de tasa y requisitos de formato de media.

---

## IA Que Realmente Conoce Tu Marca

Esto es lo que separa a OmniPost de todos los competidores. La IA de Hootsuite genera contenido generico. La IA de OmniPost genera contenido que suena como vos, y sabe que funciona para tu audiencia especifica.

### Brand Voice — Configuralo Una Vez, Se Usa en Todo

Configura el tono, vocabulario y estilo de tu marca en un solo lugar. Cada caption generado por IA, cada sugerencia de optimizacion, cada recomendacion de respuesta usa automaticamente tu Brand Voice como contexto. Lo configuras una vez durante el onboarding. A partir de ahi, cada interaccion con IA habla con tu voz, sin ingenieria de prompts manual, sin copiar y pegar guias de marca, sin editar la salida de IA para que suene como vos.

### Generacion de Contenido Basada en Performance

OmniPost es la unica plataforma donde la IA aprende de TUS datos reales de rendimiento. Cada 6 horas, las analiticas reales se ingestan desde las 10 plataformas conectadas a una base de datos estructurada. Cuando le pedis a la IA que genere contenido, automaticamente consulta tus posts de mejor rendimiento, entendiendo que temas, tonos, estructuras y patrones de publicacion realmente resuenan con tu audiencia. La IA no adivina basandose en mejores practicas genericas. Sabe que tus posts de LinkedIn los martes con preguntas en el titulo obtienen 3x tu engagement promedio, y escribe en consecuencia.

### Tres Motores de IA a Tu Disposicion

Elegis el cerebro que mejor se adapte a tu necesidad. OmniPost integra tres proveedores de IA de primera linea: OpenAI GPT-4 para generacion versatil y de alta calidad, Google Gemini para contenido creativo y multimodal, y Perplexity Sonar para contenido informado por busquedas en tiempo real. Tu Brand Voice se inyecta automaticamente en cada llamada, sin importar que proveedor uses.

### Variantes de Contenido Nativas por Plataforma

Deja de adaptar un post para multiples plataformas. Escribe un brief, una oracion describiendo lo que queres comunicar, y la IA genera versiones genuinamente diferentes y nativas para cada plataforma seleccionada. La version de LinkedIn es profesional y de liderazgo de opinion. La de X es concisa y con gancho en 280 caracteres. La de Instagram lidera con emocion e incluye hashtags estrategicos. La de TikTok es casual y consciente de tendencias. Cada variante usa el perfil de contenido especifico de la plataforma: limites de caracteres, guias de estilo, estrategias de hashtags, patrones estructurales y expectativas de tono. Son 10 perfiles de plataforma distintos trabajando para vos.

### Calendario de Contenido con IA

Genera un mes completo de ideas de posts en un solo clic. Decile a OmniPost tu objetivo del mes ("Impulsar awareness de la coleccion de primavera"), tu industria y tu mezcla de contenido preferida. La IA produce entre 20 y 60 ideas de posts distribuidas en tus plataformas conectadas. Cada idea incluye titulo, descripcion breve, hashtags sugeridos y fecha de publicacion recomendada basada en tus datos de analiticas. La mezcla de contenido es configurable: educativo (30%), promocional (20%), engagement (30%), detras de escena (20%), o cualquier proporcion que prefieras.

### Reutilizacion Autonoma de Posts

Cuando uno de tus posts tiene un rendimiento excepcional, 2x o mas que el engagement promedio de tu cuenta, OmniPost lo detecta automaticamente. Sin que lo pidas, el sistema genera versiones reutilizadas para tus otras plataformas conectadas y te envia una notificacion: "Tu post de LinkedIn esta rindiendo 3.1x tu promedio. Aqui hay versiones adaptadas para X, Instagram y Bluesky. Aprueba para agregar a tu cola." Vos revisas, aprobas, y el contenido reutilizado se programa. El sistema propone. Vos decidis.

---

## Nunca Pierdas un Mensaje

### Bandeja de Entrada Social Unificada

Todos los comentarios, DMs, menciones y respuestas de las 10 plataformas en una sola bandeja. Los mensajes nuevos se sincronizan cada 30 minutos automaticamente via workers en segundo plano. Responde directamente desde OmniPost: las respuestas se envian a traves de la API nativa de cada plataforma. Sin cambiar entre apps. Las conversaciones estan hiladas, asi ves el contexto completo de cada interaccion.

### Triaje Inteligente con IA

Cada mensaje entrante es clasificado automaticamente por IA: pregunta, queja, cumplido, lead, solicitud de soporte o spam. La prioridad se evalua: las quejas y leads se marcan como URGENTE y aparecen inmediatamente. Se generan tres sugerencias de respuesta en tu Brand Voice, con diferentes tonos (profesional, calido, directo) para que elijas la que mejor encaje. El puntaje de sentimiento te dice de un vistazo si el mensaje es positivo, neutral o negativo. Responde con un clic o edita la sugerencia antes de enviar.

### Contexto de CRM en Cada Conversacion

Cuando un mensaje viene de un contacto en tu HubSpot o Salesforce conectado, su informacion aparece en linea: nombre, empresa, etapa del deal y ultima interaccion. Las sugerencias de respuesta de IA son conscientes de la relacion comercial. Un mensaje de un prospecto en etapa de "Negociacion" recibe una respuesta sugerida diferente a uno de un cliente de largo plazo. Bandeja social y CRM, conectados donde importa.

---

## Analiticas Que Impulsan Decisiones

### Dashboard de Performance en Tiempo Real

Analiticas cross-platform en un solo dashboard. Engagement, alcance, impresiones, likes, comentarios, compartidos y crecimiento, desglosados por plataforma y por post. Los datos se ingestan directamente desde las APIs de cada proveedor cada 6 horas. Son numeros reales de la fuente, no estimaciones ni proyecciones.

### Constructor de Reportes Personalizados

Arma cualquier reporte a partir de tus datos. Elegi metricas (vistas, likes, tasa de engagement), dimensiones (por fecha, por plataforma, por canal), rangos de fechas y filtros. Programa reportes para ejecutarse automaticamente con cronogramas cron. Exporta a CSV. Comparti con clientes via un link publico, sin necesidad de login. Cuando no hay datos todavia, el reporte lo muestra claramente en vez de inventar numeros.

### Radar de Tendencias

Temas trending de tus plataformas conectadas, evaluados por IA segun la relevancia para tu marca. Cada tendencia recibe un puntaje de relevancia (1-10) y una senal de urgencia: publicar AHORA (dentro de 2 horas), publicar HOY, o publicar ESTA SEMANA. Para tendencias relevantes (puntaje 6+), la IA genera una idea de post que conecta la tendencia con tu marca. Se el primero, no el ultimo.

---

## Hecho para Equipos

### Flujos de Aprobacion Multi-Nivel

El contenido pasa por tantos niveles de aprobacion como tu equipo necesite. El creador envia a revision. El editor revisa y pide cambios. El manager da la aprobacion final. Cada paso dispara una notificacion por email: ningun pedido de aprobacion se pierde. Configura workflows personalizados con roles y asignados especificos en cada nivel. Historial completo de auditoria de cada decision.

### Gestion de Equipo

Invita a tu equipo con permisos basados en roles. Owner tiene control total. Manager puede invitar miembros y gestionar contenido. Member contribuye y ejecuta. Viewer tiene acceso de solo lectura. Cada rol ve unicamente las acciones que puede realizar, con seguridad aplicada a nivel de componente.

### Gestion de Campanas

Agrupa posts relacionados en campanas. Mide el rendimiento total a nivel de campana: impresiones, clics, engagement y tasa de engagement a traves de todos los posts de la campana. Gestiona parametros UTM (source, medium, campaign) para integracion con tracking de links. Archiva campanas completadas preservando sus analiticas.

### Gestion de Tareas

Asigna tareas con prioridad (Baja, Media, Alta, Urgente), fechas limite y descripciones. Vincula tareas a posts especificos cuando sea relevante. Menciona miembros del equipo con @mention en tareas para notificaciones directas. Completa, cancela o reasigna tareas segun avanza el trabajo. Notificaciones por email para asignaciones y vencimientos.

---

## Integraciones Que Completan Tu Stack

### Automatizacion

- **Zapier** — Conecta OmniPost con 7,000+ apps. Dispara Zaps cuando se publican posts. Crea borradores en OmniPost desde cualquier app conectada.
- **Make** — Workflows de automatizacion visual. Transformaciones de datos avanzadas. Triggers y acciones via webhooks.

### CRM

- **HubSpot** — Sincroniza contactos con OmniPost. Los posts publicados se registran como actividades del CRM. Contexto de contacto en la bandeja social.
- **Salesforce** — Sincronizacion de contactos via SOQL. Registros de actividad para interacciones sociales. Modo sandbox para testing.

### Almacenamiento

- **Google Drive** — Importa imagenes y videos directamente via el Google Picker nativo del navegador.

### Seguridad

- **SAML 2.0 SSO** — Soporte para Okta, Azure AD y Google Workspace. Flujo de login SP-initiated. Mapeo de atributos personalizado.
- **OpenID Connect** — Flujo PKCE con auto-discovery. Soporte para Auth0, Okta y Cognito.

### Proximamente

- **Slack** — Notificaciones y acciones directas desde canales de Slack.
- **Notion** — Sincronizacion bidireccional de contenido y calendarios editoriales.

---

## Precios Que Tienen Sentido

Pagas por las plataformas que realmente usas. No por asientos. No por funciones. Plataformas y cuentas.

**Mas plataformas, menor precio por plataforma:**

| Proveedores seleccionados | Precio por proveedor/mes |
| ------------------------- | ------------------------ |
| 1                         | $12                      |
| 2-3                       | $10                      |
| 4-6                       | $8                       |
| 7-10                      | $6                       |

**Mas cuentas, menor precio por cuenta:**

| Cuentas gestionadas | Multiplicador |
| ------------------- | ------------- |
| 1ra cuenta          | x1.0 (base)   |
| 2da-3ra             | x0.80         |
| 4ta-9na             | x0.65         |
| 10ma+               | x0.50         |

### Bundles Predefinidos

| Bundle      | Plataformas                         | Precio         |
| ----------- | ----------------------------------- | -------------- |
| Creator     | X + Instagram + YouTube             | $25/cuenta/mes |
| Social Pro  | X + Instagram + Facebook + LinkedIn | $32/cuenta/mes |
| Agency Full | Las 10 plataformas                  | $55/cuenta/mes |

### Plan Personalizado

Elegi cualquier combinacion de plataformas. El precio se ajusta automaticamente. Todas las funciones del producto incluidas en todos los niveles: IA, analiticas, SSO, CRM, gestion de equipo, todo. Sin restriccion de funciones por plan.

---

## Para Agencias

OmniPost fue construido para agencias de redes sociales que manejan multiples clientes:

- **Gestion multi-cuenta** — Los datos de cada cliente estan completamente aislados. Cambia entre cuentas desde un solo dashboard.
- **Precios por volumen** — Cuantos mas clientes manejas, menor es el precio por cuenta. 10+ cuentas al 50% de la tarifa base.
- **Programacion masiva** — Carga de CSV para grandes lotes de contenido en multiples cuentas.
- **Reportes para clientes** — Comparti analiticas via links publicos. Sin necesidad de login para el cliente.
- **Aprobaciones multi-nivel** — El contenido pasa por tu proceso de revision antes de publicarse.
- **Tracking de campanas** — Agrupa y medi campanas de clientes con integracion UTM.
- **Programa de referidos** — Gana 30 dias gratis por cada cliente referido que se convierte en usuario de pago.

---

## Confiable por Diseno

- Posts entregados a traves de infraestructura de cola empresarial con reintento automatico
- Monitoreo de estado en tiempo real para cada post programado y publicado
- 10 plataformas sociales, una sola capa de integracion, cada una con su propio adaptador
- Workers en segundo plano para ingestion de analiticas, sincronizacion de bandeja y procesamiento de IA
- Arquitectura multi-tenant con separacion criptografica de autenticacion

---

## Empieza Gratis

Prueba gratuita de 14 dias. Sin tarjeta de credito. Todas las funciones incluidas desde el dia uno. Empieza a publicar en 10 plataformas con IA que conoce tu marca.
