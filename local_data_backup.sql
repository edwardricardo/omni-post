--
-- PostgreSQL database dump
--

\restrict nfeKGpK3m8Jf5insjamtuAAW2jckOkB7o0nTzVil8XgP8VEebUOwm9LC7pRR9ns

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: Analytics; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: Project; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public."Project" VALUES ('6389d2be-2e88-4e88-a831-f7274d6ecd00', 'Gol de Ayer', 'es', '2025-09-11 02:49:09.228');


--
-- Data for Name: Channel; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public."Channel" VALUES ('dev-x', '6389d2be-2e88-4e88-a831-f7274d6ecd00', 'X', '@GolDeAyerDev', '{"token": "REEMPLAZAR"}', '2025-09-11 02:49:09.245', '2025-09-11 02:49:09.245');


--
-- Data for Name: Post; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: PostContent; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: PostMedia; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: PublishLog; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public._prisma_migrations VALUES ('225c71fc-1104-461d-8766-96707910043e', '0a0f0d3f84fef445f9db4717518d8fa50b11c421d2bd484d876b2e13529b2f15', '2025-09-10 22:18:45.239203-04', '20250911021845_init', NULL, NULL, '2025-09-10 22:18:45.191776-04', 1);
INSERT INTO public._prisma_migrations VALUES ('35764b8d-25fa-4488-9202-b894714caf3b', 'ec25abb843850c68cf9b55c359e05695ffd96a0821d72dfccedd0b9e84a07fe5', '2025-09-10 22:48:18.919331-04', '20250911024818_init', NULL, NULL, '2025-09-10 22:48:18.912494-04', 1);
INSERT INTO public._prisma_migrations VALUES ('67676ad2-13bf-4e5b-9c7c-7da297392551', '4fa8da65db3c37ad0059e2b2e4853d326004c0fa77097eeb226ca55384441a68', '2025-09-11 01:12:45.143276-04', '20250911051245_csm_core_v1', NULL, NULL, '2025-09-11 01:12:45.13191-04', 1);
INSERT INTO public._prisma_migrations VALUES ('59039eb8-143a-436f-9c70-c89d0d03855d', '479b7f6f0740ad8eefea8cb601244f58401a61074789492a748e4fa878fdd38a', '2025-09-13 01:59:01.467421-04', '20250913055901_init', NULL, NULL, '2025-09-13 01:59:01.452788-04', 1);


--
-- PostgreSQL database dump complete
--

\unrestrict nfeKGpK3m8Jf5insjamtuAAW2jckOkB7o0nTzVil8XgP8VEebUOwm9LC7pRR9ns

