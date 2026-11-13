import { describe, expect, it, vi } from "vitest";
import {
  copyKey,
  copyStatusFor,
  copyToClipboard
} from "@/features/services/lib/copy-feedback";

describe("copyKey", () => {
  it("separates the same value copied under different names", () => {
    expect(copyKey("https://a.deedlit.dev", "URL")).not.toBe(
      copyKey("https://a.deedlit.dev", "docs URL")
    );
  });

  it("does not collide when the boundary between name and value moves", () => {
    expect(copyKey("b", "a ")).not.toBe(copyKey(" b", "a"));
  });
});

describe("copyToClipboard", () => {
  it("reports a copy and keys it to the button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const feedback = await copyToClipboard("a.deedlit.dev", "hostname", { writeText });

    expect(writeText).toHaveBeenCalledWith("a.deedlit.dev");
    expect(feedback).toEqual({
      key: copyKey("a.deedlit.dev", "hostname"),
      status: "copied",
      message: "Copied hostname: a.deedlit.dev"
    });
  });

  it("reports a failure when writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const feedback = await copyToClipboard("a.deedlit.dev", "hostname", { writeText });

    expect(feedback.status).toBe("failed");
    expect(feedback.message).toBe("Clipboard unavailable");
    expect(feedback.key).toBe(copyKey("a.deedlit.dev", "hostname"));
  });

  it("reports a failure when there is no clipboard (insecure context)", async () => {
    const feedback = await copyToClipboard("a.deedlit.dev", "hostname", undefined);
    expect(feedback.status).toBe("failed");
  });
});

describe("copyStatusFor", () => {
  const feedback = {
    key: copyKey("https://a.deedlit.dev", "URL"),
    status: "copied" as const,
    message: ""
  };

  it("flips only the button that was clicked", () => {
    expect(copyStatusFor(feedback, "https://a.deedlit.dev", "URL")).toBe("copied");
    expect(copyStatusFor(feedback, "a.deedlit.dev", "hostname")).toBeNull();
    expect(copyStatusFor(feedback, "https://b.deedlit.dev", "URL")).toBeNull();
  });

  it("shows nothing once the feedback is cleared", () => {
    expect(copyStatusFor(null, "https://a.deedlit.dev", "URL")).toBeNull();
  });
});
