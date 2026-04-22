/**
 * @file port.test.ts
 * @description Tests for the port utilities (extractErrorInfo, LogLevel).
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { LogLevel, extractErrorInfo } from "../src/port";

describe("LogLevel", () => {
  it("exposes all four severity levels as string constants", () => {
    expect(LogLevel.DEBUG).toBe("debug");
    expect(LogLevel.INFO).toBe("info");
    expect(LogLevel.WARN).toBe("warn");
    expect(LogLevel.ERROR).toBe("error");
  });
});

describe("extractErrorInfo", () => {
  it("extracts message, name, and stack from an Error instance", () => {
    const err = new Error("boom");
    const info = extractErrorInfo(err);
    expect(info.message).toBe("boom");
    expect(info.name).toBe("Error");
    expect(typeof info.stack).toBe("string");
  });

  it("extracts a string `code` field from augmented errors", () => {
    const err = Object.assign(new Error("bad"), { code: "ERR_CODE" });
    const info = extractErrorInfo(err);
    expect(info.code).toBe("ERR_CODE");
  });

  it("extracts a numeric `status` field from augmented errors", () => {
    const err = Object.assign(new Error("unauthorized"), { status: 401 });
    const info = extractErrorInfo(err);
    expect(info.status).toBe(401);
  });

  it("ignores a non-string code", () => {
    const err = Object.assign(new Error("x"), { code: 42 });
    const info = extractErrorInfo(err);
    expect(info.code).toBeUndefined();
  });

  it("ignores a non-numeric status", () => {
    const err = Object.assign(new Error("x"), { status: "500" });
    const info = extractErrorInfo(err);
    expect(info.status).toBeUndefined();
  });

  it("handles a plain string error", () => {
    expect(extractErrorInfo("failure").message).toBe("failure");
  });

  it("handles null", () => {
    expect(extractErrorInfo(null).message).toBe("null");
  });

  it("handles undefined", () => {
    expect(extractErrorInfo(undefined).message).toBe("undefined");
  });

  it("falls back to String() for arbitrary values", () => {
    expect(extractErrorInfo(123).message).toBe("123");
    expect(extractErrorInfo({ foo: "bar" }).message).toBe("[object Object]");
  });

  it("preserves subclass name", () => {
    class MyError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = "MyError";
      }
    }
    expect(extractErrorInfo(new MyError("x")).name).toBe("MyError");
  });
});
