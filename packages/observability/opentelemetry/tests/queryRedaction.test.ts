/**
 * @file queryRedaction.test.ts
 * @description Pins the redaction of sensitive query parameter values: every name of
 *              `SENSITIVE_QUERY_PARAMETERS` keeps its name and gets the value `REDACTED`, the form
 *              the HTTP instrumentation writes; every other parameter and the rest of the string
 *              stay exactly as written, encoding included; a name matches only as a whole name, as
 *              a query parser reads it; a string with no query, a malformed one and an empty value
 *              are handled without an exception; a repeated parameter is redacted at every
 *              occurrence; and a fragment keeps its text unless it carries a sensitive parameter. The
 *              attribute variant reads `url.query` and `http.query` as a query even without their
 *              leading `?`, because the HTTP instrumentation and Sentry write them that way. Every
 *              value is fake.
 * @layer infrastructure
 */
import { describe, expect, it } from "vitest";
import {
  REDACTED_QUERY_VALUE,
  SENSITIVE_QUERY_PARAMETERS,
  redactSensitiveQueryAttribute,
  redactSensitiveQueryParameters,
} from "../src/queryRedaction.js";

describe("redactSensitiveQueryParameters", () => {
  it("replaces the value of every listed name with REDACTED and keeps the name", () => {
    for (const name of SENSITIVE_QUERY_PARAMETERS) {
      expect(redactSensitiveQueryParameters(`/v1/resource?${name}=FAKE_VALUE_1`)).toBe(
        `/v1/resource?${name}=${REDACTED_QUERY_VALUE}`
      );
    }
  });

  it("redacts code, state and access_token in one query and keeps every other parameter as written", () => {
    const url =
      "https://user@api.example.test:8443/v1/me?fields=id%2Cname&code=FAKE_CODE_1&q=a+b&state=FAKE_STATE_1&access_token=FAKE_TOKEN_1&page=2";

    expect(redactSensitiveQueryParameters(url)).toBe(
      "https://user@api.example.test:8443/v1/me?fields=id%2Cname&code=REDACTED&q=a+b&state=REDACTED&access_token=REDACTED&page=2"
    );
  });

  it("matches a name only as a whole name", () => {
    const url =
      "/auth?postal_code=12345&code_challenge=FAKE_CHALLENGE&state_id=7&my_access_token=x&xcode=y";

    expect(redactSensitiveQueryParameters(url)).toBe(url);
  });

  it("matches a name exactly, letter case included", () => {
    const url = "/auth?Code=FAKE_CODE_2&STATE=FAKE_STATE_2&Access_Token=FAKE_TOKEN_2";

    expect(redactSensitiveQueryParameters(url)).toBe(url);
  });

  it("matches a percent-encoded or form-encoded name as a query parser decodes it", () => {
    expect(redactSensitiveQueryParameters("/cb?acc%65ss_token=FAKE_TOKEN_3&page=1")).toBe(
      "/cb?acc%65ss_token=REDACTED&page=1"
    );
    expect(redactSensitiveQueryParameters("/cb?access+token=FAKE_TOKEN_4")).toBe(
      "/cb?access+token=FAKE_TOKEN_4"
    );
  });

  it("returns a string with no query unchanged", () => {
    for (const value of ["", "/v1/me", "GET", "plain text with no query", "code=FAKE_CODE_5"]) {
      expect(redactSensitiveQueryParameters(value)).toBe(value);
    }
  });

  it("handles a malformed string without throwing and still redacts the parameters it can read", () => {
    const url = "/cb?%E0%A4%A=x&%=y&code=FAKE_CODE_6%&state=%ZZ&&=z&page";

    expect(() => redactSensitiveQueryParameters(url)).not.toThrow();
    expect(redactSensitiveQueryParameters(url)).toBe(
      "/cb?%E0%A4%A=x&%=y&code=REDACTED&state=REDACTED&&=z&page"
    );
  });

  it("replaces an empty value and leaves a name that carries no value", () => {
    expect(redactSensitiveQueryParameters("/cb?code=&state&page=1")).toBe(
      "/cb?code=REDACTED&state&page=1"
    );
  });

  it("redacts every occurrence of a repeated parameter", () => {
    expect(
      redactSensitiveQueryParameters(
        "/cb?code=FAKE_CODE_7&page=1&code=FAKE_CODE_8&code=FAKE_CODE_9"
      )
    ).toBe("/cb?code=REDACTED&page=1&code=REDACTED&code=REDACTED");
  });

  it("keeps a fragment after the query as written", () => {
    expect(redactSensitiveQueryParameters("/cb?code=FAKE_CODE_10&page=1#section-2")).toBe(
      "/cb?code=REDACTED&page=1#section-2"
    );
  });

  it("redacts a sensitive parameter a fragment carries, the form of an OAuth implicit-grant redirect", () => {
    expect(
      redactSensitiveQueryParameters(
        "/cb#access_token=FAKE_TOKEN_11&state=FAKE_STATE_11&expires_in=3600"
      )
    ).toBe("/cb#access_token=REDACTED&state=REDACTED&expires_in=3600");
  });

  it("redacts the parameters of every URL a free-text string holds", () => {
    expect(
      redactSensitiveQueryParameters(
        "redirect from /a?page=1 to /b?code=FAKE_CODE_12 failed: GET /c?access_token=FAKE_TOKEN_12"
      )
    ).toBe("redirect from /a?page=1 to /b?code=REDACTED failed: GET /c?access_token=REDACTED");
  });
});

describe("redactSensitiveQueryAttribute", () => {
  it("reads url.query and http.query as a query even without their leading question mark", () => {
    for (const key of ["url.query", "http.query"]) {
      expect(redactSensitiveQueryAttribute(key, "code=FAKE_CODE_13&page=2")).toBe(
        "code=REDACTED&page=2"
      );
    }
  });

  it("keeps the leading question mark url.query carries when the fetch instrumentation writes it", () => {
    expect(
      redactSensitiveQueryAttribute("url.query", "?access_token=FAKE_TOKEN_14&fields=id")
    ).toBe("?access_token=REDACTED&fields=id");
  });

  it("reads any other attribute as a string that may hold URLs", () => {
    expect(
      redactSensitiveQueryAttribute("url.full", "https://h.test/me?access_token=FAKE_TOKEN_15")
    ).toBe("https://h.test/me?access_token=REDACTED");
    expect(redactSensitiveQueryAttribute("db.statement", "code=FAKE_CODE_16")).toBe(
      "code=FAKE_CODE_16"
    );
  });

  it("redacts each string of a string array and keeps its other items", () => {
    expect(
      redactSensitiveQueryAttribute("http.request.header.referer", [
        "https://app.test/cb?state=FAKE_STATE_17",
        null,
        "no query",
      ])
    ).toEqual(["https://app.test/cb?state=REDACTED", null, "no query"]);
  });

  it("returns the very value it was given when there is nothing to redact", () => {
    const strings = ["https://app.test/cb?page=1", undefined];
    const numbers = [1, 2];

    expect(redactSensitiveQueryAttribute("http.request.header.referer", strings)).toBe(strings);
    expect(redactSensitiveQueryAttribute("app.counts", numbers)).toBe(numbers);
    expect(redactSensitiveQueryAttribute("http.response.status_code", 200)).toBe(200);
    expect(redactSensitiveQueryAttribute("app.cached", false)).toBe(false);
  });
});
