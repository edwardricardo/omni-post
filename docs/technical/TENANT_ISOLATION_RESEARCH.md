# Aislamiento de tenant en entidades de propiedad transitiva — investigación y decisión

- **Estado**: investigación cerrada, decisión propuesta (pendiente de firma)
- **Fecha**: 2026-08-28
- **Alcance**: los 65 modelos sin `accountId` propio, con `Post` / `PostContent` / `PostMedia` en el centro
- **Relación con el canon vigente**: extiende ADR-0014 (multi-tenant isolation guards) y ADR-0020 (tenant context at boundaries). No los reemplaza.

> **Nota de método.** Cinco investigaciones paralelas produjeron el material fuente; una pasada de verificación adversarial fue contra las fuentes primarias y anuló cinco afirmaciones centrales. Este documento aplica el resultado de la verificación, no el de los informes. Donde una cifra circulaba como "medida" y no lo era, se dice explícitamente. Los números del repo que aparecen abajo los medí en esta sesión contra `main` (`b2281abc`), no los tomé del enunciado.

---

## 1. La pregunta, en una línea

**¿Debe `Post` llevar su propia `accountId`, o alcanza con que la herede por la cadena de claves foráneas?**

Importa acá y no en abstracto porque `Post` **es el producto**. OmniPost existe para publicar, agendar y medir contenido; `Post` es ese contenido. Y es exactamente la entidad que ninguna de las dos capas de aislamiento alcanza:

- El guard de Prisma (`$extends`) inyecta `where.accountId` en modelos enrolados. Sin columna no hay nada que inyectar.
- La política RLS es `USING (current_setting('app.account_id') = '__system__' OR "accountId" = current_setting('app.account_id'))`. Sin columna la política ni siquiera compila.

Medido en el repo, la correlación es perfecta y eso ordena el problema: **59 modelos tienen `accountId`, y exactamente esos 59 tienen RLS**. La cobertura no es una decisión aparte de la columna; la cobertura **es** la columna. Los 65 restantes no están "pendientes de enrolar": son inalcanzables por construcción bajo la forma actual de la política.

Hoy el aislamiento de esos 65 descansa en el gate de caller a nivel aplicación (ADR-0020) más el hecho incidental de que el padre guardado suele consultarse primero. Eso es defensa por convención, no por construcción.

> **Precondición que ordena todo lo demás.** Antes de decidir A, B o C hay que verificar que RLS **hoy esté enforceando algo**. Medido: **cero ocurrencias de `FORCE ROW LEVEL SECURITY` en todo el árbol de migraciones**. La migración base documenta que la app debe correr como rol `omnipost_app` no-superusuario, pero la memoria del proyecto registra que en la práctica se conecta como `postgres` con `BYPASSRLS`. Si eso sigue así, los 59 modelos que creemos cubiertos son decoración, y construir A′ o B encima sería construir sobre un límite que nunca enforceó nada. Esto se detalla como Tajada 0 en la sección 6.

---

## 2. Qué hace la industria

### 2.1 Lo que está MEDIDO

Muy poco, y menos de lo que parecía. Distingo tres categorías con rigor porque la diferencia decidió el resultado.

**Sobrevive al escrutinio:**

| Medición                                                                                                  | Fuente                                                                                            | Qué mide realmente                                                                            |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Política sobre columna local indexada: 171 ms → **<0,1 ms** con índice                                    | [Supabase / GaryAustin1](https://github.com/orgs/supabase/discussions/14576)                      | 100K filas. Confirma que la forma "columna local" es esencialmente gratis                     |
| Política con función que contiene un join: **11.000 ms → 7 ms** al envolverla en `(select …)`             | ídem                                                                                              | El costo no es el join, es la correlación por fila                                            |
| Reversión de la dirección del join: **9.000 ms → 20 ms**                                                  | ídem                                                                                              | La forma correlacionada vs la descorrelacionada, mismo dato                                   |
| Pertenencia a conjunto, 1M filas, con índice: **2 ms** (100 padres) / **3 ms** (500) / **24 ms** (10.000) | ídem                                                                                              | El costo escala con _padres por tenant_, no con filas                                         |
| Detección automática de IDOR: **59,9 % recall / 57,5 % precisión / 57,1 % F1**                            | [Semgrep, 2026-08-27](https://semgrep.dev/blog/2026/idor-detection-benchmark-semgrep-multimodal/) | 275 etiquetas revisadas a mano, 4 repos. Publicado por el vendor que gana su propio benchmark |
| 84 de 107 divulgaciones clasificadas son BOLA real; **41,7 % son "Action-Level Object BOLA"**             | [arXiv:2605.25865, 2026-05-25](https://arxiv.org/abs/2605.25865)                                  | Preprint, un solo autor, sin revisión por pares                                               |

Las cifras de Supabase **no traen versión de PostgreSQL ni fecha**, y no confirman que ambos brazos ejecutaran la misma consulta. Son internamente consistentes y reproducibles desde un harness público; se usan como orden de magnitud, no como precisión.

El 41,7 % de "Action-Level Object BOLA" — autorización verificada con la granularidad equivocada, típicamente sobre el objeto padre en vez del objeto mutado — **es literalmente la forma `Post` guardado vía `Project`**. Es el dato más directamente aplicable de todo el corpus.

**Lo que hubo que descartar — la corrección más importante de esta investigación:**

Tres de los cinco informes apoyaron su veredicto sobre la opción B en una medición de [pgsql-performance del 2023-07-10](https://www.postgresql.org/message-id/CAPcM0QW3yFGqnRGvR2PzbeZVYBuQTkE72+rdt9dE6Bqs2KSwgQ@mail.gmail.com): 350,922 ms con RLS contra 0,094 ms sin RLS sobre un esquema isomorfo al nuestro. Un factor de 3.700×.

**No es una comparación controlada y no debe entrar en la decisión.** Al leer el mensaje original:

1. **Son consultas distintas.** El brazo con RLS es `select * from "Track"` sin filtro. El brazo sin RLS es un `Aggregate` que devuelve **una fila**, con el predicado de tenant **hardcodeado como literal `116`** en vez de `current_setting()`.
2. **68 de los 350 ms son compilación JIT**, no RLS. El plan muestra `JIT: … Total 68.135 ms` y `actual time=68.097..350.074`: la primera tupla llega exactamente en el límite del JIT.
3. **Es una pregunta de foro sin responder.** El hilo compañero ([Ventimiglia, 2023-08-14](https://www.postgresql.org/message-id/flat/CADE7j6hzNEsdrfbUxZUKEZXz-B0Vz1Qy-mFo4hB%2BQXWsgAVv9g%40mail.gmail.com), 876 ms vs 0,364 ms) **nunca recibió respuesta de un desarrollador de PostgreSQL**.

El _mecanismo_ que ese plan exhibe sí es real y se lee directo del `EXPLAIN`: el qual de la política aterriza como `Filter` sobre un scan, no como un join que el planificador pueda reordenar, y por lo tanto **no aporta selectividad de índice**. La magnitud no es evidencia de nada.

**Consecuencia honesta: la opción B no está medida-y-fallada. Está sin medir.**

### 2.2 Lo que es RECOMENDACIÓN (unánime en la forma, vacía en los números)

La recomendación de poner la clave de tenant en la tabla hija es unánime entre todos los proveedores que tuvieron que resolverlo mecánicamente. Ninguno lo resuelve con un join.

| Fuente                                                                                                                                           | Fecha                       | Qué dice                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Citus](https://docs.citusdata.com/en/stable/use_cases/multi_tenant.html)                                                                        | vigente                     | "Even in a single-machine database it can be useful to denormalize tables with the addition of company id, **whether it be for row-level security** or for additional indexing" |
| [Azure Cosmos DB for PostgreSQL](https://learn.microsoft.com/en-us/azure/cosmos-db/postgresql/quickstart-build-scalable-apps-model-multi-tenant) | 2023-01-30, act. 2026-04-27 | "you may need to **denormalize a little and add the tenant ID column** to large tables if it's missing, then backfill"                                                          |
| [AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/rls.html)               | vigente                     | "RLS **is required** to maintain tenant data isolation in a pooled model"                                                                                                       |
| [Crunchy Data](https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres)                                                      | 2024-04-03                  | "ideally you have that org_id in every table"                                                                                                                                   |
| [Nile](https://www.thenile.dev/docs/tenant-virtualization/tenant-isolation)                                                                      | vigente                     | `tenant_id` en toda tabla tenant-aware, `PRIMARY KEY(tenant_id, id)`                                                                                                            |

**Ninguna de estas fuentes publica una medición.** "Negligible overhead" (ClickHouse), "no measurable cost" (QueryPlane), "RLS is required" (AWS) son opiniones de partes interesadas. El consenso de proveedores es unánime sobre la forma y vacío sobre los números.

**Ninguna de ellas, además, dice qué hacer con tablas que no tienen la columna.** Todas asumen que existe. Nuestros 65 modelos sin clave están fuera de la forma que todo patrón publicado presupone.

### 2.3 Lo que hace nuestro sector específicamente

Dato relevante y contraintuitivo: **los dos líderes del mercado hacen propiedad transitiva, igual que nosotros.**

- **Buffer**: jerarquía publicada `Account → Organization → Channel → Post`. El tipo `Post` de su GraphQL **no tiene `organizationId`**; `Channel` sí. Toda consulta de colección obliga a nombrar el tenant: `PostsInput.organizationId` es **no-nullable**. ([modelo de datos](https://developers.buffer.com/guides/data-model.html), [referencia](https://developers.buffer.com/reference.html))
- **Hootsuite**: `Organization → SocialProfile (ownerId) → Message`. El mensaje no lleva organización. ([referencia OpenAPI](https://developer.hootsuite.com/reference/getsocialprofiles-1.md))

Pero el contexto importa: **ninguno de los dos podría usar RLS aunque quisiera.** Buffer corre sobre MongoDB sharded ([caso MongoDB](https://www.mongodb.com/resources/solutions/industries/built-mongodb-buffer)); Hootsuite sobre MySQL + MongoDB con una filosofía explícita de "no joins"; Sprout Social sobre MySQL + Cassandra. Su elección informa sobre la línea base del sector — **el aislamiento a nivel aplicación es el estándar de facto en este vertical** — pero no informa sobre la pregunta A-vs-B, porque nunca tuvieron la opción.

Sprout Social es el único que lo declara públicamente, en su [página de seguridad](https://sproutsocial.com/security/sprout-social-application/): _"each customer's data is logically separated… Various front-end and back-end verification measures operate continuously to enforce this separation."_ Eso es la opción C, declarada como postura de seguridad de una empresa pública con SOC 2.

**El competidor directo con nuestro stack exacto es evidencia EN CONTRA de la opción A ingenua.** Postiz (NestJS + Prisma + PostgreSQL, [esquema público](https://raw.githubusercontent.com/gitroomhq/postiz-app/main/libraries/nestjs-libraries/src/database/prisma/schema.prisma)) desnormaliza `organizationId` en `Post`, `Media` y `Comments`. Verificado en el esquema: **cero claves foráneas compuestas** ("No relations use multiple reference fields") y **cero RLS**. Los dos síntomas observables son el costo de esa variante:

- `getPosts` filtra por `Post.organizationId` **y** por `integration.organizationId` en la misma consulta — el cinturón-y-tiradores que se escribe cuando ninguna fuente de verdad es confiable por sí sola.
- `getPost`, verbatim: `where: { id, ...(orgId ? { organizationId: orgId } : {}), deletedAt: null }`. **El filtro de tenant desaparece si `orgId` es falsy.**

Desnormalizar sin constraint no les simplificó la capa de consultas ni los salvó de un call-site sin guardia.

### 2.4 Lo que NO se pudo averiguar

Esto es tan decisivo como lo anterior y se declara sin adorno:

1. **Ningún post-mortem, reporte de brecha ni artículo de ingeniería documenta una fuga cross-tenant causada por una columna de tenant desnormalizada que se desincronizó de su padre.** Se buscó desde cuatro encuadres. Cero resultados. No leer eso como seguridad: leerlo como **riesgo sin precio público**.
2. **Ningún estudio compara tasas de fallo reales entre RLS-con-columna, RLS-con-join y filtrado en aplicación.** El propio preprint de BOLA lo dice: _"the existing literature remains almost entirely conceptual."_
3. **Ningún post-mortem de "adoptamos RLS y lo sacamos".** Lo que existe es advocacy comercial en contra ([PlanetScale, 2026-04-30](https://planetscale.com/blog/rls-sounds-great-until-it-isnt), [Bytebase, 2026-07-12](https://www.bytebase.com/blog/postgres-row-level-security-limitations-and-alternatives/)), de vendors que venden la alternativa.
4. **Ningún playbook de migración** para retrofitear una clave de tenant en decenas de tablas. La única frase publicada al respecto es la de Azure sobre el backfill.
5. **Ninguna fuente aborda la adopción parcial** — si es coherente tener 59 modelos con RLS por columna local, algunos con FK compuesta y otros solo con gate de aplicación. Todas asumen una elección uniforme de campo verde.
6. **Ninguna plataforma de gestión de redes sociales publica cómo aísla tenants.** No hay precedente sectorial al que apelar.

---

## 3. Qué dice el canon

### 3.1 PostgreSQL

La documentación oficial recomienda explícitamente la forma sin subconsulta. De [Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), verbatim:

> "the policy expressions consider only the current values in the row to be accessed or updated. **This is the simplest and best-performing case; when possible, it's best to design row security applications to work this way.** If it is necessary to consult other rows or other tables to make a policy decision, that can be accomplished using sub-`SELECT`s…"

Es decir: **el manual recomienda A sobre B.**

Advertencias documentadas que golpean a B, todas primarias:

- Los quals de política se evalúan **antes** que los del usuario, _"the only exceptions to this rule are `leakproof` functions"_.
- Las políticas con sub-`SELECT` traen carreras bajo `READ COMMITTED`. Las mitigaciones que el propio manual ofrece son `SELECT … FOR SHARE` dentro de la subconsulta (bloqueo sobre `Project` en cada lectura de `Post`, y requiere privilegio `UPDATE`) o un `ACCESS EXCLUSIVE`. **Ninguna es viable en una ruta caliente.**
- _"heavy concurrent use of row share locks on the referenced table could pose a performance problem"_.
- Las políticas corren con los privilegios del llamador: el rol de la app debe poder leer toda tabla nombrada en la política.
- _"Referential integrity checks… **always bypass row security**"_.
- Las subconsultas dentro de una política **están sujetas a la RLS de la tabla referenciada** ([Graphile RLS Infosheet](https://learn.graphile.org/docs/PostgreSQL_Row_Level_Security_Infosheet.pdf)), con riesgo de recursión. Nuestro `Project` **sí** tiene RLS, así que una política sobre `Post` que subconsulte `Project` dispara la política de `Project` anidada, por fila candidata.

**Corrección importante sobre el orden de evaluación.** Dos informes concluyeron que un filtro selectivo del llamador (`WHERE projectId = $1`) nunca puede empujarse a un index scan por delante de la política. Es falso. El [commit de Tom Lane de 2017](https://www.postgresql.org/message-id/E1cTuVJ-0003ZU-A2%40gemulon.postgresql.org) (PG10) dice verbatim: _"'leakproof' quals can be allowed to go ahead of quals of lower security_level, if it's helpful to do so"_, y los operadores de igualdad estándar **son LEAKPROOF**. El caso catastrófico de seq scan es el de la **consulta débilmente filtrada** — que es exactamente la que corrió el hilo de 2023 (`select * from "Track"`).

**La exposición real de B se reduce a: listados sin predicado selectivo, analítica, exportaciones y cualquier ruta que use un operador no-leakproof (`LIKE`, operadores propios).** Es un costo acotado, no un abismo. El residuo honesto: la corrección de Lane es a nivel de scan; _"Eventually these qual ordering rules should be enforced for join quals as well… but that's a task for another patch."_ Sigue sin hacerse en PG18.

**Un CVE que hay que sacar de la columna de riesgo de B.** [CVE-2024-10976](https://www.postgresql.org/support/security/CVE-2024-10976/) se citó como superficie de ataque de las políticas con subconsulta. El aviso dice, verbatim, que aplica _"in cases where role-specific policies are used and a given query is planned under one role and then executed under other roles"_. La subconsulta es el vehículo; el gatillo es el cambio de rol con políticas por rol. Nosotros bindeamos tenancy con un GUC de sesión, no con políticas por rol. CVSS 4.2, parcheado desde 16.5. **Higiene de parches, no argumento de diseño.**

Lo que sí queda, y es la advertencia menos citada: [Tom Lane, 2023-10-13](https://www.postgresql.org/message-id/1570249.1697228785%40sss.pgh.pa.us), sobre una política de comparación simple — es decir, sobre la **opción A**:

> "When that's enforced, the query can no longer use an index-only scan (because it needs to fetch tenant_id too)… the estimated cost of an indexscan query could be high enough to persuade the planner that a seqscan is a better idea."

Su remedio es el índice multicolumna con tenant al frente que todos los vendors recomiendan, **con una salvedad que ningún vendor menciona**: _"Adding tenant_id is going to bloat your indexes quite a bit, so I wouldn't do that except in cases where you've demonstrated it's important."_ **A no es gratis: es barata después de pagar índices, y la autoridad recomienda pagarlos por demostración, no en bloque.**

Corremos **PostgreSQL 16** (`pgvector/pgvector:pg16`). Consecuencias concretas: `ON DELETE SET NULL (column_list)` está disponible (PG15+); el _skip scan_ de B-tree de PG18, que habría permitido que un índice `(accountId, projectId)` sirviera también consultas que solo filtran por `projectId`, **no** lo está.

### 3.2 DDD

El canon de dominio es inequívoco y **coincide** con el canon de PostgreSQL. No hay contradicción entre las dos disciplinas en este punto.

Evans, cap. 6: _"Only AGGREGATE roots can be obtained directly with database queries."_ Una entidad que se consulta y se muta de forma independiente **es** una raíz de agregado, no una parte interior.

Vernon, [Effective Aggregate Design](https://www.dddcommunity.org/library/vernon_2011/) (2011), rechaza explícitamente el agregado grande `Product` que contiene `BacklogItem`s: _"The big aggregate looked attractive, but it wasn't truly practical… This large cluster aggregate will never perform or scale well."_ La resolución es hacer de cada hijo su propia raíz, asociada por identidad.

Y la evidencia decisiva es su propio código de referencia: [`IDDD_Samples`](https://github.com/VaughnVernon/IDDD_Samples) contiene una cadena `Forum → Discussion → Post`, con una entidad literalmente llamada `Post`. Verbatim:

```java
public class Post extends EventSourcedRootEntity {
    private DiscussionId discussionId;
    private ForumId forumId;
    private Tenant tenant;          // el tenant, en el hijo más profundo
```

El tenant es el **primer parámetro del constructor**, no hay setter público, y el hijo lo recibe **de su padre**, no del llamador:

```java
public Post post(...) {
    Post post = new Post(
            this.tenant(),          // del PADRE, no del caller
            this.forumId(), this.discussionId(), ...);
}
```

Esto responde dos cosas de golpe. Primero: **`accountId` en `Post` no es desnormalización, es la referencia por identidad de `Post` al agregado `Account`** — la misma regla que ya pone `ProductId` en `BacklogItem`. Segundo: **la deriva por escritura equivocada queda excluida por construcción**, porque el llamador no puede pasar un tenant incorrecto — el llamador no pasa el tenant.

Vernon también pone `tenantId` en entidades **interiores** (`Task` dentro de `BacklogItem`) y filtra por él en SQL. Pero eso hay que argumentarlo honestamente: **es una decisión de persistencia y defensa en profundidad, no canon DDD.** El canon DDD cubre `Post`; no cubre `PostContent` ni `PostMedia`.

**El repo ya respondió esta pregunta dos veces, distinto, sin declarar la regla.** Medido: `PostAggregate` **ya** es `extends AggregateRoot<PostId>` y tiene **cero** referencias a `accountId`. `MentionAggregate` tiene 8 y `SocialMessageAggregate` tiene 13. La inconsistencia es nuestra, no del canon.

---

## 4. Las opciones, con su costo real

### A — Desnormalizar la clave, sin constraint

Agregar `accountId` a `Post` y compañía. Ambas capas funcionan de inmediato.

- **Cómo falla en producción**: una fila cuya `accountId` no coincide con la de su padre queda corrupta y **nada la detecta**. Peor: el guard confía en la columna, así que la fila corrupta se sirve como si estuviera correctamente aislada. Postiz es la demostración en vivo — desnormalizaron, y aun así filtran por ambas fuentes de verdad _y_ tienen un call-site donde el filtro se evapora.
- **Qué la mantiene honesta**: nada estructural. Un job de reconciliación detecta después del hecho.
- **Veredicto**: no adoptar en esta forma. Es la variante que el único precedente de nuestro stack implementó, con los síntomas visibles.

### A′ — Desnormalizar **con clave foránea compuesta** (la opción que la investigación encontró y la verificación confirmó)

Este es el hallazgo más sólido de todo el corpus. Cada cita fue verificada verbatim.

**Es un patrón real, con nombre y linaje.** [Paul Martinez (Google), pgsql-hackers, 2021-01-05](https://www.postgresql.org/message-id/CACqFVBZQyMYJV=njbSMxf+rbDHpx=W=B7AEaMKn8dWn9OZJY7w@mail.gmail.com), verbatim:

> "In multi-tenant applications, it is common to denormalize a "tenant_id" column across every table, and use composite primary keys of the form (tenant_id, id) and composite foreign keys of the form (tenant_id, fk_id)… This is often done initially for performance reasons, but **has the added benefit of making it impossible for data from one tenant to reference data from another tenant**, also making this a good decision from a security perspective."

**PostgreSQL fue modificado para soportarlo.** Las [notas de PG15](https://www.postgresql.org/docs/release/15.0/), verbatim: _"Allow foreign key `ON DELETE SET` actions to affect only specified columns (Paul Martinez)."_ La [propuesta que lo produjo](https://www.postgresql.org/message-id/CAF%2B2_SGRXQOtumethpuXhsyU%2B4AYzfKA5fhHCjCjH%2BjQ04WWjA%40mail.gmail.com) usa una tabla `posts` como ejemplo de trabajo.

**Un framework lo trae como feature de primera clase.** [Ecto](https://ecto.hexdocs.pm/multi-tenancy-with-foreign-keys.html), sobre tablas llamadas literalmente `posts` y `comments`, verbatim: _"it does not guarantee that all posts and their related comments belong to the same organization"_, resuelto con `unique_index(:posts, [:id, :org_id])` + `references(:posts, with: [org_id: :org_id])`.

**Es la única vía declarativa disponible.** De [Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html), verbatim: _"PostgreSQL does not support `CHECK` constraints that reference table data other than the new or updated row being checked."_ La elección es FK compuesta o triggers. No hay tercera opción declarativa.

**La variante barata que ningún informe separó.** Todos encuadraron esto como que exige **clave primaria compuesta** (`@@id([accountId, id])`), heredando el encuadre de sharding de Citus. Es más pesado de lo necesario. De la misma página de Constraints, verbatim:

> "A foreign key must reference columns that either are a primary key **or form a unique constraint, or are columns from a non-partial unique index**."

Entonces `UNIQUE (id, accountId)` en `Project` + `FOREIGN KEY (projectId, accountId) REFERENCES "Project"(id, accountId)` en `Post` compra la garantía completa **sin tocar las claves primarias de una sola columna**. Sin cambio de forma de IDs en 124 modelos, sin reescritura de identidad en el ORM.

Esto importa además porque **disuelve la propia objeción del autor del patrón**. [Martinez, 2021-08-17](https://www.postgresql.org/message-id/CAF%2B2_SHQtbxWJe1CGwi6iOgMihorgo3Bt-x%2BPhSia%3Dgm5Qcr-g%40mail.gmail.com), verbatim — la segunda mitad de la frase que uno de los informes citó truncada:

> "This approach works pretty well for multi-tenant databases, because then your indexes all start with tenant_id, which should help with performance… **But then it requires including a tenant_id in _every_ query (and subquery!), which may be difficult to enforce in a codebase.**"

Esa objeción aplica a las **PK compuestas** (toda búsqueda pasa a ser de dos columnas). **No aplica a las FK compuestas sobre un constraint único.**

**La cadena se propaga sola.** A′ no exige que las 65 tablas referencien `Account`. Exige que cada tabla referencie a **su padre inmediato incluyendo la columna de tenant**, y la cadena hace el resto: `PostContent(accountId, postId) → Post(accountId, id)`, que a su vez está anclada en `Project`. Eso reduce el costo conceptual sustancialmente: es una regla local repetida, no un rediseño global.

- **Cómo falla en producción**: la fila con `accountId` divergente **no se puede escribir**. Todo camino de escritura que "se olvide" falla ruidosamente en el `INSERT`, que es lo opuesto a la deriva silenciosa. Y por la regla de bypass de integridad referencial citada arriba, **la FK se enforcea independientemente de si RLS está bien configurada** — es una garantía estrictamente más fuerte que la política.
- **Qué la mantiene honesta**: el motor. No un job, no una convención, no un fitness check.
- **Costos verificados**:
  - El padre necesita `UNIQUE (id, accountId)`. `Project` hoy tiene `@@unique([accountId, name])`, no ese.
  - El índice sobre las columnas referenciadas **no se crea solo**: _"the declaration of a foreign key constraint does not automatically create an index on the referencing columns."_ A nuestro favor, ese índice es `(accountId, projectId)`, el mismo que la política RLS quiere — costo compartido, no aditivo.
  - El subconjunto de columnas aplica solo a `ON DELETE`, **nunca a `ON UPDATE`** (verificado en `CREATE TABLE`). Necesita PG15+; corremos PG16.
  - `MATCH SIMPLE` por defecto: una fila con `projectId` NULL escapa al constraint. Verificación por tabla.
  - La columna de tenant queda efectivamente inmutable: mover un `Project` entre cuentas pasa a ser una migración en cascada explícita. **Ese es el punto** — el evento que habría causado deriva se vuelve ruidoso.
  - Prisma lo expresa ([discussion #12547](https://github.com/prisma/prisma/discussions/12547), respuesta del equipo Prisma: _"You need to actually have and spell out the fields that contain the referencing fields now"_). Diff mecánico grande. **Pregunta sin resolver: si un escalar (`accountId`) puede participar en dos relaciones simultáneamente.** Para `Post` la esquivamos (solo la relación compuesta a `Project`, sin relación directa a `Account`), pero merece un spike antes de comprometerse.
  - Bloqueos de migración: agregar una FK toma `AccessExclusive` en ambas tablas. [GoCardless](https://gocardless.com/blog/zero-downtime-postgres-migrations-the-hard-parts) midió **15 segundos de caída de API** cuando un `SELECT` largo colisionó con la migración. Presupuestar `lock_timeout` y transacciones separadas.
- **Costo de migrar con datos vivos**: agregar columna nullable → backfill por lotes (Citus advierte explícitamente: _"Doing the whole table at once may cause too much load"_) → `NOT NULL` → `UNIQUE` en el padre → FK compuesta como `NOT VALID` → `VALIDATE CONSTRAINT`. **No existe playbook publicado para esto a escala de decenas de tablas.**

### B — Políticas RLS con join

La forma del enunciado: `USING (EXISTS (SELECT 1 FROM "Project" p WHERE p.id = "projectId" AND p."accountId" = current_setting(...)))`.

- **Cómo falla en producción**: correlacionada por fila. El qual aterriza como `Filter` sobre un scan y no aporta selectividad de índice en consultas débilmente filtradas — listados, analítica, exportaciones. Suma: evaluación anidada de la política de `Project` por fila candidata, contención de row-share locks sobre `Project`, la carrera documentada bajo `READ COMMITTED` cuyas mitigaciones oficiales son inviables en ruta caliente, y el requisito de privilegio de lectura sobre `Project` para el rol de la app.
- **Qué la mantiene honesta**: la política misma, si está bien escrita. Pero hay que escribirla bien 65 veces, y la corrección no es verificable por constraint.
- **Costo**: **desconocido en nuestra forma.** Esto hay que decirlo sin adorno: la medición que parecía condenarla era un espejismo. B no está medida-y-fallada, está sin medir.
- **Nota**: no compra garantía de integridad. Una fila con padre equivocado sigue siendo posible; la política simplemente no la deja ver.

### B′ — Política descorrelacionada de pertenencia a conjunto

La variante que ningún informe original propuso y que las mediciones de Supabase respaldan:

```sql
USING ("projectId" IN (SELECT p.id FROM "Project" p
                       WHERE p."accountId" = current_setting('app.account_id', true)))
```

Un solo `InitPlan`, evaluado una vez, seguido de sondeo por índice sobre `Post(projectId)` — que **ya existe** en el esquema.

- **Cómo falla**: el costo escala con **proyectos por cuenta**, no con filas. Medido en el análogo más cercano: 2 ms con 100 padres, 24 ms con 10.000. Materializa todos los IDs de proyecto de la cuenta en cada consulta y en cada tabla.
- **Qué la mantiene honesta**: nada estructural, igual que B. Hereda las advertencias de recursión y privilegios.
- **Costo de migrar**: **cero columnas, cero backfill, cero superficie de deriva.** Es la opción más barata de probar, y por eso vale medirla aunque no se adopte.

### C — Aceptarlo y mover la garantía a la aplicación

Declarar el gate de caller como regla de canon y enforcearlo con un fitness check. Es lo que el repo ya hace de facto.

- **Cómo falla en producción**: BOLA es el #1 de [OWASP API Security 2023](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/), con prevalencia _Widespread_ y explotabilidad _Easy_. **41,7 % de los casos confirmados reales son exactamente la granularidad equivocada** — autorización verificada sobre el padre en vez del objeto. Y el modo de fallo específico está documentado en vivo en Postiz: el filtro condicional que desaparece.
- **Qué la mantiene honesta**: un fitness check puede probar que la llamada **existe**; no puede probar que es **correcta**, y no ve la ruta que nunca la llamó. El techo de la mejor herramienta disponible es **59,9 % de recall al 57,5 % de precisión**. Nuestros greps de fitness son regex, muy por debajo de eso.
- **El enforcement en runtime presupone A.** [Aikido Zen](https://www.aikido.dev/blog/zen-stops-idor-vulnerabilities) parsea cada sentencia SQL y verifica que toda tabla tocada lleve un filtro de igualdad sobre la columna de tenant configurada. Se configura con **un** nombre de columna. `Post`, `PostContent` y `PostMedia` le son invisibles. **La mejor versión de C necesita la columna de A.**
- **Lo transferible de C, que vale la pena hacer pase lo que pase**: Buffer hace `PostsInput.organizationId` **no-nullable**. Una consulta de listado sin scope **es inexpresable**, no meramente detectable. Eso es más fuerte que "cada caso de uso se acuerda de chequear".
- **Y su matiz de diseño**: Buffer no eligió una sola regla. Puso la clave directa en entidades que **pueden existir antes que su contenedor** (`Idea`: contenido sin canal asignado) y dejó heredar al resto (`Post`: ligado a un canal por definición). Verbatim de su documentación: _"Ideas belong to an organization (not a channel) because they haven't been assigned to a specific platform yet."_ El discriminador no es riesgo ni tamaño: es **si la entidad puede quedar huérfana de su ruta de propiedad**.

---

## 5. Recomendación

**Adoptar A′ — `accountId` desnormalizada con clave foránea compuesta sobre constraint único — para `Post`, `PostContent`, `PostMedia`, y luego para el subconjunto de los 65 que un triage identifique como propiedad de tenant. Con la Tajada 0 de la sección 6 como precondición bloqueante.**

Justificación, en orden de peso:

1. **Es la única opción donde la garantía es estructural.** Una fila cross-tenant se vuelve inescribible, enforceada por el motor, e independientemente de si RLS está bien configurada. Todas las demás dependen de que alguien escriba algo correctamente — una política, un gate, un job — y la única cifra dura que tenemos sobre esa clase de dependencia es 59,9 % de recall.
2. **La objeción que motivó esta investigación queda disuelta, no mitigada.** "Una fila cuya `accountId` discrepa de su padre es corrupta y nada la detecta" es cierto de A ingenua y falso de A′.
3. **El canon de dominio y el de PostgreSQL coinciden.** `PostAggregate` ya es raíz de agregado en nuestro propio código; Vernon pone el tenant en la raíz por regla, y su implementación de referencia lo hace sobre una entidad llamada `Post` en una cadena de tres niveles. El manual de PostgreSQL llama a la forma de columna local _"the simplest and best-performing case."_ No hay tensión entre las dos disciplinas acá.
4. **Habilita las mejores versiones de B y C en vez de competir con ellas.** La política RLS rápida quiere un índice con tenant al frente; el enforcement SQL en runtime quiere un `tenantColumnName`. A′ es el movimiento habilitante.

**Costo declarado, sin suavizar:**

- Índices nuevos con `accountId` al frente en tablas que hoy tienen todos sus índices liderados por `projectId`. `Post` ya carga 7 índices parciales; Lane advierte explícitamente sobre el bloat y recomienda pagar **por demostración, no en bloque**. Corremos PG16, así que el skip scan de PG18 no nos rescata de índices duplicados.
- Un diff mecánico grande en Prisma, con una pregunta abierta (escalar compartido entre dos relaciones) que exige spike.
- Migración con datos vivos sin playbook publicado, y con riesgo medido de caída por bloqueo si no se presupuesta `lock_timeout`.
- Los movimientos a nivel contenedor (transferir un `Project` entre cuentas) pasan a ser migraciones explícitas en cascada. Verificado: **ningún competidor permite mover contenido entre contenedores**; algunos sí mueven contenedores. Hootsuite retiene el contenido agendado al transferir, y le sale barato **precisamente porque** su contenido no lleva clave desnormalizada. Si alguna vez queremos esa feature, A′ la encarece.
- **65 modelos es demasiado para un solo movimiento, y ninguna fuente dice cómo hacerlo.** Por eso la recomendación incluye triage, no un barrido.

**Lo que NO recomiendo y por qué:** B en la forma del enunciado (correlacionada), porque el manual desaconseja explícitamente la subconsulta, porque anida la política de `Project` por fila candidata, y porque su carrera bajo `READ COMMITTED` no tiene mitigación viable en ruta caliente. **Pero la evidencia contra B es mecánica, no cuantitativa** — la cifra que circulaba no era una medición. Si alguien quiere defender B′, la puerta está abierta y el experimento es barato.

**El experimento que falta y que sería honesto correr durante la primera tajada:** medir B′ contra A′ sobre `Post` con datos representativos, con `EXPLAIN ANALYZE`, en las tres formas de consulta que importan — punto por ID, listado filtrado por `projectId`, y listado sin predicado selectivo. Es media jornada y convierte la única incógnita real en dato. Si B′ mide bien y el triage devuelve muchas más de 3 tablas, la decisión merece revisarse; A′ y B′ no son mutuamente excluyentes por tabla.

---

## 6. Qué implicaría acá en concreto

### Estado medido (contra `main` @ `b2281abc`, esta sesión)

| Métrica                                       | Valor              | Nota                                          |
| --------------------------------------------- | ------------------ | --------------------------------------------- |
| Modelos en `schema.prisma`                    | **124**            |                                               |
| Con `accountId` propio                        | **59**             |                                               |
| Sin clave de tenant                           | **65**             |                                               |
| Tablas con `ENABLE ROW LEVEL SECURITY`        | **59**             | 51 en la migración base + 8 posteriores       |
| Modelos en `TENANT_SCOPED_MODELS`             | **58**             | ADR-0020 dice 57; derivó en uno               |
| Ocurrencias de `FORCE ROW LEVEL SECURITY`     | **0**              | en todo el árbol de migraciones               |
| `PostAggregate` con `accountId`               | **0** referencias  | pero `extends AggregateRoot<PostId>`          |
| `MentionAggregate` / `SocialMessageAggregate` | 8 / 13 referencias | la inconsistencia declarada en la sección 3.2 |
| PostgreSQL                                    | **16**             | `ON DELETE SET NULL (cols)` sí; skip scan no  |

**Cobertura RLS = presencia de columna, exactamente.** Los 59 con `accountId` son los 59 con RLS. Eso simplifica el problema: no hay modelos "pendientes de enrolar", solo modelos inalcanzables.

**Una divergencia que apareció al medir y merece revisión aparte:** `AuditLog` **tiene** `accountId` pero **no** está enrolado en el guard (es el único caso). Probablemente deliberado — inyectar tenant en escrituras de auditoría sería incorrecto — pero se cruza con el hallazgo de seguridad ya registrado sobre el activity-feed filtrando el AuditLog global. No es parte de este trabajo; queda nombrado.

**Otra, menor:** hay dos ADR numerados 0020 (`audit-actor-exclusive-arc` y `tenant-context-at-boundaries`). Colisión de numeración a resolver cuando se toque el índice de ADRs.

### Forma concreta del cambio

`Project` ya tiene `@@unique([accountId, name])`; necesita además `@@unique([id, accountId])`. `Post` tiene `projectId` con relación simple y todos sus índices liderados por `projectId`.

```prisma
model Project {
  id        String @id @default(uuid())
  accountId String
  @@unique([id, accountId])          // nuevo: destino de la FK compuesta
}

model Post {
  id        String  @id @default(uuid())
  projectId String
  accountId String                    // nuevo
  project   Project @relation(fields: [projectId, accountId], references: [id, accountId])
  @@index([accountId, projectId])     // nuevo: sirve a la FK y a la política RLS
}

model PostContent {
  postId    String
  accountId String                    // nuevo
  post      Post @relation(fields: [postId, accountId], references: [id, accountId])
}
```

`Post` necesita entonces `@@unique([id, accountId])` para ser destino de las FK de `PostContent` y `PostMedia`. La cadena se ancla en `Project`, y de ahí en `Account`.

### Primera tajada verificable

**Tajada 0 — probar que RLS enforcea (precondición bloqueante, sin la cual el resto es teatro).**

No es una tajada de esta decisión; es la deuda que la hace posible. Verificación exigida, en este orden:

1. Confirmar con qué rol se conecta la app en cada entorno y si tiene `BYPASSRLS` o `SUPERUSER` (`\du` en psql).
2. Decidir si hace falta `FORCE ROW LEVEL SECURITY` o si basta con que el rol no sea el dueño de las tablas. Hoy no hay ninguno de los dos garantizado en el árbol de migraciones.
3. **La prueba que decide**: consultar como el rol de la aplicación con el contexto de tenant **equivocado** debe devolver **cero filas** sobre un modelo cubierto. Si devuelve filas, RLS es decoración y ese es el trabajo, no este documento.
4. **La segunda prueba**: `EXPLAIN ANALYZE` de una lectura normal debe seguir mostrando un index scan sobre un índice con tenant al frente. Si no, la política está degradando a seq scan y nadie lo notó.

Estas dos pruebas son el rojo demostrado de esta área, en el sentido del canon: un gate que nunca se vio fallar no es un gate.

**Tajada 1 — el trío `Post` / `PostContent` / `PostMedia`, extremo a extremo.**

Tres tablas, no 65. Es la entidad núcleo del producto, es donde el hueco duele, y es lo bastante chico para probarse completo:

1. Spike de Prisma: confirmar que la relación compuesta genera lo esperado y resolver la pregunta del escalar compartido.
2. Columna nullable + backfill por lotes desde `project.accountId` (Citus advierte explícitamente contra el `UPDATE` de una sola pasada).
3. `NOT NULL` + `@@unique([id, accountId])` en `Project` y `Post`.
4. FK compuesta como `NOT VALID`, luego `VALIDATE CONSTRAINT`, con `lock_timeout` presupuestado.
5. Enrolar los tres modelos en `TENANT_SCOPED_MODELS` y agregar sus políticas RLS con la forma de columna local ya canónica.
6. **La prueba de que la garantía es real**: intentar insertar un `Post` con `accountId` que no coincide con `project.accountId` debe fallar con violación de FK. Y el mismo `EXPLAIN ANALYZE` de la Tajada 0 sobre los listados calientes de `Post`, antes y después, para medir el costo del índice nuevo en vez de suponerlo.
7. **Oportunista, mientras el dato está montado**: la comparación A′ contra B′ nombrada al final de la sección 5. El costo marginal es bajo y convierte la única incógnita real en dato.

**Tajada 2 — triage de los 65, no barrido de los 65.**

Ninguna fuente dice cómo migrar decenas de tablas, y no hay que descubrirlo de golpe. El discriminador de Buffer es el mejor criterio publicado y es aplicable directo: **¿puede esta entidad existir antes que su contenedor, o quedar huérfana de su ruta de propiedad?**

- Si sí, o si su padre es nullable, o si hay alguna ruta que la alcance sin cargar el padre primero → necesita clave propia.
- Si no puede existir sin su padre y toda ruta pasa por él → la herencia por FK compuesta ya la cubre, y no hace falta la columna.
- Y algunos de los 65 son legítimamente globales (Citus mantiene sus tablas de referencia sin clave de tenant, deliberadamente).

El número accionable no es 65: es "cuántos de los 65 son propiedad de tenant", y nadie lo calculó todavía. Ese cálculo es el entregable de la Tajada 2.

**Transversal, independiente de A/B/C — vale hacerlo igual.**

Lo único en lo que todo el vertical converge: hacer que el tenant sea un argumento **requerido y no-nullable** de toda consulta de colección, al estilo de `PostsInput.organizationId` de Buffer. Una consulta sin scope debe ser **inexpresable**, no solo detectable. Nuestro fitness check apunta a la familia correcta, pero el patrón del competidor es más estricto, y es ortogonal a cómo se resuelva la capa de almacenamiento.

Y un gate de cobertura que hoy no existe: auditar `pg_class.relrowsecurity` + `pg_policy` para afirmar que toda tabla propiedad de tenant tiene RLS habilitada **y** una política. La cobertura parcial es un modo de fallo con nombre propio que un chequeo de "¿está RLS activa?" no detecta. Encaja exacto en el patrón de fitness functions del repo — y, por canon, nace con su rojo demostrado.

---

## 7. Fuentes

**PostgreSQL (primarias)**

- [Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) — doc vigente (PG18)
- [CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html) — doc vigente
- [Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) — doc vigente
- [CREATE TABLE](https://www.postgresql.org/docs/current/sql-createtable.html) — doc vigente
- [Notas de release PG15](https://www.postgresql.org/docs/release/15.0/) — 2022-10-13
- [Notas de release PG18](https://www.postgresql.org/docs/release/18.0/)
- [Tom Lane, commit de planificación RLS (PG10)](https://www.postgresql.org/message-id/E1cTuVJ-0003ZU-A2%40gemulon.postgresql.org) — 2017-01-18
- [Tom Lane, sobre RLS e index-only scans](https://www.postgresql.org/message-id/1570249.1697228785%40sss.pgh.pa.us) — 2023-10-13
- [Paul Martinez, patrón de FK compuesta multi-tenant](https://www.postgresql.org/message-id/CACqFVBZQyMYJV=njbSMxf+rbDHpx=W=B7AEaMKn8dWn9OZJY7w@mail.gmail.com) — 2021-01-05
- [Paul Martinez, propuesta ON DELETE SET NULL (column_list)](https://www.postgresql.org/message-id/CAF%2B2_SGRXQOtumethpuXhsyU%2B4AYzfKA5fhHCjCjH%2BjQ04WWjA%40mail.gmail.com) — 2019-01-20
- [Paul Martinez, la salvedad sobre PK compuestas](https://www.postgresql.org/message-id/CAF%2B2_SHQtbxWJe1CGwi6iOgMihorgo3Bt-x%2BPhSia%3Dgm5Qcr-g%40mail.gmail.com) — 2021-08-17
- [pgsql-performance, reporte de regresión RLS](https://www.postgresql.org/message-id/CAPcM0QW3yFGqnRGvR2PzbeZVYBuQTkE72+rdt9dE6Bqs2KSwgQ@mail.gmail.com) — 2023-07-10 — **descartado como medición, ver sección 2.1**
- [pgsql-performance, hilo compañero sin respuesta](https://www.postgresql.org/message-id/flat/CADE7j6hzNEsdrfbUxZUKEZXz-B0Vz1Qy-mFo4hB%2BQXWsgAVv9g%40mail.gmail.com) — 2023-08-14
- [CVE-2024-10976](https://www.postgresql.org/support/security/CVE-2024-10976/) — 2024-11-14, CVSS 4.2
- [CVE-2025-8713](https://www.postgresql.org/support/security/CVE-2025-8713/) — 2025-08-14, CVSS 3.1

**Mediciones**

- [Supabase — RLS Performance and Best Practices](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv) y su [discusión de origen #14576](https://github.com/orgs/supabase/discussions/14576) — sin fecha ni versión declaradas
- [Semgrep — IDOR detection benchmark](https://semgrep.dev/blog/2026/idor-detection-benchmark-semgrep-multimodal/) — 2026-08-27
- [Scott Pierce — Optimizing Postgres RLS](https://scottpierce.dev/posts/optimizing-postgres-rls/) — 2025-01-05
- [GoCardless — Zero-downtime Postgres migrations, the hard parts](https://gocardless.com/blog/zero-downtime-postgres-migrations-the-hard-parts) — 2024-06

**Patrón multi-tenant (recomendaciones)**

- [Citus — Multi-tenant Applications](https://docs.citusdata.com/en/stable/use_cases/multi_tenant.html) y [Migration schema](https://docs.citusdata.com/en/stable/develop/migration_mt_schema.html)
- [Azure Cosmos DB for PostgreSQL — Model multi-tenant apps](https://learn.microsoft.com/en-us/azure/cosmos-db/postgresql/quickstart-build-scalable-apps-model-multi-tenant) — 2023-01-30, act. 2026-04-27
- [AWS Prescriptive Guidance — RLS recommendations](https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/rls.html)
- [AWS Well-Architected SaaS Lens — Tenant Isolation](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/tenant-isolation.html)
- [Crunchy Data — RLS for Tenants in Postgres](https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres) — 2024-04-03
- [Nile — Tenant Isolation](https://www.thenile.dev/docs/tenant-virtualization/tenant-isolation)
- [Ecto — Multi tenancy with foreign keys](https://ecto.hexdocs.pm/multi-tenancy-with-foreign-keys.html)
- [Graphile — PostgreSQL RLS Infosheet (PDF)](https://learn.graphile.org/docs/PostgreSQL_Row_Level_Security_Infosheet.pdf)

**Postura contraria (vendors interesados)**

- [PlanetScale — RLS sounds great until it isn't](https://planetscale.com/blog/rls-sounds-great-until-it-isnt) — 2026-04-30
- [PlanetScale — Approaches to tenancy in Postgres](https://planetscale.com/blog/approaches-to-tenancy-in-postgres) — 2026-04-21
- [Bytebase — Postgres RLS limitations and alternatives](https://www.bytebase.com/blog/postgres-row-level-security-limitations-and-alternatives/) — 2026-07-12
- [Bytebase — Postgres RLS footguns](https://www.bytebase.com/blog/postgres-row-level-security-footguns/) — 2025-09-05
- [Neon — Is Postgres RLS for everything and everyone?](https://neon.com/blog/is-postgres-rls-for-everything-and-everyone) — 2024-11-15

**DDD**

- [Vernon — Effective Aggregate Design, partes I-III (PDF, CC BY-ND)](https://www.dddcommunity.org/library/vernon_2011/) — 2011
- [VaughnVernon/IDDD_Samples — Post.java](https://raw.githubusercontent.com/VaughnVernon/IDDD_Samples/master/iddd_collaboration/src/main/java/com/saasovation/collaboration/domain/model/forum/Post.java) y [Discussion.java](https://raw.githubusercontent.com/VaughnVernon/IDDD_Samples/master/iddd_collaboration/src/main/java/com/saasovation/collaboration/domain/model/forum/Discussion.java)
- [Evans — DDD Reference (PDF, CC BY)](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf) — edición 2015-03

**Competidores y sector**

- [Buffer — Data model](https://developers.buffer.com/guides/data-model.html) y [referencia GraphQL](https://developers.buffer.com/reference.html)
- [Buffer — API is open for building](https://buffer.com/resources/buffer-api-is-here/) — 2026-05-27
- [Hootsuite — social profiles (OpenAPI)](https://developer.hootsuite.com/reference/getsocialprofiles-1.md) y [schedule message](https://developer.hootsuite.com/reference/schedulemessage-1.md)
- [Sprout Social — application security](https://sproutsocial.com/security/sprout-social-application/)
- [Postiz — schema.prisma](https://raw.githubusercontent.com/gitroomhq/postiz-app/main/libraries/nestjs-libraries/src/database/prisma/schema.prisma) y [posts.repository.ts](https://raw.githubusercontent.com/gitroomhq/postiz-app/main/libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts)
- [MongoDB — caso Buffer](https://www.mongodb.com/resources/solutions/industries/built-mongodb-buffer) — 2021-04-28, act. 2022-10-17
- [Figma — How Figma's databases team lived to tell the scale](https://www.figma.com/blog/how-figmas-databases-team-lived-to-tell-the-scale/) — 2024-03-14

**Seguridad aplicada**

- [OWASP API1:2023 — Broken Object Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/)
- [OWASP — Multi-Tenant Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html) — sin fecha publicada
- [arXiv:2605.25865 — BOLA in the wild](https://arxiv.org/abs/2605.25865) — 2026-05-25, preprint sin revisión por pares
- [Aikido — Zen stops IDOR at runtime](https://www.aikido.dev/blog/zen-stops-idor-vulnerabilities) — 2026-02-16, act. 2026-05-18
- [prisma-rls — limitaciones del enfoque de extensión](https://github.com/s1owjke/prisma-rls)
- [Prisma discussion #12547 — relaciones multi-campo](https://github.com/prisma/prisma/discussions/12547)

**Canon interno relacionado**

- `docs/technical/ADR-0014-multi-tenant-isolation-guards.md`
- `docs/technical/ADR-0020-tenant-context-at-boundaries.md` — 2026-07-16
- `docs/security/MULTI_TENANT_GUARDS.md`
- `infra/prisma/migrations/20260527000000_add_rls_tenant_isolation/migration.sql`
