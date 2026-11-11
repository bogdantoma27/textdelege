import { describe, expect, it } from "vitest";
import { Indexed } from "../src/views/indexed";

const render = (text: string) => String(<Indexed text={text} />);

describe("Indexed", () => {
  it("sets the index after a caret as a superscript and keeps the caret hidden in the page", () => {
    expect(render("47^3")).toBe('47<span class="vh">^</span><sup>3</sup>');
  });

  it("handles several indices and the text around them", () => {
    expect(render("alin. (1^1), lit. a^2)")).toBe(
      'alin. (1<span class="vh">^</span><sup>1</sup>), lit. a<span class="vh">^</span><sup>2</sup>)',
    );
  });

  it("leaves text without an index as it is and escapes it", () => {
    expect(render("Art. 47")).toBe("Art. 47");
    expect(render("a < b")).toBe("a &lt; b");
  });

  it("leaves a caret that is not followed by digits", () => {
    expect(render("x^y")).toBe("x^y");
  });
});
