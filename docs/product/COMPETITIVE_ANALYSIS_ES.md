# Análisis Competitivo Detallado — OmniPost vs. Mercado 2026

> Investigación de mercado realizada en mayo de 2026 a partir de páginas oficiales de pricing y reviews independientes (G2, Capterra, Trustpilot, SocialRails, Research.com, comparativas 2026). Las cifras de precio cambian con frecuencia: reverificar antes de usar en material externo (inversores, ventas).
>
> **Leyenda de la matriz:**
>
> - ✅ Incluido en el plan base de pago
> - 🔼 Solo en tier superior (se indica cuál)
> - ➕ Add-on de pago separado (no incluido en ningún plan estándar)
> - 🟡 Versión básica/limitada
> - ❌ No disponible

---

## 1. Resumen ejecutivo

|                                       | Competidor más peligroso      | Por qué                                                                                                                                                                           |
| ------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Modelo de negocio (agencia LATAM)** | **Metricool**                 | Mismo segmento hispano, mismo rango de precio (~€12), agencia/multi-perfil, AI, el mejor valorado en la región                                                                    |
| **Modelo agencia multi-cliente**      | **Sendible**                  | Client Connect, dashboards por cliente, onboarding sin passwords — lo que OmniPost intenta con multi-tenant nativo                                                                |
| **Diferenciador "IA + analytics"**    | **Predis.ai / Vista Social**  | Predis ya predice performance pre-publicación; Vista Social entrena IA con knowledge base + brand voice por cliente. Erosionan el "diferenciador defendible" de los docs internos |
| **Incumbente enterprise**             | **Sprout Social / Hootsuite** | Solo si OmniPost sube al segmento terciario (SSO, listening, CX)                                                                                                                  |

**Hallazgo clave:** la afirmación de [INVESTOR_ES.md](INVESTOR_ES.md) de que "ningún competidor conecta analytics + IA generativa + adaptación multi-plataforma" era válida hace ~2 años. En 2026 **Predis.ai** (predicción de engagement pre-publicación), **Vista Social** (IA entrenada con knowledge base + brand voice) y **ContentStudio** (Agentic AI sobre content discovery) ya ofrecen variantes de esa conexión. La ventaja real de OmniPost hoy es: **(a)** profundidad de plataformas (Snapchat/Telegram/Bluesky nativos), **(b)** arquitectura multi-tenant nativa para agencias, **(c)** precio por-plataforma (no por-asiento), y **(d)** funciones autónomas integradas en una sola plataforma. El "AI informado por datos" ya no es suficiente como único diferenciador.

---

## 2. Comparativa de precios (2026)

Precios mensuales en USD salvo indicación. "anual" = precio efectivo/mes con facturación anual.

| Producto          | Plan entrada                        | Plan medio                        | Plan alto            | Enterprise            | Modelo de cobro           | Cuentas incluidas (entrada)  |
| ----------------- | ----------------------------------- | --------------------------------- | -------------------- | --------------------- | ------------------------- | ---------------------------- |
| **OmniPost**      | $12/plataforma                      | $8/plat. (4-6)                    | $6/plat. (7-10)      | —                     | **Por plataforma**        | según selección              |
| **Metricool**     | Free / Starter $25 (5 marcas)       | Advanced $54-$172                 | —                    | Custom                | Por nº de marcas          | Free: todas menos LinkedIn/X |
| **Buffer**        | Free / Essentials $5/canal          | Team $10/canal                    | —                    | —                     | **Por canal**             | Free: 3 canales              |
| **Predis.ai**     | Free / Core $19                     | Rise $40                          | —                    | Enterprise+ $212      | Por créditos AI           | Core: 10 canales             |
| **ContentStudio** | Standard $19                        | Advanced $49                      | Agency $99           | Custom                | Por créditos + cuentas    | Standard: 5 cuentas          |
| **Sendible**      | Creator $29                         | Traction $89 / Scale $199         | Advanced $299        | Enterprise $750       | Por tier (users+perfiles) | Creator: 6 perfiles          |
| **Loomly**        | Free / Starter $49 anual            | Beyond $249 anual                 | —                    | Custom                | Por tier                  | Starter: 12 cuentas          |
| **Vista Social**  | Free / Professional $79 ($64 anual) | Advanced $149                     | Scale $349           | Custom                | Por tier + à-la-carte     | Professional: 15 perfiles    |
| **Agorapulse**    | Free / Standard $99 ($79 anual)     | Professional $149 ($119)          | Advanced $199 ($149) | Custom                | **Por usuario**           | Standard: 10 perfiles        |
| **Hootsuite**     | Standard $99/user                   | Advanced $249/user                | —                    | Custom (~$15-16k/año) | **Por usuario**           | Standard: 10 cuentas         |
| **Sprout Social** | Essentials $99 ($79 anual)          | Standard $199 / Professional $299 | Advanced $399        | Custom                | **Por asiento**           | Essentials: 5 perfiles       |

**Observación de pricing:** OmniPost, Buffer (por canal) y Metricool (por marca) son los **únicos que no penalizan equipos grandes**. Agorapulse, Hootsuite y Sprout cobran **por usuario** — un equipo de 5 en Sprout Professional ≈ **$1,495/mes**. Este es el flanco de precio más explotable de OmniPost contra los incumbentes enterprise.

---

## 3. Matriz maestra de features

### 3.1 Publicación y scheduling

| Feature                     | OmniPost         | Metricool      | Buffer        | Sendible        | Agorapulse  | Hootsuite         | Sprout       | Vista Social  | Loomly     | Predis.ai        | ContentStudio |
| --------------------------- | ---------------- | -------------- | ------------- | --------------- | ----------- | ----------------- | ------------ | ------------- | ---------- | ---------------- | ------------- |
| Scheduling ilimitado        | ✅               | ✅ (pago)      | 🔼 Essentials | ✅              | ✅          | ✅                | ✅           | ✅            | ✅         | 🟡 manual (Core) | ✅            |
| Calendario visual           | ✅               | ✅             | ✅            | ✅              | ✅          | ✅                | ✅           | ✅            | ✅         | ✅               | ✅            |
| Bulk / CSV scheduling       | ✅               | ✅             | 🟡            | ✅              | 🔼 Advanced | 🔼 Advanced (350) | ✅           | ✅            | ✅         | ✅               | ✅            |
| Mejor hora para publicar    | ✅               | ✅             | ❌            | 🟡              | 🔼 Advanced | ✅                | ✅ (Optimal) | ✅            | ✅         | ❌               | ✅            |
| Recycling / colas evergreen | ✅               | ❌ (debilidad) | 🟡 cola       | ✅ Smart Queues | 🔼 Advanced | ✅                | ❌           | ✅ Smart Pub. | ✅         | ❌               | ✅ categorías |
| Variantes nativas por red   | ✅ (10 perfiles) | 🟡             | 🟡            | 🟡              | 🟡          | 🟡                | 🟡           | 🟡            | ✅ mockups | 🟡               | 🟡 grid       |
| Link-in-bio                 | ✅               | ✅ SmartLinks  | ✅ Start Page | ❌              | 🔼 Pro      | ❌                | ❌           | ✅ Vista Page | ❌         | ❌               |

### 3.2 IA / generación de contenido

| Feature                                       | OmniPost                     | Metricool      | Buffer   | Sendible     | Agorapulse     | Hootsuite  | Sprout          | Vista Social      | Loomly  | Predis.ai                 | ContentStudio          |
| --------------------------------------------- | ---------------------------- | -------------- | -------- | ------------ | -------------- | ---------- | --------------- | ----------------- | ------- | ------------------------- | ---------------------- |
| IA texto/caption                              | ✅ multi-LLM                 | ✅ 🟡 créditos | ✅ todos | ✅ ilimitado | ✅             | ✅ OwlyGPT | 🔼 Professional | ✅ créditos       | ✅ chat | ✅ core                   | ✅ créditos            |
| IA multi-proveedor + routing                  | ✅ (GPT-4/Gemini/Perplexity) | ❌             | ❌       | ❌           | ❌             | ❌         | ❌              | ❌                | ❌      | ❌                        | ❌                     |
| Brand Voice automático                        | ✅ inyección auto            | ❌             | ❌       | 🟡           | 🟡 Org Context | ❌         | 🟡              | ✅ knowledge base | ❌      | ✅ brand kit              | 🟡                     |
| Contenido informado por analytics             | ✅ top performers en prompt  | ❌             | ❌       | ❌           | ❌             | ❌         | ❌              | 🟡                | ❌      | ✅ predicción pre-publish | ❌                     |
| Generación de imagen IA                       | ✅                           | ✅             | ❌       | ✅ ilimitado | ❌             | ❌         | ❌              | ✅ 🟡 cuota       | ❌      | ✅                        | ✅ créditos            |
| Generación de video IA                        | 🟡                           | ❌             | ❌       | ✅           | ❌             | ❌         | ❌              | ❌                | ❌      | ✅ (slideshow)            | ✅ créditos + clipping |
| Carruseles IA                                 | 🟡                           | ❌             | ❌       | ❌           | ❌             | ❌         | ❌              | ❌                | ❌      | ✅ (feature estrella)     | ❌                     |
| Funciones autónomas (repurpose/triage/trends) | ✅ 3                         | ❌             | ❌       | ❌           | ❌             | ❌         | ❌              | 🟡 DM auto        | ❌      | ❌                        | 🟡 Agentic AI          |

### 3.3 Analytics y reporting

| Feature                       | OmniPost | Metricool     | Buffer        | Sendible             | Agorapulse  | Hootsuite   | Sprout             | Vista Social | Loomly | Predis.ai  | ContentStudio |
| ----------------------------- | -------- | ------------- | ------------- | -------------------- | ----------- | ----------- | ------------------ | ------------ | ------ | ---------- | ------------- |
| Analytics cross-platform      | ✅       | ✅ (fuerte)   | 🔼 Essentials | ✅                   | ✅          | 🔼 Advanced | ✅ (best-in-class) | ✅           | ✅     | 🟡 básico  | ✅ profundo   |
| Benchmarking competidores     | 🟡       | ✅ hasta 100  | ❌            | ❌                   | ➕ add-on   | 🟡 5 / 🔼20 | 🔼 Professional    | 🔼           | ❌     | ✅ (FB/IG) | 🔼 Advanced   |
| Reportes personalizados       | ✅       | 🔼 Advanced   | ❌            | 🔼 Scale             | 🔼 Advanced | 🔼 Advanced | 🔼 Advanced        | ✅           | ✅     | ❌         | 🔼 Advanced   |
| White-label reports           | ✅       | 🔼 Custom     | 🔼 Team       | ➕ add-on (Advanced) | ✅ todos    | ❌          | ❌                 | 🔼 Scale     | ❌     | ❌         | 🔼 Advanced   |
| Analytics de ads pagados      | 🟡       | ✅ (estrella) | ❌            | ❌                   | 🔼 Advanced | ✅          | 🔼 Professional    | ❌           | ❌     | ❌         | ❌            |
| Looker Studio / API analytics | 🟡       | 🔼 Advanced   | ❌            | ❌                   | 🔼 Advanced | ❌          | 🔼 Advanced        | ❌           | ❌     | ➕ API     | ✅ API        |

### 3.4 Inbox social / engagement

| Feature                     | OmniPost      | Metricool | Buffer    | Sendible | Agorapulse    | Hootsuite     | Sprout         | Vista Social  | Loomly | Predis.ai | ContentStudio |
| --------------------------- | ------------- | --------- | --------- | -------- | ------------- | ------------- | -------------- | ------------- | ------ | --------- | ------------- |
| Inbox unificado             | ✅            | ✅ 🟡     | ❌ (lite) | ✅       | ✅ (estrella) | ✅            | ✅ Smart Inbox | ✅            | ✅     | ❌        | 🔼 Advanced   |
| Triage/clasificación IA     | ✅ (estrella) | ❌        | ❌        | ❌       | 🔼 Custom     | 🔼 Advanced   | 🔼 Advanced    | ✅ DM auto    | ❌     | ❌        | 🟡 reply IA   |
| Análisis de sentimiento     | ✅            | ❌        | ❌        | ❌       | 🔼 Advanced   | 🔼 Advanced   | 🔼 Advanced    | 🔼 Enterprise | ❌     | ❌        | ❌            |
| Sugerencias de respuesta IA | ✅ (3 tonos)  | ❌        | 🟡        | ❌       | 🔼 Custom     | 🔼 Advanced   | ❌             | ✅            | ❌     | ❌        | ✅ Advanced   |
| Detección de colisión       | 🟡            | ❌        | ❌        | ❌       | 🔼 Pro        | ❌            | 🔼 Advanced    | ❌            | ❌     | ❌        | ❌            |
| Gestión de reseñas          | ❌            | 🟡        | ❌        | ❌       | ✅ Google     | ✅ Enterprise | ✅             | ✅ 6 sitios   | ❌     | ❌        | ❌            |

### 3.5 Colaboración, agencia y enterprise

| Feature                            | OmniPost        | Metricool   | Buffer   | Sendible                      | Agorapulse           | Hootsuite                  | Sprout        | Vista Social  | Loomly        | Predis.ai | ContentStudio  |
| ---------------------------------- | --------------- | ----------- | -------- | ----------------------------- | -------------------- | -------------------------- | ------------- | ------------- | ------------- | --------- | -------------- |
| Workflows de aprobación multinivel | ✅ N niveles    | 🔼 Advanced | 🔼 Team  | ✅                            | 🔼 Pro→Custom        | 🟡                         | 🔼 Advanced   | 🔼 Advanced   | ✅ (estrella) | ❌        | 🔼 Advanced    |
| RBAC / roles personalizados        | ✅              | 🔼 Advanced | 🔼 Team  | ✅                            | 🔼 Custom            | 🔼 Enterprise              | ✅            | 🔼            | 🔼 Beyond     | 🟡        | ✅             |
| Dashboards por cliente             | ✅ multi-tenant | ❌          | 🟡 Team  | ✅ Client Connect (Traction+) | 🔼 Profile Connector | 🟡                         | 🟡            | 🔼 Scale      | ❌            | 🟡 marcas | ✅ EasyConnect |
| White-label de plataforma          | 🟡              | 🔼 Custom   | ❌       | ➕ add-on                     | ❌                   | ❌                         | ❌            | 🔼 Scale      | ❌            | ❌        | 🔼 Enterprise  |
| CRM integrado (HubSpot/Salesforce) | ✅              | ❌          | ❌       | ❌                            | 🔼 Custom            | 🔼 Enterprise              | ✅            | ❌            | ❌            | ❌        | ❌             |
| SSO (SAML/OIDC)                    | ✅              | ❌          | ❌       | 🔼 Enterprise                 | 🔼 Custom            | 🔼 Enterprise              | 🔼 Enterprise | 🔼 Enterprise | ❌            | ❌        | 🔼 Enterprise  |
| Social listening real              | ❌              | ❌          | ❌       | 🟡                            | ➕ add-on            | 🔼 Enterprise (Talkwalker) | ➕ add-on     | ➕ $75/mo     | ❌            | ❌        | 🟡 discovery   |
| Content discovery / curación       | 🟡 trends       | 🟡          | 🟡 Ideas | ❌                            | ❌                   | ❌                         | ❌            | ✅ Smart Pub  | 🟡 Post Ideas | ❌        | ✅ (estrella)  |

---

## 4. Ficha por competidor: features estrella + qué es base vs. coste extra

### 4.1 Metricool — _el rival más directo en LATAM_

- **Estrella:** analytics + benchmarking de hasta 100 competidores; dashboards de **ads pagados** junto a orgánico; conector Looker Studio + reportes PDF/PPT; precio agresivo.
- **Base (Starter ~$25):** scheduling ilimitado, inbox, IA con créditos limitados, SmartLinks.
- **Coste extra:** **X/Twitter = +$5/mes por cuenta en TODOS los planes** (incluido Custom); LinkedIn solo en planes de pago; gestión de equipo + aprobaciones → **Advanced**; white-label + account manager → **Custom**; plantillas de reporte + Looker → **Advanced**.
- **Debilidades:** sin social listening real, sin recycling de contenido, sin editor de video, inbox sin auto-triggers, UI anticuada, créditos IA no divulgados.

### 4.2 Sendible — _el benchmark de modelo agencia_

- **Estrella:** dashboards white-label rebrandables con dominio propio; Client Connect (espacios por cliente); Smart Queues (recycling); **créditos IA ilimitados en todos los planes**.
- **Base (Creator $29):** 1 user, 6 perfiles, scheduling, IA ilimitada, inbox, **solo reportes prefabricados**.
- **Coste extra:** report builder custom → **Scale ($199)**; Client Connect/dashboards → **Traction+**; **white-label = add-on de pago, solo desde Advanced**; SSO → Enterprise.
- **Debilidades:** listening débil (sin sentimiento ni competidores); X degradado a solo-publicación; fallos recurrentes de LinkedIn; UI recargada; precio escala fuerte a escala agencia.

### 4.3 Agorapulse — _inbox-first, caro por usuario_

- **Estrella:** inbox unificado con reglas de moderación + detección de colisión; ROI vía Google Analytics; Power Reports; AI writing assistant en todos los planes.
- **Base (Standard $79-99/user):** 10 perfiles, scheduling, inbox, 1 regla moderación/perfil, 6 meses retención.
- **Coste extra:** **listening = add-on de pago** (Advanced Listening, custom); Benchmarking y Advocacy = add-ons separados; **X/Twitter = add-on X Lite/X Plus**; perfiles extra = **$10/mes c/u**; pricing **por usuario** (3 users Standard ≈ $237-297/mes); SSO/HubSpot/Salesforce/AI replies → **Custom**.
- **Debilidades:** precio por-usuario escala rapidísimo; listening y benchmarking casi duplican el precio; app móvil limitada.

### 4.4 Hootsuite — _incumbente enterprise premium_

- **Estrella:** dashboard todo-en-uno; OwlyGPT; listening con Talkwalker (Enterprise); Amplify employee advocacy (Enterprise).
- **Base (Standard $99/user):** 10 cuentas, analytics básico, listening 7 días, 5 competidores, inbox básico.
- **Coste extra:** cuentas ilimitadas + analytics exportable + ROI + listening 30 días → **Advanced ($249/user)**; **Talkwalker listening, Amplify, Advanced Analytics, Social CRM, SSO, Salesforce, AI Reply → solo Enterprise** (~$15-16k/año); perfiles extra ~$10-20/mes.
- **Debilidades:** UI recargada con curva de aprendizaje; analytics avanzado tras paywall; sin plan gratis; por-usuario prohibitivo para agencias pequeñas.

### 4.5 Sprout Social — _premium analytics + CX_

- **Estrella:** Smart Inbox (social CRM); analytics y reporting best-in-class; Social Listening (add-on); IA (AI Assist, sentimiento, edición de tono).
- **Base (Standard $199/seat):** 5 perfiles, Smart Inbox, reportes básicos, gestión de reseñas — **sin aprobaciones, sin IA, sin reportes competitivos**.
- **Coste extra:** perfiles ilimitados + IA Assist + reportes competitivos → **Professional ($299)**; sentimiento + automatización + aprobaciones + API → **Advanced ($399)**; SSO → Enterprise; **add-ons separados (precio opaco):** Premium Analytics, Social Listening, Employee Advocacy, Influencer Marketing.
- **Debilidades:** auto-renovación agresiva + contrato 12-24 meses (queja dominante); coste por-asiento altísimo; Standard limita 5 perfiles; add-ons opacos.

### 4.6 Buffer — _simplicidad, precio por canal_

- **Estrella:** publicación simple con precio predecible por canal; AI Assistant en todos los tiers (incl. Free); plan gratis generoso; Ideas + Start Page.
- **Base (Essentials $5/canal):** scheduling ilimitado, analytics avanzado, hashtag manager, IA/replies ilimitados.
- **Coste extra:** aprobaciones + permisos + usuarios ilimitados + reportes branded + invitar clientes → **solo Team ($10/canal)**; descuento por volumen >10 canales (~$3.33/canal).
- **Debilidades:** **sin social listening**; engagement lite (sin inbox/CRM real); analytics superficial; sin tier agencia/white-label real.

### 4.7 Vista Social — _cobertura de redes + IA con knowledge base_

- **Estrella:** **13+ redes** (incl. Bluesky, Threads, Reddit, Tumblr, Snapchat); AI Assistant entrenado con knowledge base + DM Automation; gestión de reseñas en 6 sitios; **pricing modular à-la-carte**.
- **Base (Professional $79):** 3 users, 15 perfiles, 2.500 créditos IA, 50 imágenes IA, planning/engagement/reportes/reseñas básicos.
- **Coste extra:** workflows multinivel + custom domains + Zapier/Make + knowledge base → **Advanced ($149)**; white-label + client connections + créditos ilimitados → **Scale ($349)**; sentimiento/premium analytics/SSO → **Enterprise**; **siempre add-on:** X/Twitter $29/mo, Listening $75/mo, Advocacy $199/mo (25 emp), perfiles/users extra.
- **Debilidades:** X como add-on impopular; créditos IA se agotan rápido; complejidad de pricing (muchos add-ons); soporte solo email bajo Enterprise.

### 4.8 Loomly — _colaboración/aprobaciones first_

- **Estrella:** Post Ideas + tips de optimización + trends de X; workflows de aprobación custom multinivel; calendario editorial por marca; post mockups casi nativos.
- **Base (Starter $49 anual):** IA chat, scheduling, aprobaciones, analytics avanzado — tope **3 users / 12 cuentas**.
- **Coste extra:** custom branding + roles custom + Hashtag Manager + 2FA → **Beyond ($249 anual, salto de ~+$200/mes)**; **sin opción à-la-carte** — el 4º user o la 13ª cuenta fuerzan upgrade completo.
- **Debilidades:** gap de precio Starter→Beyond sin tier intermedio; IA débil, sin generación de imagen; **sin listening**; fallos de publicación; sin white-label/agencia real.

### 4.9 Predis.ai — _IA de creación + predicción de performance_

- **Estrella:** generación IA (texto→post, **carruseles** = su mejor feature, text-to-video); **predicción de engagement pre-publicación**; análisis de competidores (FB/IG); automatización e-commerce (Shopify/WooCommerce).
- **Base (Core $19):** 1 marca, 10 canales, 1.300 créditos, **sin auto-posting**, 60 análisis competidor/mes.
- **Coste extra:** auto-posting + 4 marcas → **Rise ($40)**; marcas ilimitadas + 600 análisis + 60 canales → **Enterprise+ ($212)**; **add-ons:** canales extra $5-99/mo, +1.200 créditos $29/mo, **API custom**. IA medida por créditos en todos los tiers (video/voiceover consume por segundo).
- **Debilidades:** video = "slideshow animado", no generativo real; diseño bajo Canva; scheduler básico; sin inbox/engagement; analytics mínimo — no sirve como SMM standalone.

### 4.10 ContentStudio — _content discovery + Agentic AI_

- **Estrella:** motor de Content Discovery con **Agentic AI** (resume, añade tu opinión, distribuye); creación IA; módulo de análisis de competidores; inbox unificado + analytics profundo.
- **Base (Standard $19):** 1 user, 5 cuentas, 1 workspace, discovery + RSS + scheduling — **sin inbox, sin aprobaciones, sin competidores, sin white-label**.
- **Coste extra:** Social Inbox + aprobaciones + competidores + white-label reports + client dashboards → **Advanced ($49)**; users/workspaces ilimitados + créditos grandes → **Agency ($99)**; **SSO + white-label de plataforma + API completo → Enterprise**; **add-ons en todos los tiers:** cuentas ($5→$1), users (+$10), workspaces (+$10), créditos IA (+$5/100).
- **Debilidades:** créditos IA se agotan rápido (sin opción ilimitada); Discover a veces desactualizado; curva de aprendizaje; sin plantillas de creación de video; no sustituye listening enterprise.

---

## 5. Conclusiones estratégicas para OmniPost

1. **El doc de inversores omite a Metricool y Sendible** — los dos competidores que más se parecen a OmniPost en modelo de negocio y mercado. Un inversor que conozca el sector lo notará. Recomendación: añadir ambos a la comparativa de [INVESTOR_ES.md](INVESTOR_ES.md).

2. **El "diferenciador defendible" necesita reformularse.** "IA conectada a analytics" ya lo tienen Predis.ai (predicción pre-publish), Vista Social (knowledge base) y ContentStudio (Agentic AI). El diferenciador defendible real de OmniPost es la **combinación simultánea**: 10-12 plataformas nativas (Snapchat/Telegram/Bluesky) + multi-tenant nativo + IA multi-LLM con routing + funciones autónomas + CRM + SSO **a precio por-plataforma**. Ningún competidor reúne los 6 a la vez — ese es el mensaje, no "IA + analytics" solo.

3. **El precio por-plataforma es el arma más fuerte.** Solo Buffer (por canal) y Metricool (por marca) no penalizan equipos; Agorapulse/Hootsuite/Sprout cobran por-usuario y se vuelven prohibitivos. Posicionar agresivamente contra el coste por-asiento.

4. **Gaps de OmniPost a cubrir:** (a) **social listening real** — ausente; todos los enterprise lo tienen (aunque como add-on caro), es la objeción #1 esperable de agencias; (b) **gestión de reseñas** — Agorapulse/Sprout/Vista lo tienen, OmniPost no; (c) **white-label de plataforma maduro** — Sendible/Vista/ContentStudio lo ofrecen, es decisivo para agencias.

5. **Benchmark feature-by-feature contra Sendible y Agorapulse, no contra Sprout.** Sprout/Hootsuite son referencia de precio (caros), pero el comprador-agencia de OmniPost compara funcionalmente con Sendible (modelo cliente) y Agorapulse (inbox). Ese es el set competitivo operativo.

---

## 6. Clasificación de todas las features por orden de necesidad

> **Lente:** un producto SMM/CMS para **agencias y creadores en 2026** (caso OmniPost). La clasificación mezcla dos ejes: _cuán imprescindible es tenerla_ y _cuánto diferencia_. Escala, de mayor a menor necesidad:
>
> | Nivel                    | Significado                                                                                                                     |
> | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
> | 🟥 **Obligatoria**       | Table-stakes absoluto. Sin esto no hay producto: deal-breaker inmediato. Es base, no diferencia, pero su ausencia te elimina.   |
> | 🟧 **Necesaria**         | El comprador-agencia la pide activamente. Paridad competitiva: su ausencia es una objeción seria de venta.                      |
> | 🟨 **Corriente**         | Commodity de higiene: todos la tienen, ya no diferencia. Hay que tenerla bien hecha para no perder, pero hacerla no gana deals. |
> | 🟩 **Bueno tenerla**     | Aporta valor real, sube retención/ticket o cierra objeciones. No es deal-breaker.                                               |
> | 🟦 **Interesante**       | Emergente/innovadora. Posible diferenciador futuro, necesidad aún no probada. Apuesta, no obligación.                           |
> | ⬛ **Pérdida de tiempo** | Bajo ROI, bloat, humo de marketing o fuera del foco del producto. No mover recursos aquí.                                       |

### 6.1 Publicación y scheduling

| Feature                                                 | En qué consiste                                                    | Nivel            | Por qué                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------- |
| Scheduling ilimitado + calendario visual                | Programar posts a futuro en todas las redes desde un calendario    | 🟥 Obligatoria   | Es la razón de existir de la categoría. Sin esto no eres un SMM. Lo tienen los 10.                        |
| Publicación nativa por red (límites, hashtags, formato) | Adaptar automáticamente cada post a las reglas de cada plataforma  | 🟥 Obligatoria   | El "publica una vez" es el value prop central; sin adaptación nativa el contenido se rompe.               |
| Preview/mockup por canal                                | Ver exactamente cómo se verá el post antes de publicar             | 🟧 Necesaria     | Reduce errores y reproceso; las agencias lo exigen para aprobaciones de cliente. Loomly lo hace bandera.  |
| Mejor hora para publicar                                | Recomendación algorítmica del horario de mayor engagement          | 🟨 Corriente     | Lo tienen casi todos; ya no diferencia, pero su ausencia se nota (Buffer no lo tiene y se lo critican).   |
| Bulk / CSV scheduling                                   | Cargar decenas/cientos de posts de una vez                         | 🟧 Necesaria     | Crítico para agencias con volumen (75+ posts/día). Sin esto no escalas multi-cliente.                     |
| Recycling / colas evergreen                             | Re-publicar automáticamente contenido perenne                      | 🟩 Bueno tenerla | Ahorra trabajo real (Sendible Smart Queues es estrella). Metricool/Loomly no lo tienen y se los critican. |
| Primer comentario programado                            | Publicar el primer comentario (hashtags/links) junto al post       | 🟨 Corriente     | Práctica estándar de IG; barato de implementar, esperado, no diferencia.                                  |
| Link-in-bio / página de enlaces                         | Página agregadora de links (tipo Linktree)                         | 🟩 Bueno tenerla | Sube ticket y stickiness en creadores; no es deal-breaker para agencias.                                  |
| RSS / blog auto-posting                                 | Auto-publicar desde feeds RSS                                      | 🟦 Interesante   | Útil para content curation pero nicho; solo agencias de contenido lo valoran.                             |
| Post templates                                          | Plantillas reutilizables de estructura de post                     | 🟨 Corriente     | Commodity de productividad; esperado, no mueve la aguja.                                                  |
| Audience targeting / sponsoring                         | Segmentar la audiencia orgánica o promocionar desde la herramienta | 🟦 Interesante   | Pocos lo usan bien; potencial diferenciador si se liga a ads analytics.                                   |

### 6.2 IA y generación de contenido

| Feature                                       | En qué consiste                                                | Nivel                | Por qué                                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| IA de texto/caption                           | Generar copys/captions desde un prompt                         | 🟥 Obligatoria       | En 2026 es table-stakes; los 10 la tienen (incluso Buffer en plan gratis). Sin esto estás fuera.                                        |
| Contenido informado por analytics reales      | Inyectar los top-performers de la cuenta en el prompt de IA    | 🟦 Interesante       | Era el diferenciador de OmniPost; Predis (predicción) y Vista (knowledge base) ya lo erosionan. Apuesta defendible si se ejecuta mejor. |
| IA multi-proveedor con routing                | Enrutar a GPT-4/Gemini/Perplexity según la tarea               | 🟦 Interesante       | Ningún competidor lo hace; diferenciador técnico real, pero el usuario no lo "ve" — hay que traducirlo a beneficio (calidad/coste).     |
| Brand Voice automático                        | Inyectar el tono de marca en cada generación                   | 🟧 Necesaria         | Es la queja #1 contra la IA de Hootsuite/Sprout ("genérica"). Pasó de diferenciador a expectativa.                                      |
| Generación de imagen IA                       | Crear imágenes desde prompt                                    | 🟨 Corriente         | Sendible/Vista/Predis/ContentStudio/Metricool ya la tienen; commoditizada por el mercado.                                               |
| Carruseles IA                                 | Generar carruseles multi-slide con estilo consistente          | 🟩 Bueno tenerla     | Feature estrella de Predis; alto valor percibido en IG/LinkedIn, todavía poco común.                                                    |
| Generación de video IA                        | Texto→video / Reels                                            | 🟦 Interesante       | Hype alto pero output aún débil ("slideshow animado" en Predis). Apuesta, no obligación todavía.                                        |
| Funciones autónomas (repurpose/triage/trends) | Agentes que reutilizan, clasifican y detectan tendencias solos | 🟦 Interesante       | Diferenciador real de OmniPost; ContentStudio (Agentic AI) empieza a competir. Sube switching cost.                                     |
| Hashtag manager/generator                     | Sugerir y gestionar hashtags                                   | 🟨 Corriente         | Commodity total; esperado, cero diferenciación.                                                                                         |
| AI alt-text                                   | Generar texto alternativo accesible                            | 🟩 Bueno tenerla     | Bajo coste, alto valor de accesibilidad/compliance; Agorapulse/Sprout lo promueven.                                                     |
| Image-to-caption                              | La IA mira la imagen y propone el caption                      | 🟦 Interesante       | Innovador (ContentStudio); reduce fricción real, aún poco común.                                                                        |
| Brand kit / asset library                     | Logos, colores, fuentes y stock para consistencia              | 🟩 Bueno tenerla     | Sube retención en agencias multi-marca; no es deal-breaker.                                                                             |
| AI voiceover                                  | Locución IA para videos                                        | ⬛ Pérdida de tiempo | Nicho, consume créditos caros (Predis cobra por segundo), bajo uso real. Fuera del foco SMM.                                            |
| Meme generator                                | Generador de memes                                             | ⬛ Pérdida de tiempo | Gimmick; no mueve retención ni ticket. Bloat.                                                                                           |
| Blog→video / blog→carousel                    | Convertir un artículo en post visual                           | 🟦 Interesante       | Útil para content marketers; nicho, no para el comprador-agencia core.                                                                  |
| E-commerce product → post/video               | Feed Shopify/WooCommerce → posts automáticos                   | 🟦 Interesante       | Diferenciador fuerte **solo** si el ICP es e-commerce; fuera de foco si el ICP es agencia.                                              |
| Generación multi-idioma                       | Generar contenido en N idiomas                                 | 🟧 Necesaria         | Para el mercado LATAM/hispano de OmniPost es necesidad, no opción.                                                                      |

### 6.3 Analytics y reporting

| Feature                                | En qué consiste                                           | Nivel            | Por qué                                                                                                           |
| -------------------------------------- | --------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| Analytics cross-platform               | Métricas unificadas de todas las redes                    | 🟥 Obligatoria   | Sin medir resultados la herramienta no justifica su precio. Table-stakes.                                         |
| Reportes exportables (PDF/PPT)         | Informes descargables para presentar al cliente           | 🟧 Necesaria     | Una agencia que no puede entregar un reporte al cliente no compra. Objeción inmediata.                            |
| White-label reports                    | Reportes con la marca de la agencia, sin la del proveedor | 🟧 Necesaria     | Para el ICP agencia es casi obligatoria; Sendible/ContentStudio la gatean en tiers altos justamente porque vende. |
| Reportes personalizables / plantillas  | Construir el informe a medida del cliente                 | 🟩 Bueno tenerla | Sube ticket (Sendible lo pone en Scale $199); valioso pero no deal-breaker en entrada.                            |
| Benchmarking de competidores           | Comparar tu cuenta vs. rivales                            | 🟩 Bueno tenerla | Estrella de Metricool (100 competidores); alto valor percibido, aún diferencia.                                   |
| ROI reporting (integración GA)         | Atribuir ventas/leads al social vía Google Analytics      | 🟦 Interesante   | Estrella de Agorapulse; difícil de hacer bien, fuerte si se logra (cierra la venta a marketing).                  |
| Analytics de ads pagados               | Métricas de campañas pagas junto a orgánico               | 🟦 Interesante   | Diferenciador de Metricool; el resto casi no lo tiene. Apuesta con upside.                                        |
| Scheduled email reports                | Envío automático periódico del informe                    | 🟨 Corriente     | Esperado en agencia; commodity, no diferencia.                                                                    |
| Conector Looker Studio / API analytics | Exportar la data a BI externo                             | 🟩 Bueno tenerla | Lo piden agencias data-driven; gateado en tiers altos por casi todos.                                             |
| Hashtag / audience demographics        | Tracking de hashtags y demografía de audiencia            | 🟨 Corriente     | Commodity analítico; esperado, no mueve la decisión.                                                              |

### 6.4 Inbox social y engagement

| Feature                                  | En qué consiste                                               | Nivel            | Por qué                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------- |
| Inbox unificado                          | Comentarios, DMs, menciones de todas las redes en una bandeja | 🟧 Necesaria     | El comprador-agencia lo espera (estrella de Agorapulse/Sprout). Buffer no lo tiene y se lo critican duro. |
| Triage/clasificación IA del mensaje      | Clasificar cada mensaje (queja/lead/spam) automáticamente     | 🟦 Interesante   | Diferenciador de OmniPost; solo Vista/ContentStudio empiezan. Alto valor si funciona.                     |
| Sugerencias de respuesta IA (multi-tono) | Proponer 2-3 respuestas en el brand voice                     | 🟦 Interesante   | Diferenciador real; Sprout/Agorapulse lo gatean a tiers top. Sube velocidad de soporte.                   |
| Análisis de sentimiento                  | Detectar si el mensaje es positivo/negativo                   | 🟩 Bueno tenerla | Esperado en enterprise; gateado en tiers altos en todos. Valioso, no deal-breaker en entrada.             |
| Saved replies / plantillas               | Respuestas guardadas reutilizables                            | 🟨 Corriente     | Commodity de soporte; esperado, cero diferenciación.                                                      |
| Asignación / tagging de mensajes         | Asignar conversaciones a miembros del equipo                  | 🟧 Necesaria     | Sin esto un equipo de agencia no puede operar el inbox. Paridad obligada.                                 |
| Detección de colisión                    | Avisar si dos personas responden el mismo mensaje             | 🟩 Bueno tenerla | Evita doble-respuesta vergonzosa; valorado por equipos, no deal-breaker.                                  |
| Gestión de reseñas                       | Responder reviews de Google/Yelp/Trustpilot                   | 🟩 Bueno tenerla | **Gap de OmniPost.** Agorapulse/Sprout/Vista lo tienen; objeción esperable de agencias locales.           |
| Traducción inline                        | Traducir el mensaje entrante en la bandeja                    | 🟦 Interesante   | Muy relevante para el ICP LATAM/multi-idioma de OmniPost; poco común.                                     |
| Reglas de moderación / automatización    | Auto-ocultar/etiquetar/responder según reglas                 | 🟩 Bueno tenerla | Estrella de Agorapulse; ahorra trabajo a escala, gateado por valor.                                       |

### 6.5 Colaboración, agencia y enterprise

| Feature                                                         | En qué consiste                                                 | Nivel                | Por qué                                                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------- |
| Workflows de aprobación (multinivel)                            | Cadena de revisión/aprobación antes de publicar                 | 🟥 Obligatoria       | Para agencia es deal-breaker: ningún cliente deja publicar sin aprobar. Estrella de Loomly por algo.          |
| RBAC / roles y permisos                                         | Control de quién ve/hace qué                                    | 🟧 Necesaria         | Sin roles, una agencia no puede separar clientes/equipos. Paridad obligada; gateado por casi todos.           |
| Dashboards / espacios por cliente                               | Aislamiento de datos por cliente, vista por cliente             | 🟥 Obligatoria       | Es **el** requisito del ICP agencia multi-cliente. Es la ventaja arquitectural multi-tenant de OmniPost.      |
| Onboarding sin compartir passwords (Client Connect/EasyConnect) | El cliente conecta sus propias cuentas                          | 🟧 Necesaria         | Bloqueante de venta a agencias serias (seguridad/compliance). Sendible/ContentStudio lo hacen bandera.        |
| White-label de plataforma                                       | La herramienta entera con la marca de la agencia                | 🟩 Bueno tenerla     | Sube mucho el ticket y el switching cost; gateado a tiers top por todos porque vende.                         |
| CRM integrado (HubSpot/Salesforce)                              | Sincronizar conversaciones/leads con el CRM                     | 🟦 Interesante       | Diferenciador de OmniPost vs. casi todos; fuerte para el segmento marketing/enterprise.                       |
| SSO (SAML/OIDC)                                                 | Inicio de sesión corporativo único                              | 🟧 Necesaria         | Deal-breaker para enterprise (terciario). Todos lo gatean a Enterprise; obligado para subir de segmento.      |
| Audit logs                                                      | Registro inmutable de acciones                                  | 🟩 Bueno tenerla     | Requisito de compliance enterprise; OmniPost ya lo tiene, úsalo como argumento.                               |
| Social listening real                                           | Monitoreo de menciones/sentimiento/share-of-voice en web+social | 🟧 Necesaria         | **Gap crítico de OmniPost.** Objeción #1 esperable; todos los enterprise lo tienen (aunque como add-on caro). |
| Content discovery / curación                                    | Descubrir contenido/tendencias del nicho para curar             | 🟦 Interesante       | Estrella de ContentStudio; diferencia para agencias de contenido, nicho para el resto.                        |
| Comentarios internos / notas                                    | Discusión interna del equipo sobre un post                      | 🟨 Corriente         | Commodity de colaboración; esperado, no diferencia.                                                           |
| Notificaciones Slack/Teams                                      | Avisar al equipo en su chat de trabajo                          | 🟨 Corriente         | Integración esperada; commodity.                                                                              |
| Employee advocacy                                               | Empleados amplifican el contenido corporativo                   | 🟦 Interesante       | Add-on caro en Hootsuite/Vista; solo enterprise grande lo valora. Apuesta de segmento.                        |
| Influencer marketing                                            | Descubrir/gestionar influencers                                 | ⬛ Pérdida de tiempo | Producto aparte (Sprout lo separa); fuera del foco de un SMM/CMS. No invertir aquí.                           |
| Mobile app                                                      | App nativa iOS/Android                                          | 🟧 Necesaria         | Esperada; su ausencia o debilidad es queja recurrente (Agorapulse, Vista). Paridad obligada.                  |
| 2FA / seguridad de cuenta                                       | Doble factor para acceso                                        | 🟥 Obligatoria       | Higiene de seguridad no negociable; manejas credenciales de terceros.                                         |

### 6.6 Integraciones

| Feature                          | En qué consiste                                   | Nivel            | Por qué                                                                                       |
| -------------------------------- | ------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| Canva / herramientas de diseño   | Crear/editar visuales sin salir de la herramienta | 🟧 Necesaria     | Esperada por casi todos; su ausencia obliga a saltar de app y se nota.                        |
| Google Drive / Dropbox           | Importar media desde la nube                      | 🟨 Corriente     | Commodity de importación; esperado, no diferencia.                                            |
| Zapier / Make                    | Automatizar con miles de apps externas            | 🟩 Bueno tenerla | Cubre el "long tail" de integraciones sin construirlas; gateado a tiers altos por valor.      |
| API pública / MCP                | Integración programática propia                   | 🟩 Bueno tenerla | La piden agencias técnicas/enterprise; diferencia en segmento alto. OmniPost ya es API-first. |
| WordPress / blog publishing      | Publicar también en el blog/CMS                   | 🟦 Interesante   | Relevante solo si el ICP hace content marketing long-form; nicho.                             |
| Bitly / acortador de links + UTM | Acortar y trackear enlaces                        | 🟨 Corriente     | Commodity de tracking; esperado, cero diferenciación.                                         |

### 6.7 Lectura estratégica de la clasificación

- **Lo Obligatorio que OmniPost ya cubre** (scheduling+nativo, aprobaciones, dashboards por cliente, 2FA): es tu base — no es marketing, es supervivencia. Comunícalo como "lo damos por hecho", no como diferenciador.
- **Lo Necesario donde tienes un gap** → **social listening real** y **gestión de reseñas** son las dos objeciones de venta más probables. Priorizar en roadmap antes que cualquier feature 🟦 Interesante.
- **Tus 🟦 Interesantes son tu narrativa de diferenciación**: IA multi-LLM con routing, contenido informado por analytics, funciones autónomas, triage IA, CRM integrado, traducción inline. Ninguna sola gana; **la combinación** es el pitch (ver §5.2).
- **No invertir en ⬛**: AI voiceover, meme generator, influencer marketing — son bloat que infla la matriz de features pero no mueve adquisición ni retención. Predis/Sprout los tienen y aun así no es lo que les compran.
- **Cuidado con las 🟨 Corrientes**: hay que tenerlas todas y bien hechas (su ausencia te elimina por "checklist"), pero cero presupuesto de marketing — nadie cambia de herramienta por un hashtag manager.

---

_Fuentes principales: páginas oficiales de pricing de cada producto (mayo 2026); G2; Capterra; Trustpilot; SocialRails; Research.com; comparativas 2026 de Buffer, Zapier, Planable, SocialBu, Copyter, DigitalApplied. Las cifras de precios y la disponibilidad de features cambian con frecuencia — reverificar contra las páginas oficiales antes de usar en material externo._
