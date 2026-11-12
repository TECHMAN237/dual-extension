import { describe, expect, it } from "vitest";
import { scanSegments } from "../src/content/scanner";

function scan(html: string) {
  document.body.innerHTML = html;
  let n = 0;
  return scanSegments(document.body, { nextId: () => `d-${++n}` });
}

describe("scanner", () => {
  it("finds text in headings, paragraphs, buttons, links, lists, labels, table cells and attributes", () => {
    const segs = scan(`
      <h1>Welcome back</h1>
      <p>Read the latest news</p>
      <button>Sign in</button>
      <nav><ul><li><a href="/about">About us</a></li></ul></nav>
      <a href="/help">Help centre</a>
      <ul><li>First item</li></ul>
      <label>Email address</label>
      <table><tr><td>Total amount</td></tr></table>
      <input placeholder="Search products" />
      <textarea placeholder="Your message"></textarea>
      <img alt="Company logo" src="x.png" />
      <button title="Open menu" aria-label="Main menu">☰</button>
      <input type="submit" value="Send message" />
    `);
    const byText = Object.fromEntries(segs.map((s) => [s.text, s]));
    expect(byText["Welcome back"]?.context).toBe("heading");
    expect(byText["Read the latest news"]?.context).toBe("paragraph");
    expect(byText["Sign in"]?.context).toBe("button");
    expect(byText["About us"]?.context).toBe("navigation");
    expect(byText["Help centre"]?.context).toBe("link");
    expect(byText["First item"]?.context).toBe("list_item");
    expect(byText["Email address"]?.context).toBe("label");
    expect(byText["Total amount"]?.context).toBe("table_cell");
    expect(byText["Search products"]).toMatchObject({ kind: "attr", attr: "placeholder", context: "placeholder" });
    expect(byText["Your message"]).toMatchObject({ kind: "attr", attr: "placeholder" });
    expect(byText["Company logo"]).toMatchObject({ kind: "attr", attr: "alt", context: "alt_text" });
    expect(byText["Open menu"]).toMatchObject({ kind: "attr", attr: "title", context: "title_attribute" });
    expect(byText["Main menu"]).toMatchObject({ kind: "attr", attr: "aria-label", context: "aria_label" });
    expect(byText["Send message"]).toMatchObject({ kind: "attr", attr: "value", context: "button" });
    // "☰" has no letters and is not translatable
    expect(byText["☰"]).toBeUndefined();
  });

  it("excludes scripts, styles, code, pre, hidden content, passwords, editable areas, notranslate, URLs and numbers", () => {
    const segs = scan(`
      <script>var text = "Script text";</script>
      <style>.a { content: "Style text"; }</style>
      <code>Code text</code>
      <pre>Pre text</pre>
      <div style="display:none">Hidden by display</div>
      <div style="visibility:hidden">Hidden by visibility</div>
      <div hidden>Hidden attribute</div>
      <div aria-hidden="true">Aria hidden</div>
      <input type="password" placeholder="Password hint" />
      <div contenteditable="true">Editable user text</div>
      <div translate="no">Keep brand name</div>
      <span class="notranslate">Untranslatable span</span>
      <p>https://example.com/path</p>
      <p>42,000.00</p>
      <p>user@example.com</p>
      <svg><text>Svg text</text></svg>
      <p>Visible paragraph</p>
      <div data-douala-ui="1">Our own UI</div>
    `);
    const texts = segs.map((s) => s.text);
    expect(texts).toEqual(["Visible paragraph"]);
  });

  it("assigns unique ids and preserves whitespace information", () => {
    const segs = scan(`<p>  Padded text  </p><p>Padded text</p>`);
    expect(segs).toHaveLength(2);
    expect(new Set(segs.map((s) => s.id)).size).toBe(2);
    expect(segs[0]).toMatchObject({ text: "Padded text", leading: "  ", trailing: "  " });
    expect(segs[0]!.originalValue).toBe("  Padded text  ");
  });

  it("skips nodes already known to the registry and supports scanning a single text node", () => {
    document.body.innerHTML = `<p>Known text</p><p>New text</p>`;
    const known = document.body.querySelector("p")!.firstChild!;
    let n = 0;
    const segs = scanSegments(document.body, { nextId: () => `d-${++n}`, isKnown: (node) => node === known });
    expect(segs.map((s) => s.text)).toEqual(["New text"]);
    const single = scanSegments(document.body.querySelectorAll("p")[1]!.firstChild!, { nextId: () => "x" });
    expect(single).toHaveLength(1);
    expect(single[0]!.context).toBe("paragraph");
  });
});
