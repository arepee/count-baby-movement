// Small helpers for route handlers.

import { NextResponse } from "next/server";

export const json = <T>(data: T, status = 200) => NextResponse.json(data, { status });
export const badRequest = (error: string) => json({ error }, 400);

/** Parse a JSON request body, returning undefined when it is missing or malformed. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

/** Wrap a handler so unexpected errors become a 500 JSON response. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error(err);
      return json({ error: "Server error" }, 500);
    }
  };
}
