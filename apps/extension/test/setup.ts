import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { installChromeMock, type ChromeMock } from "./chrome-mock";

export const chromeMock: ChromeMock = installChromeMock();

beforeEach(() => {
  chromeMock.reset();
  document.body.innerHTML = "";
});

afterEach(() => {
  cleanup();
});
